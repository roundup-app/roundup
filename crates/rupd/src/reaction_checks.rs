//! NR7: a PrChecks reaction matches only complete, fresh `agent.worktreeState` evidence for the head it
//! pinned at activation. Anything less never matches and says why; a moved head invalidates it.
use std::sync::Arc;
use std::time::Duration;

use contracts::Actor;
use contracts::agent::{
    WorktreeCheckConclusion, WorktreeEvidence, WorktreeEvidenceState, WorktreeState,
};
use contracts::reaction::{
    Condition, ObservationCause as Cause, ObservationHealth as Health, Reaction, State,
};
use rpc::{Ctx, Module, RpcError};
use serde_json::{Value, json};

use crate::reaction::{Reactions, read as read_record};
use contracts::reaction::ObservationRecovery as Recovery;
use rusqlite::{OptionalExtension, params};

const EVERY: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Every required check passed on the pinned head.
    Match,
    /// The head moved: the reaction ends, and a replacement is an explicit new one.
    Invalidate(Cause, String),
    /// No match now, and the cause the user can act on.
    Wait(Cause, String),
}

/// A current PR identity, independently of whether its required checks have concluded.
pub(crate) fn current<'a>(
    state: &'a WorktreeState,
    repository: &str,
    number: u32,
) -> Result<&'a WorktreeEvidence, (Cause, String)> {
    let Some(pr) = state
        .pr
        .as_ref()
        .filter(|pr| pr.number.get() == u64::from(number))
    else {
        return Err((
            Cause::PrMissing,
            format!("the Worktree holds no PR {number}"),
        ));
    };
    let evidence = state
        .evidence
        .as_ref()
        .ok_or((Cause::EvidenceMissing, "no required-check evidence".into()))?;
    if pr.stale || evidence.stale {
        return Err((
            Cause::EvidenceStale,
            "the evidence is stale; the last refresh failed or is old".into(),
        ));
    }
    match evidence.state {
        WorktreeEvidenceState::Complete | WorktreeEvidenceState::Incomplete => {}
        WorktreeEvidenceState::StaleHead => {
            return Err((
                Cause::HeadMoved,
                "the PR head moved while the checks were read".into(),
            ));
        }
        WorktreeEvidenceState::Unknown => {
            return Err((
                Cause::ForgeReadFailed,
                "the forge read failed without a reason".into(),
            ));
        }
        WorktreeEvidenceState::Unavailable => {
            return Err((
                Cause::ChecksUnavailable,
                "no usable gh, login, GitHub remote or answer in time".into(),
            ));
        }
    }
    if evidence.repository.as_deref() != Some(repository) {
        return Err((
            Cause::RepositoryMismatch,
            format!(
                "the PR is in {}, not {repository}",
                evidence
                    .repository
                    .as_deref()
                    .unwrap_or("an unknown repository")
            ),
        ));
    }
    if evidence.head.as_ref().is_none_or(|head| head.is_empty()) {
        return Err((
            Cause::HeadMissing,
            "the evidence names no current head".into(),
        ));
    }
    Ok(evidence)
}

pub(crate) fn decide(
    pin: &str,
    repository: &str,
    number: u32,
    read: &Result<WorktreeState, RpcError>,
) -> Verdict {
    let state = match read {
        Ok(state) => state,
        Err(error) => {
            return Verdict::Wait(
                Cause::WorktreeReadFailed,
                format!("the Worktree read failed: {}", error.message),
            );
        }
    };
    let evidence = match current(state, repository, number) {
        Ok(evidence) => evidence,
        Err((code, cause)) => return Verdict::Wait(code, cause),
    };
    let head = evidence.head.as_deref().unwrap_or_default();
    if head != pin {
        return Verdict::Invalidate(
            Cause::HeadMoved,
            format!("the PR head moved from {pin} to {head}"),
        );
    }
    if evidence.state != WorktreeEvidenceState::Complete {
        return Verdict::Wait(
            Cause::ChecksPending,
            "a required check is pending, or none is required".into(),
        );
    }
    if evidence.checks.is_empty() {
        return Verdict::Wait(Cause::ChecksPending, "no required check concluded".into());
    }
    if evidence
        .checks
        .iter()
        .any(|check| check.conclusion != WorktreeCheckConclusion::Passed)
    {
        return Verdict::Wait(
            Cause::ChecksFailed,
            "a required check did not pass on the pinned head".into(),
        );
    }
    Verdict::Match
}

pub(crate) async fn read(
    agents: &agents::Agents,
    ctx: &Ctx,
    target: &str,
) -> Result<WorktreeState, RpcError> {
    let value = agents
        .call(ctx, "agent.worktreeState", json!({ "id": target }))
        .await?;
    serde_json::from_value(value).map_err(RpcError::internal)
}

/// The head a new reaction pins: a fresh stable identity, including while checks are pending.
pub(crate) fn pin(
    read: Result<WorktreeState, RpcError>,
    repository: &str,
    number: u32,
) -> Result<String, RpcError> {
    let refuse = |cause: String| {
        RpcError::new(
            rpc::code::INVALID_PARAMS,
            format!("pr-checks needs a current PR identity to activate: {cause}"),
        )
    };
    let state = read.map_err(|e| refuse(format!("the Worktree read failed: {}", e.message)))?;
    let evidence =
        current(&state, repository, number).map_err(|(_, diagnostic)| refuse(diagnostic))?;
    Ok(evidence.head.clone().unwrap_or_default())
}

#[derive(Clone)]
pub(crate) struct Watcher {
    pub reactions: Arc<Reactions>,
    pub agents: Arc<agents::Agents>,
    pub messages: Arc<messages::Messages>,
    pub bus: rpc::Bus,
    pub touches: Arc<crate::Touches>,
}

