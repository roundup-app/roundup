//! NR7: a PrChecks reaction matches only complete, fresh `agent.worktreeState` evidence for the head it
//! pinned at activation. Anything less never matches and says why; a moved head invalidates it.
use std::sync::Arc;
use std::time::Duration;

use contracts::Actor;
use contracts::agent::{
    WorktreeCheckConclusion, WorktreeEvidence, WorktreeEvidenceState, WorktreeState,
};
use contracts::reaction::{Condition, Reaction, State};
use rpc::{Ctx, Module, RpcError};
use serde_json::{Value, json};

use crate::reaction::Reactions;

const EVERY: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Every required check passed on the pinned head.
    Match,
    /// The head moved: the reaction ends, and a replacement is an explicit new one.
    Invalidate(String),
    /// No match now, and the cause the user can act on.
    Wait(String),
}

/// The evidence a state carries for `repository` and `number`, or the cause it has none a reaction may
/// trust: a missing, stale, other-repository, other-PR or incomplete read.
pub(crate) fn complete<'a>(
    state: &'a WorktreeState,
    repository: &str,
    number: u32,
) -> Result<&'a WorktreeEvidence, String> {
    let Some(pr) = state
        .pr
        .as_ref()
        .filter(|pr| pr.number.get() == u64::from(number))
    else {
        return Err(format!("the Worktree holds no PR {number}"));
    };
    let evidence = state
        .evidence
        .as_ref()
        .ok_or("no required-check evidence")?;
    if pr.stale || evidence.stale {
        return Err("the evidence is stale; the last refresh failed or is old".into());
    }
    if evidence.repository.as_deref() != Some(repository) {
        return Err(format!(
            "the PR is in {}, not {repository}",
            evidence
                .repository
                .as_deref()
                .unwrap_or("an unknown repository")
        ));
    }
    match evidence.state {
        WorktreeEvidenceState::Complete if evidence.head.is_some() => Ok(evidence),
        WorktreeEvidenceState::Complete => Err("the evidence names no head".into()),
        WorktreeEvidenceState::Incomplete => {
            Err("a required check is pending, or none is required".into())
        }
        WorktreeEvidenceState::StaleHead => {
            Err("the PR head moved while the checks were read".into())
        }
        WorktreeEvidenceState::Unknown => Err("the forge read failed without a reason".into()),
        WorktreeEvidenceState::Unavailable => {
            Err("no usable gh, login, GitHub remote or answer in time".into())
        }
    }
}

