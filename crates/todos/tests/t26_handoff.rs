//! T26: a hand-off is a Change of kind `handed`, and the record bounds it.
use std::sync::Arc;

use contracts::Actor;
use provenance::Touches;
use rpc::{Bus, Ctx, Module, RpcError, code};
use serde_json::{Value, json};
use todos::Todos;

async fn call(h: &Todos, actor: Actor, method: &str, params: Value) -> Result<Value, RpcError> {
    let ctx = Ctx {
        actor,
        bus: Bus::new(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    h.call(&ctx, method, params).await
}

fn agent(id: &str) -> Value {
    json!({"kind": "agent", "id": id, "parent": null})
}

#[tokio::test]
async fn t26_a_handoff_adds_one_change_with_equal_values() {
    let dir = tempfile::tempdir().unwrap();
    let h = Todos::open(dir.path(), Bus::new()).unwrap();
    let user = Actor::user();
    let a = agent("a");
    let create = json!({"title": "t", "owner": a});
    call(&h, user.clone(), "todo.create", create).await.unwrap();
    let hand = |who: &str| json!({"agent": who});
    let daemon = Actor::daemon();
    let none = call(&h, daemon.clone(), "todo.hand", hand("b")).await;
    assert_eq!(none.unwrap(), Value::Null);
    let handed = call(&h, daemon.clone(), "todo.hand", hand("a")).await;
    assert_eq!(handed.unwrap()["id"], 1);
    let history = call(&h, user.clone(), "todo.getHistory", json!({"id": 1})).await;
    let history = history.unwrap()["changes"].clone();
    let last = history.as_array().unwrap().last().unwrap().clone();
    assert_eq!(history.as_array().unwrap().len(), 2);
    assert_eq!(last["handed"], a);
    assert_eq!(last["before"], last["after"]);
    // The record bounds it, and only the Daemon hands.
    let again = call(&h, daemon.clone(), "todo.hand", hand("a")).await;
    assert_eq!(again.unwrap(), Value::Null);
    let refused = call(&h, user.clone(), "todo.hand", hand("a")).await;
    assert_eq!(refused.unwrap_err().code, code::FORBIDDEN);
    // Away and back starts afresh; a blocked and a done Todo are never picked.
    for owner in [agent("b"), a.clone()] {
        let assign = json!({"id": 1, "owner": owner});
        call(&h, user.clone(), "todo.assign", assign).await.unwrap();
    }
    let blocked = json!({"title": "u", "owner": a, "blockers": [1]});
    call(&h, user.clone(), "todo.create", blocked)
        .await
        .unwrap();
    let done = json!({"title": "v", "owner": a});
    call(&h, user.clone(), "todo.create", done).await.unwrap();
    call(&h, user.clone(), "todo.complete", json!({"id": 3}))
        .await
        .unwrap();
    let next = call(&h, daemon.clone(), "todo.hand", hand("a")).await;
    assert_eq!(next.unwrap()["id"], 1);
    let next = call(&h, daemon, "todo.hand", hand("a")).await;
    assert_eq!(next.unwrap(), Value::Null);
}

#[tokio::test]
async fn t26_old_changes_read_no_handed_actor() {
    let dir = tempfile::tempdir().unwrap();
    let h = Todos::open(dir.path(), Bus::new()).unwrap();
    let create = json!({"title": "t"});
    call(&h, Actor::user(), "todo.create", create)
        .await
        .unwrap();
    let history = call(&h, Actor::user(), "todo.getHistory", json!({"id": 1})).await;
    assert!(history.unwrap()["changes"][0].get("handed").is_none());
    let old: contracts::todo::Change = serde_json::from_value(json!({
        "seq": 1, "actor": null, "changed_at": null, "before": null,
        "after": {"title": "t", "body": "", "done": false, "blockers": []},
    }))
    .unwrap();
    assert_eq!(old.handed, None);
}
