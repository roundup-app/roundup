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
