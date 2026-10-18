//! G2542: the `Git` side of prepared directories (`docs/worktrees.md`). An enrolled directory is
//! assigned by switching it to a new Agent branch, and released by parking it on a detached
//! commit; it is never removed, reset, stashed, cleaned of ignored files or force-switched.

use super::*;

/// Marks a directory as being prepared, so no assignment takes it meanwhile; ends on drop.
pub(crate) struct Preparing {
    busy: Arc<Mutex<Vec<PathBuf>>>,
    path: PathBuf,
}

impl Drop for Preparing {
    fn drop(&mut self) {
        let mut busy = self.busy.lock().unwrap_or_else(|err| err.into_inner());
        busy.retain(|path| *path != self.path);
    }
}

/// Git's own marks of an operation in progress, in the directory's git dir.
const OPERATIONS: [&str; 7] = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
    "index.lock",
];

impl Git {
    /// Replace the set of enrolled directories every removal and recovery path must retain.
    pub fn set_enrolled(&self, paths: &[PathBuf]) {
        let mut enrolled = self.enrolled.write().unwrap_or_else(|err| err.into_inner());
        *enrolled = paths.iter().map(|path| canonical_path(path)).collect();
    }

    pub(crate) fn is_enrolled(&self, path: &Path) -> bool {
        let path = canonical_path(path);
        let enrolled = self.enrolled.read().unwrap_or_else(|err| err.into_inner());
        enrolled.contains(&path)
    }

    /// `None` when a preparation already runs in `path`.
    pub(crate) fn begin_preparing(&self, path: &Path) -> Option<Preparing> {
        let path = canonical_path(path);
        let mut busy = self.busy.lock().unwrap_or_else(|err| err.into_inner());
        if busy.contains(&path) {
            return None;
        }
        busy.push(path.clone());
        Some(Preparing {
            busy: Arc::clone(&self.busy),
            path,
        })
    }

    pub(crate) fn is_preparing(&self, path: &Path) -> bool {
        let path = canonical_path(path);
        let busy = self.busy.lock().unwrap_or_else(|err| err.into_inner());
        busy.contains(&path)
    }

    /// G2542c: the guards that must hold before `path` is enrolled or assigned. Reads only. The
    /// canonical path on success, otherwise the first guard that fails, by name.
    pub(crate) fn check_prepared(&self, project: &Path, path: &Path) -> Result<PathBuf, String> {
        let unusable = |err: std::io::Error| format!("unusable_path: {}: {err}", path.display());
        let canonical = path.canonicalize().map_err(unusable)?;
        let name = path
            .file_name()
            .ok_or_else(|| format!("unusable_path: {}", path.display()))?;
        let parent = path.parent().unwrap_or(Path::new("/"));
        if parent.canonicalize().map_err(unusable)?.join(name) != canonical {
            return Err(format!("symlink_escape: {}", path.display()));
        }
        let real_project = project.canonicalize().map_err(unusable)?;
        if !canonical.starts_with(&real_project) {
            return Err(format!("outside_project: {}", canonical.display()));
        }
        let toplevel = PathBuf::from(self.run(project, &["rev-parse", "--show-toplevel"])?);
        if toplevel.canonicalize().map_err(unusable)? == canonical {
            return Err("primary_checkout".into());
        }
        let common = |dir: &Path| -> Result<PathBuf, String> {
            let found = self.run(
                dir,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )?;
            PathBuf::from(found)
                .canonicalize()
                .map_err(|e| e.to_string())
        };
        if common(&canonical)? != common(project)? {
            return Err("other_repository".into());
        }
        let own_root = PathBuf::from(self.run(&canonical, &["rev-parse", "--show-toplevel"])?);
        if own_root.canonicalize().map_err(unusable)? != canonical {
            return Err("not_a_worktree_root".into());
        }
        let entry = self
            .registered_worktrees(project)
            .map_err(|err| err.message)?
            .into_iter()
            .find(|(entry, _)| *entry == canonical)
            .ok_or("not_registered")?;
        match entry.1 {
            Some(branch) => {
                if branch.starts_with("refs/heads/roundup/agent-") {
                    return Err(format!("owned_branch: {branch}"));
                }
                let ahead =
                    self.run(project, &["rev-list", "--count", &branch, "--not", "HEAD"])?;
                if ahead != "0" {
                    return Err(format!("unlanded_commits: {branch} is ahead by {ahead}"));
                }
            }
            None => {
                let loose = self.run(
                    &canonical,
                    &[
                        "rev-list",
                        "--count",
                        "HEAD",
                        "--not",
                        "--branches",
                        "--remotes",
                        "--tags",
                    ],
                )?;
                if loose != "0" {
                    return Err(format!("unlanded_commits: {loose} not on any branch"));
                }
            }
        }
        let status = self.run(
            &canonical,
            &["status", "--porcelain", "-z", "--untracked-files=all"],
        )?;
        if !status.is_empty() {
            return Err("uncommitted_work".into());
        }
        let git_dir = PathBuf::from(self.run(&canonical, &["rev-parse", "--absolute-git-dir"])?);
        if let Some(mark) = OPERATIONS.iter().find(|mark| git_dir.join(mark).exists()) {
            return Err(format!("git_operation_in_progress: {mark}"));
        }
        Ok(canonical)
    }

