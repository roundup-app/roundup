//! A36: a spawn's `unset` removes a Daemon variable from that program alone.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use contracts::terminal::SpawnParams;
use std::collections::BTreeMap;
use terminal::Terminals;

// A variable every test process has, so no test sets one.
const NAME: &str = "CARGO_PKG_NAME";

async fn program_sees(terminals: &Terminals, unset: Vec<String>) -> String {
    let dir = tempfile::tempdir().unwrap();
    let script = format!("read go; printf 'seen=<%s>' \"${{{NAME}-absent}}\"");
    let spawned = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["/bin/sh".into(), "-c".into(), script]),
            env: BTreeMap::new(),
            unset,
            cols: 80,
            rows: 24,
            machine: None,
        })
        .await
        .unwrap();
    let mut output = terminals.subscribe_output(&spawned.id).unwrap();
    terminals.write(&spawned.id, b"\n").await.unwrap();
    let mut text = String::new();
    while let Some(chunk) = output.next().await {
        if let terminal::Output::Bytes { bytes, .. } = chunk {
            text.push_str(&String::from_utf8_lossy(&bytes));
        }
    }
    let start = text.find("seen=<").expect("program printed nothing") + 6;
    text[start..].split('>').next().unwrap().to_string()
}

#[tokio::test]
async fn a36_unset_removes_a_daemon_variable_for_one_spawn() {
    let daemon = std::env::var(NAME).unwrap();
    let data = tempfile::tempdir().unwrap();
    let plain = Terminals::open(data.path(), rpc::Bus::new()).unwrap();
    assert_eq!(program_sees(&plain, vec![]).await, daemon);
    assert_eq!(program_sees(&plain, vec![NAME.into()]).await, "absent");
}
