//! M8: an Agent asks the App to open or rename a Project. The Daemon validates, emits
//! `project.requested` once, and logs a Touch; it cannot see what the App does.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use contracts::project::Requested;
use contracts::{Actor, ActorKind, EventData, IdentifyParams, Verb};
use rpc::{Client, code};
use serde_json::{Value, json};
use tokio::net::UnixListener;

struct World {
    dir: tempfile::TempDir,
    client: Client,
    caller: Client,
}

fn agent() -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: "m".into(),
        parent: None,
    }
}

async fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let roundup = dir.path().join(".roundup");
    let socket = dir.path().join("rupd.sock");
    let daemon = Arc::new(rupd::Daemon::open(&roundup).unwrap());
    tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    let client = Client::connect(&socket).await.unwrap();
    client
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let caller = Client::connect(&socket).await.unwrap();
    caller
        .request("daemon.identify", IdentifyParams { actor: agent() })
        .await
        .unwrap();
    World {
        dir,
        client,
        caller,
    }
}

impl World {
    async fn requested(&mut self) -> Vec<Requested> {
        let mut seen = Vec::new();
        while let Ok(Some(event)) =
            tokio::time::timeout(Duration::from_millis(300), self.client.next_event()).await
        {
            if let EventData::ProjectRequested(request) = event.data {
                seen.push(request);
            }
        }
        seen
    }
}

#[tokio::test]
async fn m8_project_open_validates_and_emits_the_event_once() {
    let mut w = world().await;
    let folder = w.dir.path().join("other");
    std::fs::create_dir(&folder).unwrap();
    let file = w.dir.path().join("file");
    std::fs::write(&file, "").unwrap();

    let relative = w
        .caller
        .request("project.open", json!({"path": "other"}))
        .await;
    let missing = w
        .caller
        .request("project.open", json!({"path": w.dir.path().join("gone")}))
        .await;
    let not_a_directory = w
        .caller
        .request("project.open", json!({"path": file}))
        .await;
    assert_eq!(relative.unwrap_err().code, code::INVALID_PARAMS);
    assert_eq!(missing.unwrap_err().code, code::NOT_FOUND);
    assert_eq!(not_a_directory.unwrap_err().code, code::NOT_FOUND);
    assert!(w.requested().await.is_empty());

    let ok = w
        .caller
        .request("project.open", json!({"path": folder}))
        .await
        .unwrap();

    assert_eq!(ok, Value::Null);
    assert_eq!(
        w.requested().await,
        vec![Requested::Open {
            path: folder.to_string_lossy().into_owned()
        }]
    );
}

#[tokio::test]
async fn m8_project_rename_validates_the_name_like_s10() {
    let mut w = world().await;

    for bad in ["", "   ", "a\nb", &"x".repeat(41)] {
        let err = w
            .caller
            .request("project.rename", json!({"name": bad}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{bad:?}");
    }
    assert!(w.requested().await.is_empty());

    w.caller
        .request("project.rename", json!({"name": &"x".repeat(40)}))
        .await
        .unwrap();
    w.caller
        .request("project.rename", json!({"name": "  Shop  "}))
        .await
        .unwrap();

    let seen = w.requested().await;
    assert_eq!(seen.len(), 2);
    let Requested::Rename { path, name } = &seen[1] else {
        panic!("a rename request");
    };
    assert_eq!(name, "Shop");
    assert_eq!(Path::new(path), w.dir.path());
}

#[tokio::test]
async fn m8_the_event_is_a_touch_by_the_agent() {
    let w = world().await;
    let folder = w.dir.path().join("other");
    std::fs::create_dir(&folder).unwrap();

    w.caller
        .request("project.open", json!({"path": folder}))
        .await
        .unwrap();

    let item = format!("project:{}", folder.display());
    let history = w
        .client
        .request("provenance.history", json!({"item": item}))
        .await
        .unwrap();
    let history = history.as_array().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0]["verb"], json!(Verb::Wrote));
    assert_eq!(history[0]["actor"]["id"], "m");
}
