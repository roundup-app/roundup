//! B13 to B17: a question bubbles up the Rail one Door at a time and lands with the user. Workstreams
//! nest `top` > `mid` > `sub`; Agent `c` lives in `sub`, Agent `d` in `top`. The clock is fake.

use std::sync::atomic::{AtomicI64, Ordering};

use contracts::agent::{NodeKind, StatusEvent};
use contracts::{Actor, EventData, Kind, Status, Verb};
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
        let agents: Arc<dyn TerminalOwners> = rail.clone();
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

    /// The Daemon's clock reads `ms`, and every bound that ran out by then is passed.
    async fn at(&self, ms: i64) {
        self.clock.store(ms, Ordering::SeqCst);
        settle(&self.messages.inner, None, "settle").await.unwrap();
    }

    /// `(to, status, reason, passedFrom)` of every Message, by id.
    async fn all(&self) -> Vec<(String, String, Value, Value)> {
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
                    m["passedFrom"].clone(),
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
                id: id.into(),
                attempt: "1".into(),
                status_revision: revision.to_string(),
                status,
            })),
        );
        // The listener reads the event on its own task.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    fn touchers(&self, id: u32) -> Vec<(Verb, String)> {
        self.touches
            .history(&item(id))
            .unwrap()
            .into_iter()
            .map(|t| (t.verb, t.actor.id))
            .collect()
    }
}

fn row(to: &str, status: &str, reason: Value, from: Value) -> (String, String, Value, Value) {
    (to.into(), status.into(), reason, from)
}

#[tokio::test]
async fn b13_a_question_goes_door_by_door_up_the_rail_and_lands_with_the_user() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());

    let first = h.ask("c", "sub").await;
    assert_eq!(first["passedFrom"], Value::Null);
    h.at(60_000).await;
    h.at(120_000).await;
    h.at(180_000).await;

    assert_eq!(
        h.all().await,
        [
            row("sub", "dropped", json!("passed"), Value::Null),
            row("mid", "dropped", json!("passed"), json!(1)),
            row("top", "dropped", json!("passed"), json!(2)),
            row("you", "delivered", json!("escalated"), json!(3)),
        ]
    );
    let escalated_question = h.get(4).await;
    assert_eq!(escalated_question["from"]["id"], "c");
    assert_eq!(escalated_question["kind"], "question");
    assert_eq!(escalated_question["body"], "which?");
    assert_eq!(escalated_question["replyTo"], Value::Null);
}

#[tokio::test]
async fn b13_a_hop_made_by_a_bound_is_touched_by_rupd_and_the_first_by_the_sender() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.at(60_000).await;

    assert_eq!(h.touchers(1), [(Verb::Wrote, "c".to_owned())]);
    assert_eq!(h.touchers(2), [(Verb::Wrote, "rupd".to_owned())]);
}

#[tokio::test]
async fn b13_the_sender_is_never_a_hop_and_the_chain_is_read_once() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    // `mid`'s Door asks `sub`: its own Workstream is above `sub`, so it is skipped.
    h.ask("mid", "sub").await;
    h.rail.0.lock().unwrap()[2].parent = None;
    h.at(60_000).await;
    h.at(120_000).await;

    assert_eq!(
        h.all().await,
        [
            row("sub", "dropped", json!("passed"), Value::Null),
            row("top", "dropped", json!("passed"), json!(1)),
            row("you", "delivered", json!("escalated"), json!(2)),
        ]
    );
}

#[tokio::test]
async fn b13_a_question_to_an_agent_or_the_user_has_one_hop() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "r").await;
    h.ask("c", "you").await;
    h.at(600_000).await;

    assert_eq!(
        h.all().await,
        [
            row("r", "dropped", json!("passed"), Value::Null),
            row("you", "delivered", Value::Null, Value::Null),
            row("you", "delivered", json!("escalated"), json!(1)),
        ]
    );
}

