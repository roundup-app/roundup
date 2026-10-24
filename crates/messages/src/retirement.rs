//! A35: durable protection for later Agents leaving the Rail, separate from restart.
use super::*;

impl Messages {
    /// Reserve before stopping/removing a selected later Agent. Waits for in-flight delivery,
    /// then durably preserves its existing records and refuses further sends/delivery.
    /// The coordinator owns Proof, selection and Takeover consent; this changes none of them.
    /// Same-key retries are no-ops even after removal/reopen/completion. Another reservation,
    /// an empty key, missing receiver or stale Attempt is refused. An already stopped Agent
    /// reconciles its ordinary B9 ending first; no final record revives. No rollback releases
    /// this protection: a failed removal must resume with the same key.
    pub async fn reserve_retirement(&self, agent: &str, key: &str) -> Result<(), RpcError> {
        if key.is_empty() {
            return Err(RpcError::new(code::INVALID_PARAMS, "empty retirement key"));
        }
        let _delivery = self.inner.delivery.write().await;
        if let Some((previous, _)) = self.store()?.retirement(agent)? {
            return if previous == key {
                Ok(())
            } else {
                Err(RpcError::conflict(
                    "another retirement reserved this receiver",
                ))
            };
        }
        let nodes = load_rail_nodes(&self.inner).await?;
        let node = nodes
            .iter()
            .find(|n| n.id == agent)
            .ok_or_else(|| RpcError::not_found(agent))?;
        let mut store = self.store()?;
        accept_reservation(&self.inner, &mut store, node)?;
        (self.inner.fault)("reserve_retirement").map_err(RpcError::internal)?;
        store.atomically(|s| s.reserve_retirement(agent, key))
    }

    /// Complete after Agents::retire removes the Agent from the Rail; no SessionStart is needed.
    /// Refuses a missing/different key or an Agent still on the Rail. Failure retains protection;
    /// retry/reopen uses the same key. Repeated completed calls succeed without lifecycle work,
    /// and completed protection never expires or makes preserved pending records deliverable.
    pub async fn complete_retirement(&self, agent: &str, key: &str) -> Result<(), RpcError> {
        let _delivery = self.inner.delivery.write().await;
        let (previous, completed) = self
            .store()?
            .retirement(agent)?
            .ok_or_else(|| RpcError::conflict("retirement not reserved"))?;
        if previous != key {
            return Err(RpcError::conflict(
                "another retirement reserved this receiver",
            ));
        }
        if completed {
            return Ok(());
        }
        if load_rail_nodes(&self.inner)
            .await?
            .iter()
            .any(|n| n.id == agent)
        {
            return Err(RpcError::conflict("retiring Agent still on the Rail"));
        }
        (self.inner.fault)("complete_retirement").map_err(RpcError::internal)?;
        self.store()?.complete_retirement(agent, key)
    }
}
