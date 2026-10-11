//! A35: a Mark's snapshot of an Agent's working files, kept as a commit under
//! `refs/roundup/marks/`, and the return of a Worktree to one. No branch, `HEAD` or remote moves,
//! and the Worktree's own index is read, never written.

use std::path::{Path, PathBuf};

use rpc::RpcError;

use crate::worktree::{Git, Worktree};

/// How many paths one `git checkout-index` is asked for.
const CHUNK: usize = 200;

fn failed(detail: impl std::fmt::Display) -> RpcError {
    RpcError::internal(format!("worktree_failed: {detail}"))
}

/// The tree of every tracked and every untracked, not ignored, file of `worktree` now, written
/// through a copy of its index.
fn tree_now(git: &Git, worktree: &Worktree) -> Result<String, RpcError> {
    let dir = worktree.path.as_path();
    let index = git
        .run_env(
            dir,
            &[],
            &["rev-parse", "--path-format=absolute", "--git-path", "index"],
        )
        .map_err(failed)?;
    let copy = PathBuf::from(format!("{index}.roundup-mark"));
    let _ = std::fs::remove_file(&copy);
    if Path::new(&index).is_file() {
        std::fs::copy(&index, &copy).map_err(failed)?;
    }
    let env = [("GIT_INDEX_FILE", copy.as_os_str())];
    let tree = git
        .run_env(dir, &env, &["add", "-A", "--", ".", ":(exclude).roundup"])
        .and_then(|_| git.run_env(dir, &env, &["write-tree"]));
    let _ = std::fs::remove_file(&copy);
    tree.map_err(failed)
}

/// Every `-z` field of `output`.
fn fields(output: &str) -> Vec<&str> {
    output.split('\0').filter(|f| !f.is_empty()).collect()
}

impl Git {
    /// Keep a snapshot of `worktree`'s working files under the reference `name`; returns the
    /// commit that holds it.
    pub fn snapshot(&self, worktree: &Worktree, name: &str) -> Result<String, RpcError> {
        let tree = tree_now(self, worktree)?;
        let identity = [
            ("GIT_AUTHOR_NAME", "roundup".as_ref()),
            ("GIT_AUTHOR_EMAIL", "roundup@localhost".as_ref()),
            ("GIT_COMMITTER_NAME", "roundup".as_ref()),
            ("GIT_COMMITTER_EMAIL", "roundup@localhost".as_ref()),
        ];
        let commit = self
            .run_env(
                &worktree.path,
                &identity,
                &["commit-tree", &tree, "-m", "roundup mark"],
            )
            .map_err(failed)?;
        let reference = format!("refs/roundup/marks/{name}");
        self.run_env(&worktree.path, &[], &["update-ref", &reference, &commit])
            .map_err(failed)?;
        Ok(commit)
    }

    /// Drop the reference `name` of a snapshot; one already gone is not an error.
    pub fn forget_snapshot(&self, project: &Path, name: &str) {
        let reference = format!("refs/roundup/marks/{name}");
        if let Err(error) = self.run_env(project, &[], &["update-ref", "-d", &reference]) {
            eprintln!("agents: could not drop {reference}: {error}");
        }
    }

    /// The paths whose content differs between `snapshot` and `worktree` now, sorted.
    pub fn changed_since(
        &self,
        worktree: &Worktree,
        snapshot: &str,
    ) -> Result<Vec<String>, RpcError> {
        let now = tree_now(self, worktree)?;
        let kept = format!("{snapshot}^{{tree}}");
        let out = self
            .run_env(
                &worktree.path,
                &[],
                &[
                    "diff-tree",
                    "-r",
                    "--name-only",
                    "--no-renames",
                    "-z",
                    &kept,
                    &now,
                ],
            )
            .map_err(failed)?;
        let mut paths: Vec<String> = fields(&out).into_iter().map(str::to_owned).collect();
        paths.sort();
        Ok(paths)
    }

    /// Set the working files of `worktree` to `snapshot`: a changed file takes its old content,
    /// a file created since is removed and a file deleted since returns.
    pub fn restore(&self, worktree: &Worktree, snapshot: &str) -> Result<(), RpcError> {
        let now = tree_now(self, worktree)?;
        let kept = format!("{snapshot}^{{tree}}");
        let dir = worktree.path.as_path();
        let out = self
            .run_env(
                dir,
                &[],
                &[
                    "diff-tree",
                    "-r",
                    "--name-status",
                    "--no-renames",
                    "-z",
                    &kept,
                    &now,
                ],
            )
            .map_err(failed)?;
        let fields = fields(&out);
        let (mut added, mut back) = (Vec::new(), Vec::new());
        for pair in fields.chunks(2) {
            let [status, path] = pair else { continue };
            if *status == "A" {
                added.push(*path);
            } else {
                back.push(*path);
            }
        }
        for path in added {
            let file = dir.join(path);
            if std::fs::symlink_metadata(&file).is_ok_and(|m| m.is_dir()) {
                continue;
            }
            match std::fs::remove_file(&file) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(failed(error)),
            }
            let mut parent = file.parent();
            while let Some(folder) = parent.filter(|folder| *folder != dir) {
                if std::fs::remove_dir(folder).is_err() {
                    break;
                }
                parent = folder.parent();
            }
        }
        if back.is_empty() {
            return Ok(());
        }
        let index = self
            .run_env(
                dir,
                &[],
                &["rev-parse", "--path-format=absolute", "--git-path", "index"],
            )
            .map_err(failed)?;
        let copy = PathBuf::from(format!("{index}.roundup-restore"));
        let _ = std::fs::remove_file(&copy);
        let env = [("GIT_INDEX_FILE", copy.as_os_str())];
        let restored = self
            .run_env(dir, &env, &["read-tree", &kept])
            .and_then(|_| {
                back.chunks(CHUNK).try_for_each(|paths| {
                    let mut args = vec!["checkout-index", "-f", "--"];
                    args.extend(paths);
                    self.run_env(dir, &env, &args).map(|_| ())
                })
            });
        let _ = std::fs::remove_file(&copy);
        restored.map_err(failed)
    }
}
