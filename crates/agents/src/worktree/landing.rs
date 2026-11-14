//! G4: Landing, the one way a Worktree's branch reaches its Base.

use std::path::Path;
use std::process::{Command, Stdio};

use rpc::RpcError;

use super::{Git, Worktree, WorktreeError, failed};

impl Git {
    /// G4: rebase the branch onto the Base, run `check` in the Worktree, fast-forward the Base.
    /// Every failure leaves the branch, the Worktree and the Base as they were. The checks run in
    /// the order the scenario lists, so one code wins when several hold.
    pub fn land(
        &self,
        project: &Path,
        worktree: &Worktree,
        check: Option<&str>,
    ) -> Result<String, RpcError> {
        if !worktree.path.is_dir() {
            return Err(WorktreeError::Missing(worktree.path.display().to_string()).into());
        }
        let Some(check) = check else {
            return Err(RpcError::conflict(
                "check_missing: the Project has no check; set one with project.setWorktrees",
            ));
        };
        if self.dirty(worktree)? {
            return Err(WorktreeError::Dirty.into());
        }
        let base_ref = format!("refs/heads/{}", worktree.base);
        let moved =
            || RpcError::conflict(format!("base_moved: {} is not checked out", worktree.base));
        let checked_out = self.run(project, &["symbolic-ref", "HEAD"]).ok();
        if checked_out.as_deref() != Some(&base_ref)
            || self.reference(project, &base_ref)?.is_none()
        {
            return Err(moved());
        }
        let before = self
            .run(&worktree.path, &["rev-parse", "HEAD"])
            .map_err(failed)?;
        let undo =
            |err: RpcError| match self.run(&worktree.path, &["reset", "--hard", "-q", &before]) {
                Ok(_) => {
                    let _ = self.run(&worktree.path, &["clean", "-fdq"]);
                    err
                }
                Err(reset) => failed(format!("{err}; could not restore the branch: {reset}")),
            };

        if let Err(err) = self.run(&worktree.path, &["rebase", &base_ref]) {
            let paths = self
                .run(&worktree.path, &["diff", "--name-only", "--diff-filter=U"])
                .unwrap_or_default();
            self.run(&worktree.path, &["rebase", "--abort"])
                .map_err(|abort| failed(format!("could not abort the rebase: {abort}")))?;
            return Err(if paths.is_empty() {
                failed(err)
            } else {
                RpcError::conflict(format!(
                    "landing_conflict: {}",
                    paths.lines().collect::<Vec<_>>().join(", ")
                ))
            });
        }

        let output = Command::new("sh")
            .current_dir(&worktree.path)
            .args(["-c", "exec 2>&1; eval \"$1\"", "sh", check])
            .stdin(Stdio::null())
            .output()
            .map_err(|err| undo(failed(err)))?;
        if !output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = text.lines().collect();
            let skip = lines.len().saturating_sub(20);
            let tail = lines
                .iter()
                .skip(skip)
                .copied()
                .collect::<Vec<_>>()
                .join("\n");
            return Err(undo(RpcError::conflict(format!("check_failed: {tail}"))));
        }
        if self.dirty(worktree).map_err(undo)? {
            return Err(undo(RpcError::conflict("check_failed: check left changes")));
        }

        let touched = self
            .run(
                project,
                &["diff", "--name-only", "-z", &base_ref, &worktree.branch],
            )
            .map_err(|err| undo(failed(err)))?;
        let touched: Vec<&str> = touched.split('\0').filter(|p| !p.is_empty()).collect();
        let status = self
            .run(
                project,
                &[
                    "--no-optional-locks",
                    "status",
                    "--porcelain",
                    "-z",
                    "--untracked-files=all",
                ],
            )
            .map_err(|err| undo(failed(err)))?;
        let mut entries = status.split('\0').filter(|e| !e.is_empty());
        while let Some(entry) = entries.next() {
            let path = entry.get(3..).unwrap_or_default();
            if matches!(entry.get(..1), Some("R" | "C")) {
                entries.next();
            }
            if touched.contains(&path) {
                return Err(undo(RpcError::conflict(format!(
                    "base_dirty: {path} has changes in the Project folder"
                ))));
            }
        }
        if self
            .run(project, &["merge", "--ff-only", "-q", &worktree.branch])
            .is_err()
        {
            return Err(undo(moved()));
        }
        self.run(project, &["rev-parse", &base_ref]).map_err(failed)
    }
}
