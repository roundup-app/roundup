//! B2: a Message sent to an Agent already `idle` is typed at once, with no new `idle` event.

use std::sync::Mutex as StdMutex;

use contracts::Kind;
use serde_json::json;

use super::*;
use super::{FakeRail, agent, agent_node};

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
async fn b2_a_message_sent_as_the_receiver_goes_idle_is_still_typed() {
    let dir = tempfile::tempdir().unwrap();
    let typed: Arc<StdMutex<Vec<String>>> = Arc::default();
    let seen = Arc::clone(&typed);
    let deliver: Deliver = Arc::new(move |_, text| {
        seen.lock().unwrap().push(shown(text));
        Box::pin(async { Ok(()) })
    });
    let bus = Bus::new();
    let rail = Arc::new(StaleOnce {
        stale: false.into(),
        read: None,
    });
    let messages = Messages::open(dir.path(), bus.clone(), rail.clone(), deliver).unwrap();
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
        if !typed.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    assert_eq!(
        *typed.lock().unwrap(),
        ["[from an Agent that is gone, note] late"]
    );
}

#[tokio::test]
async fn b2_initial_acknowledgement_waits_for_idle_reconciliation() {
    let dir = tempfile::tempdir().unwrap();
    let rail = Arc::new(StaleOnce {
        stale: false.into(),
        read: Some((tokio::sync::Notify::new(), tokio::sync::Semaphore::new(0))),
    });
    let deliver: Deliver = Arc::new(|_, _| Box::pin(async { Ok(()) }));
    let messages = Messages::open(dir.path(), Bus::new(), rail.clone(), deliver).unwrap();
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

#[tokio::test]
async fn b2_busy_rollback_preserves_the_next_idle_in_either_order() {
    // Both callers share on_idle, but send uses Fresh and status uses Next.
    for status_driven in [false, true] {
        for idle_before_busy in [true, false] {
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                let dir = tempfile::tempdir().unwrap();
                let entered = Arc::new(tokio::sync::Notify::new());
                let release = Arc::new(tokio::sync::Notify::new());
                let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
                let accepted: Arc<StdMutex<Vec<String>>> = Arc::default();
                let deliver: Deliver = {
                    let entered = entered.clone();
                    let release = release.clone();
                    let attempts = attempts.clone();
                    let accepted = accepted.clone();
                    Arc::new(move |_, text| {
                        let first = attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0;
                        let entered = entered.clone();
                        let release = release.clone();
                        let accepted = accepted.clone();
                        Box::pin(async move {
                            if first {
                                entered.notify_one();
                                release.notified().await;
                                Err(Refusal::Busy)
                            } else {
                                accepted.lock().unwrap().push(shown(text));
                                Ok(())
                            }
                        })
                    })
                };
                let bus = Bus::new();
                let rail = FakeRail::new(vec![agent_node(
                    "b",
                    if status_driven {
                        Kind::Working
                    } else {
                        Kind::Idle
                    },
                )]);
                let messages =
                    Messages::open(dir.path(), bus.clone(), rail.clone(), deliver).unwrap();
                let ctx = Ctx {
                    actor: Actor::user(),
                    bus,
                    touches: Arc::new(Touches::in_memory().unwrap()),
                };
                let mut completed = messages.inner.completed.subscribe();
                start_listener(&messages.inner);
                while completed.recv().await.unwrap() != "initial" {}
                let send = || {
                    messages.call(
                        &ctx,
                        "message.send",
                        json!({"to":"b", "kind":"note", "body":"[decision d1] test"}),
                    )
                };
                if status_driven {
                    send().await.unwrap();
                    let mut nodes = rail.0.lock().unwrap();
                    nodes[0].status.as_mut().unwrap().kind = Kind::Idle;
                    nodes[0].status_revision = Some("2".into());
                }
                let delivery = async {
                    if status_driven {
                        on_status(&messages.inner, "b", "1", "2", Kind::Idle).await;
                    } else {
                        send().await.unwrap();
                    }
                };
                let next_idle = || async {
                    let revision = if status_driven { "3" } else { "2" };
                    rail.0.lock().unwrap()[0].status_revision = Some(revision.into());
                    on_status(&messages.inner, "b", "1", revision, Kind::Idle).await;
                };
                let ordering = async {
                    entered.notified().await;
                    if idle_before_busy {
                        next_idle().await;
                    }
                    release.notify_one();
                };
                tokio::join!(delivery, ordering);
                if !idle_before_busy {
                    assert_eq!(
                        attempts.load(std::sync::atomic::Ordering::SeqCst),
                        1,
                        "must not spin on the same idle revision"
                    );
                    next_idle().await;
                }
                let stored = messages
                    .call(&ctx, "message.get", json!({"id":1}))
                    .await
                    .unwrap();
                assert_eq!(
                    stored["status"], "delivered",
                    "status_driven={status_driven}, idle_before_busy={idle_before_busy}: {stored}"
                );
                assert_eq!(
                    *accepted.lock().unwrap(),
                    ["[from you, note] [decision d1] test"]
                );
                assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 2);
            })
            .await
            .expect("Busy/idle delivery did not settle");
        }
    }
}

