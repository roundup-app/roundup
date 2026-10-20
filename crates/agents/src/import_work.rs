//! U2875a, U2875b: the user's import of recent Claude Code conversations into this Project.

use super::*;
use contracts::project::{
    ImportCandidate, ImportCommitParams, ImportDiscoverParams, ImportDiscovery, ImportExclusion,
    ImportOutcome, ImportPeriod, ImportResult,
};

const DAY_MS: i64 = 86_400_000;
/// Selections one confirmation may carry; more are refused, never silently dropped.
const MAX_SELECTIONS: usize = 50;

fn user_only(ctx: &Ctx) -> Result<(), RpcError> {
    if ctx.actor.kind != ActorKind::User {
        return Err(RpcError::forbidden("only the user imports conversations"));
    }
    Ok(())
}

impl Agents {
    pub(super) async fn import_discover(
        &self,
        ctx: &Ctx,
        params: ImportDiscoverParams,
    ) -> Result<ImportDiscovery, RpcError> {
        user_only(ctx)?;
        let days = match params.period {
            ImportPeriod::Day => 1,
            ImportPeriod::Week => 7,
            ImportPeriod::Month => 30,
        };
        let found = self
            .launcher
            .discover_recent(self.project_dir(), store::now_ms(), days * DAY_MS)
            .await?;
        let rail = self.shared.rail();
        let mut out = ImportDiscovery {
            candidates: Vec::new(),
            excluded: Vec::new(),
        };
        for c in found.candidates {
            if rail.represents_source(&c.source)? {
                out.excluded.push(ImportExclusion {
                    source: c.source,
                    reason: "already in this Project".into(),
                });
            } else {
                out.candidates.push(ImportCandidate {
                    source: c.source,
                    title: c.title,
                    cwd: c.cwd.to_string_lossy().into_owned(),
                    last_activity_ms: c.last_activity_ms,
                    revision: c.revision,
                });
            }
        }
        out.excluded
            .extend(found.excluded.into_iter().map(|e| ImportExclusion {
                source: e.source,
                reason: e.reason.into(),
            }));
        Ok(out)
    }

    pub(super) async fn import_commit(
        &self,
        ctx: &Ctx,
        params: ImportCommitParams,
    ) -> Result<ImportResult, RpcError> {
        user_only(ctx)?;
        if params.selections.len() > MAX_SELECTIONS {
            return Err(RpcError::not_accepted(format!(
                "import at most {MAX_SELECTIONS} conversations at once"
            )));
        }
        let mut outcomes = Vec::new();
        for selection in params.selections {
            let now = store::now_ms();
            let outcome = match self
                .import_conversation(&selection.source, &selection.revision, now)
                .await
            {
                Ok((workstream, agent)) => {
                    Self::touch_rail(ctx, &workstream)?;
                    Self::touch_rail(ctx, &agent)?;
                    ImportOutcome {
                        source: selection.source,
                        workstream: Some(workstream),
                        agent: Some(agent),
                        error: None,
                    }
                }
                Err(err) => ImportOutcome {
                    source: selection.source,
                    workstream: None,
                    agent: None,
                    error: Some(err.message),
                },
            };
            outcomes.push(outcome);
        }
        Ok(ImportResult { outcomes })
    }
}
