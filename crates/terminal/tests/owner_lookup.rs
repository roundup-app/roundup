//! X6570: the owner lookup reports a poisoned remote table.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use contracts::terminal::SpawnParams;
use std::collections::BTreeMap;
use terminal::{TerminalOwner, Terminals};

#[tokio::test]
async fn x6570a_a_poisoned_remote_table_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let (owner, mut child) = TerminalOwner::start(
        std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")),
        dir.path(),
        SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["/bin/sh".into(), "-c".into(), "sleep 60".into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
        },
    )
    .unwrap();
    let terminals = Terminals::open(dir.path(), rpc::Bus::new()).unwrap();
    let id = terminals.attach_owner(dir.path(), &owner).await.unwrap().id;

    assert!(terminals.terminal_owner(&id).unwrap().is_some());
    assert!(terminals.terminal_owner("not-a-number").unwrap().is_none());
    assert!(terminals.terminal_owner("999").unwrap().is_none());

    terminals.poison_remote_table_for_test();
    let err = terminals.terminal_owner(&id).unwrap_err();
    assert_eq!(err.code, rpc::code::INTERNAL);

    let _ = child.kill();
    let _ = child.wait();
}
