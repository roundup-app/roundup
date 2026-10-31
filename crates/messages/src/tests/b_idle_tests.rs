//! B2, B3563c, B3563d: a Message to an Agent already `idle` reaches its inbox at once, with no new
//! `idle` event; an unavailable inbox keeps it `pending`; Routes are `auto` or `drop`.

use contracts::Kind;
use serde_json::json;

use super::*;
use super::{agent, agent_node, attach_inbox, ext};

/// A Rail whose next `rail.tree` answers `working` once, as a read taken just before the receiver
/// went `idle`; every later read answers `idle`.
struct StaleOnce {
    stale: std::sync::atomic::AtomicBool,
    read: Option<(tokio::sync::Notify, tokio::sync::Semaphore)>,
}

impl TerminalOwners for StaleOnce {
    fn with_terminal_owner(
        &self,
        _: &str,
        record: &mut dyn FnMut(Option<&agents::TerminalOwner>) -> Result<(), RpcError>,
    ) -> Result<(), RpcError> {
        // This adapter has no Terminal attachments in any state.
        record(None)
    }
}

#[async_trait::async_trait]
impl Module for StaleOnce {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent", "rail"]
    }

    async fn call(&self, _ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
        if method != "rail.tree" {
            return Err(RpcError::method_not_found(method));
        }
        if let Some((entered, release)) = &self.read {
            entered.notify_one();
            release.acquire().await.unwrap().forget();
        }
        let stale = self.stale.swap(false, std::sync::atomic::Ordering::SeqCst);
        let mut node = agent_node("b", if stale { Kind::Working } else { Kind::Idle });
        node.status_revision = Some(if stale { "1" } else { "2" }.into());
        Ok(serde_json::to_value(vec![node]).unwrap())
    }
}

#[tokio::test]
async fn b2_a_message_sent_as_the_receiver_goes_idle_is_still_written() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let rail = Arc::new(StaleOnce {
        stale: false.into(),
        read: None,
    });
    let messages = Messages::open(dir.path(), bus.clone(), rail.clone()).unwrap();
    let inbox = attach_inbox(&messages, true);
    let ctx = Ctx {
        actor: agent("a"),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let mut completed = messages.inner.completed.subscribe();
    tokio::time::timeout(std::time::Duration::from_millis(100), async {
        while completed.recv().await.unwrap() != "initial" {}
    })
    .await
    .expect("initial idle reconciliation completed");

    rail.stale.store(true, std::sync::atomic::Ordering::SeqCst);
    let sent = json!({"to": "b", "kind": "note", "body": "late"});
    messages.call(&ctx, "message.send", sent).await.unwrap();
    for _ in 0..100 {
        if !inbox.typed().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    assert_eq!(inbox.typed(), [("b".to_owned(), "late".to_owned())]);
}

#[tokio::test]
async fn b2_initial_acknowledgement_waits_for_idle_reconciliation() {
    let dir = tempfile::tempdir().unwrap();
    let rail = Arc::new(StaleOnce {
        stale: false.into(),
        read: Some((tokio::sync::Notify::new(), tokio::sync::Semaphore::new(0))),
    });
    let messages = Messages::open(dir.path(), Bus::new(), rail.clone()).unwrap();
    let mut completed = messages.inner.completed.subscribe();
    let (entered, release) = rail.read.as_ref().unwrap();
    tokio::time::timeout(std::time::Duration::from_millis(100), async {
        entered.notified().await;
        assert!(
            completed.try_recv().is_err(),
            "a blocked Rail read is not reconciled"
        );
        // From here the Rail answers every read: the initial reconciliation reads it twice (resync, then settle),
        // and the clock's passes may read it before, between or after those.
        release.add_permits(tokio::sync::Semaphore::MAX_PERMITS);
        while completed.recv().await.unwrap() != "initial" {}
    })
    .await
    .expect("initial reconciliation acknowledged after Rail answers");
}

/// A receiver `b` that is `idle` with a Terminal, a Working sender `a`, an inbox that fails with
/// `failure` and records no receipt; `kind` is sent once.
async fn recovering_note(dir: &Path, kind: &str, failure: contracts::agent::Inbox) -> Harness {
    let mut receiver = agent_node("b", Kind::Idle);
    receiver.terminal_id = Some("terminal-b".into());
    let h = Harness::with_inbox(dir, vec![agent_node("a", Kind::Working), receiver]);
    h.inbox.receipt(false);
    h.inbox.set(failure);
    let mut completed = h.messages.inner.completed.subscribe();
    while completed.recv().await.unwrap() != "initial" {}
    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to":"b", "kind":kind, "body":"recover after outage"}),
        )
        .await;
    if failure == contracts::agent::Inbox::Mismatch {
        assert_eq!(sent.unwrap_err().code, code::INBOX_UNAVAILABLE);
    } else {
        assert_eq!(sent.unwrap()["id"], 1);
    }
    h
}