pub(crate) fn decide(
    pin: &str,
    repository: &str,
    number: u32,
    read: &Result<WorktreeState, RpcError>,
) -> Verdict {
    let state = match read {
        Ok(state) => state,
        Err(error) => return Verdict::Wait(format!("the Worktree read failed: {}", error.message)),
    };
    let evidence = match complete(state, repository, number) {
        Ok(evidence) => evidence,
        Err(cause) => return Verdict::Wait(cause),
    };
    let head = evidence.head.as_deref().unwrap_or_default();
    if head != pin {
        return Verdict::Invalidate(format!("the PR head moved from {pin} to {head}"));
    }
    if evidence.checks.is_empty() {
        return Verdict::Wait("no required check concluded".into());
    }
    if evidence
        .checks
        .iter()
        .any(|check| check.conclusion != WorktreeCheckConclusion::Passed)
    {
        return Verdict::Wait("a required check did not pass on the pinned head".into());
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

/// The head a new reaction pins: the PR's current head, on complete fresh evidence only.
pub(crate) fn pin(
    read: Result<WorktreeState, RpcError>,
    repository: &str,
    number: u32,
) -> Result<String, RpcError> {
    let refuse = |cause: String| {
        RpcError::new(
            rpc::code::INVALID_PARAMS,
            format!("pr-checks needs complete current evidence to activate: {cause}"),
        )
    };
    let state = read.map_err(|e| refuse(format!("the Worktree read failed: {}", e.message)))?;
    let evidence = complete(&state, repository, number).map_err(refuse)?;
    if evidence.checks.is_empty() {
        return Err(refuse("no required check concluded".into()));
    }
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
            let state = read(&self.agents, &ctx, &saved.target).await;
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
                    Ok(_) => self.reactions.observe(&saved.id, "matched", None, None),
                    Err(error) => self.reactions.observe(
                        &saved.id,
                        "write-failed",
                        Some(format!("the firing was not accepted: {}", error.message)),
                        None,
                    ),
                }
            }
            Verdict::Invalidate(cause) => self.reactions.observe(
                &saved.id,
                "invalidated",
                Some(cause),
                Some(State::Invalidated),
            ),
            Verdict::Wait(cause) => self
                .reactions
                .observe(&saved.id, "waiting", Some(cause), None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::agent::{WorktreePr, WorktreeRequiredCheck};

    const REPO: &str = "github.com/acme/one";

    fn state(
        evidence: WorktreeEvidenceState,
        head: &str,
        conclusion: WorktreeCheckConclusion,
    ) -> WorktreeState {
        WorktreeState {
            ahead: 0,
            behind: 0,
            dirty: false,
            ci: None,
            pr: Some(WorktreePr {
                number: std::num::NonZeroU64::new(23).unwrap(),
                stale: false,
            }),
            evidence: Some(WorktreeEvidence {
                state: evidence,
                stale: false,
                repository: Some(REPO.into()),
                head: Some(head.into()),
                checks: vec![WorktreeRequiredCheck {
                    name: "check".into(),
                    conclusion,
                }],
                read_at: Some(1),
                revision: Some("r".into()),
            }),
        }
    }

    fn passed(head: &str) -> WorktreeState {
        state(
            WorktreeEvidenceState::Complete,
            head,
            WorktreeCheckConclusion::Passed,
        )
    }

    fn verdict(s: WorktreeState) -> Verdict {
        decide("a", REPO, 23, &Ok(s))
    }

    #[test]
    fn nr7_checks_require_complete_pinned_head_evidence() {
        assert_eq!(verdict(passed("a")), Verdict::Match);
        assert_eq!(pin(Ok(passed("a")), REPO, 23).unwrap(), "a");

        // An old pass followed by a changed head, even a failing one, invalidates; it never matches.
        assert!(matches!(verdict(passed("b")), Verdict::Invalidate(_)));
        assert!(matches!(
            verdict(state(
                WorktreeEvidenceState::Complete,
                "b",
                WorktreeCheckConclusion::Failed
            )),
            Verdict::Invalidate(_)
        ));

        // Each gap waits with a cause and is never a pass, and none can activate a reaction.
        let mut gaps = Vec::new();
        for kind in [
            WorktreeEvidenceState::Incomplete,
            WorktreeEvidenceState::StaleHead,
            WorktreeEvidenceState::Unknown,
            WorktreeEvidenceState::Unavailable,
        ] {
            gaps.push(state(kind, "a", WorktreeCheckConclusion::Passed));
        }
        for conclusion in [
            WorktreeCheckConclusion::Failed,
            WorktreeCheckConclusion::Skipped,
            WorktreeCheckConclusion::Cancelled,
        ] {
            gaps.push(state(WorktreeEvidenceState::Complete, "a", conclusion));
        }
        let mut stale = passed("a");
        stale.evidence.as_mut().unwrap().stale = true;
        gaps.push(stale);
        let mut no_ci = passed("a");
        no_ci.evidence.as_mut().unwrap().checks.clear();
        gaps.push(no_ci);
        let mut none = passed("a");
        none.evidence = None;
        gaps.push(none);
        for gap in gaps {
            assert!(matches!(verdict(gap.clone()), Verdict::Wait(cause) if !cause.is_empty()));
            if gap.evidence.as_ref().is_none_or(|e| {
                e.checks.is_empty() || e.state != WorktreeEvidenceState::Complete || e.stale
            }) {
                assert!(pin(Ok(gap), REPO, 23).is_err());
            }
        }

        // Same PR number in another repository, or another PR, cannot cross-match.
        assert!(matches!(
            decide("a", "github.com/acme/two", 23, &Ok(passed("a"))),
            Verdict::Wait(cause) if cause.contains("github.com/acme/one")
        ));
        assert!(matches!(
            decide("a", REPO, 24, &Ok(passed("a"))),
            Verdict::Wait(_)
        ));
        // A failed refresh waits.
        assert!(matches!(
            decide("a", REPO, 23, &Err(RpcError::internal("offline"))),
            Verdict::Wait(_)
        ));
    }
}
