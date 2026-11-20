//! G10/G11: the user's own git worktrees an Agent may start in. Reads only: nothing here writes a
//! ref, a file or git's worktree list.

use std::path::{Path, PathBuf};

use contracts::agent::Adoptable;
use rpc::{RpcError, code};

use super::{Git, Worktree, canonical_path, failed, invalid};

/// A directory (or git's own state in it) that means a merge, rebase, cherry-pick, revert or bisect
/// is running.
const OPERATION_STATE: [&str; 7] = [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "index.lock",
];

struct Listed {
    path: PathBuf,
    branch: Option<String>,
}

impl Git {
    /// Every worktree git lists for the Project's repository, the primary checkout first.
    fn listed(&self, project: &Path) -> Result<Vec<Listed>, RpcError> {
        let listing = self
            .run(project, &["worktree", "list", "--porcelain", "-z"])
            .map_err(failed)?;
        Ok(listing
            .split("\0\0")
            .filter_map(|record| {
                let path = record
                    .split('\0')
                    .find_map(|value| value.strip_prefix("worktree "))?;
                let branch = record
                    .split('\0')
                    .find_map(|value| value.strip_prefix("branch refs/heads/"))
                    .map(str::to_owned);
                Some(Listed {
                    path: self.listed_path(Path::new(path)),
                    branch,
                })
            })
            .collect())
    }

    /// G10: a row for each listed worktree but the primary checkout. `busy` holds the directories
    /// an Agent or Terminal of this Rail works in; `recorded` those any Agent's node records.
    pub fn adoptable(
        &self,
        project: &Path,
        busy: &[PathBuf],
        recorded: &[PathBuf],
    ) -> Result<Vec<Adoptable>, RpcError> {
        let base = self.adoption_base(project)?;
        self.listed(project)?
            .into_iter()
            .skip(1)
            .map(|entry| {
                let refusal = self.refusal(&entry, busy, recorded);
                let (ahead, dirty) = match (&entry.branch, self.exists(&entry.path)) {
                    (Some(branch), true) => (
                        self.ahead_of(project, &base, branch).unwrap_or(0),
                        self.dirty_at(&entry.path).unwrap_or(false),
                    ),
                    _ => (0, false),
                };
                Ok(Adoptable {
                    path: entry.path.to_string_lossy().into_owned(),
                    branch: entry.branch,
                    ahead,
                    dirty,
                    refusal: refusal.map(str::to_owned),
                })
            })
            .collect()
    }

    /// G10: the Worktree `agent.adopt {path, branch}` starts an Agent in, or the refusal. Changes
    /// nothing. The Base is the Project's now, recorded once (G11).
    pub fn adopt_check(
        &self,
        project: &Path,
        path: &Path,
        branch: &str,
        busy: &[PathBuf],
        recorded: &[PathBuf],
    ) -> Result<Worktree, RpcError> {
        let listed = self.listed(project)?;
        let path = self.listed_path(path);
        let Some(position) = listed.iter().position(|entry| entry.path == path) else {
            return Err(if self.in_other_repository(project, &path) {
                invalid("other_repository", path.display())
            } else {
                invalid("not_registered", path.display())
            });
        };
        if position == 0 {
            return Err(invalid("primary_checkout", path.display()));
        }
        let entry = &listed[position];
        if let Some(refusal) = self.refusal(entry, busy, recorded) {
            return Err(refusal_error(refusal, &path));
        }
        if entry.branch.as_deref() != Some(branch) {
            return Err(RpcError::conflict(format!(
                "adopt_stale: {} is not on {branch} now",
                path.display()
            )));
        }
        let base = self.adoption_base(project)?;
        Ok(Worktree {
            path,
            branch: branch.to_owned(),
            base,
            adopted: true,
        })
    }

    fn adoption_base(&self, project: &Path) -> Result<String, RpcError> {
        self.run(project, &["symbolic-ref", "--short", "HEAD"])
            .map_err(|err| {
                if self.check_deadline().is_err() {
                    failed(err)
                } else {
                    invalid("no_base", "HEAD is detached")
                }
            })
    }

    fn refusal(
        &self,
        entry: &Listed,
        busy: &[PathBuf],
        recorded: &[PathBuf],
    ) -> Option<&'static str> {
        let owned = entry
            .branch
            .as_deref()
            .is_some_and(|branch| branch.starts_with("roundup/agent-"))
            || recorded
                .iter()
                .any(|path| canonical_path(path) == entry.path);
        if owned {
            return Some("owned_branch");
        }
        if entry.branch.is_none() {
            return Some("detached_head");
        }
        if !self.exists(&entry.path) {
            return Some("worktree_missing");
        }
        if self.operation_in_progress(&entry.path) {
            return Some("operation_in_progress");
        }
        if self.is_enrolled(&entry.path)
            || busy.iter().any(|path| canonical_path(path) == entry.path)
        {
            return Some("worktree_in_use");
        }
        None
    }

    fn operation_in_progress(&self, dir: &Path) -> bool {
        OPERATION_STATE.iter().any(|name| {
            self.run(dir, &["rev-parse", "--git-path", name])
                .is_ok_and(|found| {
                    let found = Path::new(found.trim());
                    let found = if found.is_absolute() {
                        found.to_owned()
                    } else {
                        dir.join(found)
                    };
                    self.exists(&found)
                })
        })
    }

    fn in_other_repository(&self, project: &Path, path: &Path) -> bool {
        let common = |dir: &Path| {
            self.run(
                dir,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )
            .ok()
            .map(|dir| canonical_path(Path::new(dir.trim())))
        };
        self.exists(path)
            && match (common(path), common(project)) {
                (Some(theirs), Some(ours)) => theirs != ours,
                (Some(_), None) => true,
                _ => false,
            }
    }

    fn ahead_of(&self, project: &Path, base: &str, branch: &str) -> Option<u32> {
        let range = format!("{base}..refs/heads/{branch}");
        self.run(project, &["rev-list", "--count", &range])
            .ok()?
            .trim()
            .parse()
            .ok()
    }

    fn dirty_at(&self, dir: &Path) -> Result<bool, RpcError> {
        self.dirty(&Worktree {
            path: dir.to_owned(),
            branch: String::new(),
            base: String::new(),
            adopted: true,
        })
    }
}

fn refusal_error(refusal: &str, path: &Path) -> RpcError {
    match refusal {
        "worktree_missing" => RpcError::new(
            code::NOT_FOUND,
            format!("worktree_missing: {}", path.display()),
        ),
        "worktree_in_use" => RpcError::conflict(format!("worktree_in_use: {}", path.display())),
        name => invalid(name, path.display()),
    }
}
