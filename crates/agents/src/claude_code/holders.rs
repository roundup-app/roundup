//! RLH1: find a live Claude Code background session that holds an Agent's conversation outside the
//! Daemon's Terminals. The vendor detail (`<config>/jobs/<id>/state.json`) stays in this file.

use std::path::Path;

use super::Launcher;

impl Launcher {
    /// The pids of processes outside `own` that belong to a background session whose job names
    /// `marker`, the Agent's settings file. `table` is `ps -o pid=,ppid=,comm=,args=` output.
    pub fn outside_holders(&self, marker: &Path, table: &str, own: &[u32]) -> Vec<u32> {
        let marker = marker.to_string_lossy();
        let jobs = jobs_naming(&self.conversation_dir.join("jobs"), &marker);
        if jobs.is_empty() {
            return Vec::new();
        }
        let me = std::process::id();
        table
            .lines()
            .filter_map(|line| {
                let line = line.trim_start();
                let (pid, args) = line.split_once(char::is_whitespace)?;
                let pid: u32 = pid.parse().ok()?;
                let held = args.contains(&*marker) || jobs.iter().any(|job| args.contains(job));
                (held && pid != me && !own.contains(&pid)).then_some(pid)
            })
            .collect()
    }
}

/// The ids of the jobs whose state names `marker`. An id too short to be told apart is not used
/// to match a process.
fn jobs_naming(jobs: &Path, marker: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(jobs) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| {
            std::fs::read_to_string(entry.path().join("state.json"))
                .is_ok_and(|state| state.contains(marker))
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|id| id.len() >= 8)
        .collect()
}