    /// G2542a: with the reservation already persisted, create the Agent branch and its ownership
    /// ref, then switch the directory to the branch without force.
    pub(crate) fn assign_prepared(&self, project: &Path, plan: &Provision) -> Result<(), RpcError> {
        let input = format!(
            "start\ncreate refs/heads/{} {}\ncreate {} {}\nprepare\ncommit\n",
            plan.worktree.branch, plan.commit, plan.owner, plan.commit
        );
        self.update_refs(project, &input)?;
        self.run(&plan.worktree.path, &["switch", &plan.worktree.branch])
            .map(drop)
            .map_err(failed)
    }

    /// Whether the directory is on `reference` (`Some(true)`), detached (`Some(false)`), or on
    /// another branch (`None`).
    fn on_branch(&self, path: &Path, reference: &str) -> Result<Option<bool>, RpcError> {
        let output = self
            .output(path, &["symbolic-ref", "-q", "HEAD"], None)
            .map_err(failed)?;
        if !output.status.success() {
            return Ok(Some(false));
        }
        let head = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        Ok((head == reference).then_some(true))
    }

    /// G2542d: undo an unfinished assignment. Edits keep the directory as it is, to be reconciled.
    pub(crate) fn recover_prepared(
        &self,
        project: &Path,
        plan: &Provision,
    ) -> Result<(), RpcError> {
        let reference = format!("refs/heads/{}", plan.worktree.branch);
        let branch = self.reference(project, &reference)?;
        let owner = self.reference(project, &plan.owner)?;
        if owner.is_none() {
            if branch.is_some() {
                return Err(failed("unowned provisioning branch; preserving it"));
            }
            return Ok(());
        }
        if owner.as_deref() != Some(&plan.commit)
            || branch.as_ref().is_some_and(|head| head != &plan.commit)
        {
            return Err(failed(
                "provisioning ownership or branch changed; preserving it",
            ));
        }
        if plan.worktree.path.exists() {
            let path = canonical_path(&plan.worktree.path);
            if !self
                .registered_worktrees(project)?
                .iter()
                .any(|(entry, _)| *entry == path)
            {
                return Err(failed("prepared directory is not a registered Worktree"));
            }
            if !self
                .run(&path, &["status", "--porcelain", "--untracked-files=all"])
                .map_err(failed)?
                .is_empty()
            {
                return Err(failed(format!(
                    "unfinished assignment has edits; preserving {}",
                    path.display()
                )));
            }
            match self.on_branch(&path, &reference)? {
                Some(true) => {
                    self.run(&path, &["switch", "--detach", &plan.commit])
                        .map_err(failed)?;
                }
                Some(false) => {}
                None => return Err(failed("prepared directory is on another branch")),
            }
        }
        if branch.is_some() {
            self.run(project, &["update-ref", "-d", &reference, &plan.commit])
                .map_err(failed)?;
        }
        self.finish(project, plan)
    }

