//! MC53: a connection to herdr-core that closes is replaced by the next call that needs the core.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use contracts::terminal::SpawnParams;
use rpc::Bus;
use terminal::Terminals;

fn params(cwd: &std::path::Path) -> SpawnParams {
    SpawnParams {
        cwd: cwd.to_string_lossy().into_owned(),
        command: Some(vec!["cat".into()]),
        env: BTreeMap::new(),
        unset: Vec::new(),
        cols: 80,
        rows: 24,
        machine: None,
    }
}

#[tokio::test]
async fn mc53_start_after_a_lost_connection_reconnects() {
    let dir = tempfile::tempdir().unwrap();
    // The first core dies on its own a moment after it answers; a later one lives.
    let script = dir.path().join("core");
    let log = dir.path().join("starts");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\necho x >> {log}\nif [ \"$(wc -l < {log})\" = 1 ]; then ( sleep 1; kill $$ ) & fi\nexec {core} connect\n",
            log = log.display(),
            core = env!("CARGO_BIN_EXE_herdr-core-test"),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new())
        .unwrap()
        .with_core(&script);
    terminals.spawn(params(dir.path())).await.unwrap();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    terminals
        .spawn(params(dir.path()))
        .await
        .expect("a start after the loss reconnects");
    assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 2);
}
