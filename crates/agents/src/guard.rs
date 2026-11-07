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
            Reason::Budget => "Agents held over half of this Mac's memory",
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
    let mut held: Vec<&Reading> = readings
        .iter()
        .filter(|r| r.agent.is_some() && !r.protected)
        .collect();
    held.sort_by(|a, b| b.memory.cmp(&a.memory).then(a.pid.cmp(&b.pid)));
    let mut sum: u64 = held.iter().map(|r| r.memory).sum();
    let mut ends = Vec::new();
    for r in &held {
        if sum <= budget {
            break;
        }
        sum -= r.memory;
        ends.push(r.pid);
    }
    if ends.is_empty() && level >= CRITICAL {
        ends.extend(held.first().map(|r| r.pid));
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
        let mut live = HashSet::new();
        let mut readings = Vec::new();
        let found: Vec<(Pid, u64, String, u64)> = self
            .system
            .processes()
            .iter()
            .map(|(pid, p)| {
                (
                    *pid,
                    p.start_time(),
                    p.name().to_string_lossy().into_owned(),
                    p.memory(),
                )
            })
            .collect();
        for (pid, start, name, rss) in found {
            let id = pid.as_u32();
            live.insert((id, start));
            let system = &mut self.system;
            let agent = self.marks.agent(id, start, || {
                system.refresh_processes_specifics(
                    ProcessesToUpdate::Some(&[pid]),
                    false,
                    ProcessRefreshKind::nothing().with_environ(UpdateKind::Always),
                );
                system
                    .process(pid)
                    .map(|p| p.environ().to_vec())
                    .unwrap_or_default()
            });
            if agent.is_none() {
                continue;
            }
            readings.push(Reading {
                pid: id,
                agent,
                memory: footprint(id).unwrap_or(rss),
                protected: id == own || claudes.contains(&id) || name == "claude",
                name,
            });
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
) -> std::thread::JoinHandle<()> {
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
        .expect("a thread starts")
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
        .join()
        .unwrap();
        let seen = seen.lock().unwrap();
        assert_eq!(seen.0, 3, "one reading per tick");
        assert!(seen.1.iter().all(|id| *id != std::thread::current().id()));
    }
}
