//! LH4: the Daemon keeps each Agent's last link set and sends it, through a real Daemon with a
//! fake model (no `claude`, no network) and a transcript the test writes.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use contracts::EventData;
use contracts::links::{LinkEntry, LinkKind, LinkSet};
use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

const BOUND: Duration = Duration::from_secs(5);
const PR: &str = "https://github.com/acme/app/pull/7";

/// Answers the PR link for the text it is given, or fails when `fail` is set.
struct Model {
    calls: Arc<AtomicUsize>,
    fail: bool,
}

#[async_trait]
impl agents::LinksModel for Model {
    async fn links(&self, _text: &str, _last: &LinkSet) -> Result<LinkSet, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.fail {
            return Err("absent or invalid structured output".into());
        }
        Ok(LinkSet {
            entries: vec![LinkEntry {
                kind: LinkKind::Pr,
                url: PR.into(),
                tooltip: "the pull request".into(),
            }],
        })
    }
}

struct Run {
    client: Client,
    events: tokio::sync::broadcast::Receiver<contracts::Event>,
    agent: String,
    dir: tempfile::TempDir,
    calls: Arc<AtomicUsize>,
    lines: usize,
}

impl Run {
    async fn start(fail: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
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
        let calls = Arc::new(AtomicUsize::new(0));
        let (daemon, watchers, bus) = rupd::test_support::daemon_with_links(
            project,
            &project.join("data"),
            launcher,
            Model {
                calls: Arc::clone(&calls),
                fail,
            },
        );
        let daemon = Arc::new(daemon);
        let socket = project.join("rupd.sock");
        tokio::spawn(rupd::serve(
            UnixListener::bind(&socket).unwrap(),
            Arc::clone(&daemon),
            watchers,
        ));
        let client = Client::connect(&socket).await.unwrap();
        let events = bus.subscribe();
        let door = client
            .request("rail.createWorkstream", json!({"name":"Ship"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        client
            .request("rail.startDoor", json!({"id":door}))
            .await
            .unwrap();
        let agent = client
            .request(
                "agent.spawn",
                json!({"name":"a","parent":door,"cwd":project}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        std::mem::forget(daemon);
        Self {
            client,
            events,
            agent,
            dir,
            calls,
            lines: 0,
        }
    }

    /// A turn that adds `text` to the transcript and stops.
    async fn turn(&mut self, text: &str) {
        let path = self.dir.path().join("transcript.jsonl");
        let mut body = std::fs::read_to_string(&path).unwrap_or_default();
        body.push_str(&format!(
            "{}\n",
            json!({"message":{"role":"assistant","content":[{"type":"text","text":text}]}})
        ));
        self.lines += 1;
        std::fs::write(&path, body).unwrap();
        let tree = self.client.request("rail.tree", Value::Null).await.unwrap();
        let attempt = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == self.agent.as_str())
            .unwrap()["attempt"]
            .clone();
        self.client
            .request(
                "agent.signal",
                json!({"id":self.agent,"attempt":attempt,"payload":{
                    "hook_event_name":"Stop","transcript_path":path,"last_assistant_message":text}}),
            )
            .await
            .unwrap();
    }

    async fn links(&self) -> LinkSet {
        let set = self
            .client
            .request("agent.links", json!({"id":self.agent}))
            .await
            .unwrap();
        serde_json::from_value(set).unwrap()
    }

    /// The next `agent.links` event.
    async fn event(&mut self) -> LinkSet {
        tokio::time::timeout(BOUND, async {
            loop {
                if let EventData::AgentLinks(event) = self.events.recv().await.unwrap().data {
                    assert_eq!(event.id, self.agent);
                    return event.set;
                }
            }
        })
        .await
        .expect("an agent.links event")
    }

    /// Whether an `agent.links` event is waiting, after the work in flight has run.
    async fn quiet(&mut self) -> bool {
        // A later event arrives after the one this waits for, so a short wait that sees none
        // shows no second `agent.links` event was sent.
        let next = tokio::time::timeout(Duration::from_millis(300), async {
            loop {
                if let Ok(event) = self.events.recv().await
                    && matches!(event.data, EventData::AgentLinks(_))
                {
                    return;
                }
            }
        })
        .await;
        next.is_err()
    }
}

#[tokio::test]
async fn lh4_an_accepted_answer_replaces_the_set_and_emits_once() {
    let mut run = Run::start(false).await;
    run.turn(&format!("opened {PR}")).await;
    let set = run.event().await;
    assert_eq!(set.entries.len(), 1);
    assert_eq!(set.entries[0].url, PR);
    assert!(run.quiet().await, "one event for one answer");
    assert_eq!(run.links().await, set);
}

#[tokio::test]
async fn lh4_a_turn_without_a_call_keeps_the_set_and_emits_nothing() {
    let mut run = Run::start(false).await;
    run.turn(&format!("opened {PR}")).await;
    let kept = run.event().await;
    // Plain prose runs no call; a failed call changes nothing and emits nothing.
    run.turn("done, nothing more to say").await;
    assert!(run.quiet().await);
    assert_eq!(run.calls.load(Ordering::SeqCst), 1);
    assert_eq!(run.links().await, kept);

    let mut failing = Run::start(true).await;
    failing.turn(&format!("opened {PR}")).await;
    assert!(failing.quiet().await);
    assert_eq!(failing.calls.load(Ordering::SeqCst), 1);
    assert!(failing.links().await.entries.is_empty());
}

#[tokio::test]
async fn lh4_the_link_read_returns_the_last_set() {
    let mut run = Run::start(false).await;
    assert!(
        run.links().await.entries.is_empty(),
        "an Agent with no turn holds no set"
    );
    run.turn(&format!("opened {PR}")).await;
    let sent = run.event().await;
    assert_eq!(run.links().await, sent);
}
