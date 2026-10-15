//! Helpers shared by the scenario tests.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use contracts::terminal::SpawnParams;
use contracts::{Actor, EventData};
use provenance::Touches;
use rpc::{Bus, Ctx};
use terminal::Terminals;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;

pub fn open(dir: &tempfile::TempDir) -> (Terminals, Bus) {
    let bus = Bus::new();
    (Terminals::open(dir.path(), bus.clone()).unwrap(), bus)
}

pub fn ctx(dir: &tempfile::TempDir, bus: &Bus) -> Ctx {
    Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::open(&dir.path().join("provenance.db")).unwrap()),
    }
}

pub const PATIENCE: Duration = Duration::from_secs(10);

pub fn sh(cwd: &Path, script: &str) -> SpawnParams {
    SpawnParams {
        cwd: cwd.to_string_lossy().into_owned(),
        command: Some(vec!["/bin/sh".into(), "-c".into(), script.into()]),
        env: BTreeMap::new(),
        cols: 80,
        rows: 24,
    }
}

pub fn decode(data: &str) -> String {
    String::from_utf8_lossy(&STANDARD.decode(data).expect("base64 output")).into_owned()
}

/// Everything the program printed and the exit code it ended with.
pub async fn until_exit(events: &mut Receiver<EventData>) -> (String, Option<i32>) {
    let mut printed = String::new();
    tokio::time::timeout(PATIENCE, async {
        loop {
            match events.recv().await.expect("events stay open") {
                EventData::TerminalOutput(out) => printed.push_str(&decode(&out.data)),
                EventData::TerminalExited(done) => return (printed, done.code),
                _ => {}
            }
        }
    })
    .await
    .expect("the program exits in time")
}

/// The exit code of a program whose output the test ignores. A program that prints more than the
/// event backlog makes a slow receiver lag (`Lagged`, then the newest events, exit included), so a
/// lag is not a closed channel here; `until_exit` keeps the strict read for tests that need output.
pub async fn until_exit_code(events: &mut Receiver<EventData>) -> Option<i32> {
    tokio::time::timeout(PATIENCE, async {
        loop {
            match events.recv().await {
                Ok(EventData::TerminalExited(done)) => return done.code,
                Ok(_) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => panic!("events stay open"),
            }
        }
    })
    .await
    .expect("the program exits in time")
}

/// Wait until the program's output so far contains `needle`.
pub async fn until_printed(events: &mut Receiver<EventData>, needle: &str) {
    let mut printed = String::new();
    tokio::time::timeout(PATIENCE, async {
        while !printed.contains(needle) {
            if let EventData::TerminalOutput(out) = events.recv().await.expect("events stay open") {
                printed.push_str(&decode(&out.data));
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{needle:?} was not printed in time"));
}
