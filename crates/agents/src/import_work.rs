//! U2875a, U2875b: the user's import of recent Claude Code conversations into this Project.

use super::*;
use contracts::project::{
    ImportCandidate, ImportCommitParams, ImportDiscoverParams, ImportDiscovery, ImportExclusion,
    ImportList, ImportListParams, ImportListed, ImportLive, ImportOutcome, ImportPeriod,
    ImportResult,
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

fn period_ms(period: ImportPeriod) -> i64 {
    DAY_MS
        * match period {
            ImportPeriod::Day => 1,
            ImportPeriod::Week => 7,
            ImportPeriod::Month => 30,
        }
}

impl Agents {
    /// U3523a: read-only. Any caller may list; listing starts nothing and commits nothing, and
    /// the sidecar behind it runs only for this call.
    pub(super) async fn import_list(
        &self,
        _ctx: &Ctx,
        params: ImportListParams,
    ) -> Result<ImportList, RpcError> {
        // A Project that is not a repository has no registered Worktrees to add.
        let worktrees = self
            .shared
            .git
            .registered_worktrees(self.project_dir())
            .unwrap_or_default()
            .into_iter()
            .map(|(path, _)| path)
            .collect::<Vec<_>>();
        let found = self
            .launcher
            .list_vendor(
                self.project_dir(),
                &worktrees,
                (store::now_ms(), period_ms(params.period)),
            )
            .await?;
        let rail = self.shared.rail();
        let mut out = ImportList {
            candidates: Vec::new(),
            excluded: Vec::new(),
            notices: found.notices,
            sdk: found.sdk,
        };
        for c in found.candidates {
            if rail.represents_source(&c.source)? {
                out.excluded.push(ImportExclusion {
                    source: c.source,
                    reason: "already in this Project".into(),
                    title: Some(c.title),
                    last_activity_ms: Some(c.last_activity_ms),
                });
            } else {
                out.candidates.push(ImportListed {
                    source: c.source,
                    title: c.title,
                    cwd: c.cwd.to_string_lossy().into_owned(),
                    last_activity_ms: c.last_activity_ms,
                    revision: c.revision,
                    live: c.live.map(|live| ImportLive {
                        pid: live.pid,
                        cwd: live.cwd,
                        name: live.name,
                        busy: live.busy,
                        started_at_ms: live.started_at_ms,
                    }),
                });
            }
        }
        out.excluded
            .extend(found.excluded.into_iter().map(|e| ImportExclusion {
                source: e.source,
                reason: e.reason,
                title: None,
                last_activity_ms: e.modified_ms,
            }));
        Ok(out)
    }

    pub(super) async fn import_discover(
        &self,
        ctx: &Ctx,
        params: ImportDiscoverParams,
    ) -> Result<ImportDiscovery, RpcError> {
        user_only(ctx)?;
        let found = self
            .launcher
            .discover_recent(
                self.project_dir(),
                store::now_ms(),
                period_ms(params.period),
            )
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
                    title: Some(c.title),
                    last_activity_ms: Some(c.last_activity_ms),
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
                reason: e.reason,
                title: None,
                last_activity_ms: e.modified_ms,
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
