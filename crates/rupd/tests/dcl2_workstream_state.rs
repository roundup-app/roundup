//! DCL2 through a real Daemon and the pinned real `claude` on aimock: an idle Door still
//! receives a Message while a child works, and the Workstream state reads working.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "../../rup/tests/e2e/aimock.rs"]
#[allow(dead_code)]
mod aimock;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/transcripts.rs"]
#[allow(dead_code)]
mod transcripts;

use std::path::Path;
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};
use transcripts::{snapshots, written};

const BOUND: Duration = Duration::from_secs(30);
const DOOR_PROMPT: &str = "What is this Workstream for?";

async fn until(what: &str, mut ready: impl FnMut() -> bool) {
    let mut tick = tokio::time::interval(Duration::from_millis(10));
    tokio::time::timeout(BOUND, async {
        while !ready() {
            tick.tick().await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what}"));
}

async fn node(user: &Client, id: &str) -> Value {
    let tree = user.request("rail.tree", Value::Null).await.unwrap();
    tree.as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn dcl2_idle_door_receives_while_child_works() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let model = aimock::Model::start_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/b21_stopped_door.json"),
    );
    let rup = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    let claude = aimock::routed_claude(dir.path());
    aimock::configure(&dir.path().join("config"), dir.path());
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        true,
        |command| {
            command
                .env("ROUNDUP_DATA_DIR", data.path())
                .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
                .env("ROUNDUP_RUP_BIN", &rup)
                .env("ROUNDUP_CLAUDE_BIN", &claude)
                .env("CLAUDE_CODE_OAUTH_TOKEN", "")
                .env("AIMOCK_URL", &model.url)
                .env("RUPD_DIGEST_OBSERVER", dir.path().join("comparisons"));
        },
    );
    let user = Client::connect(&daemon.socket).await.unwrap();
    until("first snapshot", || {
        snapshots(dir.path())
            .iter()
            .any(|v| v["nodes"] == json!([]))
    })
    .await;
    let door = user
        .request(
            "rail.createWorkstream",
            json!({"name":"work","parent":null,
                "order":{"kind":"work","ask":DOOR_PROMPT,"limits":[]}}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let child = user
        .request(
            "agent.spawn",
            json!({"name":"review","parent":door,"cwd":dir.path(),"prompt":"What should this Agent do?"}),
        )
        .await
        .unwrap();
    let (child_id, attempt) = (
        child["id"].as_str().unwrap().to_owned(),
        child["attempt"].clone(),
    );
    let idle = |id: &str, revision: u32| {
        let id = id.to_owned();
        let dir = dir.path().to_owned();
        move || {
            snapshots(&dir).iter().any(|v| {
                v["nodes"].as_array().unwrap().iter().any(|n| {
                    n["id"] == id
                        && n["status"]["kind"] == "idle"
                        && n["status_revision"]
                            .as_str()
                            .is_some_and(|r| r.parse::<u32>().unwrap() >= revision)
                })
            })
        }
    };
    until("child idle", idle(&child_id, 2)).await;
    // The Door is started after its child, as a reopened Workstream's is.
    user.request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    until("door idle", idle(&door, 4)).await;
    until("door prompt on disk", || {
        written(&dir.path().join("config"), DOOR_PROMPT)
    })
    .await;

    // The child's turn begins and does not end.
    user.request(
        "agent.signal",
        json!({"id":child_id,"attempt":attempt,"payload":{"hook_event_name":"UserPromptSubmit","prompt":"go"}}),
    )
    .await
    .unwrap();
    let door_node = node(&user, &door).await;
    assert_eq!(door_node["status"]["kind"], "idle", "the Door's own Kind");
    assert_eq!(door_node["workstream_state"], "working");

    let sent = user
        .request(
            "message.send",
            json!({"to":door,"kind":"note","body":"[digest] while the child works"}),
        )
        .await
        .unwrap()["id"]
        .clone();
    let mut delivered = false;
    let mut tick = tokio::time::interval(Duration::from_millis(20));
    tokio::time::timeout(BOUND, async {
        while !delivered {
            let message = user
                .request("message.get", json!({"id":sent}))
                .await
                .unwrap();
            delivered = message["status"] == "delivered";
            tick.tick().await;
        }
    })
    .await
    .expect("the idle Door received the note while its child worked");
    assert_eq!(
        node(&user, &child_id).await["status"]["kind"],
        "working",
        "delivery did not wait for the child"
    );

    // A native permission prompt of the child makes the Workstream needs-you.
    user.request(
        "agent.signal",
        json!({"id":child_id,"attempt":attempt,"payload":{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"ls"}}}),
    )
    .await
    .unwrap();
    let door_node = node(&user, &door).await;
    assert_eq!(door_node["workstream_state"], "needs-you");
}
