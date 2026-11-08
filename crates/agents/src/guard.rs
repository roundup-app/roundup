//! AMG1–AMG4: the memory guard. A process is an Agent's when its environment holds
//! `ROUNDUP_AGENT`; when the Agents' processes together pass the budget, or the Mac's memory
//! pressure runs critical, the largest of them is ended with SIGKILL. A stopped process keeps its
//! memory, so nothing is stopped, and nothing is resumed or rerun afterwards.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::time::Duration;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// The environment variable the launch command sets to the Agent's id.
const MARK: &str = "ROUNDUP_AGENT=";
/// The `kern.memorystatus_vm_pressure_level` at which the Mac's memory is critical.
const CRITICAL: u8 = 4;
/// Time between two readings of the process list.
const TICK: Duration = Duration::from_secs(1);

/// One process as the guard reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reading {
    pub pid: u32,
    /// The Agent whose marker the process carries, or `None` for an unmarked process.
    pub agent: Option<String>,
    pub memory: u64,
    pub name: String,
    /// An Agent's own `claude` or the Daemon: never ended.
    pub protected: bool,
}

/// Why a process was ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Budget,
    Critical,
}

/// A process the guard ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct End {
    pub agent: String,
    pub name: String,
    pub memory: u64,
    pub reason: Reason,
}

impl End {
    /// The note the Agent and its Door get: the process, its memory, the reason and the fix.
    pub fn note(&self) -> String {
        const GB: u64 = 1 << 30;
        let size = if self.memory >= GB {
            format!("{} GB", self.memory / GB)
        } else {
            format!("{} MB", self.memory >> 20)
        };
        let reason = match self.reason {
            Reason::Budget => "Agents used over half of this Mac's memory",
            Reason::Critical => "this Mac's memory ran critical",
        };
        format!(
            "roundup ended {} ({size}): {reason}; run fewer at once",
            self.name
        )
    }
}

/// What one reading of the machine returns.
pub struct Sample {
    pub readings: Vec<Reading>,
    pub ram: u64,
    pub level: u8,
}

/// The machine, as the sampler reads and acts on it.
pub trait Source: Send + 'static {
    fn sample(&mut self) -> Sample;
    fn end(&mut self, pid: u32);
}

/// AMG2: the pids to end. Only Agents' processes count and only they can be returned, never a
/// `claude`. Over `budget` it returns the largest first until the rest is at or under it; at
/// critical `level` with nothing over it, the largest alone.
pub fn decide(readings: &[Reading], budget: u64, level: u8) -> Vec<u32> {
    let mut big: Vec<&Reading> = readings
        .iter()
        .filter(|r| r.agent.is_some() && !r.protected)
        .collect();
    big.sort_by(|a, b| b.memory.cmp(&a.memory).then(a.pid.cmp(&b.pid)));
    let mut sum: u64 = big.iter().map(|r| r.memory).sum();
    let mut ends = Vec::new();
    for r in &big {
        if sum <= budget {
            break;
        }
        sum -= r.memory;
        ends.push(r.pid);
    }
    if ends.is_empty() && level >= CRITICAL {
        ends.extend(big.first().map(|r| r.pid));
    }
    ends
}

/// AMG1: each process's marker, read from its environment once per pid and start time.
#[derive(Default)]
pub struct Marks {
    seen: HashMap<(u32, u64), Option<String>>,
}

impl Marks {
    /// The Agent marking `pid`; `read` fetches its environment and runs only the first time.
    pub fn agent(
        &mut self,
        pid: u32,
        start: u64,
        read: impl FnOnce() -> Vec<OsString>,
    ) -> Option<String> {
        self.seen
            .entry((pid, start))
            .or_insert_with(|| marker(&read()))
            .clone()
    }

    /// Forget processes that no longer run.
    fn keep(&mut self, live: &HashSet<(u32, u64)>) {
        self.seen.retain(|key, _| live.contains(key));
    }
}

/// The Agent id in an environment of `KEY=value` entries.
pub fn marker(environ: &[OsString]) -> Option<String> {
    environ
        .iter()
        .find_map(|entry| entry.to_str()?.strip_prefix(MARK))
        .map(str::to_owned)
}