struct RecoveringInbox {
    state: StdMutex<contracts::agent::Inbox>,
    written: StdMutex<Vec<u32>>,
    gate: std::sync::atomic::AtomicBool,
    checking: tokio::sync::Notify,
    finish: tokio::sync::Notify,
}

#[async_trait]
impl NoteInbox for RecoveringInbox {
    async fn check(&self, _: &str) -> contracts::agent::Inbox {
        if self.gate.swap(false, std::sync::atomic::Ordering::SeqCst) {
            self.checking.notify_one();
            self.finish.notified().await;
        }
        *self.state.lock().unwrap()
    }

    fn write(
        &self,
        _: &str,
        entries: &[agents::claude_code::inbox::Entry],
    ) -> Result<(), contracts::agent::Inbox> {
        self.written
            .lock()
            .unwrap()
            .extend(entries.iter().map(|e| e.id));
        Ok(())
    }
}

async fn recovering_note(
    kind: &str,
    failure: contracts::agent::Inbox,
) -> (
    tempfile::TempDir,
    Harness,
    Arc<RecoveringInbox>,
    Arc<StdMutex<Vec<String>>>,
) {
    let dir = tempfile::tempdir().unwrap();
    let mut receiver = agent_node("b", Kind::Idle);
    receiver.terminal_id = Some("terminal-b".into());
    let typed: Arc<StdMutex<Vec<String>>> = Arc::default();
    let seen = typed.clone();
    let h = Harness::with_deliver(
        dir.path(),
        vec![agent_node("a", Kind::Working), receiver],
        Arc::new(move |_, text| {
            seen.lock().unwrap().push(text);
            Box::pin(async { Ok(()) })
        }),
    );
    let mut completed = h.messages.inner.completed.subscribe();
    while completed.recv().await.unwrap() != "initial" {}
    let inbox = Arc::new(RecoveringInbox {
        state: StdMutex::new(failure),
        written: StdMutex::new(vec![]),
        gate: false.into(),
        checking: tokio::sync::Notify::new(),
        finish: tokio::sync::Notify::new(),
    });
    h.messages.set_inbox(inbox.clone());
    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({
                "to":"b", "kind":kind, "body":"recover after hold"
            }),
        )
        .await;
    if failure == contracts::agent::Inbox::Mismatch {
        assert_eq!(sent.unwrap_err().code, code::INBOX_UNAVAILABLE);
    } else {
        assert_eq!(sent.unwrap()["id"], 1);
    }
    assert_eq!(
        h.messages.get_or_not_found(1).unwrap().reason,
        Some(Reason::Inbox)
    );
    (dir, h, inbox, typed)
}

async fn terminal_hold(h: &Harness, takeover: bool, begin: bool) {
    if takeover {
        h.call(
            if begin {
                "takeover.begin"
            } else {
                "takeover.end"
            },
            json!({"agent":"b"}),
        )
        .await
        .unwrap();
    } else {
        h.messages
            .user_wrote("terminal-b", if begin { b"draft" } else { b"\x15" })
            .await;
    }
}

fn assert_recovery_held(h: &mut Harness, inbox: &RecoveringInbox, typed: &StdMutex<Vec<String>>) {
    assert!(
        inbox.written.lock().unwrap().is_empty(),
        "no inbox send during hold"
    );
    assert!(typed.lock().unwrap().is_empty(), "no Terminal fallback");
    let message = h.messages.get_or_not_found(1).unwrap();
    assert_eq!(message.status, MessageStatus::Held);
    assert!(!h.messages.store().unwrap().in_flight(1).unwrap());
    assert!(!h.events().iter().any(|e| e == "message.delivered"));
}

