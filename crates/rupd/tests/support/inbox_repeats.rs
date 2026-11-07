//! B5763: real Message storage and delivery, with only Rail and peer I/O replaced.
use super::*;
use agents::claude_code::inbox::Entry;
use contracts::{Actor, agent::Inbox};
use parking_lot::Mutex;
use rpc::Module;
use std::sync::Arc;
use std::sync::atomic::AtomicI64;

struct Rail(Mutex<Value>);
#[async_trait::async_trait]
impl Module for Rail {
    fn namespaces(&self) -> &'static [&'static str] {
        &["rail"]
    }
    async fn call(&self, _: &rpc::Ctx, method: &str, _: Value) -> Result<Value, rpc::RpcError> {
        assert_eq!(
            method, "rail.tree",
            "Messages never type a prompt or Terminal bytes"
        );
        Ok(self.0.lock().clone())
    }
}

struct Peer {
    writes: Mutex<Vec<u32>>,
    session: Mutex<String>,
    transcript: PathBuf,
    state: Mutex<Inbox>,
}
#[async_trait::async_trait]
impl messages::NoteInbox for Peer {
    async fn check(&self, _: &str) -> Inbox {
        *self.state.lock()
    }
    fn session(&self, _: &str) -> Option<String> {
        Some(self.session.lock().clone())
    }
    fn content(&self, _: &str, entry: &Entry) -> String {
        entry.content("uds:/probe/service", "default")
    }
    fn previous(&self, _: &str) -> Result<Option<String>, Inbox> {
        agents::claude_code::inbox::previous(
            &self.transcript,
            &self.session.lock(),
            "uds:/probe/service",
        )
        .map_err(|_| Inbox::Missing)
    }
    fn write(&self, _: &str, entries: &[Entry]) -> Result<(), Inbox> {
        self.writes
            .lock()
            .extend(entries.iter().map(|entry| entry.id));
        Ok(())
    }
}
struct Delivery {
    messages: messages::Messages,
    ctx: rpc::Ctx,
    rail: Arc<Rail>,
    peer: Arc<Peer>,
    clock: Arc<AtomicI64>,
    dir: tempfile::TempDir,
}
impl Delivery {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let rail = Arc::new(Rail(Mutex::new(json!([{
            "id":"receiver", "kind":"agent", "name":"receiver", "parent":null,
            "order":0,"status":{"kind":"idle","label":"","since":0,"finished":"0"},
            "attempt":"1","status_revision":"1","terminal_id":"test-terminal",
            "worktree":null,"can_resume":false,"channel":null,"work":null,
            "stray":[],"model":null,"effort":null
        }]))));
        let peer = Arc::new(Peer {
            writes: Mutex::default(),
            session: Mutex::new("same-session".into()),
            transcript: dir.path().join("transcript.jsonl"),
            state: Mutex::new(Inbox::Ok),
        });
        let clock = Arc::new(AtomicI64::new(100_000));
        let ctx = rpc::Ctx {
            actor: Actor::user(),
            bus: rpc::Bus::new(),
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
        };
        let messages = Self::open(dir.path(), &ctx, &rail, &peer, &clock);
        Self {
            messages,
            ctx,
            rail,
            peer,
            clock,
            dir,
        }
    }
    fn open(
        dir: &Path,
        ctx: &rpc::Ctx,
        rail: &Arc<Rail>,
        peer: &Arc<Peer>,
        clock: &Arc<AtomicI64>,
    ) -> messages::Messages {
        let clock = clock.clone();
        let messages = messages::Messages::open_with(
            dir,
            ctx.bus.clone(),
            rail.clone(),
            messages::Env {
                touches: ctx.touches.clone(),
                clock: Arc::new(move || clock.load(Ordering::SeqCst)),
                fault: Arc::new(|_| Ok(())),
            },
        )
        .unwrap();
        messages.set_inbox(peer.clone());
        messages.listen();
        messages
    }
    fn reopen(&mut self) {
        self.ctx.bus = rpc::Bus::new();
        self.messages = Self::open(
            self.dir.path(),
            &self.ctx,
            &self.rail,
            &self.peer,
            &self.clock,
        );
    }
    async fn call(&self, method: &str, params: Value) -> Value {
        let reader = rpc::Ctx {
            actor: Actor::user(),
            bus: self.ctx.bus.clone(),
            touches: self.ctx.touches.clone(),
        };
        let ctx = if matches!(method, "message.get" | "message.list") {
            &reader
        } else {
            &self.ctx
        };
        self.messages.call(ctx, method, params).await.unwrap()
    }
    async fn send(&self, kind: &str, body: &str) -> u32 {
        self.call(
            "message.send",
            json!({"to":"receiver","kind":kind,"body":body}),
        )
        .await["id"]
            .as_u64()
            .unwrap() as u32
    }
    async fn get(&self, id: u32) -> Value {
        self.call("message.get", json!({"id":id})).await
    }
    async fn all(&self) -> Vec<Value> {
        let mut all = self
            .call("message.list", json!({"to":"receiver"}))
            .await
            .as_array()
            .unwrap()
            .clone();
        all.sort_by_key(|message| message["id"].as_u64().unwrap());
        all
    }
    async fn edge(&self) {
        let event = {
            let mut rail = self.rail.0.lock();
            let revision = rail[0]["status_revision"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap()
                + 1;
            rail[0]["status_revision"] = json!(revision.to_string());
            rail[0]["status"]["kind"] = json!("idle");
            serde_json::from_value(json!({"id":"receiver","attempt":"1","status_revision":revision.to_string(),"status":rail[0]["status"]})).unwrap()
        };
        self.ctx
            .bus
            .emit(Actor::daemon(), EventData::AgentStatus(event));
        tokio::task::yield_now().await;
    }
    fn writes(&self) -> Vec<u32> {
        self.peer.writes.lock().clone()
    }
    fn flight(&self, id: u32) -> bool {
        rusqlite::Connection::open(self.dir.path().join("project.db"))
            .unwrap()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM message_flight WHERE message_id=?)",
                [id],
                |r| r.get(0),
            )
            .unwrap()
    }
}

