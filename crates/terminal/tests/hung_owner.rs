//! X18: a hung owner never blocks the calling thread.
#![cfg(target_os = "linux")]

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use contracts::terminal::SpawnParams;
use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;
use terminal::Terminals;

const PATIENCE: Duration = Duration::from_secs(30);

fn sleeper(dir: &std::path::Path) -> SpawnParams {
    SpawnParams {
        cwd: dir.to_string_lossy().into_owned(),
        command: Some(vec!["/bin/sh".into(), "-c".into(), "sleep 60".into()]),
        env: BTreeMap::new(),
        cols: 80,
        rows: 24,
    }
}

/// Owner helpers are this process's children running `terminal-owner`.
fn helpers() -> Vec<Pid> {
    let me = std::process::id();
    let mut found = Vec::new();
    for entry in std::fs::read_dir("/proc").unwrap().flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<i32>() else {
            continue;
        };
        let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
            continue;
        };
        let Some((head, rest)) = stat.rsplit_once(')') else {
            continue;
        };
        let parent: u32 = rest
            .split_whitespace()
            .nth(1)
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);
        if parent == me && head.contains("terminal-owner") {
            found.push(Pid::from_raw(pid));
        }
    }
    found.sort();
    found
}

/// Continues and kills every helper at the end, so no test leaves a stopped process behind.
struct Reap;

impl Drop for Reap {
    fn drop(&mut self) {
        for pid in helpers() {
            let _ = kill(pid, Signal::SIGCONT);
            let _ = kill(pid, Signal::SIGKILL);
        }
    }
}

async fn owners(dir: &std::path::Path, count: usize) -> (Terminals, Vec<String>) {
    let terminals = Terminals::open(dir, rpc::Bus::new())
        .unwrap()
        .with_terminal_owner(std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")));
    let mut ids = Vec::new();
    for _ in 0..count {
        ids.push(terminals.spawn(sleeper(dir)).await.unwrap().id);
    }
    (terminals, ids)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn x18_list_over_hung_owners_returns_within_patience_with_the_live_ones() {
    let _reap = Reap;
    let dir = tempfile::tempdir().unwrap();
    let (terminals, ids) = owners(dir.path(), 3).await;
    let pids = helpers();
    assert_eq!(pids.len(), 3);
    kill(pids[0], Signal::SIGSTOP).unwrap();
    kill(pids[1], Signal::SIGSTOP).unwrap();
    let start = Instant::now();
    let listed = tokio::time::timeout(PATIENCE, terminals.list())
        .await
        .unwrap();
    // Asked together: two hung owners cost one wait, not two.
    assert!(
        start.elapsed() < Duration::from_secs(9),
        "{:?}",
        start.elapsed()
    );
    let live: Vec<_> = listed.iter().map(|info| info.id.clone()).collect();
    assert_eq!(live.len(), 1, "{live:?} of {ids:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn x18_program_ended_of_a_hung_owner_returns_within_patience() {
    let _reap = Reap;
    let dir = tempfile::tempdir().unwrap();
    let (terminals, ids) = owners(dir.path(), 1).await;
    kill(helpers()[0], Signal::SIGSTOP).unwrap();
    let ticks = tokio::spawn(async {
        let mut tick = tokio::time::interval(Duration::from_millis(100));
        for _ in 0..10 {
            tick.tick().await;
        }
    });
    assert!(
        tokio::time::timeout(PATIENCE, terminals.program_ended(&ids[0]))
            .await
            .unwrap()
    );
    assert!(ticks.is_finished(), "other tasks ran while the owner hung");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn x18_a_resumed_owner_is_listed_again() {
    let _reap = Reap;
    let dir = tempfile::tempdir().unwrap();
    let (terminals, ids) = owners(dir.path(), 1).await;
    let pid = helpers()[0];
    kill(pid, Signal::SIGSTOP).unwrap();
    assert!(
        tokio::time::timeout(PATIENCE, terminals.list())
            .await
            .unwrap()
            .is_empty()
    );
    kill(pid, Signal::SIGCONT).unwrap();
    let listed = tokio::time::timeout(PATIENCE, terminals.list())
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, ids[0]);
}