fn rail_for_recovery() -> Vec<RailNode> {
    let mut receiver = agent_node("b", Kind::Idle);
    receiver.terminal_id = Some("terminal-b".into());
    vec![agent_node("a", Kind::Working), receiver]
}

#[tokio::test]
async fn b3563c_unavailable_inbox_keeps_pending_identity_and_reports_the_cause() {
    use contracts::agent::Inbox;
    for kind in ["note", "question"] {
        for failure in [Inbox::Missing, Inbox::Mismatch] {
            for restart in [false, true] {
                let dir = tempfile::tempdir().unwrap();
                let mut h = recovering_note(dir.path(), kind, failure).await;
                // A second Message queues behind the first; only a mismatch is told to its sender.
                let second = h
                    .call_as(
                        agent("a"),
                        "message.send",
                        json!({"to":"b", "kind":"note", "body":"queued behind"}),
                    )
                    .await;
                assert_eq!(
                    second.err().map(|e| e.code),
                    (failure == Inbox::Mismatch).then_some(code::INBOX_UNAVAILABLE),
                    "{kind} {failure:?}"
                );
                for revision in 2..5 {
                    on_status(
                        &h.messages.inner,
                        "b",
                        "1",
                        &revision.to_string(),
                        Kind::Idle,
                    )
                    .await;
                }
                for id in [1, 2] {
                    let message = h.messages.get_or_not_found(id).unwrap();
                    assert_eq!(message.status, MessageStatus::Pending, "{id}");
                    assert_eq!(message.reason, None);
                    assert!(!h.messages.store().unwrap().in_flight(id).unwrap());
                }
                assert!(h.inbox.written().is_empty(), "no write while unavailable");
                assert!(!h.events().iter().any(|e| e == "message.delivered"));

                if restart {
                    drop(h);
                    h = Harness::with_inbox(dir.path(), rail_for_recovery());
                    h.inbox.receipt(false);
                    let mut completed = h.messages.inner.completed.subscribe();
                    while completed.recv().await.unwrap() != "initial" {}
                } else {
                    h.inbox.set(Inbox::Ok);
                }
                on_status(&h.messages.inner, "b", "1", "9", Kind::Idle).await;

                // The same ids, in order, once; the receipt alone delivers them.
                assert_eq!(
                    h.inbox.written(),
                    [1, 2],
                    "{kind} {failure:?} restart={restart}"
                );
                let texts: Vec<_> = h.inbox.typed().into_iter().map(|t| t.1).collect();
                assert_eq!(texts, ["recover after outage", "queued behind"]);
                assert_eq!(
                    h.messages.get_or_not_found(1).unwrap().status,
                    MessageStatus::Pending
                );
                h.messages.confirm_inbox("b", &[1, 2]);
                for id in [1, 2] {
                    assert_eq!(
                        h.messages.get_or_not_found(id).unwrap().status,
                        MessageStatus::Delivered
                    );
                }
            }
        }
    }
}

#[tokio::test]
async fn b3563c_every_sender_and_kind_uses_the_inbox_and_never_the_terminal() {
    for kind in ["note", "question"] {
        for sender in [
            Actor::user(),
            agent("a"),
            Actor {
                kind: ActorKind::Ext,
                id: "ext".into(),
                parent: None,
            },
            Actor::daemon(),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let h = Harness::with_inbox(
                dir.path(),
                vec![agent_node("a", Kind::Working), agent_node("b", Kind::Idle)],
            );
            h.inbox.receipt(false);
            let mut completed = h.messages.inner.completed.subscribe();
            while completed.recv().await.unwrap() != "initial" {}
            let sent = h
                .call_as(
                    sender.clone(),
                    "message.send",
                    json!({"to":"b", "kind":kind, "body":"which transport?"}),
                )
                .await
                .unwrap();
            assert_eq!(h.inbox.written(), [1], "{sender:?} {kind}");
            assert_eq!(
                h.call("message.get", json!({"id":sent["id"]}))
                    .await
                    .unwrap()["status"],
                "pending"
            );
        }
    }
}

