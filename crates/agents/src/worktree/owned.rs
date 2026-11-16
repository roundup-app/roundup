//! U7186a: what an Agent's recorded file writes leave changed, per repository and branch.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use contracts::agent::OwnedGroup;

use super::Git;

impl Git {
    /// One group per repository and branch the absolute `edits` sit in, sorted by repo then branch.
    /// A branch other than the default lists every file it changed against the merge base with the
    /// default branch; the default branch's checkout lists only edited files. A missing repository
    /// or an unreadable one is omitted. Runs no command that writes.
    pub fn owned_groups(&self, edits: &[String]) -> Vec<OwnedGroup> {
        let mut sites: BTreeMap<(PathBuf, PathBuf), BTreeSet<PathBuf>> = BTreeMap::new();
        for edit in edits {
            if let Some((top, rel)) = self.locate(Path::new(edit)) {
                let common = self.common_root(&top).unwrap_or_else(|| top.clone());
                sites.entry((common, top)).or_default().insert(rel);
            }
        }
        let mut groups = Vec::new();
        for ((repo, top), written) in sites {
            if let Some(group) = self.owned_group(&repo, &top, &written) {
                groups.push(group);
            }
        }
        groups.sort_by(|a, b| (&a.repo, &a.branch).cmp(&(&b.repo, &b.branch)));
        groups
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
    fn default_branch(&self, top: &Path) -> Option<(String, String)> {
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
        let mut files = self.files_against(top, &base).ok()?;
        if branch == default {
            files.retain(|file| written.contains(Path::new(&file.path)));
        }
        Some(OwnedGroup {
            repo: repo.display().to_string(),
            branch,
            base: default,
            files,
        })
    }
}
