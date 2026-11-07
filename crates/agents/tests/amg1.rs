//! AMG1: the environment marks a process as an Agent's, whatever its parent or session.
#![allow(clippy::disallowed_methods)] // the test names its own child's environment

use agents::guard::{Live, Source};
use std::collections::HashSet;
use std::process::Command;
use std::time::{Duration, Instant};

#[test]
fn amg1_reparented_child_is_marked_by_its_environment() {
    let script = "( setsid sleep 30 & ) &";
    let status = Command::new("sh")
        .args(["-c", script])
        .env("ROUNDUP_AGENT", "amg1-agent")
        .status()
        .unwrap();
    assert!(status.success());
    let mut live = Live::new(HashSet::new);
    let deadline = Instant::now() + Duration::from_secs(4);
    let found = loop {
        let sample = live.sample();
        let hit = sample.readings.iter().find(|r| r.name == "sleep").cloned();
        if hit.is_some() || Instant::now() > deadline {
            break hit;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    if let Some(r) = &found {
        live.end(r.pid);
    }
    let found = found.expect("the reparented sleep is read");
    assert_eq!(found.agent.as_deref(), Some("amg1-agent"));
    let sample = live.sample();
    assert!(
        sample
            .readings
            .iter()
            .all(|r| r.agent.as_deref() == Some("amg1-agent"))
    );
}