async fn recovery_waits_for_last_hold(takeover: bool) {
    for (kind, failure) in ["note", "question"].into_iter().flat_map(|kind| {
        [
            contracts::agent::Inbox::Missing,
            contracts::agent::Inbox::Mismatch,
        ]
        .map(|failure| (kind, failure))
    }) {
        for both in [false, true] {
            let (_dir, mut h, inbox, typed) = recovering_note(kind, failure).await;
            terminal_hold(&h, takeover, true).await;
            if both {
                terminal_hold(&h, !takeover, true).await;
            }
            *inbox.state.lock().unwrap() = contracts::agent::Inbox::Ok;
            on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
            assert_recovery_held(&mut h, &inbox, &typed);
            if both {
                terminal_hold(&h, !takeover, false).await;
                on_status(&h.messages.inner, "b", "1", "3", Kind::Idle).await;
                assert_recovery_held(&mut h, &inbox, &typed);
            }
            terminal_hold(&h, takeover, false).await;
            on_status(&h.messages.inner, "b", "1", "4", Kind::Idle).await;
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
            assert_eq!(
                h.messages.get_or_not_found(1).unwrap().status,
                MessageStatus::Pending
            );
            assert!(!h.events().iter().any(|e| e == "message.delivered"));
            // B8's cut: a hold beginning after the inbox write cannot revoke its confirmation.
            terminal_hold(&h, takeover, true).await;
            h.messages.confirm_inbox("b", &[1]);
            h.messages.confirm_inbox("b", &[1]);
            on_status(&h.messages.inner, "b", "1", "5", Kind::Idle).await;
            assert_eq!(
                h.messages.get_or_not_found(1).unwrap().status,
                MessageStatus::Delivered
            );
            assert_eq!(
                h.events()
                    .iter()
                    .filter(|e| *e == "message.delivered")
                    .count(),
                1
            );
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
            assert!(typed.lock().unwrap().is_empty());
        }
    }
}

#[tokio::test]
// B50(f): rejects releasing an inbox hold before the final Terminal hold ends.
async fn b6_inbox_recovery_waits_for_takeover_to_end() {
    recovery_waits_for_last_hold(true).await;
}

#[tokio::test]
async fn b32_inbox_recovery_waits_for_unsent_input_to_end() {
    recovery_waits_for_last_hold(false).await;
}

#[tokio::test]
async fn b32_inbox_recovery_checks_holds_after_the_inbox_check_completes() {
    for takeover in [false, true] {
        for (kind, failure) in ["note", "question"].into_iter().flat_map(|kind| {
            [
                contracts::agent::Inbox::Missing,
                contracts::agent::Inbox::Mismatch,
            ]
            .map(|failure| (kind, failure))
        }) {
            let (_dir, mut h, inbox, typed) = recovering_note(kind, failure).await;
            inbox.gate.store(true, std::sync::atomic::Ordering::SeqCst);
            let observation = on_status(&h.messages.inner, "b", "1", "2", Kind::Idle);
            let hold_before_completion = async {
                inbox.checking.notified().await;
                terminal_hold(&h, takeover, true).await;
                *inbox.state.lock().unwrap() = contracts::agent::Inbox::Ok;
                inbox.finish.notify_one();
            };
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                tokio::join!(observation, hold_before_completion);
            })
            .await
            .expect("inbox check and hold completed");
            assert_recovery_held(&mut h, &inbox, &typed);
            terminal_hold(&h, takeover, false).await;
            on_status(&h.messages.inner, "b", "1", "3", Kind::Idle).await;
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
        }
    }
}

// B50(a,e): restoring the Note-only transport gate sends a question to the prompt callback.
#[tokio::test]
async fn b50_sender_and_kind_choose_only_the_authorized_transport() {
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
            let prompts = Arc::new(StdMutex::new(Vec::new()));
            let seen = prompts.clone();
            let h = Harness::with_deliver(
                dir.path(),
                vec![agent_node("a", Kind::Working), agent_node("b", Kind::Idle)],
                Arc::new(move |_, text| {
                    seen.lock().unwrap().push(text);
                    Box::pin(async { Ok(()) })
                }),
            );
            let mut completed = h.messages.inner.completed.subscribe();
            while completed.recv().await.unwrap() != "initial" {}
            let inbox = Arc::new(RecoveringInbox {
                state: StdMutex::new(contracts::agent::Inbox::Ok),
                written: StdMutex::new(vec![]),
                gate: false.into(),
                checking: tokio::sync::Notify::new(),
                finish: tokio::sync::Notify::new(),
            });
            h.messages.set_inbox(inbox.clone());
            let sent = h
                .call_as(
                    sender.clone(),
                    "message.send",
                    json!({"to":"b", "kind":kind, "body":"which transport?"}),
                )
                .await
                .unwrap();
            if sender.kind == ActorKind::User {
                assert_eq!(prompts.lock().unwrap().len(), 1);
                assert!(inbox.written.lock().unwrap().is_empty());
            } else {
                assert!(prompts.lock().unwrap().is_empty(), "{sender:?} {kind}");
                assert_eq!(*inbox.written.lock().unwrap(), [1]);
                assert_eq!(
                    h.call("message.get", json!({"id":sent["id"]}))
                        .await
                        .unwrap()["status"],
                    "pending"
                );
            }
        }
    }
}

