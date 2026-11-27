//! U7951a through a real Daemon: a restart before `SessionStart` re-arms the first-prompt bound
//! from the delivery's own start time, on an injected clock.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

struct Run {
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
    daemon: Arc<rupd::Daemon>,
}

async fn start(project: &Path, clock: &Arc<AtomicI64>) -> Run {
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
    let clock = Arc::clone(clock);
    let (daemon, watchers) = rupd::test_support::daemon_with_clock(
        project,
        &project.join("data"),
        launcher,
        move || clock.load(Ordering::SeqCst),
    );
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

async fn first_delivery(run: &Run, child: &str) -> Value {
    let instructions = run
        .client
        .request("agent.instructions", json!({"id":child}))
        .await
        .unwrap();
    instructions["deliveries"][0].clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn u7951a_a_restart_before_session_start_still_bounds_the_first_prompt() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let clock = Arc::new(AtomicI64::new(1_000));
    let first = start(project, &clock).await;
    let door = first
        .client
        .request("rail.createWorkstream", json!({"name":"Ship"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let spawner = Client::connect(&project.join(format!("rupd-{}.sock", std::process::id())))
        .await
        .unwrap();
    spawner
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door,"parent":null}}),
        )
        .await
        .unwrap();
    let child = spawner
        .request(
            "agent.spawn",
            json!({"name":"child","parent":door,"cwd":project,"role":"job","prompt":"Do it.","order":{"kind":"work","ask":"Do it.","limits":[]}}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(first_delivery(&first, &child).await["state"], "prepared");

    first.server.abort();
    drop(first);
    clock.fetch_add(61_000, Ordering::SeqCst);
    let second = start(project, &clock).await;
    second.daemon.reattach_owners().await.unwrap();

    let mut delivery = first_delivery(&second, &child).await;
    for _ in 0..100 {
        if delivery["state"] == "uncertain" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        delivery = first_delivery(&second, &child).await;
    }
    assert_eq!(delivery["state"], "uncertain");
    assert!(delivery["cause"].as_str().is_some_and(|c| !c.is_empty()));
}
