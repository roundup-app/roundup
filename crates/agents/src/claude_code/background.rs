//! DCL3: work that outlives a foreground `Stop`. A native background Agent has no long-lived
//! process of its own, so it is a retained task fact (`SubagentStart` until its own
//! `SubagentStop`); a background shell or Monitor is a process under the program, seen through a
//! process snapshot. Services of the program itself never count as work.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

/// Hook events that open and close a background Agent. Apart from `STATE_EVENTS`: H15's replay
/// rule covers the events that move a Kind, and these move only this fact.
pub const BACKGROUND_EVENTS: [&str; 2] = ["SubagentStart", "SubagentStop"];

/// One process of a snapshot. `started` tells a reused PID from the process first seen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub pid: u32,
    pub parent: u32,
    pub started: u64,
    /// The command line, program first.
    pub command: Vec<String>,
}

/// What retained facts and the latest process snapshot say is still running.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Background {
    /// Open background Agents by their id: retained across a Daemon reopen.
    pub agents: BTreeSet<String>,
    /// Work processes by PID and the start time they were first seen with.
    pub processes: BTreeMap<u32, u64>,
    /// Why the last process observation failed; work is then not known to have ended.
    pub unavailable: Option<String>,
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
    /// records the cause. `services` names programs (by file name) that are not work.
    pub fn observe(
        &mut self,
        root: u32,
        snapshot: Result<&[Process], String>,
        services: &[String],
    ) {
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
            if process.pid == root || !under(root, process, &by_pid, services) {
                continue;
            }
            // Keyed by PID with its start time, so a reused PID is the new process it is.
            work.insert(process.pid, process.started);
        }
        self.processes = work;
    }
}

fn service(process: &Process, services: &[String]) -> bool {
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
            let words: Vec<String> = script.split_whitespace().map(|w| name(w)).collect();
            words.first().is_some_and(|w| w == "rup") && rup_args(&words)
        });
    rup || hook_shell || services.contains(&program)
}

/// Whether `process` descends from `root` through no service.
fn under(
    root: u32,
    process: &Process,
    by_pid: &BTreeMap<u32, &Process>,
    services: &[String],
) -> bool {
    let mut at = process;
    for _ in 0..by_pid.len() + 1 {
        if service(at, services) {
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

    fn proc(pid: u32, parent: u32, started: u64, command: &[&str]) -> Process {
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
        a.observe_processes(1, Ok(&shell), &[]);
        hook(
            &mut a,
            json!({"hook_event_name":"SubagentStop","agent_id":"C"}),
        );
        assert_eq!(kind(&a), Kind::Working, "the shell still runs");
        assert_eq!(a.status().unwrap().finished, finished);
        let done = a.observe_processes(1, Ok(&[]), &[]).expect("released");
        assert_eq!(done.kind, Kind::Idle);
        assert_eq!(
            done.finished,
            (finished.parse::<u64>().unwrap() + 1).to_string()
        );
        assert!(
            a.observe_processes(1, Ok(&[]), &[]).is_none(),
            "completes once"
        );
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
            proc(5, 1, 1, &["node", "server.js"]),
            proc(6, 5, 1, &["node", "child.js"]),
        ];
        let services = vec!["node".to_owned()];
        a.observe_processes(1, Ok(&only_services), &services);
        assert_eq!(kind(&a), Kind::Idle);
        assert!(!a.background().holds());
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
        a.observe_processes(1, Ok(&work), &[]);
        // Daemon reopen: the retained facts alone rebuild the hold, the dropped
        // SubagentStop notwithstanding.
        let facts = a.background().clone();
        let mut b = agent();
        hook(&mut b, json!({"hook_event_name":"Stop"}));
        b.resume_background(facts);
        let kept = b.observe_processes(1, Err("no process table".into()), &[]);
        assert_eq!(kept.unwrap().kind, Kind::Working);
        assert_eq!(
            b.background().unavailable.as_deref(),
            Some("no process table")
        );
        // PID 10 now belongs to an unrelated process outside the program: the old work ended.
        let reused = [proc(10, 99, 77, &["vim"])];
        b.observe_processes(1, Ok(&reused), &[]);
        assert!(b.background().processes.is_empty());
        // Only the lost SubagentStop keeps the Agent Working, never the reused PID.
        assert_eq!(b.background().agents.len(), 1);
        hook(&mut b, json!({"hook_event_name":"SessionStart"}));
        assert_eq!(kind(&b), Kind::Idle);
    }
}
