use super::*;

impl Agents {
    /// G3: how far the Agent's Worktree is from its Base. Reads only.
    pub(super) async fn worktree_state(&self, id: &str) -> Result<WorktreeState, RpcError> {
        let record = self.shared.node(id)?.worktree;
        let Some(record) = record else {
            return Err(RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")));
        };
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let worktree = worktree::Worktree::from(&record);
        tokio::task::spawn_blocking(move || git.state(&project, &worktree))
            .await
            .map_err(|err| RpcError::internal(format!("worktree_failed: {err}")))?
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
        let attempt = self
            .shared
            .rail()
            .node(id)?
            .attempt
            .expect("reserved Attempt");
        let (git, plan_project, plan_id) =
            (self.shared.git.bounded(), project.clone(), id.to_owned());
        let plan = tokio::task::spawn_blocking(move || git.plan(&plan_project, &plan_id, &attempt))
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