fn digest(last: &str) -> contracts::agent::DigestEntry {
    contracts::agent::DigestEntry {
        name: "child".into(),
        kind: contracts::Kind::Working,
        last: last.into(),
        todos: 0,
        link: None,
        pads: vec![],
    }
}

// Rejects bypassing the shared rule in the internal producer, losing batch history, or adding expiry.
#[tokio::test(start_paused = true)]
async fn b5763b_identical_daemon_digests_write_once() {
    for case in [0, 1, 2] {
        let batch = case > 0;
        let h = Delivery::new();
        if batch {
            h.rail.0.lock()[0]["status"]["kind"] = json!("working");
        }
        let entry = digest("done: ready");
        h.messages.note_attention("receiver", &entry).await.unwrap();
        let first = h.all().await[0]["id"].as_u64().unwrap() as u32;
        if !batch {
            assert_eq!(h.writes(), [first]);
            assert_eq!(h.get(first).await["status"], "pending");
            h.messages.confirm_inbox("receiver", &[first]);
            h.clock.store(131_001, Ordering::SeqCst);
        }
        h.messages.note_attention("receiver", &entry).await.unwrap();
        let second = h.all().await.last().unwrap()["id"].as_u64().unwrap() as u32;
        let other = if case == 2 {
            Some(h.send("note", "continue").await)
        } else {
            None
        };
        if batch {
            h.edge().await;
        }
        until("digest repeat closes", async || {
            (h.get(second).await["reason"] == "repeat of last inbox entry").then_some(())
        })
        .await;
        assert_ne!(first, second);
        let mut expected = vec![first];
        expected.extend(other);
        assert_eq!(h.writes(), expected);
        assert!(!h.flight(second));
        assert_eq!(h.get(second).await["status"], "delivered");
    }
}

// Rejects raw-body or Actor-keyed comparison, cutting question identity, and session leakage.
#[tokio::test(start_paused = true)]
async fn b5763b_a_different_inbox_entry_breaks_the_repeat() {
    let h = Delivery::new();
    let a = h.send("note", "A").await;
    let b = h.send("question", "A").await;
    let c = h.send("note", "A").await;
    assert_eq!(h.writes(), [a, b, c]);
    for id in [a, b, c] {
        assert_eq!(h.get(id).await["status"], "pending");
    }
    let repeat = h.send("note", "A").await;
    assert_eq!(h.get(repeat).await["reason"], "repeat of last inbox entry");
    *h.peer.session.lock() = "new-session".into();
    let new = h.send("note", "A").await;
    assert_eq!(h.writes(), [a, b, c, new]);
    assert_eq!(h.get(new).await["status"], "pending");
}

// Rejects fabricating a transcript receipt and repeated delivery events after close/reopen.
#[tokio::test(start_paused = true)]
async fn b5763b_repeat_delivery_is_final() {
    let mut h = Delivery::new();
    let first = h.send("note", "A").await;
    h.messages.confirm_inbox("receiver", &[first]);
    let mut events = h.ctx.bus.subscribe();
    let second = h.send("note", "A").await;
    let original = h.get(second).await;
    for _ in 0..30 {
        h.edge().await;
    }
    h.messages.confirm_inbox("receiver", &[second, second]);
    let mut delivered = Vec::new();
    while let Ok(event) = events.try_recv() {
        if let EventData::MessageDelivered(m) = event.data {
            delivered.push(m.id);
        }
    }
    assert_eq!(delivered, [second]);
    h.reopen();
    let mut events = h.ctx.bus.subscribe();
    h.edge().await;
    h.messages.confirm_inbox("receiver", &[second]);
    assert_eq!(h.get(second).await, original);
    assert_eq!(h.writes(), [first]);
    assert!(!h.flight(second));
    while let Ok(event) = events.try_recv() {
        assert!(!matches!(event.data, EventData::MessageDelivered(_)));
    }
}

