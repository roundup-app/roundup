//! X6014: the owner keeps output written while no client is attached.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use contracts::terminal::{CatchUp, SpawnParams};
use std::collections::BTreeMap;
use std::time::Duration;
use terminal::{TerminalOwner, Terminals};

const LOG_BYTES: u64 = 1_048_576;

struct Owner {
    owner: TerminalOwner,
    child: std::process::Child,
}
impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start(dir: &std::path::Path, script: &str) -> Owner {
    let (owner, child) = TerminalOwner::start(
        std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")),
        dir,
        SpawnParams {
            cwd: dir.to_string_lossy().into_owned(),
            command: Some(vec!["/bin/sh".into(), "-c".into(), script.into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
        },
    )
    .unwrap();
    Owner { owner, child }
}

async fn attach(dir: &std::path::Path, owner: &Owner) -> (Terminals, String) {
    let terminals = Terminals::open(dir, rpc::Bus::new()).unwrap();
    let id = terminals.attach_owner(dir, &owner.owner).await.unwrap().id;
    (terminals, id)
}

fn catch_up(terminals: &Terminals, owner: &Owner, id: &str) -> CatchUp {
    terminals
        .catch_up(&contracts::terminal::CatchUpParams {
            id: id.into(),
            incarnation: owner.owner.info.incarnation.clone(),
            after: 0,
        })
        .unwrap()
}

#[tokio::test]
async fn x6014a_output_written_while_detached_is_replayed_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let owner = start(
        dir.path(),
        "i=1; while [ $i -le 40 ]; do echo $i; i=$((i+1)); sleep 0.05; done; sleep 60",
    );
    let (first, first_id) = attach(dir.path(), &owner).await;
    drop((first, first_id));
    // The gap: several ticks pass with no client.
    tokio::time::sleep(Duration::from_millis(600)).await;
    let (second, id) = attach(dir.path(), &owner).await;
    // The program ends its count 2 s after it starts; one wait covers the rest, with margin.
    tokio::time::sleep(Duration::from_secs(4)).await;
    let text = second
        .read(&contracts::terminal::ReadParams {
            id: id.clone(),
            after: Some(0),
            reader: None,
            max: None,
        })
        .unwrap()
        .text;
    let numbers: Vec<u32> = text
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect();
    assert_eq!(numbers, (1..=40).collect::<Vec<_>>(), "{text}");
    assert!(matches!(
        catch_up(&second, &owner, &id),
        CatchUp::Contiguous { from: 0, .. }
    ));
}

#[tokio::test]
async fn x6014b_a_long_gap_drops_oldest_bytes_and_names_the_offset() {
    let dir = tempfile::tempdir().unwrap();
    // Each line is 65 bytes on the PTY (63 digits, CR, LF).
    let lines = LOG_BYTES / 65 + 1000;
    let owner = start(
        dir.path(),
        &format!(
            "i=0; while [ $i -lt {lines} ]; do printf '%063d\\n' 0; i=$((i+1)); done; sleep 60"
        ),
    );
    let (first, _) = attach(dir.path(), &owner).await;
    drop(first);
    tokio::time::sleep(Duration::from_secs(3)).await;
    let (second, id) = attach(dir.path(), &owner).await;
    let end = second.snapshot(&id).unwrap().after;
    let dropped = end - LOG_BYTES;
    assert!(dropped > 0, "the program must overrun the log");
    match catch_up(&second, &owner, &id) {
        CatchUp::Gap { from, after, .. } => assert_eq!((from, after), (dropped, end)),
        other => panic!("expected the dropped range by offset, got {other:?}"),
    }
}
