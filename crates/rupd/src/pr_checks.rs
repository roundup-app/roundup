//! Required-check evidence used by continuation verification.
use contracts::agent::{
    WorktreeCheckConclusion, WorktreeEvidence, WorktreeEvidenceState, WorktreeState,
};
use rpc::{Ctx, Module, RpcError};
use serde_json::json;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Every required check passed on the pinned head.
    Match,
    /// The head differs from the accepted identity.
    Invalidate(String),
    /// No match now, and the cause the user can act on.
    Wait(String),
}

/// A current PR identity, independently of whether its required checks have concluded.
pub(crate) fn current<'a>(
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
        .ok_or_else(|| "no required-check evidence".to_string())?;
    if pr.stale || evidence.stale {
        return Err("the evidence is stale; the last refresh failed or is old".into());
    }
    match evidence.state {
        WorktreeEvidenceState::Complete | WorktreeEvidenceState::Incomplete => {}
        WorktreeEvidenceState::StaleHead => {
            return Err("the PR head moved while the checks were read".into());
        }
        WorktreeEvidenceState::Unknown => {
            return Err("the forge read failed without a reason".into());
        }
        WorktreeEvidenceState::Unavailable => {
            return Err("no usable gh, login, GitHub remote or answer in time".into());
        }
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
    if evidence.head.as_ref().is_none_or(|head| head.is_empty()) {
        return Err("the evidence names no current head".into());
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
            return Verdict::Wait(format!("the Worktree read failed: {}", error.message));
        }
    };
    let evidence = match current(state, repository, number) {
        Ok(evidence) => evidence,
        Err(cause) => return Verdict::Wait(cause),
    };
    let head = evidence.head.as_deref().unwrap_or_default();
    if head != pin {
        return Verdict::Invalidate(format!("the PR head moved from {pin} to {head}"));
    }
    if evidence.state != WorktreeEvidenceState::Complete {
        return Verdict::Wait("a required check is pending, or none is required".into());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u3078b_checks_require_fresh_complete_exact_pr_evidence() {
        let base = json!({
            "ahead":0,"behind":0,"dirty":false,"ci":null,
            "pr":{"number":23,"stale":false},
            "evidence":{"state":"complete","stale":false,
                "repository":"github.com/acme/one","head":"accepted-head",
                "checks":[{"name":"check","conclusion":"passed"}],
                "read_at":1,"revision":"forge-revision"}
        });
        let decide_value = |value| {
            decide(
                "accepted-head",
                "github.com/acme/one",
                23,
                &Ok(serde_json::from_value(value).unwrap()),
            )
        };
        assert_eq!(decide_value(base.clone()), Verdict::Match);
        for (pointer, value) in [
            ("/pr/number", json!(24)),
            ("/pr/stale", json!(true)),
            ("/evidence/stale", json!(true)),
            ("/evidence/repository", json!("github.com/acme/other")),
            ("/evidence/head", json!("replacement-head")),
            ("/evidence/head", json!(null)),
            ("/evidence/state", json!("incomplete")),
            ("/evidence/state", json!("stale-head")),
            ("/evidence/state", json!("unknown")),
            ("/evidence/state", json!("unavailable")),
            ("/evidence/checks", json!([])),
            ("/evidence/checks/0/conclusion", json!("failed")),
            ("/evidence", json!(null)),
            ("/pr", json!(null)),
        ] {
            let mut changed = base.clone();
            *changed.pointer_mut(pointer).unwrap() = value;
            assert_ne!(decide_value(changed), Verdict::Match, "{pointer}");
        }
        assert_ne!(
            decide(
                "accepted-head",
                "github.com/acme/one",
                23,
                &Err(RpcError::internal("unavailable"))
            ),
            Verdict::Match
        );
    }
}