#[tokio::test]
async fn b14_a_hop_has_not_passed_at_59999_ms_and_has_at_60000() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.clock.store(1_000, Ordering::SeqCst);
    h.ask("c", "sub").await;

    h.at(60_999).await;
    assert_eq!(h.all().await.len(), 1);
    h.at(61_000).await;
    assert_eq!(h.all().await.len(), 2);
}

#[tokio::test]
async fn b13_a_delivered_hop_stays_delivered_when_it_passes() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Idle).await;
    assert_eq!(h.inbox.typed().len(), 1);

    h.at(60_000).await;

    let all = h.all().await;
    assert_eq!(all[0].1, "delivered");
    assert_eq!(all[1], row("mid", "pending", Value::Null, json!(1)));
}

#[tokio::test]
async fn b16_a_receiver_that_is_gone_or_a_drop_route_never_delays_the_escalated_question() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    let route = json!({"from": "c", "to": "top", "delivery": "drop"});
    h.call_as(Actor::user(), "route.set", route).await.unwrap();
    h.ask("c", "sub").await;
    // `mid` is gone before the question passes: it is never made a hop.
    h.rail.0.lock().unwrap().retain(|n| n.id != "mid");

    h.at(60_000).await;

    assert_eq!(
        h.all().await,
        [
            row("sub", "dropped", json!("passed"), Value::Null),
            row("top", "dropped", Value::Null, json!(1)),
            row("you", "delivered", json!("escalated"), json!(2)),
        ]
    );
}

#[tokio::test]
async fn b16_a_hop_to_a_full_receiver_is_never_made() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    for n in 0..OPEN_BOUND {
        let p = json!({"to": "mid", "kind": "note", "body": format!("x{n}")});
        h.call_as(agent("d"), "message.send", p).await.unwrap();
    }
    h.ask("c", "sub").await;

    h.at(60_000).await;

    let all = h.all().await;
    assert_eq!(all.last().unwrap().0, "top");
    assert_eq!(all.last().unwrap().3, json!(33));
}

#[tokio::test]
async fn b16_a_delivered_hop_whose_agent_ends_passes_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Idle).await;
    h.becomes("sub", Kind::Done).await;

    let all = h.all().await;
    assert_eq!(all[0].1, "delivered");
    assert_eq!(all[1], row("mid", "pending", Value::Null, json!(1)));
}

#[tokio::test]
async fn b13_message_pass_is_the_hops_receivers_call_on_an_open_hop() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.call_as(
        agent("mid"),
        "message.send",
        json!({"to": "d", "kind": "note", "body": "x"}),
    )
    .await
    .unwrap();
    h.ask("c", "sub").await;
    let pass = |who: Actor, id: u32| h.call_as(who, "message.pass", json!({"id": id}));

    assert_eq!(
        pass(Actor::user(), 2).await.unwrap_err().code,
        code::FORBIDDEN
    );
    assert_eq!(pass(agent("c"), 2).await.unwrap_err().code, code::FORBIDDEN);
    assert_eq!(pass(agent("d"), 1).await.unwrap_err().code, code::CONFLICT);
    assert_eq!(
        pass(agent("sub"), 9).await.unwrap_err().code,
        code::NOT_FOUND
    );

    let passed = pass(agent("sub"), 2).await.unwrap();
    assert_eq!(passed["status"], "dropped");
    assert_eq!(passed["reason"], "passed");
    assert_eq!(
        h.all().await[2],
        row("mid", "pending", Value::Null, json!(2))
    );
    assert_eq!(
        pass(agent("sub"), 2).await.unwrap_err().code,
        code::CONFLICT
    );
}

#[tokio::test]
async fn b17_a_note_that_answers_the_current_hop_stops_the_bubble() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Idle).await;

    let answer = json!({"to": "c", "kind": "note", "body": "this one", "replyTo": 1});
    h.call_as(agent("sub"), "message.send", answer)
        .await
        .unwrap();
    h.at(600_000).await;

    let all = h.all().await;
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].1, "delivered");
    assert_eq!(all[1].0, "c");
}

