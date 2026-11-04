//! DCL3: work that outlives a foreground `Stop`. A native background Agent has no long-lived
//! process of its own, so it is a retained task fact (`SubagentStart` until its own
//! `SubagentStop`); a background shell or Monitor is a process under the program, seen through a
//! process snapshot. Services of the program itself never count as work.

use std::collections::{BTreeMap, BTreeSet};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Hook events that open and close a background Agent. Apart from `STATE_EVENTS`: H15's replay
/// rule covers the events that move a Kind, and these move only this fact.
/// DCL5's `PostCompact` rides along: the vendor's completed-compaction event, with `PreCompact`
/// deliberately not hooked since a start is not a completion.
pub const BACKGROUND_EVENTS: [&str; 3] = ["SubagentStart", "SubagentStop", "PostCompact"];

/// `ps` reports a process's age in whole seconds.
const START_SLACK_MS: i64 = 1500;

/// How often work that outlives a Stop is looked at again.
pub const POLL_MS: i64 = 2000;

/// The process table with each process's age, as `ps` prints it on macOS and Linux.
pub(crate) fn read_table() -> std::io::Result<String> {
    let out = Command::new("ps")
        .args(["-ax", "-ww", "-o", "pid=,ppid=,etime=,args="])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()?;
    if !out.status.success() {
        return Err(std::io::Error::other(format!("ps exited {}", out.status)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The processes of a `read_table` listing taken at `now` (Unix milliseconds); a row that is not
/// `pid ppid etime args` is skipped.
pub(crate) fn snapshot(table: &str, now: i64) -> Vec<Process> {
    table
        .lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let (pid, parent) = (words.next()?.parse().ok()?, words.next()?.parse().ok()?);
            let age = etime_seconds(words.next()?)?;
            Some(Process {
                pid,
                parent,
                started: now - age * 1000,
                command: words.map(str::to_owned).collect(),
            })
        })
        .collect()
}

/// `[[dd-]hh:]mm:ss` in seconds.
fn etime_seconds(etime: &str) -> Option<i64> {
    let (days, clock) = etime.split_once('-').unwrap_or(("0", etime));
    let mut seconds = days.parse::<i64>().ok()? * 86_400;
    let parts: Vec<&str> = clock.split(':').collect();
    if parts.len() > 3 {
        return None;
    }
    let mut unit = 1;
    for part in parts.iter().rev() {
        seconds += part.parse::<i64>().ok()? * unit;
        unit *= 60;
    }
    Some(seconds)
}

/// One process of a snapshot. `started` (Unix milliseconds) tells work of this turn from a service
/// that was already running, and a reused PID from the process first seen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub pid: u32,
    pub parent: u32,
    pub started: i64,
    /// The command line, program first.
    pub command: Vec<String>,
}

/// What retained facts and the latest process snapshot say is still running.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Background {
    /// Open background Agents by their id: retained across a Daemon reopen.
    pub agents: BTreeSet<String>,
    /// Work processes by PID and the start time they were first seen with.
    pub processes: BTreeMap<u32, i64>,
    /// Why the last process observation failed; work is then not known to have ended.
    pub unavailable: Option<String>,
    /// A foreground `Stop` came and no prompt has followed.
    pub stopped: bool,
}

/// The task facts a Daemon reopen keeps (A12a's owner record): which background Agents are open
/// and the turn they belong to. Process facts are not kept: the reopened Daemon reads liveness
/// from the process table again.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Retained {
    agents: BTreeSet<String>,
    stopped: bool,
    /// Unix milliseconds; work older than this is a service, so a reopen must not move it.
    turn_started: i64,
}

impl Retained {
    pub(super) fn new(background: &Background, turn_started: i64) -> Option<Self> {
        (background.stopped || !background.agents.is_empty()).then(|| Self {
            agents: background.agents.clone(),
            stopped: background.stopped,
            turn_started,
        })
    }

    pub(super) fn turn_started(&self) -> i64 {
        self.turn_started
    }

    /// The facts as a reopened `Background`: after a Stop, work is not known to have ended until
    /// the first snapshot is read.
    pub(super) fn reopen(self) -> Background {
        Background {
            agents: self.agents,
            processes: BTreeMap::new(),
            unavailable: self
                .stopped
                .then(|| "process table not read since the Daemon reopened".into()),
            stopped: self.stopped,
        }
    }
}

impl Background {
    pub fn holds(&self) -> bool {
        !self.agents.is_empty() || !self.processes.is_empty() || self.unavailable.is_some()
    }

    /// A hook payload's effect on the open Agents. A stop for an id never started (the spurious
    /// `SubagentStop` of ADR 0006) or with no id changes nothing.
    pub(super) fn hook(&mut self, payload: &Value) {
        let id = payload["agent_id"].as_str().map(str::to_owned);
        match (payload["hook_event_name"].as_str(), id) {
            (Some("SubagentStart"), Some(id)) => {
                self.agents.insert(id);
            }
            (Some("SubagentStop"), Some(id)) => {
                self.agents.remove(&id);
            }
            (Some("SessionStart" | "SessionEnd"), _) => self.agents.clear(),
            _ => {}
        }
    }