// B51(g): rejects a kind-scoped repeat filter and allocation before refusal.
#[tokio::test]
async fn b51_repeat_refusal_compares_both_kinds_before_allocating() {
    for first_kind in ["note", "question"] {
        for next_kind in ["note", "question"] {
            let dir = tempfile::tempdir().unwrap();
            let h = recovering_note(dir.path(), first_kind, contracts::agent::Inbox::Missing).await;
            h.inbox.set(contracts::agent::Inbox::Ok);
            on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
            h.messages.confirm_inbox("b", &[1]);
            let err = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to":"b", "kind":next_kind, "body":"recover after outage"}),
                )
                .await
                .unwrap_err();
            assert_eq!(err.code, code::CONFLICT);
            assert_eq!(
                h.call("message.list", json!({}))
                    .await
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(h.inbox.written(), [1]);
        }
    }
}

// B52(a), B39/B40: rejects clearing in-flight on idle or recording delivery on socket success.
#[tokio::test]
async fn b52_every_completed_idle_and_receipt_preserves_one_delivery() {
    for kind in ["note", "question"] {
        let dir = tempfile::tempdir().unwrap();
        let mut h = recovering_note(dir.path(), kind, contracts::agent::Inbox::Ok).await;
        for revision in 2..32 {
            on_status(
                &h.messages.inner,
                "b",
                "1",
                &revision.to_string(),
                Kind::Idle,
            )
            .await;
        }
        assert_eq!(h.inbox.written(), [1]);
        assert_eq!(
            h.messages.get_or_not_found(1).unwrap().status,
            MessageStatus::Pending
        );
        assert!(!h.events().iter().any(|e| e == "message.delivered"));
        for _ in 0..2 {
            h.messages.confirm_inbox("b", &[1]);
            assert_eq!(
                h.messages.get_or_not_found(1).unwrap().status,
                MessageStatus::Delivered
            );
        }
        assert_eq!(
            h.events()
                .iter()
                .filter(|e| *e == "message.delivered")
                .count(),
            1
        );
        on_status(&h.messages.inner, "b", "1", "62", Kind::Idle).await;
        assert_eq!(h.inbox.written(), [1]);
    }
}

#[tokio::test]
async fn b3563d_routes_are_auto_or_drop_and_keep_authority() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(
        dir.path(),
        vec![
            agent_node("b", Kind::Working),
            agent_node("c", Kind::Working),
        ],
    );
    let route = |to: &str, delivery: &str| json!({"from": "a", "to": to, "delivery": delivery});

    // The obsolete third value is invalid and stores nothing.
    for caller in [Actor::user(), agent("m")] {
        let err = h
            .call_as(caller, "route.set", route("b", "ask-first"))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    assert_eq!(h.call("route.list", Value::Null).await.unwrap(), json!([]));

    // auto sends, drop records a dropped Message without a send.
    h.call("route.set", route("b", "auto")).await.unwrap();
    h.call("route.set", route("c", "drop")).await.unwrap();
    assert_eq!(
        h.call("route.list", Value::Null).await.unwrap(),
        json!([
            {"from": "a", "to": "b", "delivery": "auto"},
            {"from": "a", "to": "c", "delivery": "drop"},
        ])
    );
    h.events();
    let status_of = |to: &'static str| {
        let h = &h;
        async move {
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": to, "kind": "note", "body": to}),
            )
            .await
            .unwrap()["status"]
                .clone()
        }
    };
    assert_eq!(status_of("b").await, "pending");
    assert_eq!(status_of("c").await, "dropped");
    assert_eq!(
        h.events(),
        ["message.sent", "message.sent", "message.dropped"]
    );
    assert!(h.inbox.written().is_empty());

    // An Extension may not set a Route; an Agent may not override the user's.
    let ext = h
        .call_as(ext("e"), "route.set", route("b", "drop"))
        .await
        .unwrap_err();
    assert_eq!(ext.code, code::FORBIDDEN);
    let overridden = h
        .call_as(agent("m"), "route.set", route("b", "drop"))
        .await
        .unwrap_err();
    assert_eq!(overridden.code, code::FORBIDDEN);
    h.call_as(agent("m"), "route.set", route("d", "drop"))
        .await
        .unwrap();
    h.call("route.set", route("d", "auto")).await.unwrap();
    let after_user = h
        .call_as(agent("m"), "route.set", route("d", "drop"))
        .await
        .unwrap_err();
    assert_eq!(after_user.code, code::FORBIDDEN);
}

