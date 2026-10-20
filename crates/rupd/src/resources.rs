//! D8: an Agent's Resource use, sampled inside `project.resources` and nowhere else. Memory and
//! CPU are read from the operating system's program table over the tree below the Agent's
//! program; disk is the size of the Agent's Worktree. Nothing here runs between calls, and
//! nothing is sent to an Agent.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use contracts::project::{AgentResources, ResourceTotal, Resources};

/// Two calls this close share one sample.
const SHARE: Duration = Duration::from_secs(1);
/// A Worktree's size is walked again no sooner than this.
const DISK_TTL: Duration = Duration::from_secs(30);
/// How long a call waits for the walks it started.
const WALK_WAIT: Duration = Duration::from_secs(1);
/// Clock ticks per second in `/proc/<pid>/stat`.
const TICKS: f64 = 100.0;

/// One program in the table.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Proc {
    pid: u32,
    ppid: u32,
    rss_bytes: u64,
    cpu_secs: f64,
}

/// The program table: `/proc` where there is one, else `ps`.
pub(crate) fn read_procs() -> Vec<Proc> {
    if Path::new("/proc/self/stat").exists() {
        return read_proc_fs();
    }
    let Ok(out) = std::process::Command::new("ps")
        .args(["-ax", "-o", "pid=,ppid=,rss=,time="])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    parse_ps(&String::from_utf8_lossy(&out.stdout))
}

fn read_proc_fs() -> Vec<Proc> {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    dir.flatten()
        .filter_map(|entry| {
            let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(entry.path().join("stat")).ok()?;
            // `pid (comm) state ppid …`: `comm` may hold parentheses, so cut after the last `)`.
            let fields: Vec<&str> = stat.rsplit_once(')')?.1.split_whitespace().collect();
            let ppid = fields.get(1)?.parse().ok()?;
            let ticks =
                fields.get(11)?.parse::<f64>().ok()? + fields.get(12)?.parse::<f64>().ok()?;
            let status = std::fs::read_to_string(entry.path().join("status")).unwrap_or_default();
            let kib = status
                .lines()
                .find_map(|line| line.strip_prefix("VmRSS:"))
                .and_then(|rest| rest.split_whitespace().next()?.parse::<u64>().ok())
                .unwrap_or(0);
            Some(Proc {
                pid,
                ppid,
                rss_bytes: kib * 1024,
                cpu_secs: ticks / TICKS,
            })
        })
        .collect()
}

/// `pid ppid rss-in-KiB cputime` rows, `cputime` as `[[dd-]hh:]mm:ss[.cc]`.
pub(crate) fn parse_ps(table: &str) -> Vec<Proc> {
    table
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let pid = words.next()?.parse().ok()?;
            let ppid = words.next()?.parse().ok()?;
            let kib: u64 = words.next()?.parse().ok()?;
            Some(Proc {
                pid,
                ppid,
                rss_bytes: kib * 1024,
                cpu_secs: parse_clock(words.next()?)?,
            })
        })
        .collect()
}

