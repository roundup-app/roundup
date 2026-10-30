use std::sync::Arc;

use contracts::{Actor, ActorKind, Event, Verb};
use provenance::Touches;
use rpc::code;
use serde_json::json;
use tokio::sync::broadcast::Receiver;

use super::*;

mod comments;
mod deletion;
// T4902 retires T29; its duration-only tests are removed.
mod history;
mod home;
mod ordering;
mod ownership;
mod references;
mod updated_at;
mod values;

struct Harness {
    todos: Todos,
    ctx: Ctx,
    events: Receiver<Event>,
}

impl Harness {
    fn new(dir: &Path) -> Self {
        let bus = Bus::new();
        let events = bus.subscribe();
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: Arc::new(Touches::in_memory().unwrap()),
        };
        Self {
            todos: Todos::open(dir, bus).unwrap(),
            ctx,
            events,
        }
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.todos.call(&self.ctx, method, params).await
    }

    async fn call_as(&self, actor: Actor, method: &str, params: Value) -> Result<Value, RpcError> {
        let ctx = Ctx {
            actor,
            bus: self.ctx.bus.clone(),
            touches: self.ctx.touches.clone(),
        };
        self.todos.call(&ctx, method, params).await
    }

    /// `"<name> <id>"` for each event, oldest first.
    fn events(&mut self) -> Vec<String> {
        let mut seen = Vec::new();
        while let Ok(event) = self.events.try_recv() {
            let event = serde_json::to_value(&event.data).unwrap();
            seen.push(format!(
                "{} {}",
                event["name"].as_str().unwrap(),
                event["data"]["id"]
            ));
        }
        seen
    }

    /// The `data` of the next event, for asserting on a field beyond `id`.
    fn event_data(&mut self) -> Value {
        let event = self.events.try_recv().unwrap();
        serde_json::to_value(&event.data).unwrap()["data"].clone()
    }

    fn touches(&self, id: u32) -> Vec<(Verb, String)> {
        self.ctx
            .touches
            .history(&item(id))
            .unwrap()
            .into_iter()
            .map(|t| (t.verb, t.actor.id))
            .collect()
    }
}

async fn changes(h: &Harness, id: u32) -> Value {
    h.call("todo.getHistory", json!({"id": id})).await.unwrap()
}

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

fn ext(id: &str, parent: &str) -> Actor {
    Actor {
        kind: ActorKind::Ext,
        id: id.into(),
        parent: Some(parent.into()),
    }
}

async fn get_home(h: &Harness, id: u32) -> Value {
    h.call("todo.get", json!({"id": id})).await.unwrap()["home"].clone()
}

fn owner_of(actor: &Actor) -> Value {
    serde_json::to_value(actor).unwrap()
}

async fn made(h: &Harness, params: Value) -> Value {
    h.call("todo.create", params).await.unwrap()
}