fn quiet_digest_body() -> String {
    crate::digest::push_body(&contracts::agent::DigestEntry {
        name: "c".into(),
        kind: Kind::Working,
        last: String::new(),
        todos: 0,
        pads: vec![],
    })
}

async fn idle_receiver(dir: &Path) -> Harness {
    let mut receiver = agent_node("b", Kind::Idle);
    receiver.terminal_id = Some("terminal-b".into());
    let h = Harness::with_inbox(dir, vec![agent_node("a", Kind::Working), receiver]);
    let mut completed = h.messages.inner.completed.subscribe();
    while completed.recv().await.unwrap() != "initial" {}
    h
}

async fn settle() {
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
}

#[tokio::test]
async fn b5168f_a_quiet_digest_starts_no_turn() {
    let dir = tempfile::tempdir().unwrap();
    let h = idle_receiver(dir.path()).await;
    let sent = json!({"to":"b", "kind":"note", "body": quiet_digest_body()});
    h.call_as(contracts::Actor::daemon(), "message.send", sent)
        .await
        .unwrap();
    settle().await;
    assert!(h.inbox.typed().is_empty());
}

#[tokio::test]
async fn b5168f_a_held_quiet_digest_rides_the_next_delivery_once() {
    let dir = tempfile::tempdir().unwrap();
    let h = idle_receiver(dir.path()).await;
    let digest = json!({"to":"b", "kind":"note", "body": quiet_digest_body()});
    h.call_as(contracts::Actor::daemon(), "message.send", digest)
        .await
        .unwrap();
    let note = json!({"to":"b", "kind":"note", "body":"hello"});
    h.call_as(agent("a"), "message.send", note).await.unwrap();
    settle().await;
    let typed = h.inbox.typed();
    assert_eq!(typed.len(), 2, "{typed:?}");
    assert_eq!(h.inbox.written().len(), 2);
    assert!(typed.iter().any(|(_, body)| body == "hello"));
}

#[tokio::test]
async fn b5168f_a_restart_keeps_a_held_quiet_digest() {
    let dir = tempfile::tempdir().unwrap();
    let h = idle_receiver(dir.path()).await;
    let digest = json!({"to":"b", "kind":"note", "body": quiet_digest_body()});
    h.call_as(contracts::Actor::daemon(), "message.send", digest)
        .await
        .unwrap();
    settle().await;
    assert!(h.inbox.typed().is_empty());
    drop(h);
    let h = idle_receiver(dir.path()).await;
    settle().await;
    assert!(
        h.inbox.typed().is_empty(),
        "still pending after the restart"
    );
    let note = json!({"to":"b", "kind":"note", "body":"hello"});
    h.call_as(agent("a"), "message.send", note).await.unwrap();
    settle().await;
    assert_eq!(h.inbox.written().len(), 2);
}

#[tokio::test]
async fn b5168f_a_finished_result_starts_one_turn() {
    let dir = tempfile::tempdir().unwrap();
    let h = idle_receiver(dir.path()).await;
    let news = crate::digest::push_body(&contracts::agent::DigestEntry {
        name: "c".into(),
        kind: Kind::Working,
        last: "done: the build is green".into(),
        todos: 0,
        pads: vec![],
    });
    let sent = json!({"to":"b", "kind":"note", "body": news});
    h.call_as(contracts::Actor::daemon(), "message.send", sent)
        .await
        .unwrap();
    settle().await;
    assert_eq!(h.inbox.typed().len(), 1);
}

#[tokio::test]
async fn b5168f_a_new_question_starts_one_turn() {
    let dir = tempfile::tempdir().unwrap();
    let h = idle_receiver(dir.path()).await;
    let sent = json!({"to":"b", "kind":"question", "body":"which branch?"});
    h.call_as(agent("a"), "message.send", sent).await.unwrap();
    settle().await;
    assert_eq!(h.inbox.typed().len(), 1);
}