#[tokio::test]
async fn b17_a_note_from_an_earlier_hop_or_after_the_escalated_question_stops_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Idle).await;
    h.at(60_000).await;

    let late = json!({"to": "c", "kind": "note", "body": "late", "replyTo": 1});
    h.call_as(agent("sub"), "message.send", late).await.unwrap();
    h.at(120_000).await;
    h.at(180_000).await;

    let all = h.all().await;
    assert_eq!(all[4], row("you", "delivered", json!("escalated"), json!(4)));
}

#[tokio::test]
async fn b14_after_a_restart_a_hop_whose_bound_ran_out_passes_once() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    let h = h.restarted();

    h.at(60_000).await;
    h.at(60_001).await;

    let all = h.all().await;
    assert_eq!(all.len(), 2);
    assert_eq!(all[1], row("mid", "pending", Value::Null, json!(1)));
}

#[tokio::test]
async fn b14_a_restart_reads_the_bound_from_the_stored_time() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.clock.store(10_000, Ordering::SeqCst);
    h.ask("c", "sub").await;
    let h = h.restarted();

    h.at(69_999).await;
    assert_eq!(h.all().await.len(), 1);
    h.at(70_000).await;
    assert_eq!(h.all().await.len(), 2);
}

#[tokio::test]
async fn b17_a_note_to_anyone_but_the_asker_stops_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Idle).await;

    let elsewhere = json!({"to": "d", "kind": "note", "body": "fyi", "replyTo": 1});
    h.call_as(agent("sub"), "message.send", elsewhere)
        .await
        .unwrap();
    h.at(60_000).await;

    let all = h.all().await;
    assert!(all.iter().any(|m| m.3 == json!(1)), "{all:?}");
}