// B51(g): rejects a kind-scoped repeat filter and allocation before refusal.
#[tokio::test]
async fn b51_repeat_refusal_compares_both_kinds_before_allocating() {
    for first_kind in ["note", "question"] {
        for next_kind in ["note", "question"] {
            let (_dir, h, inbox, _) =
                recovering_note(first_kind, contracts::agent::Inbox::Missing).await;
            *inbox.state.lock().unwrap() = contracts::agent::Inbox::Ok;
            on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
            h.messages.confirm_inbox("b", &[1]);
            let err = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to":"b", "kind":next_kind, "body":"recover after hold"}),
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
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
        }
    }
}

// B50(f): rejects bypassing Routes/Terminal holds, or changing transport on explicit delivery.
#[tokio::test]
async fn b50_routes_and_explicit_delivery_preserve_transport_for_both_kinds() {
    for kind in ["note", "question"] {
        for hold in ["ask-first", "drop", "takeover", "input"] {
            let (_dir, h, inbox, prompts) =
                recovering_note(kind, contracts::agent::Inbox::Missing).await;
            *inbox.state.lock().unwrap() = contracts::agent::Inbox::Ok;
            on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
            h.messages.confirm_inbox("b", &[1]);
            if matches!(hold, "ask-first" | "drop") {
                h.call("route.set", json!({"from":"a", "to":"b", "delivery":hold}))
                    .await
                    .unwrap();
            } else {
                terminal_hold(&h, hold == "takeover", true).await;
            }
            let sent = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to":"b", "kind":kind, "body":"held question or note"}),
                )
                .await
                .unwrap();
            assert_eq!(
                sent["status"],
                if hold == "drop" { "dropped" } else { "held" }
            );
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
            on_status(&h.messages.inner, "b", "1", "3", Kind::Idle).await;
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
            if hold == "drop" {
                *inbox.state.lock().unwrap() = contracts::agent::Inbox::Missing;
                let refused = h
                    .call("message.deliver", json!({"id":2}))
                    .await
                    .unwrap_err();
                assert_eq!(refused.code, code::CONFLICT);
                assert_eq!(
                    h.messages.get_or_not_found(2).unwrap().status,
                    MessageStatus::Dropped
                );
            } else {
                *inbox.state.lock().unwrap() = contracts::agent::Inbox::Missing;
                let refused = h
                    .call("message.deliver", json!({"id":2}))
                    .await
                    .unwrap_err();
                assert_eq!(refused.code, code::INBOX_UNAVAILABLE);
                assert_eq!(*inbox.written.lock().unwrap(), [1]);
                assert_eq!(
                    h.messages.get_or_not_found(2).unwrap().status,
                    MessageStatus::Held
                );
                *inbox.state.lock().unwrap() = contracts::agent::Inbox::Ok;
                h.call("message.deliver", json!({"id":2})).await.unwrap();
                assert_eq!(*inbox.written.lock().unwrap(), [1, 2]);
                assert_eq!(
                    h.messages.get_or_not_found(2).unwrap().status,
                    MessageStatus::Pending
                );
                h.messages.confirm_inbox("b", &[2]);
                assert_eq!(
                    h.messages.get_or_not_found(2).unwrap().status,
                    MessageStatus::Delivered
                );
            }
            assert!(prompts.lock().unwrap().is_empty());
        }
    }
}

// B52(a), B39/B40: rejects clearing in-flight on idle or recording delivery on socket success.
#[tokio::test]
async fn b52_every_completed_idle_and_receipt_preserves_one_delivery() {
    for kind in ["note", "question"] {
        let (_dir, mut h, inbox, prompts) =
            recovering_note(kind, contracts::agent::Inbox::Missing).await;
        for revision in 2..32 {
            on_status(
                &h.messages.inner,
                "b",
                "1",
                &revision.to_string(),
                Kind::Idle,
            )
            .await;
            assert!(inbox.written.lock().unwrap().is_empty());
            assert_eq!(
                h.messages.get_or_not_found(1).unwrap().status,
                MessageStatus::Held
            );
        }
        assert_eq!(
            h.events().iter().filter(|e| *e == "message.held").count(),
            1
        );
        *inbox.state.lock().unwrap() = contracts::agent::Inbox::Ok;
        for revision in 32..62 {
            on_status(
                &h.messages.inner,
                "b",
                "1",
                &revision.to_string(),
                Kind::Idle,
            )
            .await;
            assert_eq!(*inbox.written.lock().unwrap(), [1]);
            assert_eq!(
                h.messages.get_or_not_found(1).unwrap().status,
                MessageStatus::Pending
            );
            assert!(prompts.lock().unwrap().is_empty());
        }
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
        assert_eq!(*inbox.written.lock().unwrap(), [1]);
    }
}
