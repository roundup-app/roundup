//! MC57: a run with a `herdr-core` on `PATH` that would be the user's core. A test of its own core
//! never starts it, and ends its Terminal.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use herdr::Conn;
use serde_json::json;
use tokio::process::Command;

#[tokio::test]
async fn mc57_no_test_reaches_the_users_core_run() {
    let dir = tempfile::tempdir().unwrap();
    let mark = dir.path().join("reached");
    let stub = dir.path().join("herdr-core");
    std::fs::write(
        &stub,
        format!("#!/bin/sh\ntouch '{}'\nexit 1\n", mark.display()),
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    cmd.arg("connect")
        .env("PATH", format!("{}:/usr/bin:/bin", dir.path().display()))
        .env("HOME", dir.path());
    let conn = Conn::spawn(cmd, Duration::from_secs(10)).await.unwrap();
    let run = conn
        .call(
            "terminal.run",
            json!({"argv":["/bin/sh","-c","sleep 30"],"cwd":dir.path(),"env":{},"size":{"cols":80,"rows":24}}),
        )
        .await
        .unwrap();
    let address = run["address"].as_str().unwrap().to_owned();
    conn.call("terminal.kill", json!({"terminal": address}))
        .await
        .unwrap();
    drop(conn);

    assert!(!mark.exists(), "the user's core was started");
}

/// MC56: the first start fails because the core closes its pipe; Retry reconnects and starts the
/// program once.
#[tokio::test]
async fn mc56_retry_after_connection_closed_succeeds() {
    use std::collections::BTreeMap;

    use contracts::terminal::SpawnParams;
    use rpc::Bus;
    use terminal::Terminals;

    let dir = tempfile::tempdir().unwrap();
    let count = dir.path().join("starts");
    let wrapper = dir.path().join("core");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho x >> '{c}'\nif [ \"$(wc -l < '{c}')\" -le 1 ]; then exit 1; fi\nexec '{bin}' \"$@\"\n",
            c = count.display(),
            bin = env!("CARGO_BIN_EXE_herdr-core-test")
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();

    let terminals = Terminals::open(dir.path(), Bus::new())
        .unwrap()
        .with_core(&wrapper);
    let params = || SpawnParams {
        cwd: dir.path().to_string_lossy().into_owned(),
        command: Some(vec!["cat".into()]),
        env: BTreeMap::new(),
        unset: Vec::new(),
        cols: 80,
        rows: 24,
        machine: None,
    };
    assert!(
        terminals.spawn(params()).await.is_err(),
        "the first start fails"
    );
    let started = terminals.spawn(params()).await.unwrap();
    assert!(terminals.core_record(&started.id).unwrap().is_some());
    assert_eq!(std::fs::read_to_string(&count).unwrap().lines().count(), 2);
}