    /// Replace the process facts with what `snapshot` shows under `root`; an `Err` keeps them and
    /// records the cause. `rup` calls and hook shells are services, not work.
    pub fn observe(&mut self, root: u32, snapshot: Result<&[Process], String>, since: i64) {
        let snapshot = match snapshot {
            Ok(snapshot) => snapshot,
            Err(cause) => {
                self.unavailable = Some(cause);
                return;
            }
        };
        self.unavailable = None;
        let by_pid: BTreeMap<u32, &Process> = snapshot.iter().map(|p| (p.pid, p)).collect();
        let mut work = BTreeMap::new();
        for process in snapshot {
            // A process older than the turn (an MCP server) is a service, not work.
            if process.pid == root
                || process.started + START_SLACK_MS < since
                || !under(root, process, &by_pid)
            {
                continue;
            }
            // Keyed by PID with its start time, so a reused PID is the new process it is.
            work.insert(process.pid, process.started);
        }
        self.processes = work;
    }
}

fn service(process: &Process) -> bool {
    let name = |arg: &str| arg.rsplit('/').next().unwrap_or(arg).to_owned();
    let program = process.command.first().map(|p| name(p)).unwrap_or_default();
    let rup_args = |args: &[String]| {
        args.get(1)
            .is_some_and(|arg| matches!(arg.as_str(), "mcp" | "signal" | "context"))
    };
    let rup = program == "rup" && rup_args(&process.command);
    // A hook runs through a shell: `sh -c "rup signal 7"` is the hook, not work.
    let hook_shell = matches!(program.as_str(), "sh" | "bash" | "zsh")
        && process.command.get(1).is_some_and(|flag| flag == "-c")
        && process.command.get(2).is_some_and(|script| {
            let words: Vec<String> = script.split_whitespace().map(name).collect();
            words.first().is_some_and(|w| w == "rup") && rup_args(&words)
        });
    rup || hook_shell
}

