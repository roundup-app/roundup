//! MC52, MC54 against the test-support core: labelled Terminals are read back by their labels and
//! the user's own Terminals are never named in a call.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::time::Duration;

use serde_json::json;
use terminal::reconcile::{Step, apply, labels, reconcile};

async fn run(conn: &herdr::Conn, labels: serde_json::Value) -> String {
    let ran = conn
        .call(
            "terminal.run",
            json!({"argv":["cat"],"cwd":"/tmp","env":{},"size":{"cols":80,"rows":24},"labels":labels}),
        )
        .await
        .unwrap();
    ran.get("address")
        .and_then(serde_json::Value::as_str)
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn mc52_mc54_the_list_is_read_by_labels_and_extras_end() {
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    command.arg("connect");
    let conn = herdr::Conn::spawn(command, Duration::from_secs(15))
        .await
        .unwrap();
    let own = run(&conn, json!({})).await;
    let first = run(&conn, labels("p", "a", "1")).await;
    let second = run(&conn, labels("p", "a", "1")).await;
    let gone = run(&conn, labels("p", "deleted", "1")).await;

    let agents = vec!["a".to_owned(), "b".to_owned()];
    let (listed, steps) = reconcile(&conn, "p", &agents).await.unwrap();
    assert!(listed.iter().all(|t| t.address != own));
    assert_eq!(
        steps,
        [
            Step::End(first),
            Step::Attach(second.clone()),
            Step::End(gone),
            Step::Start("b".into())
        ]
    );
    for step in &steps {
        apply(&conn, step).await.unwrap();
    }
    let (listed, _) = reconcile(&conn, "p", &agents).await.unwrap();
    assert_eq!(
        listed.iter().map(|t| &t.address).collect::<Vec<_>>(),
        [&second]
    );
    // The user's Terminal is still in the core.
    conn.call("terminal.get", json!({"terminal": own}))
        .await
        .unwrap();
}

#[tokio::test]
async fn mc52_spawn_labelled_names_its_agent_in_the_core_list() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = terminal::Terminals::open(dir.path(), rpc::Bus::new()).unwrap();
    terminals
        .spawn_labelled(
            contracts::terminal::SpawnParams {
                cwd: dir.path().to_string_lossy().into_owned(),
                command: Some(vec!["cat".into()]),
                env: Default::default(),
                unset: Vec::new(),
                cols: 80,
                rows: 24,
                machine: None,
            },
            labels("p", "a", "1"),
        )
        .await
        .unwrap();
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    command.arg("connect");
    // A second core is separate, so the list read here is the started Terminal's own core.
    let (listed, steps) = {
        let conn = herdr::Conn::spawn(command, Duration::from_secs(15))
            .await
            .unwrap();
        reconcile(&conn, "p", &["a".to_owned()]).await.unwrap()
    };
    assert!(listed.is_empty() && steps == [Step::Start("a".into())]);
}
