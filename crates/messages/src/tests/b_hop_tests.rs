//! B2, B3, B6, B50 to B52 on a Rail where Workstreams nest `top` > `mid` > `sub`; Agent `c` lives in
//! `sub`, Agent `d` in `top`. The clock is fake.

use std::sync::atomic::{AtomicI64, Ordering};

use contracts::agent::{NodeKind, StatusEvent};
use contracts::{Actor, EventData, Kind, Status};
use serde_json::{Value, json};

use super::*;
use super::{FakeInbox, FakeRail, agent, agent_node, attach_inbox, node};

struct Hops {
    messages: Arc<Messages>,
    bus: Bus,
    rail: Arc<FakeRail>,
    clock: Arc<AtomicI64>,
    touches: Arc<provenance::Touches>,
    inbox: Arc<FakeInbox>,
    dir: std::path::PathBuf,
}

fn door(id: &str, parent: Option<&str>) -> RailNode {
    let mut workstream = node(
        id,
        NodeKind::Workstream,
        true,
        Some(Status {
            kind: Kind::Working,
            label: "x".into(),
            since: 0,
            finished: "0".into(),
        }),
    );
    workstream.parent = parent.map(str::to_owned);
    workstream
}

fn child(id: &str, parent: &str) -> RailNode {
    let mut agent = agent_node(id, Kind::Working);
    agent.parent = Some(parent.to_owned());
    agent
}

pub(super) fn tree() -> Vec<RailNode> {
    vec![
        door("top", None),
        child("mid", "top"),
        child("sub", "mid"),
        child("c", "sub"),
        child("d", "top"),
        agent_node("r", Kind::Working),
    ]
}

impl Hops {
    fn new(dir: &Path) -> Self {
        Self::over(dir, FakeRail::new(tree()), Arc::default())
    }

    fn over(dir: &Path, rail: Arc<FakeRail>, clock: Arc<AtomicI64>) -> Self {
        let bus = Bus::new();
        let touches = Arc::new(provenance::Touches::in_memory().unwrap());
        let reads = Arc::clone(&clock);
        let env = Env {
            touches: Arc::clone(&touches),
            clock: Arc::new(move || reads.load(Ordering::SeqCst)),
            fault: Arc::new(|_| Ok(())),
        };
        let agents: Arc<dyn Module> = rail.clone();
        let messages = Messages::open_with(dir, bus.clone(), agents, env).unwrap();
        let inbox = attach_inbox(&messages, true);
        let messages = Arc::new(messages);
        Self {
            messages,
            bus,
            rail,
            clock,
            touches,
            inbox,
            dir: dir.to_path_buf(),
        }
    }

    fn restarted(self) -> Self {
        let Self {
            rail, clock, dir, ..
        } = self;
        Self::over(&dir, rail, clock)
    }

    async fn call_as(&self, actor: Actor, method: &str, p: Value) -> Result<Value, RpcError> {
        let ctx = Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        self.messages.call(&ctx, method, p).await
    }

    async fn ask(&self, from: &str, to: &str) -> Value {
        let p = json!({"to": to, "kind": "question", "body": "which?"});
        self.call_as(agent(from), "message.send", p).await.unwrap()
    }

    async fn get(&self, id: u32) -> Value {
        let p = json!({"id": id});
        self.call_as(Actor::user(), "message.get", p).await.unwrap()
    }

    /// The Daemon's clock reads `ms`, and the pushed digests whose window ended by then go out.
    async fn at(&self, ms: i64) {
        self.clock.store(ms, Ordering::SeqCst);
        pushes::flush(&self.messages.inner).await;
    }

    /// `(to, status, reason)` of every Message, by id.
    async fn all(&self) -> Vec<(String, String, Value)> {
        let all = self
            .call_as(Actor::user(), "message.list", json!({}))
            .await
            .unwrap();
        all.as_array()
            .unwrap()
            .iter()
            .map(|m| {
                (
                    m["to"].as_str().unwrap().to_owned(),
                    m["status"].as_str().unwrap().to_owned(),
                    m["reason"].clone(),
                )
            })
            .collect()
    }

    /// Announce a Kind change of `id`, as the Agents module does.
    async fn becomes(&self, id: &str, kind: Kind) {
        let status = Status {
            kind,
            label: "x".into(),
            since: 0,
            finished: "0".into(),
        };
        let mut revision = 1;
        for node in self
            .rail
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .filter(|n| n.id == id)
        {
            node.status = Some(status.clone());
            revision = node
                .status_revision
                .as_deref()
                .unwrap()
                .parse::<i64>()
                .unwrap()
                + 1;
            node.status_revision = Some(revision.to_string());
        }
        self.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(StatusEvent {
                ended: false,
                id: id.into(),
                attempt: "1".into(),
                status_revision: revision.to_string(),
                status,
            })),
        );
        // The listener reads the event on its own task.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Marks `ids` `idle` on the Rail, with no status event.
fn idle(h: &Hops, ids: &[&str]) {
    for node in h.rail.0.lock().unwrap().iter_mut() {
        if ids.contains(&node.id.as_str()) {
            node.status = Some(Status {
                kind: Kind::Idle,
                label: "x".into(),
                since: 0,
                finished: "0".into(),
            });
        }
    }
}

/// Waits for the delivery callback to have typed `n` prompts, then lets a stray one show.
async fn typed_after(h: &Hops, n: usize) -> usize {
    for _ in 0..100 {
        if h.inbox.typed().len() >= n {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    h.inbox.typed().len()
}

#[tokio::test]
async fn b2_a_message_to_an_already_idle_door_is_typed_without_a_new_status() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    idle(&h, &["sub"]);
    h.ask("c", "sub").await;
    assert_eq!(typed_after(&h, 1).await, 1);
    assert_eq!(h.get(1).await["status"], "delivered");
}

impl Hops {
    async fn with_inbox(dir: &Path) -> (Self, Arc<FakeInbox>) {
        Self::new(dir).attach_inbox().await
    }

    /// The inbox stops standing for the transcript: a receipt is `confirm_inbox`.
    async fn attach_inbox(self) -> (Self, Arc<FakeInbox>) {
        let mut completed = self.messages.inner.completed.subscribe();
        self.inbox.receipt(false);
        while completed.recv().await.unwrap() != "initial" {}
        let inbox = Arc::clone(&self.inbox);
        (self, inbox)
    }
}

mod b3692;
mod inbox;