    /// G2542d: park the directory on a detached commit and delete only the Agent branch.
    pub(crate) fn release_prepared(
        &self,
        project: &Path,
        worktree: &Worktree,
        expected: Option<&str>,
    ) -> Result<(), RpcError> {
        let reference = format!("refs/heads/{}", worktree.branch);
        if worktree.path.exists() {
            let path = canonical_path(&worktree.path);
            match self
                .registered_worktrees(project)?
                .into_iter()
                .find(|(entry, _)| *entry == path)
            {
                Some((_, Some(branch))) if branch == reference => {
                    let tip =
                        expected.ok_or_else(|| failed("recorded Worktree branch is missing"))?;
                    self.run(&path, &["switch", "--detach", tip])
                        .map_err(failed)?;
                }
                Some((_, None)) => {}
                Some(_) => return Err(failed("recorded Worktree path belongs to another branch")),
                None => return Err(failed("recorded Worktree path is unregistered")),
            }
        }
        if let Some(expected) = expected {
            self.run(project, &["update-ref", "-d", &reference, expected])
                .map_err(failed)?;
        }
        Ok(())
    }

    /// G2542d: explicit discard of the Agent's tracked and untracked work. Ignored files stay.
    pub(crate) fn discard_prepared(
        &self,
        project: &Path,
        worktree: &Worktree,
    ) -> Result<(), RpcError> {
        let reference = format!("refs/heads/{}", worktree.branch);
        let tip = self.reference(project, &reference)?;
        if worktree.path.exists() {
            let path = canonical_path(&worktree.path);
            match self
                .registered_worktrees(project)?
                .into_iter()
                .find(|(entry, _)| *entry == path)
            {
                Some((_, Some(branch))) if branch == reference => {
                    let base = self
                        .reference(project, &format!("refs/heads/{}", worktree.base))?
                        .or_else(|| tip.clone())
                        .ok_or_else(|| failed("recorded Worktree branch is missing"))?;
                    self.run(&path, &["switch", "--detach", "--discard-changes", &base])
                        .map_err(failed)?;
                    self.run(&path, &["clean", "-fd"]).map_err(failed)?;
                }
                Some((_, None)) => {}
                Some(_) => return Err(failed("recorded Worktree path belongs to another branch")),
                None => return Err(failed("recorded Worktree path is unregistered")),
            }
        }
        if let Some(tip) = tip {
            self.run(project, &["update-ref", "-d", &reference, &tip])
                .map_err(failed)?;
        }
        Ok(())
    }

    /// G2542d: after a failed coordinated removal, put the directory back on its recreated branch.
    pub(crate) fn reattach_prepared(&self, worktree: &Worktree, tip: &str) -> Result<(), RpcError> {
        let reference = format!("refs/heads/{}", worktree.branch);
        if !worktree.path.exists() || self.on_branch(&worktree.path, &reference)? == Some(true) {
            return Ok(());
        }
        let head = self
            .run(&worktree.path, &["rev-parse", "HEAD"])
            .map_err(failed)?;
        let instructions = format!(
            "enrolled directory {} kept; to resume run `git -C {} switch {}`",
            worktree.path.display(),
            worktree.path.display(),
            worktree.branch
        );
        if head != tip {
            return Err(failed(instructions));
        }
        self.run(&worktree.path, &["switch", &worktree.branch])
            .map(drop)
            .map_err(|err| failed(format!("{err}; {instructions}")))
    }
}