impl Watcher {
    pub(crate) async fn run(self) {
        let mut tick = tokio::time::interval(EVERY);
        loop {
            tick.tick().await;
            self.check().await;
        }
    }

    /// Decides every active PrChecks reaction once, from a fresh read of its target's Worktree.
    pub(crate) async fn check(&self) {
        self.check_with(|target: String, ctx: Ctx| async move {
            read(&self.agents, &ctx, &target).await
        })
        .await;
    }

    async fn check_with<F, Fut>(&self, state_of: F)
    where
        F: Fn(String, Ctx) -> Fut,
        Fut: std::future::Future<Output = Result<WorktreeState, RpcError>> + Send,
    {
        let active = match self.reactions.active() {
            Ok(active) => active,
            Err(error) => {
                eprintln!("reactions: {}", error.message);
                return;
            }
        };
        let now = time::OffsetDateTime::now_utc();
        for saved in active {
            let Condition::PrChecks { repository, number } = &saved.condition else {
                continue;
            };
            let expired = time::OffsetDateTime::parse(
                &saved.expires_at,
                &time::format_description::well_known::Rfc3339,
            )
            .map_or(true, |at| at <= now);
            let spent = self
                .messages
                .firings_of(&saved.id)
                .map_or(true, |f| f.len() >= saved.max_firings as usize);
            let Some(pin) = saved.observation.pinned_head.clone() else {
                continue;
            };
            if expired || spent {
                continue;
            }
            let ctx = Ctx {
                actor: Actor::daemon(),
                bus: self.bus.clone(),
                touches: Arc::clone(&self.touches),
            };
            let state = state_of(saved.target.clone(), ctx).await;
            let verdict = decide(&pin, repository, *number, &state);
            self.apply(saved, &pin, &state, verdict).await;
        }
    }

    async fn apply(
        &self,
        saved: Reaction,
        pin: &str,
        state: &Result<WorktreeState, RpcError>,
        verdict: Verdict,
    ) {
        match verdict {
            Verdict::Match => {
                if let Err(why) = self.agents.guard_reach(&saved.actor, &saved.target, true) {
                    self.reactions.observe(
                        &saved.id,
                        Health::Unavailable,
                        match why.code {
                            rpc::code::NOT_FOUND => Cause::AgentUnavailable,
                            rpc::code::FORBIDDEN => Cause::AuthorityRefused,
                            _ => Cause::Unknown,
                        },
                        Some(format!(
                            "authority refused: {}; the user may inspect or stop this reaction",
                            why.message
                        )),
                        None,
                    );
                    return;
                }
                let evidence = state.as_ref().ok().and_then(|s| s.evidence.as_ref());
                let facts: Value = json!({
                    "source": "pr-checks",
                    "condition": &saved.condition,
                    "head": pin,
                    "evidence": evidence,
                });
                let fired = self
                    .messages
                    .fire_reaction(messages::reaction::Fire {
                        reaction: saved.id.clone(),
                        operation: format!("pr-checks:{pin}"),
                        to: saved.target.clone(),
                        body: saved.instruction.clone(),
                        evidence: facts.to_string(),
                        matched: true,
                    })
                    .await;
                match fired {
                    Ok(_) => self.reactions.observe(
                        &saved.id,
                        Health::Matched,
                        Cause::Unknown,
                        None,
                        None,
                    ),
                    Err(error) => self.reactions.observe(
                        &saved.id,
                        Health::WriteFailed,
                        Cause::AcceptanceFailed,
                        Some(format!("the firing was not accepted: {}", error.message)),
                        None,
                    ),
                }
            }
            Verdict::Invalidate(code, cause) => self.reactions.observe(
                &saved.id,
                Health::Invalidated,
                code,
                Some(cause),
                Some(State::Invalidated),
            ),
            Verdict::Wait(code, cause) => {
                self.reactions
                    .observe(&saved.id, Health::Waiting, code, Some(cause), None)
            }
        }
    }
}

impl Reactions {
    /// Records what the observer saw. A reaction stopped meanwhile stays stopped.
    pub(crate) fn observe(
        &self,
        id: &str,
        health: Health,
        cause_code: Cause,
        cause: Option<String>,
        end: Option<State>,
    ) {
        let db = self.db.lock().expect("reaction database poisoned");
        let saved = db
            .query_row("SELECT record FROM reactions WHERE id=?1", [id], |r| {
                r.get::<_, String>(0)
            })
            .optional();
        let Ok(Some(record)) = saved else { return };
        let Ok(mut saved) = read_record(&record) else {
            return;
        };
        if saved.state != State::Active {
            return;
        }
        saved.observation.health = serde_json::to_value(health)
            .expect("health serializes")
            .as_str()
            .expect("health discriminant")
            .into();
        saved.observation.health_code = health;
        saved.observation.cause_code = cause_code;
        saved.observation.recovery_code = if cause.is_some() {
            Recovery::Check
        } else {
            Recovery::Unknown
        };
        saved.observation.cause = cause;
        if let Some(state) = end {
            saved.state = state;
        }
        if let Ok(updated) = serde_json::to_string(&saved) {
            if updated == record {
                return;
            }
            let changed = db.execute(
                "UPDATE reactions SET record=?2 WHERE id=?1",
                params![id, updated],
            );
            if matches!(changed, Ok(n) if n > 0) {
                self.bus.emit(
                    contracts::Actor::daemon(),
                    contracts::EventData::ReactionChanged,
                );
            }
        }
    }
}

#[cfg(test)]
mod tests;