/// Whether `process` descends from `root` through no service.
fn under(root: u32, process: &Process, by_pid: &BTreeMap<u32, &Process>) -> bool {
    let mut at = process;
    for _ in 0..by_pid.len() + 1 {
        if service(at) {
            return false;
        }
        if at.parent == root {
            return true;
        }
        match by_pid.get(&at.parent) {
            Some(next) => at = next,
            None => return false,
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::claude_code::ClaudeCode;
    use contracts::Kind;

    fn proc(pid: u32, parent: u32, started: i64, command: &[&str]) -> Process {
        Process {
            pid,
            parent,
            started,
            command: command.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn agent() -> ClaudeCode {
        let mut a = ClaudeCode::new(|| 0);
        a.observe_completion(crate::Observation::Signal(
            json!({"hook_event_name":"SessionStart"}),
        ));
        a
    }

    fn hook(a: &mut ClaudeCode, payload: Value) -> Option<contracts::Status> {
        a.observe_completion(crate::Observation::Signal(payload)).0
    }

    fn kind(a: &ClaudeCode) -> Kind {
        a.status().unwrap().kind
    }

    /// The #5928 real-Claude run: a background Agent and a Monitor outlive the main Stop.
    #[test]
    fn dcl3_background_bash_monitor_and_task_hold_working() {
        let mut a = agent();
        hook(&mut a, json!({"hook_event_name":"UserPromptSubmit"}));
        hook(
            &mut a,
            json!({"hook_event_name":"SubagentStart","agent_id":"C"}),
        );
        hook(
            &mut a,
            json!({"hook_event_name":"PreToolUse","tool_name":"Monitor"}),
        );
        hook(&mut a, json!({"hook_event_name":"Stop"}));
        assert_eq!(kind(&a), Kind::Working, "background Agent holds Working");
        let finished = a.status().unwrap().finished.clone();
        hook(
            &mut a,
            json!({"hook_event_name":"PostToolUse","agent_id":"C","tool_name":"Bash"}),
        );
        assert_eq!(kind(&a), Kind::Working);
        // The Agent ends but a shell and its sleep still run under the program.
        let shell = [proc(10, 1, 5, &["bash"]), proc(11, 10, 6, &["sleep", "15"])];
        a.observe_processes(1, Ok(&shell));
        hook(
            &mut a,
            json!({"hook_event_name":"SubagentStop","agent_id":"C"}),
        );
        assert_eq!(kind(&a), Kind::Working, "the shell still runs");
        assert_eq!(a.status().unwrap().finished, finished);
        let done = a.observe_processes(1, Ok(&[])).expect("released");
        assert_eq!(done.kind, Kind::Idle);
        assert_eq!(
            done.finished,
            (finished.parse::<u64>().unwrap() + 1).to_string()
        );
        assert!(a.observe_processes(1, Ok(&[])).is_none(), "completes once");
    }

    #[test]
    fn dcl3_service_and_hook_processes_do_not_hold_working() {
        let mut a = agent();
        hook(&mut a, json!({"hook_event_name":"UserPromptSubmit"}));
        hook(&mut a, json!({"hook_event_name":"Stop"}));
        let only_services = [
            proc(2, 1, 1, &["/usr/bin/rup", "mcp"]),
            proc(3, 1, 1, &["sh", "-c", "/usr/bin/rup signal 7"]),
            proc(4, 3, 1, &["/usr/bin/rup", "signal", "7"]),
        ];
        a.observe_processes(1, Ok(&only_services));
        assert_eq!(kind(&a), Kind::Idle);
        assert!(!a.background().holds());
        // An MCP server of any name that started before the turn is a service, not work; a
        // `ps` listing gives each process's age.
        let mut b = ClaudeCode::new(|| 400_000);
        hook(&mut b, json!({"hook_event_name":"UserPromptSubmit"}));
        hook(&mut b, json!({"hook_event_name":"Stop"}));
        let table = "  2     1 05:00 npx some-mcp\n  3     1    00:02 sleep 30\n";
        b.observe_processes(1, Ok(&snapshot(table, 410_000)));
        assert_eq!(b.background().processes.keys().collect::<Vec<_>>(), [&3]);
        assert_eq!(etime_seconds("1-02:03:04"), Some(93_784));
    }

    #[test]
    fn dcl3_missing_hook_restart_and_stale_stop_reconcile() {
        let mut a = agent();
        hook(&mut a, json!({"hook_event_name":"UserPromptSubmit"}));
        hook(
            &mut a,
            json!({"hook_event_name":"SubagentStart","agent_id":"C"}),
        );
        // A stop for an id never started is the spurious one of ADR 0006.
        hook(
            &mut a,
            json!({"hook_event_name":"SubagentStop","agent_id":"other"}),
        );
        hook(&mut a, json!({"hook_event_name":"SubagentStop"}));
        hook(&mut a, json!({"hook_event_name":"Stop"}));
        assert_eq!(kind(&a), Kind::Working);
        let work = [proc(10, 1, 5, &["sleep", "9"])];
        a.observe_processes(1, Ok(&work));
        // Daemon reopen: a fresh adapter adopts the kept task facts and reads liveness again.
        let kept = a.retained().expect("C is open after the Stop");
        let mut b = ClaudeCode::starting(|| 0);
        b.resume_background(kept);
        assert_eq!(kind(&b), Kind::Working, "work is not known to have ended");
        assert!(b.background().unavailable.is_some());
        b.observe_processes(1, Ok(&work));
        assert_eq!(b.background().processes.len(), 1);
        // A stale stop of another id ends no unrelated work; C's own stop ends only C.
        hook(
            &mut b,
            json!({"hook_event_name":"SubagentStop","agent_id":"other"}),
        );
        assert_eq!(b.background().agents.len(), 1);
        hook(
            &mut b,
            json!({"hook_event_name":"SubagentStop","agent_id":"C"}),
        );
        assert_eq!(kind(&b), Kind::Working, "the process still runs");
        // PID 10 now belongs to an unrelated process outside the program: the old work ended.
        let reused = [proc(10, 99, 77, &["vim"])];
        b.observe_processes(1, Ok(&reused));
        assert!(b.background().processes.is_empty());
        assert_eq!(kind(&b), Kind::Idle, "a reused PID holds nothing");
        assert!(b.retained().is_none(), "nothing is left to keep");
        // A Stop with no open work finishes at once.
        let mut c = agent();
        hook(&mut c, json!({"hook_event_name":"Stop"}));
        assert_eq!(kind(&c), Kind::Idle);
        // A dropped SubagentStop keeps the Agent Working until the session restarts.
        hook(&mut a, json!({"hook_event_name":"SessionStart"}));
        assert!(a.background().agents.is_empty());
    }

    /// DCL5: a compaction is finished by the vendor's own event, once per compaction; its start
    /// and the usage a turn carries never count.
    #[test]
    fn dcl5_completed_compaction_is_reported_once() {
        let mut a = agent();
        hook(&mut a, json!({"hook_event_name":"UserPromptSubmit"}));
        let start = json!({"hook_event_name":"PreCompact","trigger":"auto"});
        let done = json!({"hook_event_name":"PostCompact","trigger":"auto","compact_summary":"s1"});
        hook(&mut a, start);
        hook(
            &mut a,
            json!({"hook_event_name":"PostToolUse","usage":{"input_tokens":1,"cache_read_input_tokens":900000}}),
        );
        assert_eq!(a.compactions(), 0, "start and usage are not completion");
        hook(&mut a, done.clone());
        hook(&mut a, done);
        assert_eq!(a.compactions(), 1, "a replay is the same compaction");
        hook(
            &mut a,
            json!({"hook_event_name":"PostCompact","trigger":"manual","compact_summary":"s2"}),
        );
        assert_eq!(a.compactions(), 2);
    }
}
