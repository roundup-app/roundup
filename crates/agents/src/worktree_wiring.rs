use super::*;
use crate::pr_checks::{Conclusion, Evidence, Gap};
use contracts::agent::{WorktreeCheckConclusion, WorktreeEvidence, WorktreeRequiredCheck};

impl Agents {
    /// G3: how far the Agent's Worktree is from its Base. Reads only.
    pub(super) async fn worktree_state(&self, id: &str) -> Result<WorktreeState, RpcError> {
        let record = self.shared.node(id)?.worktree;
        let Some(record) = record else {
            return Err(RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")));
        };
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let worktree = worktree::Worktree::from(&record);
        let (mut state, head) = tokio::task::spawn_blocking(move || {
            let state = git.state(&project, &worktree)?;
            let head = git.reference(&project, &format!("refs/heads/{}", worktree.branch));
            Ok::<_, RpcError>((state, head.ok().flatten()))
        })
        .await
        .map_err(|err| RpcError::internal(format!("worktree_failed: {err}")))??;
        // A local read can outlive replacement: never attach the replacement's facts to it.
        if self.shared.node(id)?.worktree.as_ref() != Some(&record) {
            return Err(RpcError::new(code::NOT_FOUND, "Worktree identity changed"));
        }
        if let Some(facts) = self.worktree_facts(id, &record, head.as_deref()) {
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
        self.shared.worktrunk.refresh(&self.shared);
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
        Evidence::Pending(read) => WorktreeEvidence {
            repository: Some(format!("{}/{}", read.host, read.repository)),
            head: Some(read.head),
            read_at: Some(read.read_at),
            ..incomplete(S::Incomplete)
        },
        Evidence::Incomplete(gap) => incomplete(match gap {
            Gap::NoRequiredChecks => S::Incomplete,
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
    mod prepared;
    mod recovery;

    use super::*;
    use contracts::project::ImportExclusionCause::AlreadyImported;
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
    async fn u2875c_preview_identity_is_checked_before_import() {
        const ID: &str = "11111111-1111-4111-8111-111111111111";
        let (dir, agents, _) = fixture();
        let project = dir.path().canonicalize().unwrap();
        let bucket = dir.path().join("projects/historical");
        std::fs::create_dir_all(&bucket).unwrap();
        let file = bucket.join(format!("{ID}.jsonl"));
        let line = |ts: &str| {
            format!(
                "{{\"type\":\"user\",\"isSidechain\":false,\"cwd\":\"{}\",\"sessionId\":\"{ID}\",\"timestamp\":\"{ts}\",\"message\":{{\"role\":\"user\",\"content\":\"Imported work\"}}}}\n",
                project.join("src").display()
            )
        };
        std::fs::write(&file, line("2026-10-19T11:00:00Z")).unwrap();
        let now = 1_792_411_200_000;
        let found = agents
            .launcher
            .discover_recent(&project, &[], now, 86_400_000)
            .await
            .unwrap();
        let revision = found.candidates[0].revision.clone();
        // The source changes after preview: refused, nothing published.
        std::fs::write(
            &file,
            line("2026-10-19T11:00:00Z") + &line("2026-10-19T11:30:00Z"),
        )
        .unwrap();
        let refused = agents
            .import_conversation(ID, &revision, now, None, false)
            .await;
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
            .discover_recent(&project, &[], now, 86_400_000)
            .await
            .unwrap();
        let revision = found.candidates[0].revision.clone();
        let ids = agents
            .import_conversation(ID, &revision, now, None, false)
            .await
            .unwrap();
        assert_eq!(
            agents
                .import_conversation(ID, &revision, now, None, false)
                .await
                .unwrap(),
            ids
        );
        assert_eq!(agents.shared.node(&ids.1).unwrap().name, "Imported work");
    }

    #[tokio::test]
    async fn u2875a_u2875b_import_methods_are_user_only_and_list_then_commit() {
        use serde_json::json;
        const ID: &str = "22222222-2222-4222-8222-222222222222";
        let (dir, agents, _) = fixture();
        let project = dir.path().canonicalize().unwrap();
        let bucket = dir.path().join("projects/historical");
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
                "{{\"type\":\"user\",\"isSidechain\":false,\"cwd\":\"{}\",\"sessionId\":\"{ID}\",\"timestamp\":\"{ts}\",\"message\":{{\"role\":\"user\",\"content\":\"Imported work\"}}}}\n",
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
        assert_eq!(again.excluded[0].cause, AlreadyImported);
        let stale = agents
            .call(
                &user,
                "project.importCommit",
                json!({"selections": [{"source": "33333333-3333-4333-8333-333333333333", "revision": "x"}]}),
            )
            .await
            .unwrap();
        assert_eq!(stale["outcomes"][0]["error"]["code"], rpc::code::CONFLICT);
    }

    #[tokio::test]
    async fn u2875c_concurrent_replay_preserves_names_homes_and_removed_sources() {
        let (dir, agents, _) = fixture();
        let (a, b) = tokio::join!(
            agents.prepare_closed("same", "first", dir.path(), RETAINED, None),
            agents.prepare_closed("same", "second", dir.path(), RETAINED, None)
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
                .prepare_closed("same", "replacement", dir.path(), b"invalid", None)
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
                .prepare_closed("same", "replacement", dir.path(), b"invalid", None)
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
            .prepare_closed("same source", "one", first.path(), RETAINED, None)
            .await
            .unwrap();
        let (_, two) = b
            .prepare_closed("same source", "two", second.path(), RETAINED, None)
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
    async fn u2875c_failed_source_cannot_undo_a_published_source() {
        let (dir, agents, _) = fixture();
        let published = agents
            .prepare_closed("good", "good", dir.path(), RETAINED, None)
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
                .prepare_closed("bad", "bad", dir.path(), b"broken\n", None)
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
            assert!(agents.shared.terminals.list().await.is_empty());
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
}
