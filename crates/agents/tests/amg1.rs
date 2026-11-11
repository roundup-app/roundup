//! AMG1: the environment marks a process as an Agent's, whatever its parent or session.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#![allow(clippy::disallowed_methods)] // the test names its own child's environment

use agents::guard::{Live, Source};
use std::collections::HashSet;
use std::process::Command;

#[test]
fn amg1_reparented_child_is_marked_by_its_environment() {
    let out = Command::new("sh")
        .args(["-c", "setsid sleep 30 >/dev/null 2>&1 </dev/null & echo $!"])
        .env("ROUNDUP_AGENT", "amg1-agent")
        .output()
        .unwrap();
    assert!(out.status.success());
    let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap();
    let mut live = Live::new(HashSet::new);
    let sample = live.sample();
    let found = sample.readings.iter().find(|r| r.pid == pid).cloned();
    if let Some(r) = &found {
        live.end(r.pid);
    }
    let found = found.expect("the detached sleep is read");
    assert_eq!(found.agent.as_deref(), Some("amg1-agent"));
    let sample = live.sample();
    assert!(
        sample
            .readings
            .iter()
            .all(|r| r.agent.as_deref() == Some("amg1-agent"))
    );
}
