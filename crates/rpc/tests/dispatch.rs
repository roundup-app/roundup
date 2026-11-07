//! C6493a, C6493b: `dispatch_methods!` decodes once, calls the typed handler, encodes once.
use std::sync::atomic::{AtomicUsize, Ordering};

use rpc::{Ctx, RpcError, code};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Params {
    n: u32,
}

#[derive(Serialize)]
struct Made {
    twice: u32,
}

#[derive(Default)]
struct Owner {
    calls: AtomicUsize,
}

impl Owner {
    async fn make(&self, _ctx: &Ctx, p: Params) -> Result<Made, RpcError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(Made { twice: p.n * 2 })
    }

    async fn ping(&self, _ctx: &Ctx) -> Result<(), RpcError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn dispatch(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        rpc::dispatch_methods!([Self, self, ctx, method, value]
            "x.make": Params => Made, make, all();
            "x.ping": () => (), ping, all();)
    }
}

fn ctx() -> Ctx {
    Ctx {
        actor: contracts::Actor::user(),
        bus: rpc::Bus::new(),
        touches: std::sync::Arc::new(provenance::Touches::in_memory().unwrap()),
    }
}

#[tokio::test]
async fn c6493a_a_typed_handler_is_decoded_called_and_encoded() {
    let owner = Owner::default();
    let made = owner.dispatch(&ctx(), "x.make", json!({"n": 4})).await;
    assert_eq!(made.unwrap(), json!({"twice": 8}));
    let ping = owner.dispatch(&ctx(), "x.ping", Value::Null).await;
    assert_eq!(ping.unwrap(), Value::Null);
    let missing = owner.dispatch(&ctx(), "x.nope", Value::Null).await;
    assert_eq!(missing.unwrap_err().code, code::METHOD_NOT_FOUND);
}

#[tokio::test]
async fn c6493b_bad_params_answer_invalid_params_without_calling_the_handler() {
    let owner = Owner::default();
    let err = owner
        .dispatch(&ctx(), "x.make", json!({"n": "four"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(
        err.message.starts_with("invalid params: "),
        "{}",
        err.message
    );
    assert_eq!(owner.calls.load(Ordering::SeqCst), 0);
}
