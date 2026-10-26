mod publication;

//! U2875a, U2875b: the user's import of recent Claude Code conversations into this Project.

use super::*;
use contracts::project::{
    ImportCandidate, ImportCommitParams, ImportDiscoverParams, ImportDiscovery, ImportDisposition,
    ImportExclusion, ImportExclusionCause, ImportFailure, ImportList, ImportListParams,
    ImportListed, ImportLive, ImportOutcome, ImportPeriod, ImportResult,
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
        ctx: &Ctx,
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
                    cause: ImportExclusionCause::AlreadyImported,
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
                cause: e.cause,
                reason: e.reason,
                title: None,
                last_activity_ms: e.modified_ms,
            }));
        drop(rail);
        if ctx.actor.kind == ActorKind::Agent {
            let node = self.shared.rail().node(&ctx.actor.id)?;
            let directory = self.dir.join("import-lists");
            std::fs::create_dir_all(&directory).map_err(RpcError::internal)?;
            let mut file =
                tempfile::NamedTempFile::new_in(&directory).map_err(RpcError::internal)?;
            serde_json::to_writer(&mut file, &out).map_err(RpcError::internal)?;
            file.persist(directory.join(format!("{}.json", node.id)))
                .map_err(RpcError::internal)?;
            ctx.emit(EventData::RailChanged);
        }
        Ok(out)
    }

    fn import_agent_list(&self, agent: &str) -> Result<ImportList, RpcError> {
        let node = self.shared.rail().node(agent)?;
        if node.kind != NodeKind::Agent {
            return Err(RpcError::forbidden("the listing identity must be an Agent"));
        }
        let file = std::fs::File::open(
            self.dir
                .join("import-lists")
                .join(format!("{}.json", node.id)),
        )
        .map_err(|_| {
            RpcError::conflict(
                "The Agent has not listed candidates. Refresh after it calls import.list.",
            )
        })?;
        serde_json::from_reader(file).map_err(RpcError::internal)
    }

    pub(super) async fn import_discover(
        &self,
        ctx: &Ctx,
        params: ImportDiscoverParams,
    ) -> Result<ImportDiscovery, RpcError> {
        user_only(ctx)?;
        if let Some(agent) = &params.agent {
            let listed = self.import_agent_list(agent)?;
            return Ok(ImportDiscovery {
                candidates: listed
                    .candidates
                    .into_iter()
                    .map(|c| ImportCandidate {
                        source: c.source,
                        title: c.title,
                        cwd: c.cwd,
                        last_activity_ms: c.last_activity_ms,
                        revision: c.revision,
                    })
                    .collect(),
                excluded: listed.excluded,
            });
        }
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
                    cause: ImportExclusionCause::AlreadyImported,
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
                cause: e.cause,
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
        let listed = params
            .agent
            .as_deref()
            .map(|agent| self.import_agent_list(agent))
            .transpose()?;
        if let Some(listed) = &listed
            && !params.selections.iter().all(|pick| {
                listed.candidates.iter().any(|candidate| {
                    candidate.source == pick.source && candidate.revision == pick.revision
                })
            })
        {
            return Err(RpcError::forbidden(
                "The selection does not match this Agent's preview. Refresh Import.",
            ));
        }
        if params.selections.len() > MAX_SELECTIONS {
            return Err(RpcError::not_accepted(format!(
                "import at most {MAX_SELECTIONS} conversations at once"
            )));
        }
        let mut outcomes = Vec::new();
        for selection in params.selections {
            let now = store::now_ms();
            let live = listed.as_ref().is_some_and(|listed| {
                listed.candidates.iter().any(|candidate| {
                    candidate.source == selection.source && candidate.live.is_some()
                })
            });
            let outcome = match self
                .import_conversation(
                    &selection.source,
                    &selection.revision,
                    now,
                    live.then_some(ctx),
                )
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
                Err(err) => {
                    // Launch can fail after publication; expose the retained Agent for Resume.
                    let published = self
                        .shared
                        .rail()
                        .closed_source(&selection.source)?
                        .filter(|(_, _, published)| *published);
                    ImportOutcome {
                        source: selection.source,
                        workstream: published
                            .as_ref()
                            .map(|(workstream, _, _)| workstream.clone()),
                        agent: published.map(|(_, agent, _)| agent),
                        error: Some(import_failure(err)),
                    }
                }
            };
            outcomes.push(outcome);
        }
        Ok(ImportResult { outcomes })
    }
}

fn import_failure(err: RpcError) -> ImportFailure {
    ImportFailure {
        outcome: match err.code {
            rpc::code::PARSE_ERROR
            | rpc::code::METHOD_NOT_FOUND
            | rpc::code::INVALID_PARAMS
            | rpc::code::NOT_FOUND
            | rpc::code::FORBIDDEN
            | rpc::code::CONFLICT
            | rpc::code::BUSY
            | rpc::code::NOT_RUNNING
            | rpc::code::EVENTS_EXPIRED
            | rpc::code::INBOX_UNAVAILABLE => ImportDisposition::Failed,
            _ => ImportDisposition::Unknown,
        },
        code: err.code,
        message: err.message,
    }
}