// Legacy evidence is an actual admitted entry, plus a separate durable pending flight.
#[tokio::test(start_paused = true)]
async fn b5763c_restart_closes_a_dropped_inflight_repeat() {
    for legacy in [false, true] {
        let mut h = Delivery::new();
        let first = h.send("note", "A").await;
        h.messages.confirm_inbox("receiver", &[first]);
        let db = rusqlite::Connection::open(h.dir.path().join("project.db")).unwrap();
        if legacy {
            db.execute("DELETE FROM message_inbox_last", []).unwrap();
            let content = Entry {
                id: first,
                kind: contracts::message::MessageKind::Note,
                from: "you".into(),
                text: "A".into(),
                one_line: false,
            }
            .content("uds:/probe/service", "default");
            std::fs::write(&h.peer.transcript,format!("{}\n",json!({"sessionId":"same-session","origin":{"kind":"peer","from":"uds:/probe/service"},"message":{"content":content}}))).unwrap();
        }
        db.execute("INSERT INTO messages(from_actor,to_id,kind,body,status,at,receiver_attempt,receiver_revision,rank) SELECT from_actor,to_id,kind,body,'pending',at,receiver_attempt,receiver_revision,rank FROM messages WHERE id=?",[first]).unwrap();
        let repeat = db.last_insert_rowid() as u32;
        db.execute(
            "INSERT INTO message_flight(message_id,prompt) VALUES(?,?)",
            [repeat, repeat],
        )
        .unwrap();
        drop(db);
        h.reopen();
        let mut events = h.ctx.bus.subscribe();
        h.edge().await;
        until("recovered flight closes", async || {
            (h.get(repeat).await["reason"] == "repeat of last inbox entry").then_some(())
        })
        .await;
        assert_eq!(h.writes(), [first]);
        assert!(!h.flight(repeat));
        let mut delivered = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let EventData::MessageDelivered(m) = event.data {
                delivered.push(m.id);
            }
        }
        assert_eq!(delivered, [repeat]);
        h.reopen();
        h.edge().await;
        assert_eq!(h.writes(), [first]);
        assert_eq!(h.get(repeat).await["status"], "delivered");
    }
}

// Rejects producer-specific filters in place of the shared delivery decision.
#[tokio::test(start_paused = true)]
async fn b5763d_all_inbox_producers_share_the_repeat_rule() {
    let mut h = Delivery::new();
    let first = h.send("note", "same user label").await;
    h.ctx.actor = Actor {
        kind: contracts::ActorKind::Ext,
        id: "you".into(),
        parent: None,
    };
    let second = h.send("note", "same user label").await;
    assert_eq!(h.get(second).await["reason"], "repeat of last inbox entry");
    assert_eq!(h.writes(), [first]);
    // Wake request creation/firing bypasses B51 acceptance refusal, then uses ordinary delivery.
    let mut wakes = Vec::new();
    for _ in 0..2 {
        let wake = h
            .messages
            .save_wake("receiver", &["child".into()], false, &["child".into()], 0)
            .unwrap();
        assert!(
            h.messages
                .fire_wake(wake.id, "receiver", "[wake] child is idle".into())
                .await
                .unwrap()
        );
        assert!(h.messages.wake(wake.id).unwrap().is_none());
        wakes.push(h.all().await.last().unwrap()["id"].as_u64().unwrap() as u32);
    }
    assert_eq!(h.writes(), [first, wakes[0]]);
    assert_eq!(h.get(wakes[0]).await["status"], "pending");
    assert_eq!(
        h.get(wakes[1]).await["reason"],
        "repeat of last inbox entry"
    );
    // A B22 push and the B43 attention producer both enter the same rendered history.
    h.clock.store(200_000, Ordering::SeqCst);
    let entry = digest("done: result");
    h.messages.push_digest("receiver", "child", &entry).await;
    let pushed = h.all().await.last().unwrap()["id"].as_u64().unwrap() as u32;
    h.messages.note_attention("receiver", &entry).await.unwrap();
    let repeated = h.all().await.last().unwrap()["id"].as_u64().unwrap() as u32;
    assert_eq!(
        h.get(repeated).await["reason"],
        "repeat of last inbox entry"
    );
    assert_eq!(h.writes(), [first, wakes[0], pushed]);
}

