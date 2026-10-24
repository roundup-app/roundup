//! A35: coordinator-owned, durable queue reservations. No lifecycle calls or consent policy.
use super::*;
use store::FirstPrompt;

impl Messages {
    /// Reserve before stopping a retained Agent. `key` identifies the coordinator's durable
    /// operation; retries must use the same key and first prompt. Waits for an in-flight Message
    /// prompt to finish. Conflicts with another reservation or a stale receiver Attempt.
    /// A retained Agent already stopped may reserve its next Attempt; B9 finals stay final.
    /// `first_prompt` is the exact text the lifecycle seam will type, never typed by Messages.
    pub async fn reserve_restart(
        &self,
        agent: &str,
        key: &str,
        first_prompt: Option<&str>,
    ) -> Result<(), RpcError> {
        if key.is_empty() || first_prompt.is_some_and(|p| p.is_empty() || p.len() > MAX_BODY_BYTES)
        {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "empty restart key or invalid first prompt",
            ));
        }
        let _delivery = self.inner.delivery.write().await;
        if let Some(previous) = self.store()?.restart(agent, key)? {
            return if previous.prompt.body() == first_prompt {
                Ok(())
            } else {
                Err(RpcError::conflict("restart first prompt changed"))
            };
        }
        let nodes = load_rail_nodes(&self.inner).await?;
        let node = nodes
            .iter()
            .find(|n| n.id == agent)
            .ok_or_else(|| RpcError::not_found(agent))?;
        if first_prompt.is_some() && node.kind != contracts::agent::NodeKind::Workstream {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "first prompt note requires a Door",
            ));
        }
        let mut store = self.store()?;
        accept_reservation(&self.inner, &mut store, node)?;
        store.atomically(|s| {
            s.reserve_restart(agent, key, binding(node).0, first_prompt)?;
            s.arm_chains((self.inner.clock)())
        })
    }

    /// After the coordinator has observed the matching SessionStart AND first-prompt
    /// acknowledgement, record its reserved text as one delivered user note. Never Steers.
    /// A recording or Touch failure is retryable with the same key, without retyping the prompt.
    /// A changed acknowledgement Attempt, missing reservation or absent first prompt conflicts.
    /// The acknowledged Attempt may have stopped since, including on Daemon restart.
    pub async fn record_restart_prompt(
        &self,
        agent: &str,
        key: &str,
        attempt: &str,
    ) -> Result<Message, RpcError> {
        let _delivery = self.inner.delivery.write().await;
        let ordinal = parse_attempt(attempt)?;
        let previous = self.store()?.restart(agent, key)?;
        if let Some(restart) = previous
            && let Some(id) = restart.prompt.note()
        {
            let store = self.store()?;
            if store.bound(id)?.0 != ordinal {
                return Err(RpcError::conflict(
                    "first prompt recorded for another Attempt",
                ));
            }
            if matches!(restart.prompt, FirstPrompt::Published { .. }) {
                return store
                    .get(id)?
                    .ok_or_else(|| RpcError::internal("restart note missing"));
            }
        }
        let at = (ordinal, 0);
        let mut store = self.store()?;
        let restart = store
            .restart(agent, key)?
            .ok_or_else(|| RpcError::conflict("restart not reserved"))?;
        if ordinal <= restart.before {
            return Err(RpcError::conflict(
                "first prompt acknowledgement predates restart",
            ));
        }
        let body = restart
            .prompt
            .body()
            .ok_or_else(|| RpcError::conflict("no reserved first prompt"))?
            .to_owned();
        (self.inner.fault)("record_restart_prompt").map_err(RpcError::internal)?;
        let message = store.atomically(|s| {
            if let Some(id) = restart.prompt.note() {
                return s
                    .get(id)?
                    .ok_or_else(|| RpcError::internal("restart note missing"));
            }
            let message = s.insert(
                &Actor::user(),
                agent,
                MessageKind::Note,
                &body,
                None,
                MessageStatus::Delivered,
                None,
                (self.inner.clock)(),
                at,
                None,
            )?;
            s.record_restart_note(agent, key, message.id)?;
            Ok(message)
        })?;
        if !matches!(restart.prompt, FirstPrompt::Published { .. }) {
            let item = item(message.id);
            let wrote = self
                .inner
                .touches
                .history(&item)
                .map_err(RpcError::internal)?
                .iter()
                .any(|t| t.verb == Verb::Wrote && t.actor == Actor::user());
            if !wrote {
                self.inner
                    .touches
                    .record(&Actor::user(), Verb::Wrote, &item)
                    .map_err(RpcError::internal)?;
            }
            (self.inner.fault)("publish_restart_prompt").map_err(RpcError::internal)?;
            store.publish_restart_note(agent, key)?;
            self.inner.bus.emit(
                Actor::user(),
                EventData::MessageSent(message.clone().into()),
            );
            self.inner.bus.emit(
                Actor::user(),
                EventData::MessageDelivered(message.clone().into()),
            );
        }
        Ok(message)
    }

    /// Release only after the coordinator observes SessionStart and any reserved first prompt
    /// has been recorded. Rebinds open Messages to `attempt`, preserving B7 ranks.
    /// A failed restart/reopen keeps its reservation for the same retry. Completed releases
    /// are no-ops even if that Attempt has since ended. Recovery may release a later live
    /// Attempt after recording the original acknowledgement.
    pub async fn release_restart(
        &self,
        agent: &str,
        key: &str,
        attempt: &str,
    ) -> Result<(), RpcError> {
        {
            let _delivery = self.inner.delivery.write().await;
            let ordinal = parse_attempt(attempt)?;
            let previous = self
                .store()?
                .restart(agent, key)?
                .ok_or_else(|| RpcError::conflict("restart not reserved"))?;
            if let Some(done) = previous.released {
                return if done == ordinal {
                    Ok(())
                } else {
                    Err(RpcError::conflict("restart released to another Attempt"))
                };
            }
            let at = self.restart_binding(agent, key, attempt).await?;
            let mut store = self.store()?;
            store.require_generation(agent, at)?;
            let previous = store
                .restart(agent, key)?
                .ok_or_else(|| RpcError::conflict("restart not reserved"))?;
            if !matches!(
                previous.prompt,
                FirstPrompt::Absent | FirstPrompt::Published { .. }
            ) {
                return Err(RpcError::conflict("first prompt not recorded"));
            }
            if let Some(id) = previous.prompt.note()
                && store.bound(id)?.0 > ordinal
            {
                return Err(RpcError::conflict(
                    "first prompt acknowledgement is newer than release Attempt",
                ));
            }
            store.atomically(|s| s.release_restart(agent, key, at, (self.inner.clock)()))?;
        }
        nudge(&self.inner, agent).await;
        Ok(())
    }

    async fn restart_binding(
        &self,
        agent: &str,
        key: &str,
        attempt: &str,
    ) -> Result<store::Binding, RpcError> {
        let attempt = parse_attempt(attempt)?;
        let restart = self
            .store()?
            .restart(agent, key)?
            .ok_or_else(|| RpcError::conflict("restart not reserved"))?;
        let nodes = load_rail_nodes(&self.inner).await?;
        let node = nodes
            .iter()
            .find(|n| n.id == agent)
            .ok_or_else(|| RpcError::not_found(agent))?;
        let at = binding(node);
        if at.0 != attempt
            || attempt <= restart.before
            || ended(node)
            || node.status_revision.is_none()
        {
            return Err(RpcError::conflict("matching restarted Attempt not live"));
        }
        let mut store = self.store()?;
        reconcile(&self.inner, &mut store, agent, at, false, false, false)?;
        store.require_generation(agent, at)?;
        Ok(at)
    }
}

fn parse_attempt(attempt: &str) -> Result<i64, RpcError> {
    contracts::agent::parse_positive_ordinal(attempt)
        .ok_or_else(|| RpcError::new(code::INVALID_PARAMS, "invalid Attempt"))
}
