use super::*;
use crate::pr_checks::{Conclusion, Evidence, Gap};
use contracts::agent::{WorktreeCheckConclusion, WorktreeEvidence, WorktreeRequiredCheck};

impl Agents {
    pub(super) async fn import_conversation(
        &self,
        source: &str,
        revision: &str,
        now_ms: i64,
    ) -> Result<(String, String), RpcError> {
        let project = self.project_dir().to_owned();
        let launcher = self.launcher.clone();
        let (src, rev) = (source.to_owned(), revision.to_owned());
        let (candidate, bytes) = tokio::task::spawn_blocking(move || {
            launcher.read_import_snapshot(&project, &src, &rev, now_ms)
        })
        .await
        .map_err(RpcError::internal)??;
        let cwd = self.project_dir().join(&candidate.cwd);
        self.prepare_closed(source, &candidate.title, &cwd, &bytes)
            .await
    }

    async fn prepare_closed(
        &self,
        source: &str,
        title: &str,
        cwd: &Path,
        conversation: &[u8],
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
            Ok::<_, RpcError>(())
        }
        .await;
        if let Err(error) = outcome {
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
        Ok(ids)
    }

    /// G3: how far the Agent's Worktree is from its Base. Reads only.
    pub(super) async fn worktree_state(&self, id: &str) -> Result<WorktreeState, RpcError> {
        let record = self.shared.node(id)?.worktree;
        let Some(record) = record else {
            return Err(RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")));
        };
        self.shared.worktrunk.refresh(&self.shared);
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let worktree = worktree::Worktree::from(&record);
        let mut state = tokio::task::spawn_blocking(move || git.state(&project, &worktree))
            .await
            .map_err(|err| RpcError::internal(format!("worktree_failed: {err}")))??;
        // A local read can outlive replacement: never attach the replacement's facts to it.
        if self.shared.node(id)?.worktree.as_ref() != Some(&record) {
            return Err(RpcError::new(code::NOT_FOUND, "Worktree identity changed"));
        }
        if let Some(facts) = self.worktree_facts(id, &record) {
            use contracts::agent::{WorktreeCi, WorktreeCiState, WorktreePr};
            state.evidence = facts
                .evidence
                .map(|(evidence, stale)| evidence_wire(evidence, stale));
            state.ci = facts.ci.map(|(value, stale)| WorktreeCi {
                state: match value.as_str() {
                    "passed" => WorktreeCiState::Passed,
                    "failed" => WorktreeCiState::Failed,
                    "running" => WorktreeCiState::Running,
                    "no-ci" => WorktreeCiState::NoCi,
                    "conflicts" => WorktreeCiState::Conflicts,
                    "error" => WorktreeCiState::Error,
                    _ => WorktreeCiState::Unknown,
                },
                stale,
            });
            state.pr = facts.pr.and_then(|(number, stale)| {
                std::num::NonZeroU64::new(number).map(|number| WorktreePr { number, stale })
            });
        }
        Ok(state)
    }

    /// U2539a: what the Agent's Worktree changed against its Base. Reads only.
    pub(super) async fn changed_files(&self, id: &str) -> Result<ChangedFiles, RpcError> {
        let record = self.shared.node(id)?.worktree;
        let Some(record) = record else {
            return Err(RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")));
        };
        let git = self.shared.git.bounded();
        let worktree = worktree::Worktree::from(&record);
        tokio::task::spawn_blocking(move || git.changed_files(&worktree))
            .await
            .map_err(|err| RpcError::internal(format!("worktree_failed: {err}")))?
    }

    /// U2540a: read one comparison within the assigned Worktree.
    pub(super) async fn compare_file(
        &self,
        id: &str,
        path: &str,
    ) -> Result<contracts::agent::FileComparison, RpcError> {
        let record = self
            .shared
            .node(id)?
            .worktree
            .ok_or_else(|| RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")))?;
        let git = self.shared.git.bounded();
        let worktree = worktree::Worktree::from(&record);
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || git.compare_file(&worktree, &path))
            .await
            .map_err(|err| RpcError::internal(format!("worktree_failed: {err}")))?
    }

    /// G4: land the Agent's branch on its Base, after the Project's `check` passes in the Worktree.
    pub(super) async fn land(&self, id: &str) -> Result<Landed, RpcError> {
        let record = self.shared.node(id)?.worktree;
        let Some(record) = record else {
            return Err(RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")));
        };
        let check = self.shared.rail().get_worktrees()?.check;
        let (git, project) = (self.shared.git.clone(), self.project_dir().to_owned());
        let worktree = worktree::Worktree::from(&record);
        let base =
            tokio::task::spawn_blocking(move || git.land(&project, &worktree, check.as_deref()))
                .await
                .map_err(|err| RpcError::internal(format!("worktree_failed: {err}")))??;
        Ok(Landed { base })
    }

    /// When the Project's `worktrees` setting is on, make a Worktree for `id` (G2) and map `cwd`
    /// into it; `None` when the setting is off, so `run_agent` uses `cwd` unchanged. Any failure
    /// retains its ownership record when cleanup cannot safely remove the new Worktree.
    pub(super) async fn provision_worktree(
        &self,
        id: &str,
        cwd: &Path,
    ) -> Result<Option<(PathBuf, worktree::Worktree)>, RpcError> {
        self.shared.rail().closed_recovery_ready(Some(id))?;
        if !self.shared.rail().get_worktrees()?.on {
            return Ok(None);
        }
        if let Some(prepared) = self.prepared_mode()? {
            return self.assign_prepared(id, cwd, prepared).await.map(Some);
        }
        let project = self.project_dir().to_owned();
        let (real_project, real_cwd) = real_paths(&project, cwd)?;
        self.shared.rail().resource_node(id)?;
        let (git, plan_project, plan_id) =
            (self.shared.git.bounded(), project.clone(), id.to_owned());
        let plan = tokio::task::spawn_blocking(move || git.plan(&plan_project, &plan_id))
            .await
            .map_err(RpcError::internal)??;
        self.shared.rail().mark_worktree_provisioning(id, &plan)?;
        let (git, provisioning_plan) = (self.shared.git.bounded(), plan.clone());
        let made =
            match tokio::task::spawn_blocking(move || git.provision(&project, &provisioning_plan))
                .await
                .map_err(RpcError::internal)?
            {
                Ok(made) => made,
                Err(err) => {
                    let (git, recovery_project, recovery_plan) = (
                        self.shared.git.bounded(),
                        self.project_dir().to_owned(),
                        plan.clone(),
                    );
                    if tokio::task::spawn_blocking(move || {
                        git.recover(&recovery_project, &recovery_plan)
                    })
                    .await
                    .map_err(RpcError::internal)?
                    .is_ok()
                    {
                        self.shared.rail().clear_worktree(id)?;
                    }
                    return Err(err);
                }
            };
        let mapped = match worktree::map_cwd(&real_project, &real_cwd, &made.path) {
            Some(mapped) if mapped.is_dir() => mapped,
            _ => {
                self.discard_worktree(id, made).await;
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!(
                        "cwd_not_in_worktree: {} is not in the fresh worktree",
                        cwd.display()
                    ),
                ));
            }
        };
        Ok(Some((mapped, made)))
    }

    /// Commit provisioning without starting a program. Mark ready before releasing the git
    /// proof so restart completes retention rather than reclaiming the assigned Worktree.
    pub(super) async fn retain_worktree(&self, id: &str) -> Result<(), RpcError> {
        let pending = self
            .shared
            .rail()
            .provisioning()?
            .into_iter()
            .find(|(node, _, _)| node.id == id);
        if let Some((node, plan, _)) = pending {
            let plan =
                plan.ok_or_else(|| RpcError::internal(format!("worktree_failed: {UNPROVEN}")))?;
            self.shared
                .rail()
                .set_worktree(id, &node.worktree.expect("provisioned Worktree"))?;
            let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
            tokio::task::spawn_blocking(move || git.finish(&project, &plan))
                .await
                .map_err(RpcError::internal)??;
            self.shared.rail().clear_provisioning_owner(id)?;
        }
        Ok(())
    }

    /// Undo a Worktree `provision_worktree` made and clear the node's record of it: used when a
    /// later step (the cwd check, or starting the Agent itself) fails.
    pub(super) async fn discard_worktree(&self, id: &str, worktree: worktree::Worktree) {
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let pending = match self.shared.rail().provisioning() {
            Ok(records) => records.into_iter().find(|(node, _, _)| node.id == id),
            Err(err) => {
                eprintln!("agents: could not read Worktree ownership for {id}: {err}");
                return;
            }
        };
        let undone = tokio::task::spawn_blocking(move || match pending {
            Some((_, Some(plan), _)) => git.recover(&project, &plan),
            Some((_, None, _)) => Err(RpcError::internal(format!("worktree_failed: {UNPROVEN}"))),
            None => git.remove_landed(&project, &worktree),
        })
        .await
        .map_err(RpcError::internal)
        .and_then(|result| result);
        match undone {
            Ok(()) => report_undo(
                "clear the Agent's worktree",
                self.shared.rail().clear_worktree(id),
            ),
            Err(err) => eprintln!("agents: could not undo Worktree for {id}: {err}"),
        }
    }
}

/// Reconcile a single unpublished source. Records stay on any refusal so neither a new
/// import nor assignment can reuse uncertain ownership. Successful sources are never selected.
pub(super) fn reconcile_closed(
    rail: &mut rail::Rail,
    git: &worktree::Git,
    project: &Path,
    dir: &Path,
    launcher: &Launcher,
    source: &str,
) -> Result<(), RpcError> {
    let Some(preparation) = rail
        .unfinished_closed()?
        .into_iter()
        .find(|preparation| preparation.source == source)
    else {
        return Ok(());
    };
    let rail::ClosedPreparation { agent, copy, .. } = preparation;
    let recover = || -> Result<(), RpcError> {
        if let Some(copy) = copy {
            launcher.discard_conversation(&copy)?;
        }
        let node = rail.resource_node(&agent)?;
        if node.worktree.is_some() {
            let plan = rail
                .provisioning()?
                .into_iter()
                .find(|(node, _, _)| node.id == agent)
                .and_then(|(_, plan, _)| plan)
                .ok_or_else(|| RpcError::internal(UNPROVEN))?;
            git.recover(project, &plan)?;
        }
        Launcher::discard(dir, &agent).map_err(RpcError::internal)?;
        Ok(())
    };
    match recover() {
        Ok(()) => rail.forget_closed(source),
        Err(error) => {
            rail.refuse_closed(source, &error.message)?;
            Err(error)
        }
    }
}

/// The error that made a caller undo its work is the one it returns, so a failed undo is only
/// reported.
pub(super) fn report_undo<E: std::fmt::Display>(what: &str, undone: Result<(), E>) {
    if let Err(err) = undone {
        eprintln!("agents: could not {what}: {err}");
    }
}

/// `project` and `cwd` with symlinks and `..` resolved, the way A4's trust check reads them, so a
/// `cwd` is judged by where it is and not by how it is written. Checked before `git` runs.
pub(super) fn real_paths(project: &Path, cwd: &Path) -> Result<(PathBuf, PathBuf), RpcError> {
    let invalid = |message: String| RpcError::new(code::INVALID_PARAMS, message);
    let real_cwd = cwd
        .canonicalize()
        .map_err(|err| invalid(format!("cwd {} is unusable: {err}", cwd.display())))?;
    let real_project = project
        .canonicalize()
        .map_err(|err| RpcError::internal(format!("{}: {err}", project.display())))?;
    if !real_cwd.starts_with(&real_project) {
        return Err(invalid(format!(
            "cwd {} is outside the project folder {}",
            real_cwd.display(),
            real_project.display()
        )));
    }
    Ok((real_project, real_cwd))
}

/// NR10: the wire form of one required-check read; only a complete read lists checks.
fn evidence_wire(evidence: Evidence, stale: bool) -> WorktreeEvidence {
    use contracts::agent::WorktreeEvidenceState as S;
    let incomplete = |state| WorktreeEvidence {
        state,
        stale,
        repository: None,
        head: None,
        checks: Vec::new(),
        read_at: None,
        revision: None,
    };
    match evidence {
        Evidence::Complete(read) => WorktreeEvidence {
            state: S::Complete,
            stale,
            revision: Some(read.revision()),
            repository: Some(format!("{}/{}", read.host, read.repository)),
            head: Some(read.head),
            read_at: Some(read.read_at),
            checks: read
                .checks
                .into_iter()
                .map(|check| WorktreeRequiredCheck {
                    name: check.name,
                    conclusion: match check.conclusion {
                        Conclusion::Passed => WorktreeCheckConclusion::Passed,
                        Conclusion::Failed => WorktreeCheckConclusion::Failed,
                        Conclusion::Skipped => WorktreeCheckConclusion::Skipped,
                        Conclusion::Cancelled => WorktreeCheckConclusion::Cancelled,
                    },
                })
                .collect(),
        },
        Evidence::Incomplete(gap) => incomplete(match gap {
            Gap::Pending | Gap::NoRequiredChecks => S::Incomplete,
            Gap::StaleHead => S::StaleHead,
            Gap::ReadFailed => S::Unknown,
            Gap::GhMissing
            | Gap::Refused
            | Gap::NotLoggedIn
            | Gap::TimedOut
            | Gap::NonGithubRemote => S::Unavailable,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(project: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("git")
            .current_dir(project)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    fn fixture() -> (tempfile::TempDir, Agents, String) {
        let (dir, _, shared) = crate::tests::shared_over_temp_dir(Arc::new(|| 0));
        git(dir.path(), &["init", "-b", "main"]);
        git(dir.path(), &["config", "user.email", "test@example.com"]);
        git(dir.path(), &["config", "user.name", "Test"]);
        std::fs::create_dir(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/file"), "base").unwrap();
        std::fs::write(dir.path().join(".gitignore"), ".cache/\n").unwrap();
        git(dir.path(), &["add", "src", ".gitignore"]);
        git(dir.path(), &["commit", "-m", "base"]);
        shared
            .rail()
            .set_worktrees(&contracts::project::Worktrees {
                on: true,
                check: None,
            })
            .unwrap();
        let id = shared
            .rail()
            .insert(NodeKind::Agent, "closed", None, None)
            .unwrap()
            .id;
        let agents = crate::tests::owner_agents(shared, dir.path());
        (dir, agents, id)
    }

    const RETAINED: &[u8] =
        b"{\"sessionId\":\"external\",\"type\":\"user\",\"message\":\"retained\"}\n";

    #[tokio::test]
    async fn u2875c_unpublished_resources_are_reconciled_at_every_durable_step() {
        // The first three node/source writes share a SQLite transaction (Rail test below).
        // These are every durable resource step after that transaction.
        for mode in 0..3 {
            for boundary in 0..14 {
                if mode == 0 && matches!(boundary, 1..=4 | 10 | 13) {
                    continue;
                }
                let (dir, agents, existing) = fixture();
                if mode == 0 {
                    agents
                        .shared
                        .rail()
                        .set_worktrees(&contracts::project::Worktrees {
                            on: false,
                            check: None,
                        })
                        .unwrap();
                }
                let prepared = if mode == 2 {
                    Some(enroll(&agents, dir.path(), "true").await)
                } else {
                    None
                };
                let (workstream, agent) = agents
                    .shared
                    .rail()
                    .reserve_closed("interrupted", "hidden")
                    .unwrap();
                let mut effective = dir.path().join("src");
                let mut provision = None;
                if mode != 0 && boundary >= 1 {
                    let mut plan = agents.shared.git.plan(dir.path(), &agent).unwrap();
                    if let Some(path) = &prepared {
                        plan.worktree.path = path.clone();
                    }
                    if mode == 2 {
                        assert!(
                            agents
                                .shared
                                .rail()
                                .reserve_prepared(&agent, &plan)
                                .unwrap()
                        );
                    } else {
                        agents
                            .shared
                            .rail()
                            .mark_worktree_provisioning(&agent, &plan)
                            .unwrap();
                    }
                    if boundary == 2 {
                        git(
                            dir.path(),
                            &[
                                "update-ref",
                                &format!("refs/heads/{}", plan.worktree.branch),
                                &plan.commit,
                            ],
                        );
                        git(dir.path(), &["update-ref", &plan.owner, &plan.commit]);
                    }
                    if boundary >= 3 {
                        if mode == 2 {
                            agents
                                .shared
                                .git
                                .assign_prepared(dir.path(), &plan)
                                .unwrap();
                        } else {
                            agents.shared.git.provision(dir.path(), &plan).unwrap();
                        }
                        effective = plan.worktree.path.join("src");
                    }
                    if boundary >= 4 {
                        agents
                            .shared
                            .rail()
                            .set_worktree(
                                &agent,
                                &contracts::agent::Worktree {
                                    path: plan.worktree.path.to_string_lossy().into_owned(),
                                    branch: plan.worktree.branch.clone(),
                                    base: plan.worktree.base.clone(),
                                },
                            )
                            .unwrap();
                    }
                    provision = Some(plan);
                }
                let mut retained = None;
                if boundary >= 5 {
                    let (id, ownership) = agents
                        .launcher
                        .prepare_conversation(&effective, RETAINED)
                        .unwrap();
                    agents
                        .shared
                        .rail()
                        .closed_copy("interrupted", &ownership)
                        .unwrap();
                    if boundary >= 6 {
                        agents.launcher.write_conversation(&ownership).unwrap();
                    }
                    if boundary >= 8 {
                        agents
                            .shared
                            .rail()
                            .save_conversation(&agent, &id, &effective.to_string_lossy())
                            .unwrap();
                    }
                    if boundary == 6 {
                        agents.launcher.interrupt_copy_for_test(&ownership);
                    }
                    retained = Some((id, effective.clone(), ownership));
                }
                if boundary >= 9 {
                    agents.shared.rail().publish_closed("interrupted").unwrap();
                }
                if boundary >= 9 {
                    if let Some((id, cwd, _)) = &retained {
                        agents
                            .launcher
                            .replace_retained_for_test(
                                cwd,
                                id,
                                b"{\"type\":\"user\",\"message\":\"published user edit\"}\n",
                            )
                            .unwrap();
                    }
                    if let Some(plan) = &provision {
                        std::fs::write(
                            plan.worktree.path.join("user-file"),
                            "keep after publication",
                        )
                        .unwrap();
                    }
                }
                if boundary >= 10
                    && let Some(plan) = &provision
                {
                    agents.shared.git.finish(dir.path(), plan).unwrap();
                }
                if boundary >= 11
                    && let Some((_, _, ownership)) = &retained
                {
                    agents.launcher.finish_conversation(ownership).unwrap();
                }
                if boundary >= 12 {
                    agents
                        .shared
                        .rail()
                        .release_closed_copy("interrupted")
                        .unwrap();
                }
                if boundary >= 13 {
                    agents
                        .shared
                        .rail()
                        .clear_provisioning_owner(&agent)
                        .unwrap();
                }
                let before = agents.shared.rail().tree().unwrap();
                assert_eq!(
                    before.len(),
                    if boundary < 9 { 1 } else { 3 },
                    "mode {mode} boundary {boundary}"
                );
                if boundary < 9 {
                    assert!(
                        agents
                            .provision_worktree(&existing, dir.path())
                            .await
                            .is_err()
                    );
                    assert!(
                        agents
                            .shared
                            .rail()
                            .reserve_closed("other source", "other")
                            .is_err()
                    );
                    assert!(agents.shared.node(&workstream).is_err());
                    assert!(agents.shared.node(&agent).is_err());
                    assert!(agents.shared.rail().has_conversation(&agent).is_err());
                }
                let agents = reopen(agents);
                let after = agents.shared.rail().tree().unwrap();
                assert_eq!(
                    after.len(),
                    if boundary < 9 { 1 } else { 3 },
                    "mode {mode} boundary {boundary}"
                );
                assert_eq!(after[0].id, existing);
                if let Some((id, cwd, ownership)) = retained {
                    assert_eq!(
                        agents.launcher.retained_copy_exists_for_test(&ownership),
                        boundary >= 9
                    );
                    assert!(!agents.launcher.copy_owner_exists_for_test(&ownership));
                    if boundary >= 9 {
                        agents.launcher.assert_retained_for_test(
                            &cwd,
                            &id,
                            b"{\"type\":\"user\",\"message\":\"published user edit\"}\n",
                        );
                    }
                    assert_eq!(
                        agents.launcher.record_conversation(&cwd, &id).is_ok(),
                        boundary >= 9
                    );
                }
                assert!(agents.shared.rail().provisioning().unwrap().is_empty());
                assert_eq!(
                    git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                    ""
                );
                if boundary < 9 {
                    assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
                    if let Some(plan) = provision {
                        assert_eq!(plan.worktree.path.exists(), mode == 2);
                    }
                    let result = agents
                        .prepare_closed("interrupted", "retry", &dir.path().join("src"), RETAINED)
                        .await
                        .unwrap();
                    assert_ne!(result.1, agent);
                }
                if let Some(path) = prepared {
                    assert_eq!(
                        std::fs::read_to_string(path.join(".cache/user-dependency")).unwrap(),
                        "keep"
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn u2875c_preview_identity_is_checked_before_import() {
        const ID: &str = "11111111-1111-4111-8111-111111111111";
        let (dir, agents, _) = fixture();
        let project = dir.path().canonicalize().unwrap();
        let encoded: String = project
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let bucket = dir.path().join("projects").join(encoded);
        std::fs::create_dir_all(&bucket).unwrap();
        let file = bucket.join(format!("{ID}.jsonl"));
        let line = |ts: &str| {
            format!(
                "{{\"type\":\"user\",\"isSidechain\":false,\"cwd\":\"{}\",\"sessionId\":\"{ID}\",\"timestamp\":\"{ts}\"}}\n",
                project.join("src").display()
            )
        };
        std::fs::write(&file, line("2026-10-19T11:00:00Z")).unwrap();
        let now = 1_792_411_200_000;
        let found = agents
            .launcher
            .discover_recent(&project, now, 86_400_000)
            .await
            .unwrap();
        let revision = found.candidates[0].revision.clone();
        // The source changes after preview: refused, nothing published.
        std::fs::write(
            &file,
            line("2026-10-19T11:00:00Z") + &line("2026-10-19T11:30:00Z"),
        )
        .unwrap();
        let refused = agents.import_conversation(ID, &revision, now).await;
        assert!(
            refused
                .unwrap_err()
                .message
                .contains("changed since preview")
        );
        assert!(agents.shared.rail().closed_source(ID).unwrap().is_none());
        // The refreshed preview imports once; a replay returns the same nodes.
        let found = agents
            .launcher
            .discover_recent(&project, now, 86_400_000)
            .await
            .unwrap();
        let revision = found.candidates[0].revision.clone();
        let ids = agents
            .import_conversation(ID, &revision, now)
            .await
            .unwrap();
        assert_eq!(
            agents
                .import_conversation(ID, &revision, now)
                .await
                .unwrap(),
            ids
        );
        assert_eq!(
            agents.shared.node(&ids.1).unwrap().name,
            "Untitled conversation"
        );
    }

    #[tokio::test]
    async fn u2875a_u2875b_import_methods_are_user_only_and_list_then_commit() {
        use serde_json::json;
        const ID: &str = "22222222-2222-4222-8222-222222222222";
        let (dir, agents, _) = fixture();
        let project = dir.path().canonicalize().unwrap();
        let encoded: String = project
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let bucket = dir.path().join("projects").join(encoded);
        std::fs::create_dir_all(&bucket).unwrap();
        let n = time::OffsetDateTime::now_utc();
        let ts = format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            n.year(),
            u8::from(n.month()),
            n.day(),
            n.hour(),
            n.minute(),
            n.second()
        );
        std::fs::write(
            bucket.join(format!("{ID}.jsonl")),
            format!(
                "{{\"type\":\"user\",\"isSidechain\":false,\"cwd\":\"{}\",\"sessionId\":\"{ID}\",\"timestamp\":\"{ts}\"}}\n",
                project.join("src").display()
            ),
        )
        .unwrap();
        let ctx = |actor: contracts::Actor| rpc::Ctx {
            actor,
            bus: Bus::new(),
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
        };
        let agent = contracts::Actor {
            kind: contracts::ActorKind::Agent,
            id: "7".into(),
            parent: None,
        };
        for method in ["project.importDiscover", "project.importCommit"] {
            let params = json!({"period": "day", "selections": []});
            let err = agents
                .call(&ctx(agent.clone()), method, params)
                .await
                .unwrap_err();
            assert_eq!(err.code, rpc::RpcError::forbidden("").code);
        }
        let user = ctx(contracts::Actor::user());
        let listed: contracts::project::ImportDiscovery = serde_json::from_value(
            agents
                .call(&user, "project.importDiscover", json!({"period": "day"}))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(listed.candidates.len(), 1);
        assert_eq!(listed.candidates[0].cwd, "src");
        let selection = json!({"source": ID, "revision": listed.candidates[0].revision});
        let committed: contracts::project::ImportResult = serde_json::from_value(
            agents
                .call(
                    &user,
                    "project.importCommit",
                    json!({"selections": [selection]}),
                )
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(committed.outcomes[0].error.is_none());
        // The imported conversation is no longer selectable, and a stale revision is refused.
        let again: contracts::project::ImportDiscovery = serde_json::from_value(
            agents
                .call(&user, "project.importDiscover", json!({"period": "day"}))
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(again.candidates.is_empty());
        assert_eq!(again.excluded[0].reason, "already in this Project");
        let stale = agents
            .call(
                &user,
                "project.importCommit",
                json!({"selections": [{"source": "33333333-3333-4333-8333-333333333333", "revision": "x"}]}),
            )
            .await
            .unwrap();
        assert!(stale["outcomes"][0]["error"].is_string());
    }

    #[tokio::test]
    async fn u2875c_concurrent_replay_preserves_names_homes_and_removed_sources() {
        let (dir, agents, _) = fixture();
        let (a, b) = tokio::join!(
            agents.prepare_closed("same", "first", dir.path(), RETAINED),
            agents.prepare_closed("same", "second", dir.path(), RETAINED)
        );
        let ids = a.unwrap();
        assert_eq!(b.unwrap(), ids);
        let other = agents
            .shared
            .rail()
            .insert(NodeKind::Workstream, "new Home", None, None)
            .unwrap();
        agents
            .shared
            .rail()
            .rename(&ids.0, "user Workstream")
            .unwrap();
        agents.shared.rail().rename(&ids.1, "user Agent").unwrap();
        agents
            .shared
            .rail()
            .move_node(&ids.1, Some(&other.id), 0)
            .unwrap();
        let agents = reopen(agents);
        assert_eq!(
            agents
                .prepare_closed("same", "replacement", dir.path(), b"invalid")
                .await
                .unwrap(),
            ids
        );
        assert_eq!(agents.shared.node(&ids.0).unwrap().name, "user Workstream");
        let node = agents.shared.node(&ids.1).unwrap();
        assert_eq!(node.name, "user Agent");
        assert_eq!(node.parent, Some(other.id));
        agents.shared.rail().remove(&ids.1).unwrap();
        assert_eq!(
            agents
                .prepare_closed("same", "replacement", dir.path(), b"invalid")
                .await
                .unwrap(),
            ids
        );
        assert!(agents.shared.node(&ids.1).is_err());
        assert_eq!(agents.shared.rail().tree().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn u2875c_source_identity_belongs_to_one_project() {
        let (first, a, _) = fixture();
        let (second, b, _) = fixture();
        let (_, one) = a
            .prepare_closed("same source", "one", first.path(), RETAINED)
            .await
            .unwrap();
        let (_, two) = b
            .prepare_closed("same source", "two", second.path(), RETAINED)
            .await
            .unwrap();
        let one = a.shared.rail().conversation(&one).unwrap().unwrap();
        let two = b.shared.rail().conversation(&two).unwrap().unwrap();
        assert_ne!(one.0, two.0);
        assert_ne!(one.1, two.1);
        assert_eq!(a.shared.rail().tree().unwrap().len(), 3);
        assert_eq!(b.shared.rail().tree().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn u2875b_publication_refuses_a_worktree_without_recorded_readiness() {
        let (dir, agents, _) = fixture();
        let (_, agent) = agents
            .shared
            .rail()
            .reserve_closed("unready", "hidden")
            .unwrap();
        let (cwd, made) = agents
            .provision_worktree(&agent, dir.path())
            .await
            .unwrap()
            .unwrap();
        let (id, copy) = agents
            .launcher
            .prepare_conversation(&cwd, RETAINED)
            .unwrap();
        agents.shared.rail().closed_copy("unready", &copy).unwrap();
        agents.launcher.write_conversation(&copy).unwrap();
        agents
            .shared
            .rail()
            .save_conversation(&agent, &id, &cwd.to_string_lossy())
            .unwrap();
        assert!(agents.shared.rail().publish_closed("unready").is_err());
        assert!(agents.shared.node(&agent).is_err());
        agents
            .shared
            .rail()
            .set_worktree(
                &agent,
                &contracts::agent::Worktree {
                    path: made.path.to_string_lossy().into_owned(),
                    branch: made.branch,
                    base: made.base,
                },
            )
            .unwrap();
        agents.shared.rail().publish_closed("unready").unwrap();
        assert!(agents.shared.node(&agent).unwrap().can_resume);
    }

    #[tokio::test]
    async fn u2875b_failed_import_readiness_leaves_no_visible_pair_or_assignment() {
        let (dir, agents, _) = fixture();
        let path = enroll(&agents, dir.path(), "false").await;
        assert!(
            agents
                .prepare_closed("failed", "hidden", dir.path(), RETAINED)
                .await
                .unwrap_err()
                .message
                .contains("readiness")
        );
        let agents = reopen(agents);
        assert_eq!(agents.shared.rail().tree().unwrap().len(), 1);
        assert!(
            agents
                .shared
                .rail()
                .closed_source("failed")
                .unwrap()
                .is_none()
        );
        assert!(
            agents
                .shared
                .rail()
                .worktree_owner_of(path.to_str().unwrap())
                .unwrap()
                .is_none()
        );
        assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
        assert_eq!(
            std::fs::read_to_string(path.join(".cache/user-dependency")).unwrap(),
            "keep"
        );
    }

    #[tokio::test]
    async fn u2875c_failed_source_cannot_undo_a_published_source() {
        let (dir, agents, _) = fixture();
        let published = agents
            .prepare_closed("good", "good", dir.path(), RETAINED)
            .await
            .unwrap();
        let saved = agents
            .shared
            .rail()
            .conversation(&published.1)
            .unwrap()
            .unwrap();
        assert!(
            agents
                .prepare_closed("bad", "bad", dir.path(), b"broken\n")
                .await
                .is_err()
        );
        let agents = reopen(agents);
        assert!(agents.shared.node(&published.1).unwrap().can_resume);
        assert!(
            agents
                .launcher
                .record_conversation(Path::new(&saved.1), &saved.0)
                .is_ok()
        );
        assert_eq!(agents.shared.rail().tree().unwrap().len(), 3);
        assert!(agents.shared.rail().closed_source("bad").unwrap().is_none());
        assert_eq!(
            git(dir.path(), &["branch", "--list", "roundup/*"])
                .lines()
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn u2875c_recovery_refusal_keeps_user_work_hidden_and_blocks_reuse() {
        for prepared in [false, true] {
            for changed in ["files", "ownership", "copy"] {
                let (dir, agents, existing) = fixture();
                if prepared {
                    enroll(&agents, dir.path(), "true").await;
                }
                let (workstream, agent) = agents
                    .shared
                    .rail()
                    .reserve_closed("unfinished", "hidden")
                    .unwrap();
                let (_, made) = agents
                    .provision_worktree(&agent, dir.path())
                    .await
                    .unwrap()
                    .unwrap();
                let (id, ownership) = agents
                    .launcher
                    .prepare_conversation(&made.path, RETAINED)
                    .unwrap();
                agents
                    .shared
                    .rail()
                    .closed_copy("unfinished", &ownership)
                    .unwrap();
                agents.launcher.write_conversation(&ownership).unwrap();
                match changed {
                    "files" => std::fs::write(made.path.join("user-file"), "keep").unwrap(),
                    "ownership" => {
                        let proof = agents
                            .shared
                            .rail()
                            .provisioning()
                            .unwrap()
                            .into_iter()
                            .find(|(node, _, _)| node.id == agent)
                            .unwrap()
                            .1
                            .unwrap();
                        git(dir.path(), &["update-ref", "-d", &proof.owner]);
                    }
                    "copy" => agents
                        .launcher
                        .replace_retained_for_test(&made.path, &id, b"changed by user")
                        .unwrap(),
                    _ => unreachable!(),
                }
                let agents = reopen(agents);
                assert!(agents.shared.node(&workstream).is_err());
                assert!(agents.shared.node(&agent).is_err());
                assert_eq!(agents.shared.rail().tree().unwrap().len(), 1);
                let error = agents
                    .prepare_closed("another", "another", dir.path(), RETAINED)
                    .await
                    .unwrap_err();
                assert!(error.message.contains("recovery refused"));
                assert!(
                    agents
                        .provision_worktree(&existing, dir.path())
                        .await
                        .unwrap_err()
                        .message
                        .contains("recovery refused")
                );
                assert!(made.path.exists());
                if changed == "files" {
                    assert_eq!(
                        std::fs::read_to_string(made.path.join("user-file")).unwrap(),
                        "keep"
                    );
                }
                if changed == "copy" {
                    assert!(
                        agents
                            .launcher
                            .record_conversation(&made.path, &id)
                            .unwrap_err()
                            .message
                            .contains("complete records")
                    );
                    // The file remains with its exact changed bytes, as the Adapter observer asserts.
                    agents
                        .launcher
                        .assert_retained_for_test(&made.path, &id, b"changed by user");
                }
                if prepared {
                    assert_eq!(
                        agents
                            .shared
                            .rail()
                            .worktree_owner_of(made.path.to_str().unwrap())
                            .unwrap(),
                        Some(agent)
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn u2875b_closed_publication_retains_continuation_without_a_launch() {
        for mode in 0..3 {
            let (dir, agents, _) = fixture();
            if mode == 0 {
                agents
                    .shared
                    .rail()
                    .set_worktrees(&contracts::project::Worktrees {
                        on: false,
                        check: None,
                    })
                    .unwrap();
            } else if mode == 2 {
                enroll(&agents, dir.path(), "test -f src/file").await;
            }
            let (workstream, agent) = agents
                .prepare_closed(
                    "opaque-source",
                    "imported",
                    &dir.path().join("src"),
                    b"{\"sessionId\":\"original\",\"type\":\"user\",\"message\":\"retained\"}\n",
                )
                .await
                .unwrap();
            let node = agents.shared.node(&agent).unwrap();
            assert_eq!(node.parent.as_ref(), Some(&workstream));
            assert!(node.can_resume);
            assert!(node.attempt.is_none());
            assert!(node.terminal_id.is_none());
            assert!(node.status_revision.is_none());
            assert_eq!(node.worktree.is_some(), mode != 0);
            let saved = agents.shared.rail().conversation(&agent).unwrap().unwrap();
            let bytes = agents
                .launcher
                .record_conversation(Path::new(&saved.1), &saved.0)
                .unwrap();
            assert!(String::from_utf8(bytes).unwrap().contains("retained"));
            assert!(agents.shared.terminals.list().is_empty());
            assert!(agents.shared.runs().is_empty());
            let agents = reopen(agents);
            assert!(agents.shared.node(&agent).unwrap().can_resume);
            assert_eq!(
                agents
                    .prepare_closed("opaque-source", "replacement", dir.path(), b"invalid")
                    .await
                    .unwrap(),
                (workstream, agent)
            );
        }
    }

    async fn enroll(agents: &Agents, project: &Path, readiness: &str) -> PathBuf {
        let path = project.join("prepared");
        git(
            project,
            &[
                "worktree",
                "add",
                "--detach",
                path.to_str().unwrap(),
                "HEAD",
            ],
        );
        std::fs::create_dir(path.join(".cache")).unwrap();
        std::fs::write(path.join(".cache/user-dependency"), "keep").unwrap();
        agents
            .set_prepared(contracts::project::Prepared {
                enrolled: vec![path.to_string_lossy().into_owned()],
                readiness: Some(readiness.into()),
                setup: None,
                timeout_ms: Some(5000),
            })
            .await
            .unwrap();
        path
    }

    fn reopen(agents: Agents) -> Agents {
        let project = agents.project_dir().to_owned();
        let dir = agents.dir.clone();
        let bus = Bus::new();
        let terminals = Arc::new(Terminals::open(&dir, bus.clone()).unwrap());
        let launcher = agents.launcher.clone();
        drop(agents);
        Agents::open_in(
            &project,
            &dir,
            bus,
            terminals,
            launcher,
            worktree::Git::from_env(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn u2875b_closed_prepared_assignment_is_exclusive_without_launch() {
        let (dir, agents, id) = fixture();
        let path = enroll(&agents, dir.path(), "test -f src/file").await;
        let (cwd, made) = agents
            .provision_worktree(&id, &dir.path().join("src"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(made.path, path);
        assert_eq!(cwd, path.join("src"));
        let other = agents
            .shared
            .rail()
            .insert(NodeKind::Agent, "other", None, None)
            .unwrap();
        let error = agents
            .provision_worktree(&other.id, dir.path())
            .await
            .unwrap_err();
        assert!(error.message.starts_with("no_prepared_directory"));
        assert_eq!(
            agents
                .shared
                .rail()
                .worktree_owner_of(path.to_str().unwrap())
                .unwrap(),
            Some(id.clone())
        );
        let node = agents.shared.node(&id).unwrap();
        assert!(node.attempt.is_none());
        assert!(node.terminal_id.is_none());
        assert!(node.status_revision.is_none());
        assert!(agents.shared.terminals.list().is_empty());
        assert!(agents.shared.runs().is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("src/file")).unwrap(),
            "base"
        );
    }

    #[tokio::test]
    async fn u2875c_retained_closed_worktree_survives_each_commit_boundary() {
        for prepared in [false, true] {
            // Ready persisted, ownership ref released, ownership record released.
            for boundary in 0..3 {
                let (dir, agents, id) = fixture();
                if prepared {
                    enroll(&agents, dir.path(), "true").await;
                }
                let (_, made) = agents
                    .provision_worktree(&id, dir.path())
                    .await
                    .unwrap()
                    .unwrap();
                let plan = agents
                    .shared
                    .rail()
                    .provisioning()
                    .unwrap()
                    .pop()
                    .unwrap()
                    .1
                    .unwrap();
                if boundary == 2 {
                    agents.retain_worktree(&id).await.unwrap();
                } else {
                    agents
                        .shared
                        .rail()
                        .set_worktree(
                            &id,
                            &contracts::agent::Worktree {
                                path: made.path.to_string_lossy().into_owned(),
                                branch: made.branch.clone(),
                                base: made.base.clone(),
                            },
                        )
                        .unwrap();
                    if boundary == 1 {
                        agents.shared.git.finish(dir.path(), &plan).unwrap();
                    }
                }
                std::fs::write(made.path.join("user-work"), "retained").unwrap();
                let agents = reopen(agents);
                let node = agents.shared.node(&id).unwrap();
                assert_eq!(node.worktree.unwrap().path, made.path.to_string_lossy());
                assert!(node.attempt.is_none());
                assert!(node.terminal_id.is_none());
                assert!(agents.shared.terminals.list().is_empty());
                assert_eq!(
                    std::fs::read_to_string(made.path.join("user-work")).unwrap(),
                    "retained"
                );
                assert!(agents.shared.rail().provisioning().unwrap().is_empty());
                assert_eq!(
                    git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                    ""
                );
            }
        }
    }

    #[tokio::test]
    async fn u2875c_interrupted_closed_provisioning_releases_owned_resources_before_reuse() {
        for prepared in [false, true] {
            for boundary in 0..3 {
                let (dir, agents, id) = fixture();
                let path = if prepared {
                    Some(enroll(&agents, dir.path(), "true").await)
                } else {
                    None
                };
                let mut plan = agents.shared.git.plan(dir.path(), &id).unwrap();
                if let Some(path) = &path {
                    plan.worktree.path = path.clone();
                }
                if prepared {
                    assert!(agents.shared.rail().reserve_prepared(&id, &plan).unwrap());
                } else {
                    agents
                        .shared
                        .rail()
                        .mark_worktree_provisioning(&id, &plan)
                        .unwrap();
                }
                if boundary == 1 {
                    git(
                        dir.path(),
                        &[
                            "update-ref",
                            &format!("refs/heads/{}", plan.worktree.branch),
                            &plan.commit,
                        ],
                    );
                    git(dir.path(), &["update-ref", &plan.owner, &plan.commit]);
                } else if boundary == 2 {
                    if prepared {
                        agents
                            .shared
                            .git
                            .assign_prepared(dir.path(), &plan)
                            .unwrap();
                    } else {
                        agents.shared.git.provision(dir.path(), &plan).unwrap();
                    }
                }
                if boundary == 2 {
                    // Readiness completed, but the source has not committed retention.
                    assert!(plan.worktree.path.join("src/file").is_file());
                }
                let agents = reopen(agents);
                assert!(agents.shared.rail().provisioning().unwrap().is_empty());
                assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
                assert_eq!(
                    git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                    ""
                );
                assert_eq!(plan.worktree.path.exists(), prepared);
                if prepared {
                    assert_eq!(
                        std::fs::read_to_string(plan.worktree.path.join(".cache/user-dependency"))
                            .unwrap(),
                        "keep"
                    );
                }
                let retry = agents
                    .shared
                    .rail()
                    .insert(NodeKind::Agent, "retry", None, None)
                    .unwrap();
                let (_, made) = agents
                    .provision_worktree(&retry.id, dir.path())
                    .await
                    .unwrap()
                    .unwrap();
                if let Some(path) = path {
                    assert_eq!(made.path, path);
                }
                assert!(agents.shared.node(&retry.id).unwrap().attempt.is_none());
            }
        }
    }

    #[tokio::test]
    async fn u2875b_missing_mapped_directory_refuses_closed_provisioning() {
        for prepared in [false, true] {
            let (dir, agents, id) = fixture();
            let path = if prepared {
                Some(enroll(&agents, dir.path(), "true").await)
            } else {
                None
            };
            std::fs::create_dir(dir.path().join("not-in-base")).unwrap();
            let error = agents
                .provision_worktree(&id, &dir.path().join("not-in-base"))
                .await
                .unwrap_err();
            assert!(error.message.starts_with("cwd_not_in_worktree"));
            assert!(agents.shared.node(&id).unwrap().worktree.is_none());
            assert!(agents.shared.node(&id).unwrap().attempt.is_none());
            assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
            assert_eq!(
                git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                ""
            );
            if let Some(path) = path {
                assert!(path.is_dir());
            }
        }
    }

    #[tokio::test]
    async fn u2875b_failed_readiness_releases_closed_assignment_and_requires_preparation() {
        let (dir, agents, id) = fixture();
        let path = enroll(&agents, dir.path(), "echo unavailable; exit 1").await;
        let error = agents
            .provision_worktree(&id, dir.path())
            .await
            .unwrap_err();
        assert!(error.message.contains("phase=readiness"));
        assert!(agents.shared.node(&id).unwrap().worktree.is_none());
        assert!(agents.shared.node(&id).unwrap().attempt.is_none());
        assert!(
            agents
                .shared
                .rail()
                .prepared_unavailable(path.to_str().unwrap())
                .unwrap()
                .is_some()
        );
        assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
        assert_eq!(
            git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
            ""
        );
        assert!(
            agents
                .provision_worktree(&id, dir.path())
                .await
                .unwrap_err()
                .message
                .contains("unavailable")
        );
        assert!(agents.shared.terminals.list().is_empty());
    }

    #[tokio::test]
    async fn u2875c_prepared_recovery_preserves_user_files_and_changed_ownership() {
        for changed_owner in [false, true] {
            let (dir, agents, id) = fixture();
            let path = enroll(&agents, dir.path(), "true").await;
            agents.provision_worktree(&id, dir.path()).await.unwrap();
            if changed_owner {
                git(dir.path(), &["commit", "--allow-empty", "-m", "new base"]);
                let plan = agents
                    .shared
                    .rail()
                    .provisioning()
                    .unwrap()
                    .pop()
                    .unwrap()
                    .1
                    .unwrap();
                git(dir.path(), &["update-ref", &plan.owner, "HEAD"]);
            } else {
                std::fs::write(path.join("user-work"), "keep me").unwrap();
            }
            let agents = reopen(agents);
            assert_eq!(
                agents
                    .shared
                    .rail()
                    .worktree_owner_of(path.to_str().unwrap())
                    .unwrap(),
                Some(id.clone())
            );
            assert!(agents.shared.node(&id).unwrap().attempt.is_none());
            if !changed_owner {
                assert_eq!(
                    std::fs::read_to_string(path.join("user-work")).unwrap(),
                    "keep me"
                );
            }
            let other = agents
                .shared
                .rail()
                .insert(NodeKind::Agent, "other", None, None)
                .unwrap();
            assert!(
                agents
                    .provision_worktree(&other.id, dir.path())
                    .await
                    .unwrap_err()
                    .message
                    .starts_with("no_prepared_directory")
            );
        }
    }

    #[tokio::test]
    async fn u2875b_first_explicit_resume_launches_attempt_one_in_retained_cwd() {
        use rpc::Module;
        use serde_json::json;
        use std::os::unix::fs::PermissionsExt;
        for prepared in [false, true] {
            let (dir, mut agents, id) = fixture();
            if prepared {
                enroll(&agents, dir.path(), "true").await;
            }
            let bin = dir.path().join("fake-claude");
            std::fs::write(&bin, "#!/bin/sh\nif [ \"$1\" = plugin ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nprintf '%s\\n' \"$@\" > launch-argv\npwd > launch-cwd\nexec sleep 30\n").unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::write(dir.path().join("rup"), "").unwrap();
            agents.launcher = Launcher::new(
                bin.to_string_lossy(),
                dir.path().join("claude.json"),
                dir.path().join("rup"),
                None,
            );
            let (cwd, made) = agents
                .provision_worktree(&id, &dir.path().join("src"))
                .await
                .unwrap()
                .unwrap();
            agents.retain_worktree(&id).await.unwrap();
            let conversation = "11111111-1111-1111-1111-111111111111";
            agents
                .shared
                .rail()
                .save_conversation(&id, conversation, cwd.to_str().unwrap())
                .unwrap();
            let agents = Arc::new(reopen(agents));
            assert!(agents.shared.terminals.list().is_empty());
            assert!(agents.shared.node(&id).unwrap().attempt.is_none());
            let ctx = rpc::Ctx {
                actor: contracts::Actor::user(),
                bus: Bus::new(),
                touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            };
            let mut resuming = {
                let agents = Arc::clone(&agents);
                let ctx = rpc::Ctx {
                    actor: ctx.actor.clone(),
                    bus: ctx.bus.clone(),
                    touches: Arc::clone(&ctx.touches),
                };
                let id = id.clone();
                tokio::spawn(
                    async move { agents.call(&ctx, "agent.resume", json!({"id": id})).await },
                )
            };
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let ready = matches!(
                        agents.shared.runs().get(&id),
                        Some(Slot::Resuming {
                            terminal_id: Some(_),
                            ..
                        })
                    );
                    if ready {
                        break;
                    }
                    if resuming.is_finished() {
                        panic!(
                            "resume ended before its launch was claimed: {:?}",
                            (&mut resuming).await
                        );
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            agents.call(&ctx, "agent.signal", json!({"id":id,"attempt":"1","payload":{"hook_event_name":"SessionStart","session_id":conversation,"source":"resume"}})).await.unwrap();
            let node: contracts::agent::RailNode =
                serde_json::from_value(resuming.await.unwrap().unwrap()).unwrap();
            assert_eq!(node.attempt.as_deref(), Some("1"));
            assert!(node.terminal_id.is_some());
            assert_eq!(node.worktree.unwrap().path, made.path.to_string_lossy());
            tokio::time::timeout(Duration::from_secs(10), async {
                while !cwd.join("launch-cwd").exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            let argv = std::fs::read_to_string(cwd.join("launch-argv")).unwrap();
            assert!(argv.contains(&format!("--resume\n{conversation}")));
            assert_eq!(
                std::fs::read_to_string(cwd.join("launch-cwd"))
                    .unwrap()
                    .trim(),
                cwd.to_str().unwrap()
            );
            agents
                .call(&ctx, "agent.stop", json!({"id":id}))
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn u2875c_stale_provisioning_cannot_reclaim_a_new_reservation() {
        for prepared in [false, true] {
            let (dir, agents, id) = fixture();
            if prepared {
                enroll(&agents, dir.path(), "true").await;
            }
            let (_, made) = agents
                .provision_worktree(&id, dir.path())
                .await
                .unwrap()
                .unwrap();
            let stale = agents
                .shared
                .rail()
                .provisioning()
                .unwrap()
                .pop()
                .unwrap()
                .1
                .unwrap();
            agents.discard_worktree(&id, made).await;
            let (_, made) = agents
                .provision_worktree(&id, dir.path())
                .await
                .unwrap()
                .unwrap();
            assert!(agents.shared.git.recover(dir.path(), &stale).is_err());
            assert!(made.path.is_dir());
            assert_eq!(git(&made.path, &["branch", "--show-current"]), made.branch);
            let agents = reopen(agents);
            assert!(agents.shared.rail().provisioning().unwrap().is_empty());
            assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
        }
    }
}
