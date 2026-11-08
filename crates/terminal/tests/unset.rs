//! A36: a spawn's `unset` removes a Daemon variable from that program alone.
use contracts::terminal::SpawnParams;
use std::collections::BTreeMap;
use terminal::Terminals;

// A variable every test process has, so no test sets one.
const NAME: &str = "CARGO_PKG_NAME";

async fn program_sees(terminals: &Terminals, unset: Vec<String>) -> String {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("seen");
    let script =
        format!("printf '%s' \"${{{NAME}-absent}}\" > seen.tmp; mv seen.tmp seen; read line");
    let spawned = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["/bin/sh".into(), "-c".into(), script]),
            env: BTreeMap::new(),
            unset,
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();
    for _ in 0..200 {
        if let Ok(seen) = std::fs::read_to_string(&out) {
            terminals.kill(&spawned.id).await.unwrap();
            return seen;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("program wrote nothing");
}

#[tokio::test]
async fn a36_unset_removes_a_daemon_variable_for_one_spawn() {
    let daemon = std::env::var(NAME).unwrap();
    let data = tempfile::tempdir().unwrap();
    let plain = Terminals::open(data.path(), rpc::Bus::new()).unwrap();
    assert_eq!(program_sees(&plain, vec![]).await, daemon);
    assert_eq!(program_sees(&plain, vec![NAME.into()]).await, "absent");

    let owned_data = tempfile::tempdir().unwrap();
    let durable = Terminals::open(owned_data.path(), rpc::Bus::new())
        .unwrap()
        .with_terminal_owner(env!("CARGO_BIN_EXE_terminal-owner").as_ref());
    assert_eq!(program_sees(&durable, vec![]).await, daemon);
    assert_eq!(program_sees(&durable, vec![NAME.into()]).await, "absent");
}
