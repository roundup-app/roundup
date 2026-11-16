//! U7186b: the endpoints a user compares and the file lists between any two. Reads only: a
//! worktree endpoint reads its working tree, a head endpoint the branch's commit.

use std::collections::BTreeSet;
use std::path::Path;

use contracts::agent::{
    ChangedFile, ChangedFiles, ChangedStatus, CompareEndpoint, CompareRef, CompareRefs,
    FileComparison,
};
use rpc::{RpcError, code};

use super::comparison::{file_content, read_worktree_file};
use super::{Git, failed, invalid};

fn endpoint_missing() -> RpcError {
    RpcError::new(code::NOT_FOUND, "endpoint_missing")
}

impl Git {
    /// Every git worktree's current state, then every branch head, each sorted by label.
    pub fn compare_refs(&self, project: &Path) -> Result<CompareRefs, RpcError> {
        let mut refs: Vec<CompareRef> = self
            .worktrees(project)?
            .into_iter()
            .map(|(path, branch)| CompareRef {
                label: format!("{branch} ({path})"),
                endpoint: CompareEndpoint::Worktree { path, branch },
            })
            .collect();
        refs.sort_by(|a, b| a.label.cmp(&b.label));
        let heads = self
            .run(
                project,
                &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
            )
            .map_err(failed)?;
        let mut heads: Vec<&str> = heads.lines().filter(|line| !line.is_empty()).collect();
        heads.sort_unstable();
        refs.extend(heads.into_iter().map(|branch| CompareRef {
            label: branch.to_owned(),
            endpoint: CompareEndpoint::Head {
                branch: branch.to_owned(),
            },
        }));
        Ok(CompareRefs { refs })
    }

    /// The files whose content differs between `from` and `to`, sorted by path, outside `.roundup/`.
    pub fn compare_endpoints(
        &self,
        project: &Path,
        from: &CompareEndpoint,
        to: &CompareEndpoint,
    ) -> Result<ChangedFiles, RpcError> {
        let (from, to) = (self.resolve(project, from)?, self.resolve(project, to)?);
        let mut paths: BTreeSet<String> = BTreeSet::new();
        for side in [&from, &to] {
            if let Some(dir) = &side.dir {
                paths.extend(
                    self.files_against(Path::new(dir), "HEAD")?
                        .into_iter()
                        .flat_map(|file| [Some(file.path), file.from])
                        .flatten(),
                );
            }
        }
        let names = self
            .run(
                project,
                &[
                    "diff",
                    "--no-ext-diff",
                    "-z",
                    "--name-only",
                    &from.rev,
                    &to.rev,
                ],
            )
            .map_err(failed)?;
        paths.extend(
            names
                .split('\0')
                .filter(|n| !n.is_empty())
                .map(str::to_owned),
        );
        let mut files = Vec::new();
        for path in paths {
            if path.starts_with(".roundup/") || path.split('/').any(|part| part == ".git") {
                continue;
            }
            let (old, new) = (self.read_side(&from, &path)?, self.read_side(&to, &path)?);
            if old == new {
                continue;
            }
            let status = match (&old, &new) {
                (None, _) => ChangedStatus::Added,
                (_, None) => ChangedStatus::Deleted,
                _ => ChangedStatus::Modified,
            };
            let line = match (&old, &new) {
                (_, Some(new)) if !new.contains(&0) => first_difference(old.as_deref(), new),
                _ => None,
            };
            files.push(ChangedFile {
                path,
                status,
                line,
                from: None,
            });
        }
        Ok(ChangedFiles { files })
    }

