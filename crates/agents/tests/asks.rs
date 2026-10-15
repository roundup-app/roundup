use std::sync::Arc;
use agents::{Asks, placement::{Placement, Request, AskPart}};
use async_trait::async_trait;
use contracts::Actor;
use rpc::{Bus, Ctx, Module};
use serde_json::{Value, json};

struct Pending;
#[async_trait]
impl Placement for Pending {
    async fn call(&self, _: &str, _: &Request) -> Result<Vec<AskPart>, String> {
        std::future::pending().await
    }
}

#[tokio::test]
async fn a40_send_returns_at_once_and_the_parts_follow() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let terminals = Arc::new(terminal::Terminals::open(dir.path(), bus.clone()).unwrap());
    let agents = Arc::new(agents::Agents::open_with(dir.path(), bus.clone(), terminals,
        agents::claude_code::Launcher::new("false", dir.path().join("config"), dir.path().join("rup"), None),
        agents::worktree::Git::from_env()).unwrap());
    let asks = Asks::open(dir.path(), bus.clone(), agents, Arc::new(Pending)).unwrap();
    let ctx = Ctx { actor: Actor::user(), bus, touches: Arc::new(provenance::Touches::open(&dir.path().join("touches.db")).unwrap()) };
    let ask = tokio::time::timeout(std::time::Duration::from_secs(1), asks.call(&ctx, "ask.send", json!({"text":"keep my words"}))).await.unwrap().unwrap();
    assert_eq!(ask["parts"][0]["state"], "placing");
    assert_eq!(asks.call(&ctx, "ask.list", Value::Null).await.unwrap()[0], ask);
}
