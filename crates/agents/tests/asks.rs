use std::sync::Arc;
use agents::Agents;
use contracts::Actor;
use rpc::{Bus, Ctx, Module};
use serde_json::{Value, json};

#[tokio::test]
async fn a40_send_returns_at_once_and_the_parts_follow() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let terminals = Arc::new(terminal::Terminals::open(dir.path(), bus.clone()).unwrap());
    let agents = Agents::open(dir.path(), dir.path(), bus.clone(), terminals).unwrap();
    let ctx = Ctx { actor: Actor::user(), bus, touches: Arc::new(provenance::Touches::open(&dir.path().join("touches.db")).unwrap()) };
    let ask = agents.call(&ctx, "ask.send", json!({"text":"fix café"})).await.unwrap();
    assert_eq!(ask["parts"][0]["state"], "placing");
    assert_eq!(ask["parts"][0]["text"], "fix café");
    let list = agents.call(&ctx, "ask.list", Value::Null).await.unwrap();
    assert_eq!(list[0]["id"], ask["id"]);
}