    /// One file's bytes on each side of a comparison.
    pub fn compare_endpoints_file(
        &self,
        project: &Path,
        from: &CompareEndpoint,
        to: &CompareEndpoint,
        path: &str,
    ) -> Result<FileComparison, RpcError> {
        if path.is_empty()
            || path.starts_with('/')
            || path.contains('\0')
            || path
                .split('/')
                .any(|part| matches!(part, "" | "." | ".." | ".git" | ".roundup"))
        {
            return Err(invalid("unsafe_path", "expected a relative file"));
        }
        let (from, to) = (self.resolve(project, from)?, self.resolve(project, to)?);
        let (old, new) = (self.read_side(&from, path)?, self.read_side(&to, path)?);
        if old.is_none() && new.is_none() {
            return Err(RpcError::new(code::NOT_FOUND, "file_missing"));
        }
        let status = match (&old, &new) {
            (None, _) => ChangedStatus::Added,
            (_, None) => ChangedStatus::Deleted,
            _ => ChangedStatus::Modified,
        };
        Ok(FileComparison {
            base: from.rev,
            old_path: path.to_owned(),
            new_path: path.to_owned(),
            status: Some(status),
            old: file_content(old),
            new: file_content(new),
        })
    }

    /// `(path, branch)` of each git worktree of the repository at `project`.
    fn worktrees(&self, project: &Path) -> Result<Vec<(String, String)>, RpcError> {
        let listing = self
            .run(project, &["worktree", "list", "--porcelain"])
            .map_err(failed)?;
        let mut worktrees = Vec::new();
        for block in listing.split("\n\n") {
            let mut path = None;
            let mut branch = None;
            for line in block.lines() {
                if let Some(value) = line.strip_prefix("worktree ") {
                    path = Some(value.to_owned());
                } else if let Some(value) = line.strip_prefix("branch ") {
                    branch = Some(value.trim_start_matches("refs/heads/").to_owned());
                } else if line == "detached" {
                    branch = Some("(detached)".to_owned());
                }
            }
            if let (Some(path), Some(branch)) = (path, branch) {
                worktrees.push((path, branch));
            }
        }
        Ok(worktrees)
    }

    /// The commit an endpoint stands on and, for a worktree, its directory. An endpoint the
    /// repository no longer lists fails `endpoint_missing`.
    fn resolve(&self, project: &Path, endpoint: &CompareEndpoint) -> Result<Side, RpcError> {
        match endpoint {
            CompareEndpoint::Head { branch } => {
                let rev = self
                    .run(
                        project,
                        &[
                            "rev-parse",
                            "--verify",
                            "--quiet",
                            &format!("refs/heads/{branch}^{{commit}}"),
                        ],
                    )
                    .map_err(|_| endpoint_missing())?;
                Ok(Side {
                    dir: None,
                    rev,
                    project: project.to_path_buf(),
                })
            }
            CompareEndpoint::Worktree { path, branch } => {
                let listed = self
                    .worktrees(project)?
                    .into_iter()
                    .any(|(listed, name)| listed == *path && name == *branch);
                if !listed || !Path::new(path).is_dir() {
                    return Err(endpoint_missing());
                }
                let rev = self
                    .run(Path::new(path), &["rev-parse", "HEAD"])
                    .map_err(failed)?;
                Ok(Side {
                    dir: Some(path.clone()),
                    rev,
                    project: project.to_path_buf(),
                })
            }
        }
    }

    fn read_side(&self, side: &Side, path: &str) -> Result<Option<Vec<u8>>, RpcError> {
        if let Some(dir) = &side.dir {
            return read_worktree_file(Path::new(dir), path);
        }
        // A missing path, a directory or a submodule has no blob: that side is absent.
        let object = format!("{}:{path}", side.rev);
        let output = self
            .output(&side.project, &["cat-file", "blob", &object], None)
            .map_err(failed)?;
        Ok(output.status.success().then_some(output.stdout))
    }
}

struct Side {
    dir: Option<String>,
    rev: String,
    project: std::path::PathBuf,
}

/// The 1-based first line of `new` that differs from `old`.
fn first_difference(old: Option<&[u8]>, new: &[u8]) -> Option<u32> {
    let old = old.unwrap_or_default();
    let at = new.iter().zip(old).take_while(|(a, b)| a == b).count();
    let line = new.iter().take(at).filter(|b| **b == b'\n').count();
    u32::try_from(line + 1).ok()
}
