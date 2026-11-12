//! A12a: a Terminal the core kept across the Daemon is attached again from the core's own record,
//! with no launch; a terminal the core lost is not found, so its Agent stays `done` (A8).
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::BTreeMap;
use std::time::Duration;

use contracts::terminal::SpawnParams;
use rpc::Bus;
use terminal::Terminals;

#[tokio::test]
async fn a12a_reattach_attaches_the_core_terminal_again() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
    let first = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["cat".into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
            machine: None,
        })
        .await
        .unwrap();
    let (core_id, adopted) = terminals.core_record(&first.id).unwrap().unwrap();
    let again = terminals.reattach(&core_id, adopted, None).await.unwrap();
    assert_ne!(again.id, first.id);
    let mut output = terminals.subscribe_output(&again.id).unwrap();
    terminals
        .write(&again.id, b"after-reattach\n")
        .await
        .unwrap();
    let seen = tokio::time::timeout(Duration::from_secs(5), async {
        let mut text = String::new();
        while let Some(chunk) = output.next().await {
            if let terminal::Output::Bytes { bytes, .. } = chunk {
                text.push_str(&String::from_utf8_lossy(&bytes));
                if text.contains("after-reattach") {
                    break;
                }
            }
        }
    })
    .await;
    assert!(seen.is_ok(), "the reattached Terminal echoes its input");
}

#[tokio::test]
async fn a12a_reattach_of_a_terminal_the_core_lost_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
    let first = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["cat".into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
            machine: None,
        })
        .await
        .unwrap();
    let (_, adopted) = terminals.core_record(&first.id).unwrap().unwrap();
    assert!(
        terminals
            .reattach("no-such-terminal", adopted, None)
            .await
            .is_err()
    );
}

/// MC12: no code opens a PTY for a Terminal, and none reads the old owner socket.
#[test]
fn mc12_no_owner_socket_reads() {
    let crates = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let banned = [
        "portable_pty",
        "openpty",
        "terminal-owner",
        "RUPD_TERMINAL_OWNER",
        "TerminalOwner",
    ];
    let mut hits = Vec::new();
    let mut dirs = vec![crates];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                if name != "target" && name != "tests" && name != "node_modules" {
                    dirs.push(path);
                }
            } else if path.extension().is_some_and(|ext| ext == "rs")
                && let Ok(text) = std::fs::read_to_string(&path)
            {
                hits.extend(
                    banned
                        .iter()
                        .filter(|word| text.contains(*word))
                        .map(|word| format!("{}: {word}", path.display())),
                );
            }
        }
    }
    assert!(hits.is_empty(), "{hits:?}");
}
