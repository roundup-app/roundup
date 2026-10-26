use super::*;
use crate::worktree_wiring::{real_paths, reconcile_closed};

impl Agents {
    pub(crate) async fn import_conversation(
        &self,
        source: &str,
        revision: &str,
        now_ms: i64,
        resume: Option<&Ctx>,
        vendor: bool,
    ) -> Result<(String, String), RpcError> {
        // Published work no longer depends on the external original. Concurrent first
        // imports still converge under prepare_closed's lifecycle lock after validation.
        if let Some((workstream, agent, true)) = self.shared.rail().closed_source(source)? {
            return Ok((workstream, agent));
        }
        let listed = if vendor {
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
                .list_saved(self.project_dir(), &worktrees, (now_ms, i64::MAX))
                .await?;
            let candidate = found
                .candidates
                .into_iter()
                .find(|c| c.source == source && c.revision == revision)
                .ok_or_else(|| {
                    RpcError::conflict("source changed since preview; Refresh to try again")
                })?;
            Some(crate::claude_code::ImportCandidate {
                source: candidate.source,
                title: candidate.title,
                cwd: candidate.cwd,
                last_activity_ms: candidate.last_activity_ms,
                revision: candidate.revision,
            })
        } else {
            None
        };
        let project = self.project_dir().to_owned();
        let launcher = self.launcher.clone();
        let (src, rev) = (source.to_owned(), revision.to_owned());
        let (candidate, bytes) = tokio::task::spawn_blocking(move || {
            launcher.read_import_snapshot(&project, &src, &rev, now_ms, listed)
        })
        .await
        .map_err(RpcError::internal)??;
        let cwd = self.project_dir().join(&candidate.cwd);
        self.prepare_closed(source, &candidate.title, &cwd, &bytes, resume)
            .await
    }

    pub(crate) async fn prepare_closed(
        &self,
        source: &str,
        title: &str,
        cwd: &Path,
        conversation: &[u8],
        resume: Option<&Ctx>,
    ) -> Result<(String, String), RpcError> {
        let _lifecycle = self.shared.door_lifecycle.write().await;
        {
            let rail = self.shared.rail();
            if let Some((workstream, agent, published)) = rail.closed_source(source)? {
                return if published {
                    Ok((workstream, agent))
                } else {
                    rail.closed_recovery_ready(None)?;
                    Err(RpcError::conflict("source preparation is still pending"))
                };
            }
            rail.closed_recovery_ready(None)?;
        }
        let (_, real_cwd) = real_paths(self.project_dir(), cwd)?;
        let ids = self.shared.rail().reserve_closed(source, title)?;
        let outcome = async {
            let effective =
                if let Some((mapped, made)) = self.provision_worktree(&ids.1, &real_cwd).await? {
                    self.shared.rail().set_worktree(
                        &ids.1,
                        &contracts::agent::Worktree {
                            path: made.path.to_string_lossy().into_owned(),
                            branch: made.branch,
                            base: made.base,
                        },
                    )?;
                    mapped
                } else {
                    real_cwd
                };
            let (id, ownership) = self
                .launcher
                .prepare_conversation(&effective, conversation)?;
            self.shared.rail().closed_copy(source, &ownership)?;
            self.launcher.write_conversation(&ownership)?;
            self.shared
                .rail()
                .save_conversation(&ids.1, &id, &effective.to_string_lossy())?;
            self.shared.rail().publish_closed(source)?;
            Ok::<_, RpcError>(effective)
        }
        .await;
        let effective = match outcome {
            Ok(effective) => effective,
            Err(error) => {
                let (shared, launcher, dir, source) = (
                    Arc::clone(&self.shared),
                    self.launcher.clone(),
                    self.dir.clone(),
                    source.to_owned(),
                );
                let recovery = tokio::task::spawn_blocking(move || {
                    reconcile_closed(
                        &mut shared.rail(),
                        &shared.git.bounded(),
                        &shared.project_dir,
                        &dir,
                        &launcher,
                        &source,
                    )
                })
                .await
                .map_err(RpcError::internal)?;
                if let Err(recovery) = recovery {
                    return Err(RpcError::internal(format!(
                        "{}; recovery refused: {}",
                        error.message, recovery.message
                    )));
                }
                return Err(error);
            }
        };
        let copies = self.shared.rail().closed_copies()?;
        for (key, ownership) in copies {
            if key == source {
                match self.launcher.finish_conversation(&ownership) {
                    Ok(()) => self.shared.rail().release_closed_copy(source)?,
                    Err(error) => eprintln!(
                        "agents: {source}: copy ownership release deferred: {}",
                        error.message
                    ),
                }
            }
        }
        // Publication already committed: a release failure must never turn success into a
        // reclaimable preparation. open_in retries this idempotent release after restart.
        if let Err(error) = self.retain_worktree(&ids.1).await {
            eprintln!(
                "agents: {}: ownership release deferred: {}",
                ids.1, error.message
            );
        }
        // Keep the publication lock through the automatic launch: a concurrent commit
        // must observe the published source and return it, never launch it a second time.
        if let Some(ctx) = resume {
            // Only acknowledgement replaces the retained continuation with the live source.
            // A failed launch must remain resumable after the external original is deleted.
            self.resume_conversation(
                ctx,
                &ids.1,
                RESUME_ACK_BOUND,
                Some((source, &effective.to_string_lossy())),
                None,
                RailPublication::Immediate,
                None,
                None,
            )
            .await?;
        }
        Ok(ids)
    }
}
