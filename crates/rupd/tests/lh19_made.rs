//! LH19, LH20: what an Agent made for the user, read and told through a real Daemon socket (no
//! model, no network). A Workstream's id stands for the Agent that makes the items.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

struct World {
    _dir: tempfile::TempDir,
    socket: PathBuf,
    user: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
}
impl Drop for World {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let (daemon, watchers) = rupd::Daemon::open(dir.path()).unwrap();
    let server = tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::new(daemon),
        watchers,
    ));
    let user = Client::connect(&socket).await.unwrap();
    World {
        _dir: dir,
        socket,
        user,
        server,
    }
}

impl World {
    async fn agent(&self, name: &str) -> (String, Client) {
        let node = self
            .user
            .request("rail.createWorkstream", json!({"name":name}))
            .await
            .unwrap();
        let id = node["id"].as_str().unwrap().to_owned();
        let client = Client::connect(&self.socket).await.unwrap();
        client
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":id,"parent":null}}),
            )
            .await
            .unwrap();
        (id, client)
    }

    async fn made(&self, id: &str) -> Vec<Value> {
        let list = self
            .user
            .request("agent.made", json!({"id":id}))
            .await
            .unwrap();
        list.as_array().unwrap().clone()
    }
}

fn row(kind: &str, id: &str, title: &str) -> Value {
    json!({"kind":kind,"id":id,"title":title})
}

#[tokio::test]
async fn lh19_only_shown_pads_the_agent_made_are_listed() {
    let w = world().await;
    let (a, agent) = w.agent("a").await;
    agent
        .request(
            "pad.create",
            json!({"name":"report","text":"x","visibility":"shown"}),
        )
        .await
        .unwrap();
    agent
        .request("pad.create", json!({"name":"chatter","text":"x"}))
        .await
        .unwrap();
    w.user
        .request("pad.create", json!({"name":"mine","text":"x"}))
        .await
        .unwrap();
    assert_eq!(w.made(&a).await, vec![row("pad", "report", "report")]);

    w.user
        .request(
            "pad.setVisibility",
            json!({"name":"chatter","visibility":"shown"}),
        )
        .await
        .unwrap();
    w.user
        .request(
            "pad.setVisibility",
            json!({"name":"report","visibility":"internal"}),
        )
        .await
        .unwrap();
    assert_eq!(w.made(&a).await, vec![row("pad", "chatter", "chatter")]);

    let gone = w.user.request("agent.made", json!({"id":"999999"})).await;
    assert_eq!(gone.unwrap_err().code, rpc::code::NOT_FOUND);
}

#[tokio::test]
async fn lh19_open_todos_and_published_files_it_made_are_listed() {
    let w = world().await;
    let (a, agent) = w.agent("a").await;
    let open = agent
        .request("todo.create", json!({"title":"Review the plan"}))
        .await
        .unwrap();
    let done = agent
        .request("todo.create", json!({"title":"Finished"}))
        .await
        .unwrap();
    agent
        .request("todo.complete", json!({"id":done["id"]}))
        .await
        .unwrap();
    let pad = agent
        .request("pad.create", json!({"name":"notes","text":"# Result"}))
        .await
        .unwrap();
    let file = agent
        .request(
            "deliverable.publish",
            json!({"key":"result","title":"Result","target":{"kind":"pad","name":"notes","incarnation":pad["incarnation"],"revision":1}}),
        )
        .await
        .unwrap();
    agent
        .request(
            "deliverable.publish",
            json!({"key":"site","title":"Site","target":{"kind":"external","url":"https://example.com/"}}),
        )
        .await
        .unwrap();
    assert_eq!(
        w.made(&a).await,
        vec![
            row("todo", &open["id"].to_string(), "Review the plan"),
            row("file", file["id"].as_str().unwrap(), "Result"),
        ]
    );
}

#[tokio::test]
async fn lh19_edited_files_and_others_items_are_not_listed() {
    let w = world().await;
    let (a, agent) = w.agent("a").await;
    let (b, other) = w.agent("b").await;
    other
        .request(
            "pad.create",
            json!({"name":"theirs","text":"x","visibility":"shown"}),
        )
        .await
        .unwrap();
    other
        .request("todo.create", json!({"title":"Theirs"}))
        .await
        .unwrap();
    w.user
        .request("todo.create", json!({"title":"Mine"}))
        .await
        .unwrap();
    // A file the Agent only wrote leaves no record to list.
    std::fs::write(w._dir.path().join("edited.txt"), "edit").unwrap();
    agent
        .request("pad.create", json!({"name":"x","text":"y"}))
        .await
        .unwrap();
    assert!(w.made(&a).await.is_empty());
    assert_eq!(w.made(&b).await.len(), 2);
}

/// The next `agent.made` event of `agent`, or `None` when none comes.
async fn told(events: &mut Client) -> Option<String> {
    tokio::time::timeout(Duration::from_millis(400), async {
        loop {
            if let Some(event) = events.next_event().await
                && let EventData::AgentMade(made) = event.data
            {
                return made.id;
            }
        }
    })
    .await
    .ok()
}

#[tokio::test]
async fn lh20_a_change_to_the_list_emits_one_event() {
    let w = world().await;
    let (a, agent) = w.agent("a").await;
    let mut events = Client::connect(&w.socket).await.unwrap();
    events.request("events.subscribe", json!({})).await.unwrap();
    assert!(w.made(&a).await.is_empty());

    let todo = agent
        .request("todo.create", json!({"title":"Read me"}))
        .await
        .unwrap();
    assert_eq!(told(&mut events).await.as_deref(), Some(a.as_str()));
    assert_eq!(told(&mut events).await, None, "one event for one change");

    agent
        .request(
            "pad.create",
            json!({"name":"report","text":"x","visibility":"shown"}),
        )
        .await
        .unwrap();
    assert_eq!(told(&mut events).await.as_deref(), Some(a.as_str()));
    w.user
        .request(
            "pad.setVisibility",
            json!({"name":"report","visibility":"internal"}),
        )
        .await
        .unwrap();
    assert_eq!(told(&mut events).await.as_deref(), Some(a.as_str()));
    agent
        .request("todo.complete", json!({"id":todo["id"]}))
        .await
        .unwrap();
    assert_eq!(told(&mut events).await.as_deref(), Some(a.as_str()));
    assert!(w.made(&a).await.is_empty());
}

#[tokio::test]
async fn lh20_a_change_that_leaves_the_list_emits_nothing() {
    let w = world().await;
    let (a, agent) = w.agent("a").await;
    let mut events = Client::connect(&w.socket).await.unwrap();
    events.request("events.subscribe", json!({})).await.unwrap();
    agent
        .request(
            "pad.create",
            json!({"name":"report","text":"x","visibility":"shown"}),
        )
        .await
        .unwrap();
    assert_eq!(told(&mut events).await.as_deref(), Some(a.as_str()));
    // The user's Todo and Pad, an internal Pad and an edit of the shown Pad's text change no list.
    agent
        .request("pad.write", json!({"name":"report","text":"y"}))
        .await
        .unwrap();
    w.user
        .request("todo.create", json!({"title":"Mine"}))
        .await
        .unwrap();
    w.user
        .request("pad.create", json!({"name":"mine","text":"x"}))
        .await
        .unwrap();
    agent
        .request("pad.create", json!({"name":"chatter","text":"x"}))
        .await
        .unwrap();
    assert_eq!(told(&mut events).await, None);
}