fn parse_clock(text: &str) -> Option<f64> {
    let (days, rest) = match text.split_once('-') {
        Some((days, rest)) => (days.parse::<f64>().ok()?, rest),
        None => (0.0, text),
    };
    let mut secs = 0.0;
    for part in rest.split(':') {
        secs = secs * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(days * 86400.0 + secs)
}

/// What the tree below `root` (itself included, however deep) holds: its programs' pids, their
/// resident memory in total, and each one's CPU seconds so far.
fn tree(procs: &[Proc], root: u32) -> (Vec<&Proc>, u64) {
    let mut children: HashMap<u32, Vec<&Proc>> = HashMap::new();
    for proc in procs {
        children.entry(proc.ppid).or_default().push(proc);
    }
    let mut found: Vec<&Proc> = procs.iter().filter(|p| p.pid == root).collect();
    let mut seen: HashSet<u32> = found.iter().map(|p| p.pid).collect();
    let mut at = 0;
    while at < found.len() {
        let pid = found[at].pid;
        at += 1;
        for child in children.get(&pid).into_iter().flatten() {
            if seen.insert(child.pid) {
                found.push(child);
            }
        }
    }
    let memory = found.iter().map(|p| p.rss_bytes).sum();
    (found, memory)
}

/// Percent of one core the `members` used over `elapsed` seconds. A program the previous sample
/// did not hold counts what it has used in all, when the Agent itself was there; with no earlier
/// sample of the Agent the reading is 0.
fn cpu_percent(members: &[&Proc], before: &HashMap<u32, f64>, known: bool, elapsed: f64) -> f64 {
    if !known || elapsed <= 0.0 {
        return 0.0;
    }
    let used: f64 = members
        .iter()
        .map(|p| (p.cpu_secs - before.get(&p.pid).copied().unwrap_or(0.0)).max(0.0))
        .sum();
    used / elapsed * 100.0
}

/// The size of the files under `root`, symlinks not followed; `None` when `root` is not there.
pub(crate) fn dir_size(root: &Path) -> Option<u64> {
    std::fs::symlink_metadata(root).ok()?;
    let mut total = 0;
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                pending.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    Some(total)
}

#[derive(Default)]
struct Disk {
    bytes: Option<u64>,
    walked: Option<Instant>,
    walking: bool,
}

#[derive(Default)]
struct State {
    at: Option<Instant>,
    last: Option<Resources>,
    /// CPU seconds of each program at the previous sample.
    cpu: HashMap<u32, f64>,
    /// The Agents the previous sample held.
    agents: HashSet<String>,
}

pub(crate) struct Sampler {
    state: tokio::sync::Mutex<State>,
    disks: Arc<Mutex<HashMap<PathBuf, Disk>>>,
    walk: Arc<dyn Fn(&Path) -> Option<u64> + Send + Sync>,
}

impl Default for Sampler {
    fn default() -> Self {
        Self {
            state: Default::default(),
            disks: Default::default(),
            walk: Arc::new(dir_size),
        }
    }
}

impl Sampler {
    /// The Resource use of `running` (Agent id and program pid) with `worktrees` (Agent id and
    /// Worktree path). A call within a second of the last returns the last one's numbers.
    pub(crate) async fn sample(
        &self,
        running: &[(String, u32)],
        worktrees: &HashMap<String, PathBuf>,
    ) -> Resources {
        let mut state = self.state.lock().await;
        if let (Some(at), Some(last)) = (state.at, &state.last)
            && at.elapsed() < SHARE
        {
            return last.clone();
        }
        let now = Instant::now();
        let elapsed = state
            .at
            .map_or(0.0, |at| now.duration_since(at).as_secs_f64());
        let procs = read_procs();
        let mut cpu = HashMap::new();
        let mut rows: Vec<(String, u64, f64)> = Vec::new();
        for (id, pid) in running {
            let (members, memory) = tree(&procs, *pid);
            let percent = cpu_percent(&members, &state.cpu, state.agents.contains(id), elapsed);
            cpu.extend(members.iter().map(|p| (p.pid, p.cpu_secs)));
            rows.push((id.clone(), memory, percent));
        }
        let paths: Vec<&PathBuf> = running
            .iter()
            .filter_map(|(id, _)| worktrees.get(id))
            .collect();
        let sizes = self.sizes(&paths).await;
        let agents: Vec<AgentResources> = rows
            .into_iter()
            .map(|(id, memory_bytes, cpu_percent)| AgentResources {
                disk_bytes: worktrees
                    .get(&id)
                    .and_then(|path| sizes.get(path).copied().flatten()),
                id,
                memory_bytes,
                cpu_percent,
            })
            .collect();
        let sized: Vec<u64> = agents.iter().filter_map(|a| a.disk_bytes).collect();
        let result = Resources {
            total: ResourceTotal {
                memory_bytes: agents.iter().map(|a| a.memory_bytes).sum(),
                cpu_percent: agents.iter().map(|a| a.cpu_percent).sum(),
                disk_bytes: (!sized.is_empty()).then(|| sized.iter().sum()),
            },
            agents,
        };
        state.agents = running.iter().map(|(id, _)| id.clone()).collect();
        state.cpu = cpu;
        state.at = Some(now);
        state.last = Some(result.clone());
        result
    }

    /// The size of each of `paths`: a walk is started for one not walked in the last 30 s, and
    /// waited for up to a second; a size not ready is the last one, or `None`.
    async fn sizes(&self, paths: &[&PathBuf]) -> HashMap<PathBuf, Option<u64>> {
        for path in paths {
            let mut disks = self.disks.lock().unwrap_or_else(|p| p.into_inner());
            let disk = disks.entry((*path).clone()).or_default();
            let stale = disk.walked.is_none_or(|at| at.elapsed() >= DISK_TTL);
            if stale && !disk.walking {
                disk.walking = true;
                let (disks, path, walk) = (
                    Arc::clone(&self.disks),
                    (*path).clone(),
                    Arc::clone(&self.walk),
                );
                std::thread::spawn(move || {
                    let bytes = walk(&path);
                    let mut disks = disks.lock().unwrap_or_else(|p| p.into_inner());
                    let disk = disks.entry(path).or_default();
                    disk.bytes = bytes;
                    disk.walked = Some(Instant::now());
                    disk.walking = false;
                });
            }
        }
        let deadline = Instant::now() + WALK_WAIT;
        loop {
            let done = {
                let disks = self.disks.lock().unwrap_or_else(|p| p.into_inner());
                paths
                    .iter()
                    .all(|path| disks.get(*path).is_none_or(|d| !d.walking))
            };
            if done || Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let disks = self.disks.lock().unwrap_or_else(|p| p.into_inner());
        paths
            .iter()
            .map(|path| {
                // A Worktree no longer on disk reads `None` whatever was walked before.
                let size = disks
                    .get(*path)
                    .and_then(|d| d.bytes)
                    .filter(|_| path.exists());
                ((*path).clone(), size)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(pid: u32, ppid: u32, rss_bytes: u64, cpu_secs: f64) -> Proc {
        Proc {
            pid,
            ppid,
            rss_bytes,
            cpu_secs,
        }
    }

    #[test]
    fn d8_memory_and_cpu_sum_the_whole_tree() {
        let procs = [
            proc(1, 0, 900, 9.0),
            proc(10, 1, 100, 1.0),
            proc(11, 10, 50, 2.0),
            proc(12, 11, 25, 3.0),
            proc(20, 1, 700, 7.0),
        ];
        let (members, memory) = tree(&procs, 10);

        assert_eq!(memory, 175);
        assert_eq!(
            members.iter().map(|p| p.pid).collect::<Vec<_>>(),
            [10, 11, 12]
        );
        let before = HashMap::from([(10, 0.5), (11, 1.0), (12, 2.0)]);
        // 0.5 + 1.0 + 1.0 seconds of CPU over 2 s.
        assert_eq!(cpu_percent(&members, &before, true, 2.0), 125.0);
    }

    #[test]
    fn d8_a_child_that_exits_leaves_the_sum() {
        let procs = [proc(10, 1, 100, 1.0), proc(11, 10, 50, 2.0)];
        assert_eq!(tree(&procs, 10).1, 150);
        assert_eq!(tree(&procs[..1], 10).1, 100);
    }

    #[test]
    fn d8_the_first_cpu_reading_is_zero() {
        let procs = [proc(10, 1, 100, 5.0)];
        let (members, _) = tree(&procs, 10);

        assert_eq!(cpu_percent(&members, &HashMap::new(), false, 1.0), 0.0);
        // A program started since the last sample counts all it has used.
        assert_eq!(cpu_percent(&members, &HashMap::new(), true, 10.0), 50.0);
    }

    #[test]
    fn d8_ps_rows_and_clocks_parse() {
        let rows = parse_ps("  10     1   2048   1:02.50\n  11    10    100 1-00:00:01\nnoise\n");

        assert_eq!(rows[0], proc(10, 1, 2048 * 1024, 62.5));
        assert_eq!(rows[1].cpu_secs, 86401.0);
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn d8_disk_is_the_worktrees_size_and_null_without_one() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a"), [0u8; 100]).unwrap();
        std::fs::write(dir.path().join("sub/b"), [0u8; 23]).unwrap();

        assert_eq!(dir_size(dir.path()), Some(123));
        assert_eq!(dir_size(&dir.path().join("gone")), None);
    }

    #[tokio::test]
    async fn d8_a_disk_size_is_cached_for_30_s_and_a_missing_worktree_reads_null() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a"), [0u8; 10]).unwrap();
        let sampler = Sampler::default();
        let path = dir.path().to_path_buf();

        assert_eq!(sampler.sizes(&[&path]).await[&path], Some(10));
        std::fs::write(dir.path().join("b"), [0u8; 5]).unwrap();
        assert_eq!(sampler.sizes(&[&path]).await[&path], Some(10));
        // Advance only the cache's stored completion time: expire it at D8's 30 s boundary.
        sampler.disks.lock().unwrap().get_mut(&path).unwrap().walked =
            Some(Instant::now() - Duration::from_secs(30));
        assert_eq!(sampler.sizes(&[&path]).await[&path], Some(15));
        drop(dir);
        assert_eq!(sampler.sizes(&[&path]).await[&path], None);
    }

    #[tokio::test]
    async fn d8_totals_add_the_agents() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        std::fs::write(a.path().join("f"), [0u8; 40]).unwrap();
        std::fs::write(b.path().join("f"), [0u8; 2]).unwrap();
        let me = std::process::id();
        let running = [
            ("a1".to_owned(), me),
            ("a2".to_owned(), me),
            ("a3".to_owned(), me),
        ];
        let worktrees = HashMap::from([
            ("a1".to_owned(), a.path().to_path_buf()),
            ("a2".to_owned(), b.path().to_path_buf()),
        ]);

        let got = Sampler::default().sample(&running, &worktrees).await;

        assert_eq!(got.agents.len(), 3);
        assert_eq!(got.agents[2].disk_bytes, None);
        assert_eq!(got.total.disk_bytes, Some(42));
        assert_eq!(
            got.total.memory_bytes,
            got.agents.iter().map(|a| a.memory_bytes).sum::<u64>()
        );
    }

    #[tokio::test]
    async fn d8_a_done_agent_has_no_entry() {
        let me = std::process::id();
        let sampler = Sampler::default();
        let both = [("a1".to_owned(), me), ("a2".to_owned(), me)];
        assert_eq!(sampler.sample(&both, &HashMap::new()).await.agents.len(), 2);

        // A second later `a2` is done: the caller no longer passes it.
        sampler.state.lock().await.at = Some(Instant::now() - Duration::from_secs(1));
        let got = sampler.sample(&both[..1], &HashMap::new()).await;
        assert_eq!(
            got.agents.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["a1"]
        );
    }

    #[tokio::test]
    async fn d8_a_disk_size_is_cached_for_30_s_and_the_walk_never_holds_the_call_past_1_s() {
        let dir = tempfile::tempdir().unwrap();
        let mut sampler = Sampler::default();
        let cached = dir.path().join("cached");
        let unknown = dir.path().join("unknown");
        std::fs::create_dir(&cached).unwrap();
        std::fs::create_dir(&unknown).unwrap();
        std::fs::write(cached.join("before"), [0; 7]).unwrap();
        assert_eq!(sampler.sizes(&[&cached]).await[&cached], Some(7));
        std::fs::write(cached.join("after"), [0; 2]).unwrap();
        sampler
            .disks
            .lock()
            .unwrap()
            .get_mut(&cached)
            .unwrap()
            .walked = Some(Instant::now() - Duration::from_secs(30));

        // Block the actual walk, not the sampler state. Moving it onto the caller must fail
        // this bound too. The finite hold prevents that mutant from stranding the test thread.
        let release = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let held = Arc::clone(&release);
        let (entered, arrivals) = std::sync::mpsc::channel();
        sampler.walk = Arc::new(move |path| {
            entered.send(()).unwrap();
            let (lock, ready) = &*held;
            let _hold = ready
                .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(3), |released| {
                    !*released
                })
                .unwrap();
            dir_size(path)
        });
        let start = Instant::now();
        let sizes = tokio::time::timeout(
            Duration::from_millis(1500),
            sampler.sizes(&[&cached, &unknown]),
        )
        .await;
        let elapsed = start.elapsed();
        // Release both real walks even if the caller exceeded its budget.
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        assert!(elapsed < Duration::from_millis(1500));
        let sizes = sizes.expect("a walk must not hold the call past its budget");
        assert_eq!(arrivals.try_iter().count(), 2);
        assert_eq!(sizes[&cached], Some(7));
        assert_eq!(sizes[&unknown], None);
        let finished = sampler.sizes(&[&cached, &unknown]).await;
        assert_eq!(finished[&cached], Some(9));
        assert_eq!(finished[&unknown], Some(0));
    }

    #[tokio::test]
    async fn d8_two_calls_within_a_second_share_one_sample_and_a_done_agent_has_no_entry() {
        let sampler = Sampler::default();
        let me = std::process::id();
        let running = [("a1".to_owned(), me)];

        let first = sampler.sample(&running, &HashMap::new()).await;
        let second = sampler.sample(&[], &HashMap::new()).await;

        assert_eq!(first, second);
        assert_eq!(first.agents[0].id, "a1");
        assert!(first.agents[0].memory_bytes > 0);
        assert_eq!(first.agents[0].cpu_percent, 0.0);
        assert_eq!(first.total.disk_bytes, None);
        let none = Sampler::default().sample(&[], &HashMap::new()).await;
        assert_eq!(
            (
                none.agents.len(),
                none.total.memory_bytes,
                none.total.disk_bytes
            ),
            (0, 0, None)
        );
    }
}