/// One process of the machine's list, before any marker is read.
pub struct Proc {
    pub pid: u32,
    pub parent: Option<u32>,
    pub start: u64,
    pub name: String,
    pub memory: u64,
}

/// AMG5: the Agents' processes among `procs`. A Daemon an Agent started inherits the Agent's
/// marker, so `own` and every process descended from it is unmarked, whatever its environment.
pub fn read(
    procs: &[Proc],
    own: u32,
    claudes: &HashSet<u32>,
    mut mark: impl FnMut(&Proc) -> Option<String>,
) -> Vec<Reading> {
    let parents: HashMap<u32, Option<u32>> = procs.iter().map(|p| (p.pid, p.parent)).collect();
    let in_daemon = |mut pid: u32| {
        // The step bound keeps a cyclic parent table from looping.
        for _ in 0..parents.len() {
            if pid == own {
                return true;
            }
            match parents.get(&pid) {
                Some(Some(parent)) => pid = *parent,
                _ => return false,
            }
        }
        false
    };
    procs
        .iter()
        .filter(|p| !in_daemon(p.pid))
        .filter_map(|p| {
            let agent = mark(p)?;
            Some(Reading {
                pid: p.pid,
                agent: Some(agent),
                memory: p.memory,
                protected: claudes.contains(&p.pid) || p.name == "claude",
                name: p.name.clone(),
            })
        })
        .collect()
}

/// The real machine: `sysinfo` for processes and environments, `pidrusage` for macOS footprints.
pub struct Live {
    system: System,
    marks: Marks,
    /// The pids of the Agents' `claude` programs, asked afresh at each reading.
    claudes: Box<dyn Fn() -> HashSet<u32> + Send>,
}

impl Live {
    pub fn new(claudes: impl Fn() -> HashSet<u32> + Send + 'static) -> Self {
        Self {
            system: System::new(),
            marks: Marks::default(),
            claudes: Box::new(claudes),
        }
    }
}

impl Source for Live {
    fn sample(&mut self) -> Sample {
        self.system.refresh_memory();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_memory(),
        );
        let claudes = (self.claudes)();
        let own = std::process::id();
        let found: Vec<Proc> = self
            .system
            .processes()
            .iter()
            // Linux lists each thread as a process sharing its process's RSS; counting them
            // would charge one Agent's memory once per thread.
            .filter(|(_, p)| p.thread_kind().is_none())
            .map(|(pid, p)| Proc {
                pid: pid.as_u32(),
                parent: p.parent().map(Pid::as_u32),
                start: p.start_time(),
                name: p.name().to_string_lossy().into_owned(),
                memory: p.memory(),
            })
            .collect();
        let live: HashSet<(u32, u64)> = found.iter().map(|p| (p.pid, p.start)).collect();
        let marks = &mut self.marks;
        let system = &mut self.system;
        let mut readings = read(&found, own, &claudes, |p| {
            marks.agent(p.pid, p.start, || {
                let pid = Pid::from_u32(p.pid);
                system.refresh_processes_specifics(
                    ProcessesToUpdate::Some(&[pid]),
                    false,
                    ProcessRefreshKind::nothing().with_environ(UpdateKind::Always),
                );
                system
                    .process(pid)
                    .map(|p| p.environ().to_vec())
                    .unwrap_or_default()
            })
        });
        for r in &mut readings {
            if let Some(f) = footprint(r.pid) {
                r.memory = f;
            }
        }
        self.marks.keep(&live);
        Sample {
            readings,
            ram: self.system.total_memory(),
            level: pressure(),
        }
    }

    fn end(&mut self, pid: u32) {
        use rustix::process::{Pid, Signal, kill_process};
        if let Some(pid) = i32::try_from(pid).ok().and_then(Pid::from_raw) {
            let _ = kill_process(pid, Signal::KILL);
        }
    }
}

/// macOS's `phys_footprint`, the figure Activity Monitor shows; elsewhere `None`, so the RSS read
/// from `/proc` stands.
#[cfg(target_vendor = "apple")]
fn footprint(pid: u32) -> Option<u64> {
    use libproc::pid_rusage::{RUsageInfoV2, pidrusage};
    let usage = pidrusage::<RUsageInfoV2>(i32::try_from(pid).ok()?).ok()?;
    Some(usage.ri_phys_footprint)
}

