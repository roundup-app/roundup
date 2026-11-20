//! CP6: the old side, a merge base exported once into `<cache>/call-paths/<commit>/`, written
//! whole (a temporary sibling renamed into place) and bounded to the last four.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::super::Git;

const KEEP: usize = 4;
const MARKER: &str = "complete";

impl Git {
    /// The export of `commit` under `cache`, made if absent. Reads the repository only.
    pub(super) fn export_commit(
        &self,
        repo: &Path,
        commit: &str,
        cache: &Path,
    ) -> Result<PathBuf, String> {
        let root = cache.join("call-paths");
        std::fs::create_dir_all(&root).map_err(|err| err.to_string())?;
        // One trace runs at a time, so a temporary directory is an interrupted export.
        for entry in std::fs::read_dir(&root)
            .map_err(|err| err.to_string())?
            .flatten()
        {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(".tmp-") || (!entry.path().join(MARKER).exists() && name != commit)
            {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
        let entry = root.join(commit);
        if entry.join(MARKER).exists() {
            // Touch the marker: the oldest marker is the first evicted.
            let _ = std::fs::write(entry.join(MARKER), "");
            return Ok(entry);
        }
        let _ = std::fs::remove_dir_all(&entry);
        let tmp = root.join(format!(".tmp-{commit}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).map_err(|err| err.to_string())?;
        self.archive(repo, commit, &tmp)?;
        std::fs::write(tmp.join(MARKER), "").map_err(|err| err.to_string())?;
        std::fs::rename(&tmp, &entry).map_err(|err| err.to_string())?;
        let mut kept: Vec<_> = std::fs::read_dir(&root)
            .map_err(|err| err.to_string())?
            .flatten()
            .filter_map(|e| {
                let time = e.path().join(MARKER).metadata().ok()?.modified().ok()?;
                Some((time, e.path()))
            })
            .collect();
        kept.sort();
        while kept.len() > KEEP {
            let (_, oldest) = kept.remove(0);
            let _ = std::fs::remove_dir_all(oldest);
        }
        Ok(entry)
    }

    /// `commit`'s tree extracted into `dest`: `git archive` into `tar`.
    pub(super) fn archive(&self, repo: &Path, commit: &str, dest: &Path) -> Result<(), String> {
        let mut archive = Command::new("git")
            .env("PATH", &self.path)
            .current_dir(repo)
            .args(["archive", "--format=tar", commit])
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|err| err.to_string())?;
        let status = Command::new("tar")
            .arg("-x")
            .arg("-C")
            .arg(dest)
            .stdin(archive.stdout.take().ok_or("no archive output")?)
            .status()
            .map_err(|err| err.to_string())?;
        let made = archive.wait().map_err(|err| err.to_string())?;
        if status.success() && made.success() {
            Ok(())
        } else {
            Err(format!("could not export {commit}"))
        }
    }
}

/// Each `node_modules` directory of `tree` linked at its path in `export`, so the old side
/// resolves packages through the new tree's. True when any was linked.
pub(super) fn link_dependencies(tree: &Path, export: &Path) -> bool {
    let mut linked = false;
    let mut stack = vec![(tree.to_owned(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if name == ".git" || name == "target" || !(kind.is_dir() || entry.path().is_dir()) {
                continue;
            }
            if name == "node_modules" {
                let rel = entry
                    .path()
                    .strip_prefix(tree)
                    .map(Path::to_owned)
                    .unwrap_or_default();
                let link = export.join(&rel);
                let same = std::fs::read_link(&link).is_ok_and(|to| to == entry.path());
                if !same {
                    let _ = std::fs::remove_dir_all(&link);
                    let _ = std::fs::remove_file(&link);
                    if let Some(parent) = link.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::os::unix::fs::symlink(entry.path(), &link);
                }
                linked = true;
            } else if depth < 4 {
                stack.push((entry.path(), depth + 1));
            }
        }
    }
    linked
}
