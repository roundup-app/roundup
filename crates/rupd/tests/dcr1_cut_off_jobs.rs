//! DCR1 through a real Daemon over its socket, with a fake `claude` that only reads stdin: a
//! quit marks the Job mid-turn as cut off, and the record survives a reopen, where an Agent's
//! `agent_resume` without `mode` takes it and refuses the finished ones.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

struct Run {
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
    daemon: Arc<rupd::Daemon>,
}

async fn start(project: &Path) -> Run {
    let fake = project.join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.join("rup");
    std::fs::write(&rup, "").unwrap();
    let launcher = agents::claude_code::Launcher::new(
        fake.to_str().unwrap(),
        project.join("claude.json"),
        rup,
        None,
    );
    let (daemon, watchers) =
        rupd::test_support::daemon_with_clock(project, &project.join("data"), launcher, || 1);
    let daemon = Arc::new(daemon);
    let socket = project.join(format!("rupd-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&socket);
    let server = tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
        watchers,
    ));
    let client = Client::connect(&socket).await.unwrap();
    Run {
        client,
        server,
        daemon,
    }
}

async fn call(client: &Client, method: &str, params: Value) -> Value {
    client.request(method, params).await.unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn dcr1_a_quit_marks_only_the_job_mid_turn_as_cut_off() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let first = start(project).await;
    let door = call(
        &first.client,
        "rail.createWorkstream",
        json!({"name":"Ship"}),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let spawner = Client::connect(&project.join(format!("rupd-{}.sock", std::process::id())))
        .await
        .unwrap();
    call(
        &spawner,
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":door,"parent":null}}),
    )
    .await;
    let mut jobs = Vec::new();
    for name in ["mid-turn", "idle", "stopped"] {
        let node = call(
            &spawner,
            "agent.spawn",
            json!({"name":name,"parent":door,"cwd":project,"role":"job","prompt":"Do it.","order":{"kind":"work","ask":"Do it.","limits":[]}}),
        )
        .await;
        jobs.push(node["id"].as_str().unwrap().to_owned());
    }
    let signal = |id: String, event: &'static str| {
        let client = &first.client;
        async move {
            let tree = call(client, "rail.tree", Value::Null).await;
            let attempt = tree
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == id.as_str())
                .unwrap()["attempt"]
                .clone();
            call(
                client,
                "agent.signal",
                json!({"id":id,"attempt":attempt,"payload":{"hook_event_name":event}}),
            )
            .await;
        }
    };
    signal(jobs[0].clone(), "UserPromptSubmit").await;
    signal(jobs[1].clone(), "UserPromptSubmit").await;
    signal(jobs[1].clone(), "Stop").await;
    call(&first.client, "agent.stop", json!({"id":jobs[2]})).await;

    // The quit: the Jobs are marked before any program ends.
    first.daemon.stop_terminals().await.unwrap();
    first.server.abort();
    drop(first);

    let second = start(project).await;
    call(
        &second.client,
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":door,"parent":null}}),
    )
    .await;
    let resume = |id: String| {
        let client = &second.client;
        async move {
            client
                .request("agent.resume", json!({"id":id}))
                .await
                .err()
                .map(|err| err.to_string())
        }
    };
    for id in &jobs[1..] {
        let refused = resume(id.clone()).await.expect("a finished Job is refused");
        assert!(refused.contains("only the user resumes it"), "{refused}");
    }
    let cut = resume(jobs[0].clone()).await;
    assert!(
        cut.as_ref()
            .is_none_or(|err| !err.contains("only the user resumes it")),
        "{cut:?}"
    );
    second.server.abort();
    second.daemon.stop_terminals().await.unwrap();
}