#[cfg(not(target_vendor = "apple"))]
fn footprint(_pid: u32) -> Option<u64> {
    None
}

/// `kern.memorystatus_vm_pressure_level`: 1 normal, 2 warning, 4 critical. Linux reads 1.
#[cfg(target_vendor = "apple")]
fn pressure() -> u8 {
    use sysctl::Sysctl;
    sysctl::Ctl::new("kern.memorystatus_vm_pressure_level")
        .and_then(|ctl| ctl.value())
        .ok()
        .and_then(|value| match value {
            sysctl::CtlValue::Int(level) => u8::try_from(level).ok(),
            _ => None,
        })
        .unwrap_or(1)
}

#[cfg(not(target_vendor = "apple"))]
fn pressure() -> u8 {
    1
}

/// Lock the Daemon's pages in memory so the sampler runs while the Mac thrashes. macOS has no
/// `mlockall`, and a refusal for a low lock limit is no harm: the sampler then runs unlocked.
#[cfg(target_os = "linux")]
fn lock_memory() {
    use nix::sys::mman::{MlockAllFlags, mlockall};
    let _ = mlockall(MlockAllFlags::MCL_CURRENT);
}

#[cfg(not(target_os = "linux"))]
fn lock_memory() {}

/// A tick that waits one second and never stops.
pub fn every_second() -> impl FnMut() -> bool + Send + 'static {
    || {
        std::thread::sleep(TICK);
        true
    }
}