// Rejects suppression before the availability gate or based on an unsuccessful write.
#[tokio::test(start_paused = true)]
async fn b5763b_unavailable_repeats_wait_for_a_passing_check() {
    let h = Delivery::new();
    let first = h.send("note", "A").await;
    *h.peer.state.lock() = Inbox::Missing;
    let repeat = h.send("note", "A").await;
    assert_eq!(h.get(repeat).await["status"], "pending");
    assert!(!h.flight(repeat));
    assert_eq!(h.writes(), [first]);
    *h.peer.state.lock() = Inbox::Ok;
    h.edge().await;
    until("available repeat closes", async || {
        (h.get(repeat).await["reason"] == "repeat of last inbox entry").then_some(())
    })
    .await;
    assert_eq!(h.writes(), [first]);
}

// Seed a prior successful write, then exercise the actual committed producer and shared guard.
#[tokio::test]
async fn b5763d_committed_rename_and_todo_handoff_share_the_repeat_rule() {
    for producer in ["rename", "todo"] {
        let mut run = Run::start().await;
        let first = run.note("seed sender address").await;
        until("seed entry", async || {
            (!run.entries().is_empty()).then_some(())
        })
        .await;
        let body = if producer == "rename" {
            "you are now called \"final-name\" on the Rail".to_owned()
        } else {
            run.sender
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":run.child}}),
                )
                .await
                .unwrap();
            let todo = run
                .sender
                .request(
                    "todo.create",
                    json!({"title":"Review changes","owner":{"kind":"agent","id":run.child}}),
                )
                .await
                .unwrap();
            format!("Next: #{} Review changes", todo["id"])
        };
        let from = run.received()[0]["from"].as_str().unwrap().to_owned();
        let content = Entry {
            id: first,
            kind: contracts::message::MessageKind::Note,
            from: Actor::daemon().id,
            text: body.clone(),
            one_line: false,
        }
        .content(&from, "default");
        let db = run.database();
        assert_eq!(
            db.execute(
                "UPDATE message_inbox_last SET content=? WHERE receiver=?",
                rusqlite::params![content, run.child]
            )
            .unwrap(),
            1
        );
        drop(db);
        let before = run.entries();
        if producer == "rename" {
            run.user
                .request("rail.rename", json!({"id":run.child,"name":"final-name"}))
                .await
                .unwrap();
        } else {
            run.idle_edge().await;
        }
        let repeat = until("producer repeat is final", async || {
            let listed = run
                .user
                .request("message.list", json!({"to":run.child}))
                .await
                .unwrap();
            listed
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["body"] == body && m["reason"] == "repeat of last inbox entry")
                .map(|m| m["id"].as_u64().unwrap() as u32)
        })
        .await;
        assert_eq!(run.entries(), before, "{producer}");
        assert_eq!(
            run.seen().await.iter().filter(|id| **id == repeat).count(),
            1
        );
        assert_eq!(run.typed().await, 0);
    }
}

// Rejects raw-body comparison: the Adapter's multibyte one-line cut defines equality.
#[tokio::test(start_paused = true)]
async fn b5763b_rendered_labels_and_the_one_line_cut_decide_equality() {
    let mut h = Delivery::new();
    let first = h.send("note", "same body").await;
    h.ctx.actor = Actor::daemon();
    let other = h.send("note", "same body").await;
    assert_eq!(h.writes(), [first, other]);
    let prefix = "é".repeat(150);
    let left = messages::digest::push_body(&digest(&format!("{prefix} left")));
    let right = messages::digest::push_body(&digest(&format!("{prefix} right")));
    let long = h.send("note", &left).await;
    let repeat = h.send("note", &right).await;
    assert_eq!(h.writes(), [first, other, long]);
    assert_eq!(h.get(repeat).await["reason"], "repeat of last inbox entry");
    assert!(
        h.get(repeat).await["body"]
            .as_str()
            .unwrap()
            .starts_with(&right)
    );
}

// Rejects calling an unwritten pending note delivered merely because the Daemon reopened.
#[tokio::test(start_paused = true)]
async fn b5763c_an_unwritten_note_still_requires_its_own_receipt() {
    let mut h = Delivery::new();
    h.rail.0.lock()[0]["status"]["kind"] = json!("working");
    let id = h.send("note", "unwritten").await;
    assert!(!h.flight(id));
    h.reopen();
    h.edge().await;
    until("ordinary delivery", async || {
        (h.writes() == [id]).then_some(())
    })
    .await;
    assert_eq!(h.get(id).await["status"], "pending");
    assert!(h.get(id).await["reason"].is_null());
    h.messages.confirm_inbox("receiver", &[id]);
    assert_eq!(h.get(id).await["status"], "delivered");
}
