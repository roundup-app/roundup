//! G10, G11: the worktrees of the Project's repository an Agent may be started in. Every command
//! here reads: adoption runs no `checkout`, `switch`, `reset`, `stash`, `clean` or `worktree add`
//! and writes no ref (`scenarios/worktrees.md`).

use std::path::{Path, PathBuf};

use contracts::agent::Adoptable;
use rpc::RpcError;

use super::{Git, Worktree, canonical_path, failed, invalid};

/// The branch prefix of roundup's own Worktrees.
const OWNED_PREFIX: &str = "roundup/agent-";

/// Git's per-worktree names that show an operation under way.
const OPERATIONS: [&str; 7] = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
    "index.lock",
];

/// What the Rail already holds, which the Daemon reads before it asks git.
#[derive(Default)]
pub struct Claims {
    /// The path of every node's Worktree, whatever its state.
    pub recorded: Vec<PathBuf>,
    /// The working directory of every Terminal that is running.
    pub cwds: Vec<PathBuf>,
}

struct Listed {
    path: PathBuf,
    branch: Option<String>,
}

impl Git {
    /// G10: one row for each worktree git lists for the Project's repository, except the primary
    /// checkout. Reads only.
    pub fn adoptable(&self, project: &Path, claims: &Claims) -> Result<Vec<Adoptable>, RpcError> {
        let listed = self.listed(project)?;
        let primary = self.primary(project, &listed);
        let mut rows = Vec::new();
        for entry in listed.iter().filter(|entry| !primary.contains(&entry.path)) {
            rows.push(self.row(project, claims, entry)?);
        }
        Ok(rows)
    }

    /// G10, G11: the Worktree an adoption of `path` on `branch` records, or the refusal. The Base
    /// is the Project's branch now, recorded once.
    pub fn adoption(
        &self,
        project: &Path,
        claims: &Claims,
        path: &Path,
        branch: &str,
    ) -> Result<Worktree, RpcError> {
        self.refuse_in_fork()?;
        let listed = self.listed(project)?;
        let wanted = self.listed_path(path);
        if self.primary(project, &listed).contains(&wanted) {
            return Err(invalid("primary_checkout", path.display()));
        }
        let Some(entry) = listed.iter().find(|entry| entry.path == wanted) else {
            if self.other_repository(project, path) {
                return Err(invalid("other_repository", path.display()));
            }
            return Err(invalid("not_registered", path.display()));
        };
        if entry.branch.as_deref() != Some(branch) {
            return Err(RpcError::conflict(format!(
                "adopt_stale: {} is not on {branch} now",
                path.display()
            )));
        }
        let row = self.row(project, claims, entry)?;
        if let Some(refusal) = row.refusal {
            return Err(refusal_error(&refusal, path));
        }
        let base = self
            .run(project, &["symbolic-ref", "--short", "HEAD"])
            .map_err(|_| invalid("no_base", "HEAD is detached"))?;
        Ok(Worktree {
            path: PathBuf::from(&row.path),
            branch: branch.to_owned(),
            base,
            adopted: true,
        })
    }

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

    /// The repository's main worktree, and the Project's own folder.
    fn primary(&self, project: &Path, listed: &[Listed]) -> Vec<PathBuf> {
        listed
            .first()
            .map(|entry| entry.path.clone())
            .into_iter()
            .chain([self.listed_path(project)])
            .collect()
    }

    fn row(&self, project: &Path, claims: &Claims, entry: &Listed) -> Result<Adoptable, RpcError> {
        let exists = self.is_dir(&entry.path);
        let branch = entry.branch.clone().unwrap_or_default();
        let ahead = match &entry.branch {
            Some(branch) => {
                let range = format!("HEAD..refs/heads/{branch}");
                self.run(project, &["rev-list", "--count", &range])
                    .map_err(failed)?
                    .parse()
                    .map_err(failed)?
            }
            None => 0,
        };
        let dirty = exists
            && self.dirty(&Worktree {
                path: entry.path.clone(),
                branch: branch.clone(),
                base: String::new(),
                adopted: true,
            })?;
        let refusal = if branch.starts_with(OWNED_PREFIX)
            || claims.recorded.iter().any(|path| canonical_path(path) == entry.path)
        {
            Some("owned_branch")
        } else if entry.branch.is_none() {
            Some("detached_head")
        } else if exists && self.operation_in_progress(&entry.path)? {
            Some("operation_in_progress")
        } else if !exists {
            Some("worktree_missing")
        } else if claims.cwds.iter().any(|cwd| canonical_path(cwd) == entry.path)
            || self.is_enrolled(&entry.path)
        {
            Some("worktree_in_use")
        } else {
            None
        };
        Ok(Adoptable {
            path: entry.path.to_string_lossy().into_owned(),
            branch,
            ahead,
            dirty,
            refusal: refusal.map(str::to_owned),
        })
    }

    fn operation_in_progress(&self, dir: &Path) -> Result<bool, RpcError> {
        let git_dir = self
            .run(dir, &["rev-parse", "--absolute-git-dir"])
            .map_err(failed)?;
        Ok(OPERATIONS
            .iter()
            .any(|name| self.exists(&Path::new(&git_dir).join(name))))
    }

    /// Whether `path` is a work tree of some other repository than the Project's.
    fn other_repository(&self, project: &Path, path: &Path) -> bool {
        let common = |dir: &Path| {
            self.run(
                dir,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )
            .ok()
            .map(|common| self.listed_path(Path::new(&common)))
        };
        self.is_dir(path)
            && common(path).is_some_and(|other| common(project).is_some_and(|ours| ours != other))
    }
}

fn refusal_error(refusal: &str, path: &Path) -> RpcError {
    match refusal {
        "worktree_missing" => super::WorktreeError::Missing(path.display().to_string()).into(),
        "worktree_in_use" => RpcError::conflict(format!("worktree_in_use: {}", path.display())),
        name => invalid(name, path.display()),
    }
}