/// AMG4: the sampler on its own thread. Per tick it reads once, decides, ends with SIGKILL and
/// reports each end to `told`; it stops when `tick` returns false. `budget` is the sum Agents may
/// hold, half the machine's RAM when `None`. `lock` pins the Daemon's memory first.
pub fn spawn(
    mut source: impl Source,
    budget: Option<u64>,
    lock: bool,
    mut tick: impl FnMut() -> bool + Send + 'static,
    mut told: impl FnMut(End) + Send + 'static,
) -> std::io::Result<std::thread::JoinHandle<()>> {
    std::thread::Builder::new()
        .name("memory-guard".into())
        .spawn(move || {
            if lock {
                lock_memory();
            }
            while tick() {
                let sample = source.sample();
                let budget = budget.unwrap_or(sample.ram / 2);
                let over = sample
                    .readings
                    .iter()
                    .filter(|r| r.agent.is_some() && !r.protected)
                    .map(|r| r.memory)
                    .sum::<u64>()
                    > budget;
                for pid in decide(&sample.readings, budget, sample.level) {
                    source.end(pid);
                    if let Some(r) = sample.readings.iter().find(|r| r.pid == pid) {
                        told(End {
                            agent: r.agent.clone().unwrap_or_default(),
                            name: r.name.clone(),
                            memory: r.memory,
                            reason: if over {
                                Reason::Budget
                            } else {
                                Reason::Critical
                            },
                        });
                    }
                }
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const GB: u64 = 1 << 30;

    fn reading(pid: u32, agent: Option<&str>, memory: u64, name: &str) -> Reading {
        Reading {
            pid,
            agent: agent.map(str::to_owned),
            memory,
            name: name.into(),
            protected: name == "claude",
        }
    }

    /// The shape of the 2026-11-07 panic logs: `n` `python3.13` processes of 1 to 22 GB, more than
    /// twice the budget in all, with an Agent's `claude` and a user's Chrome far larger than any.
    fn panic_log(n: u32) -> Vec<Reading> {
        let mut all: Vec<Reading> = (0..n)
            .map(|i| {
                let gb = 1 + u64::from(i * 7919 % 22);
                reading(1000 + i, Some("45"), gb * GB, "python3.13")
            })
            .collect();
        all.push(reading(1, Some("45"), 40 * GB, "claude"));
        all.push(reading(2, None, 50 * GB, "Google Chrome"));
        all
    }

    #[test]
    fn amg2_replays_the_panic_logs_at_64_gb() {
        for n in [87, 28] {
            let readings = panic_log(n);
            let budget = 32 * GB;
            let sum = |ends: &[u32]| -> u64 {
                readings
                    .iter()
                    .filter(|r| r.agent.is_some() && r.name != "claude" && !ends.contains(&r.pid))
                    .map(|r| r.memory)
                    .sum()
            };
            assert!(sum(&[]) > budget, "{n} processes pass the budget");
            let ends = decide(&readings, budget, 1);
            assert!(
                !ends.contains(&1) && !ends.contains(&2),
                "claude or unmarked ended"
            );
            let sizes: Vec<u64> = ends
                .iter()
                .map(|pid| readings.iter().find(|r| r.pid == *pid).unwrap().memory)
                .collect();
            assert!(sizes.windows(2).all(|w| w[0] >= w[1]), "largest first");
            assert!(sum(&ends) <= budget);
            let last = sizes.last().unwrap();
            assert!(sum(&ends) + last > budget, "no more ended than needed");
        }
    }

    #[test]
    fn amg2_critical_pressure_ends_the_largest_under_budget() {
        let readings = [
            reading(10, Some("1"), 2 * GB, "node"),
            reading(11, Some("1"), 3 * GB, "python3"),
            reading(12, Some("1"), 90 * GB, "claude"),
        ];
        assert_eq!(decide(&readings, 32 * GB, 4), vec![11]);
        assert!(decide(&readings, 32 * GB, 2).is_empty());
    }

    #[test]
    fn amg2_budget_boundary_ends_nothing() {
        let readings = [
            reading(10, Some("1"), 16 * GB, "a"),
            reading(11, Some("2"), 16 * GB, "b"),
        ];
        assert!(decide(&readings, 32 * GB, 1).is_empty());
        assert_eq!(decide(&readings, 32 * GB - 1, 1), vec![10]);
    }

    #[test]
    fn amg1_environment_is_read_once_per_pid_and_start_time() {
        let env = |agent: &str| {
            vec![
                OsString::from("A=b"),
                OsString::from(format!("{MARK}{agent}")),
            ]
        };
        let mut marks = Marks::default();
        let mut reads = 0;
        for _ in 0..3 {
            let got = marks.agent(7, 100, || {
                reads += 1;
                env("45")
            });
            assert_eq!(got.as_deref(), Some("45"));
        }
        assert_eq!(reads, 1);
        assert_eq!(
            marks
                .agent(7, 200, || {
                    reads += 1;
                    env("46")
                })
                .as_deref(),
            Some("46")
        );
        assert_eq!(reads, 2);
        assert_eq!(marker(&[OsString::from("ROUNDUP_AGENT_ID=3")]), None);
    }

    #[test]
    fn amg5_a_daemon_started_by_an_agent_and_its_children_are_unmarked() {
        let proc = |pid, parent, name: &str, memory| Proc {
            pid,
            parent: Some(parent),
            start: 1,
            name: name.into(),
            memory,
        };
        let procs = vec![
            proc(10, 1, "daemon", GB),
            proc(11, 10, "rup", 40 * GB),
            proc(12, 11, "helper", 40 * GB),
            proc(20, 1, "python3", 40 * GB),
        ];
        let got = read(&procs, 10, &HashSet::new(), |_| Some("N".into()));
        assert_eq!(got.iter().map(|r| r.pid).collect::<Vec<_>>(), vec![20]);
        assert_eq!(got[0].agent.as_deref(), Some("N"));
        assert_eq!(decide(&got, 32 * GB, 1), vec![20]);
    }

    struct Counting(Arc<Mutex<(usize, Vec<std::thread::ThreadId>)>>);

    impl Source for Counting {
        fn sample(&mut self) -> Sample {
            let mut seen = self.0.lock().unwrap();
            seen.0 += 1;
            seen.1.push(std::thread::current().id());
            Sample {
                readings: vec![],
                ram: 64 * GB,
                level: 1,
            }
        }
        fn end(&mut self, _: u32) {}
    }

    #[test]
    fn amg4_sampler_reads_once_a_second_on_its_own_thread() {
        let seen = Arc::new(Mutex::new((0, vec![])));
        let mut ticks = 0;
        spawn(
            Counting(Arc::clone(&seen)),
            None,
            false,
            move || {
                ticks += 1;
                ticks <= 3
            },
            drop,
        )
        .unwrap()
        .join()
        .unwrap();
        let seen = seen.lock().unwrap();
        assert_eq!(seen.0, 3, "one reading per tick");
        assert!(seen.1.iter().all(|id| *id != std::thread::current().id()));
    }
}
