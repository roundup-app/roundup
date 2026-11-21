//! U7186a: what an Agent's recorded file writes leave changed, per repository and branch.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use contracts::agent::{CompareTarget, FileComparison, OwnedGroup, OwnedGroupKey};
use rpc::RpcError;

use super::{Git, invalid};

/// A repository's main checkout and the checkout of one of its git worktrees (`top`), keyed to the
/// files of `top` the Agent wrote, relative to it.
type Sites = BTreeMap<(PathBuf, PathBuf), BTreeSet<PathBuf>>;

impl Git {
    /// One group per repository and branch the absolute `edits` sit in, sorted by repo then branch.
    /// Each group lists only the edited files that now differ from the merge base with the remote's
    /// main (U7672b). A missing repository or an unreadable one is omitted. Runs no command that writes.
    pub fn owned_groups(&self, edits: &[String]) -> Vec<OwnedGroup> {
        let mut groups = Vec::new();
        for ((repo, top), written) in self.sites(edits) {
            if let Some(group) = self.owned_group(&repo, &top, &written) {
                groups.push(group);
            }
        }
        groups.sort_by(|a, b| (&a.repo, &a.branch).cmp(&(&b.repo, &b.branch)));
        groups
    }

    /// U7853a: `path` as `agent.compareFile` reads it for an Agent with no Worktree: in the checkout
    /// of the group `group` names, as Changes lists it, so `to` is never `Branch`. A group the
    /// `edits` do not sit in is refused whatever the caller names; no path of the caller is opened.
    pub fn compare_group_file(
        &self,
        edits: &[String],
        group: &OwnedGroupKey,
        path: &str,
        to: CompareTarget,
    ) -> Result<FileComparison, RpcError> {
        if to == CompareTarget::Branch {
            return Err(invalid(
                "group_target",
                "a group is read as Changes, not Branch",
            ));
        }
        let top = self
            .sites(edits)
            .into_keys()
            .find(|(repo, top)| {
                repo == Path::new(&group.repo)
                    && self
                        .run(top, &["rev-parse", "--abbrev-ref", "HEAD"])
                        .is_ok_and(|branch| branch == group.branch)
            })
            .map(|(_, top)| top)
            .ok_or_else(|| {
                invalid(
                    "unsafe_path",
                    "not a repository and branch the Agent wrote in",
                )
            })?;
        self.compare_file(&top, path, to)
    }

    /// Where the absolute `edits` sit: per (main checkout, git worktree) the files written there.
    fn sites(&self, edits: &[String]) -> Sites {
        let mut sites = Sites::new();
        for edit in edits {
            if let Some((top, rel)) = self.locate(Path::new(edit)) {
                let common = self.common_root(&top).unwrap_or_else(|| top.clone());
                sites.entry((common, top)).or_default().insert(rel);
            }
        }
        sites
    }

    /// The repository root holding `path` (canonical) and `path` relative to it.
    fn locate(&self, path: &Path) -> Option<(PathBuf, PathBuf)> {
        let name = path.file_name()?;
        let parent = path.ancestors().skip(1).find(|dir| dir.is_dir())?;
        let top = self
            .run(parent, &["rev-parse", "--show-toplevel"])
            .ok()
            .and_then(|top| std::fs::canonicalize(top).ok())?;
        let dir = std::fs::canonicalize(parent).ok()?;
        let rel = if parent == path.parent()? {
            dir.strip_prefix(&top).ok()?.join(name)
        } else {
            dir.strip_prefix(&top)
                .ok()?
                .join(path.strip_prefix(parent).ok()?)
        };
        Some((top, rel))
    }

    /// The main checkout of the repository `top` belongs to, shared by all its git worktrees.
    fn common_root(&self, top: &Path) -> Option<PathBuf> {
        let common = self
            .run(
                top,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )
            .ok()?;
        let common = std::fs::canonicalize(common).ok()?;
        (common.file_name()? == ".git")
            .then(|| common.parent().map(Path::to_path_buf))
            .flatten()
    }

    /// The repository's default branch: `origin/HEAD`, else `main`, else `master`.
    pub(super) fn default_branch(&self, top: &Path) -> Option<(String, String)> {
        if let Ok(full) = self.run(
            top,
            &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        ) && let Some(name) = full.strip_prefix("origin/")
            && self
                .run(top, &["rev-parse", "--verify", "--quiet", &full])
                .is_ok()
        {
            return Some((name.to_owned(), full));
        }
        ["main", "master"].iter().find_map(|name| {
            self.run(
                top,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/heads/{name}"),
                ],
            )
            .ok()
            .map(|_| ((*name).to_owned(), (*name).to_owned()))
        })
    }

    fn owned_group(
        &self,
        repo: &Path,
        top: &Path,
        written: &BTreeSet<PathBuf>,
    ) -> Option<OwnedGroup> {
        let branch = self.run(top, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
        let (default, reference) = self.default_branch(top)?;
        let base = self.run(top, &["merge-base", &reference, "HEAD"]).ok()?;
        let mut files = self.files_against(top, &base, None).ok()?;
        files.retain(|file| written.contains(Path::new(&file.path)));
        Some(OwnedGroup {
            repo: repo.display().to_string(),
            branch,
            base: default,
            files,
        })
    }
}
