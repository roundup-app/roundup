//! RPC method dispatch for Todos.
use rpc::{Ctx, RpcError};
use serde_json::Value;

use super::Todos;
use crate::error::Error;
use contracts::todo::{Handed, Todo};

impl Todos {
    pub(super) async fn dispatch(
        &self,
        ctx: &Ctx,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        contracts::todos_methods!(rpc::dispatch_methods, Todos, self, ctx, method, value)
    }

    async fn list(&self, _ctx: &Ctx) -> Result<Vec<Todo>, Error> {
        self.store()?.list()
    }

    async fn list_handed(&self, _ctx: &Ctx) -> Result<Vec<Handed>, Error> {
        self.store()?.list_handed()
    }
}
