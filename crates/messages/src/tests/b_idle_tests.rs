//! B2: a Message sent to an Agent already `idle` is typed at once, with no new `idle` event.

use std::sync::Mutex as StdMutex;

use contracts::Kind;
use serde_json::json;

use super::*;
use super::{FakeRail, agent, agent_node};

#[tokio::test]
async fn b2_a_message_to_an_already_idle_agent_is_typed_without_a_new_status() {
    let dir = tempfile::tempdir().unwrap();
    let typed: Arc<StdMutex<Vec<String>>> = Arc::default();
    let seen = Arc::clone(&typed);
    let deliver: Deliver = Arc::new(move |_, text| {
        seen.lock().unwrap().push(text);
        Box::pin(async { Ok(()) })
    });
    let bus = Bus::new();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Idle)]);
    let messages = Messages::open(dir.path(), bus.clone(), rail, deliver).unwrap();
    let ctx = Ctx {
        actor: agent("a"),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };

    let sent = json!({"to": "b", "kind": "note", "body": "now"});
    messages.call(&ctx, "message.send", sent).await.unwrap();
    for _ in 0..100 {
        if !typed.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    assert_eq!(*typed.lock().unwrap(), ["[from a, note] now"]);
    let got = messages
        .call(&ctx, "message.get", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(got["status"], "delivered");
}

/// A Rail whose next `rail.tree` answers `working` once, as a read taken just before the receiver
/// went `idle`; every later read answers `idle`.
struct StaleOnce(std::sync::atomic::AtomicBool);

#[async_trait::async_trait]
impl Module for StaleOnce {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent", "rail"]
    }

    async fn call(&self, _ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
        if method != "rail.tree" {
            return Err(RpcError::method_not_found(method));
        }
        let stale = self.0.swap(false, std::sync::atomic::Ordering::SeqCst);
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
        seen.lock().unwrap().push(text);
        Box::pin(async { Ok(()) })
    });
    let bus = Bus::new();
    let rail = Arc::new(StaleOnce(false.into()));
    let messages = Messages::open(dir.path(), bus.clone(), rail.clone(), deliver).unwrap();
    let ctx = Ctx {
        actor: agent("a"),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    rail.0.store(true, std::sync::atomic::Ordering::SeqCst);
    let sent = json!({"to": "b", "kind": "note", "body": "late"});
    messages.call(&ctx, "message.send", sent).await.unwrap();
    for _ in 0..100 {
        if !typed.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    assert_eq!(*typed.lock().unwrap(), ["[from a, note] late"]);
}
