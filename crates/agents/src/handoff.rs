//! H7200: a builder Job takes its caller's place on the Rail, and the caller ends once it runs.

use super::*;
use contracts::agent::Order;

/// Where the builder stands: under `parent`, ahead of the caller's row `before`.
pub(super) struct Takes {
    pub parent: Option<String>,
    pub before: Option<String>,
}

impl Agents {
    /// H7200a: start a Job for `order` whose first prompt names Pad `pad`, in the place of Agent
    /// `ctx.actor`. A Mode (A4452c) stays, so its builder starts as its own root Agent.
    pub async fn start_handoff(
        &self,
        ctx: &Ctx,
        order: Order,
        pad: &str,
    ) -> Result<RailNode, RpcError> {
        let caller = self.shared.node(&ctx.actor.id)?;
        let mode = caller.parent.is_none()
            && caller
                .mode_prompt()
                .is_some_and(|prompt| !prompt.trim().is_empty());
        let takes = Takes {
            parent: caller.parent.clone(),
            before: (!mode).then(|| caller.id.clone()),
        };
        let params = serde_json::from_value(serde_json::json!({
            "cwd": self.project_dir(),
            "role": "job",
            "order": order,
            "prompt": format!(
                "Read Pad `{pad}` with `pad_read` first: it holds the detail this order leaves out."
            ),
        }))
        .map_err(RpcError::internal)?;
        self.spawn_in(ctx, params, Some(&takes)).await
    }

    /// H7200b: end the Agent that handed off, once its builder runs and it has its reply. Its row
    /// goes with it (A32).
    pub async fn end_caller(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.shared.retire(actor, id).await
    }
}
