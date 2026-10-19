use super::*;

impl Agents {
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
        if !self.shared.rail().get_worktrees()?.on {
            return Ok(None);
        }
        if let Some(prepared) = self.prepared_mode()? {
            return self.assign_prepared(id, cwd, prepared).await.map(Some);
        }
        let project = self.project_dir().to_owned();
        let (real_project, real_cwd) = real_paths(&project, cwd)?;
        self.shared.rail().node(id)?;
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

    #[tokio::test]
    async fn u2875b_closed_worktree_provisioning_does_not_allocate_attempt() {
        let (dir, agents, id) = fixture();
        let (cwd, made) = agents
            .provision_worktree(&id, &dir.path().join("src"))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(cwd, made.path.join("src"));
        assert_eq!(std::fs::read_to_string(cwd.join("file")).unwrap(), "base");
        assert_eq!(git(dir.path(), &["branch", "--show-current"]), "main");
        let node = agents.shared.node(&id).unwrap();
        assert!(node.attempt.is_none());
        assert!(node.terminal_id.is_none());
        assert!(agents.shared.terminals.list().is_empty());
        assert!(agents.shared.runs().is_empty());
        assert!(node.status_revision.is_none());
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
