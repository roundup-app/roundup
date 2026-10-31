//! A5335b through a real Daemon: after a restart an Agent's resume of a child with no run is
//! `CONFLICT`, so no Attempt starts for a finished child.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::Path;

use rpc::Client;
use serde_json::json;

#[test]
fn a5335b_a_restart_resumes_no_finished_child() {
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let start = || {
        rupd_harness::start(
            Path::new(env!("CARGO_BIN_EXE_rupd")),
            project.path(),
            false,
            |command| {
                command.env("ROUNDUP_DATA_DIR", data.path()).env(
                    "ROUNDUP_RUP_BIN",
                    Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"),
                );
            },
        )
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let daemon = start();
    let (door, child) = runtime.block_on(async {
        let user = Client::connect(&daemon.socket).await.unwrap();
        let door = user
            .request(
                "rail.createWorkstream",
                json!({"name":"work","parent":null}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let child = user
            .request(
                "agent.spawn",
                json!({"name":"review","parent":door,"cwd":project.path()}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        (door, child)
    });
    drop(daemon);

    let daemon = start();
    runtime.block_on(async {
        let agent = Client::connect(&daemon.socket).await.unwrap();
        agent
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":door,"parent":null}}),
            )
            .await
            .unwrap();
        let refused = agent
            .request("agent.resume", json!({"id":child}))
            .await
            .unwrap_err();
        assert!(
            refused.to_string().contains("only the user resumes it"),
            "{refused}"
        );
    });
}