/// Marks `ids` `idle` on the Rail, with no status event.
fn idle(h: &Hops, ids: &[&str]) {
    for node in h.rail.0.lock().unwrap().iter_mut() {
        if ids.contains(&node.id.as_str()) {
            node.status = Some(Status {
                kind: Kind::Idle,
                label: "x".into(),
                since: 0,
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

#[tokio::test]
async fn b13_a_hop_to_an_already_idle_door_is_typed_without_a_new_status() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    idle(&h, &["mid"]);
    h.ask("c", "sub").await;
    h.call_as(agent("sub"), "message.pass", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(typed_after(&h, 1).await, 1);
    assert_eq!(h.get(2).await["to"], "mid");
    assert_eq!(h.get(2).await["status"], "delivered");
}

#[tokio::test]
async fn b17_a_kill_between_the_escalated_question_and_the_chain_move_leaves_neither() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "top").await;
    // The chain move fails, as a kill between the two writes would.
    let db = rusqlite::Connection::open(dir.path().join("messages.db")).unwrap();
    db.execute_batch(
        "CREATE TRIGGER kill BEFORE UPDATE ON chains BEGIN SELECT RAISE(ABORT, 'killed'); END",
    )
    .unwrap();
    h.clock.store(60_000, Ordering::SeqCst);
    assert!(settle(&h.messages.inner, None, "settle").await.is_err());
    assert_eq!(h.all().await.len(), 1);
    db.execute_batch("DROP TRIGGER kill").unwrap();
    let h = h.restarted();
    h.at(60_000).await;
    h.at(120_000).await;
    let rows = h.all().await;
    assert_eq!(rows.iter().filter(|r| r.0 == Actor::user().id).count(), 1);
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

    async fn receive(&self, inbox: &FakeInbox, to: &str, id: u32) {
        idle(self, &[to]);
        nudge(&self.messages.inner, to).await;
        {
            let entries = inbox.entries();
            assert!(
                entries
                    .iter()
                    .any(|(receiver, seen, kind, body)| receiver == to
                        && *seen == id
                        && *kind == MessageKind::Question
                        && body == "which?")
            );
        }
        assert_eq!(self.get(id).await["status"], "pending");
        self.messages.confirm_inbox(to, &[id]);
        assert_eq!(self.get(id).await["status"], "delivered");
    }
}

// B13: rejects rebuilding ancestors at pass time, changing the origin, or typing a hop.
#[tokio::test]
async fn b13_inbox_hops_preserve_the_frozen_chain_and_origin() {
    for (from, first, recipients) in [
        ("c", "sub", vec!["sub", "mid", "top"]),
        ("mid", "sub", vec!["sub", "top"]),
        ("c", "r", vec!["r"]),
        ("c", "top", vec!["top"]),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        h.ask(from, first).await;
        h.rail
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .find(|n| n.id == first)
            .unwrap()
            .parent = Some("r".into());
        for (index, to) in recipients.iter().enumerate() {
            let id = u32::try_from(index + 1).unwrap();
            h.receive(&inbox, to, id).await;
            let message = h.get(id).await;
            assert_eq!(message["from"]["id"], from);
            assert_eq!(message["kind"], "question");
            assert_eq!(message["body"], "which?");
            assert_eq!(message["replyTo"], Value::Null);
            assert_eq!(
                message["passedFrom"],
                if id == 1 { Value::Null } else { json!(id - 1) }
            );
            h.at(i64::from(id) * 60_000).await;
            assert_eq!(h.all().await.len(), index + 2);
        }
        let all = h.all().await;
        assert_eq!(all.last().unwrap().0, "you");
        assert_eq!(all.last().unwrap().2, "escalated");
        assert_eq!(inbox.entries().len(), recipients.len());
        h.at(600_000).await;
        assert_eq!(h.all().await, all);
    }
}

// B17: rejects accepting an earlier hop's reply or a reply before the current receipt.
#[tokio::test]
async fn b17_only_the_current_delivered_inbox_hop_can_answer() {
    for (answerer, reply_to, received, stops) in [
        ("sub", 1, true, false),
        ("mid", 2, false, false),
        ("mid", 2, true, true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        h.ask("c", "sub").await;
        h.receive(&inbox, "sub", 1).await;
        h.at(60_000).await;
        if received {
            h.receive(&inbox, "mid", 2).await;
        }
        h.call_as(
            agent(answerer),
            "message.send",
            json!({"to":"c", "kind":"note", "body":"answer", "replyTo":reply_to}),
        )
        .await
        .unwrap();
        h.at(120_000).await;
        assert_eq!(h.all().await.len(), if stops { 3 } else { 4 });
    }
}

// B51(g): rejects silent peer repeat discard when releasing a held question or making a hop.
// B14: rejects starting the bound while the inbox is unavailable or restarting it on receipt.
#[tokio::test]
async fn b14_inbox_question_bounds_wait_for_the_inbox() {
    for receipt in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        idle(&h, &["sub"]);
        inbox.set(contracts::agent::Inbox::Missing);
        h.ask("c", "sub").await;
        h.at(600_000).await;
        assert_eq!(h.all().await.len(), 1);
        assert_eq!(h.get(1).await["status"], "pending");
        assert!(inbox.entries().is_empty());
        inbox.set(contracts::agent::Inbox::Ok);
        nudge(&h.messages.inner, "sub").await;
        h.at(600_001).await;
        assert_eq!(h.all().await.len(), 1);
        assert_eq!(inbox.entries().len(), 1);
        if receipt {
            h.messages.confirm_inbox("sub", &[1]);
        }
        h.at(659_999).await;
        assert_eq!(h.all().await.len(), 1);
        h.at(660_000).await;
        assert_eq!(h.all().await.len(), 2);
    }
}

// B52(b), B39/B40: rejects losing the in-flight retry identity or advancing a stored chain twice.
#[tokio::test]
async fn b52_question_restart_replays_receipts_and_escalation_once() {
    for acknowledged in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        idle(&h, &["sub"]);
        h.ask("c", "sub").await;
        assert_eq!(inbox.entries().len(), 1);
        if acknowledged {
            h.messages.confirm_inbox("sub", &[1]);
        }
        {
            let mut rail = h.rail.0.lock().unwrap();
            let node = rail.iter_mut().find(|n| n.id == "sub").unwrap();
            node.attempt = Some("2".into());
        }
        let (h, inbox) = h.restarted().attach_inbox().await;
        nudge(&h.messages.inner, "sub").await;
        assert_eq!(inbox.entries().len(), usize::from(!acknowledged));
        assert_eq!(h.all().await.len(), 1);
        h.messages.confirm_inbox("sub", &[1]);
        h.messages.confirm_inbox("sub", &[1]);
        assert_eq!(h.get(1).await["status"], "delivered");
        h.at(59_999).await;
        assert_eq!(h.all().await.len(), 1);
        h.at(60_000).await;
        assert_eq!(h.get(2).await["to"], "mid");
        assert_eq!(h.get(2).await["passedFrom"], 1);
        let (h, _) = h.restarted().attach_inbox().await;
        h.at(60_000).await;
        assert_eq!(h.all().await.len(), 2);
        h.at(120_000).await;
        assert_eq!(h.get(3).await["to"], "top");
        h.at(180_000).await;
        let all = h.all().await;
        assert_eq!(all.len(), 4);
        assert_eq!(all[3], row("you", "delivered", json!("escalated"), json!(3)));
        h.at(600_000).await;
        assert_eq!(h.all().await, all);
    }
}

// B51(g): rejects bypassing repeat refusal on automatic inbox/Terminal hold release.
// B50(b,d): rejects treating a Daemon question's authored digest prefix as a foldable note.
#[tokio::test]
async fn b50_a_daemon_question_keeps_its_full_body_in_the_inbox() {
    let dir = tempfile::tempdir().unwrap();
    let (h, inbox) = Hops::with_inbox(dir.path()).await;
    idle(&h, &["sub"]);
    let body = format!("[digest] {}", "é".repeat(300));
    h.call_as(
        Actor::daemon(),
        "message.send",
        json!({"to":"sub", "kind":"question", "body":body}),
    )
    .await
    .unwrap();
    assert_eq!(inbox.entries().len(), 1);
    assert_eq!(inbox.entries()[0].3, body);
    assert_eq!(h.get(1).await["body"], body);
    assert_eq!(h.get(1).await["status"], "pending");
    h.rail
        .0
        .lock()
        .unwrap()
        .iter_mut()
        .find(|n| n.id == "sub")
        .unwrap()
        .status
        .as_mut()
        .unwrap()
        .kind = Kind::Working;
    let question = "[digest] c is working\n  last: which?\n  open todos: 0";
    h.call_as(
        Actor::daemon(),
        "message.send",
        json!({"to":"sub", "kind":"question", "body":question}),
    )
    .await
    .unwrap();
    h.call_as(Actor::daemon(), "message.send", json!({"to":"sub", "kind":"note", "body":"[digest] c is idle\n  last: finished\n  open todos: 0"})).await.unwrap();
    assert_eq!(
        h.get(2).await["status"],
        "pending",
        "a later digest cannot drop a question"
    );
    idle(&h, &["sub"]);
    nudge(&h.messages.inner, "sub").await;
    assert!(
        inbox
            .entries()
            .iter()
            .any(|(_, id, kind, body)| *id == 2
                && *kind == MessageKind::Question
                && body == question)
    );
}

// B1/B50(b): rejects exempting questions from the open bound because their body resembles a note.
#[tokio::test]
async fn b1_daemon_questions_keep_the_open_bound_with_note_prefixes() {
    for prefix in ["[digest]", "[wake]"] {
        let dir = tempfile::tempdir().unwrap();
        let (h, _) = Hops::with_inbox(dir.path()).await;
        for index in 0..32 {
            h.call_as(
                Actor::daemon(),
                "message.send",
                json!({"to":"sub", "kind":"question", "body":format!("{prefix} which {index}?")}),
            )
            .await
            .unwrap();
        }
        let error = h
            .call_as(
                Actor::daemon(),
                "message.send",
                json!({"to":"sub", "kind":"question", "body":format!("{prefix} overflow?")}),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, code::CONFLICT);
        assert_eq!(h.all().await.len(), 32);
    }
}
