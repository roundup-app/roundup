//! FB7: the commit the App is stamped with, and the git files whose change moves it. Shared by
//! `build.rs` and its test, which include it by path.

use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()
        .filter(|out| out.status.success())?;
    Some(String::from_utf8(out.stdout).ok()?.trim().to_owned())
}

/// `git rev-parse --short=12 HEAD` in `dir`; empty outside a git checkout.
pub fn stamp(dir: &Path) -> String {
    git(dir, &["rev-parse", "--short=12", "HEAD"]).unwrap_or_default()
}

fn git_path(dir: &Path, name: &str) -> Option<PathBuf> {
    let path = PathBuf::from(git(dir, &["rev-parse", "--git-path", name])?);
    Some(if path.is_absolute() {
        path
    } else {
        dir.join(path)
    })
}

/// The paths Cargo watches: HEAD of this checkout or worktree, the ref HEAD names, and the packed
/// refs a moved ref may live in. Cargo reruns on every build for a watched path that is missing, so
/// each path exists: a loose ref that a packed branch lacks is watched as its nearest existing
/// directory, whose change time moves when a commit creates the file.
pub fn rerun_paths(dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = git_path(dir, "HEAD").into_iter().collect();
    if paths.is_empty() {
        return paths;
    }
    if let Some(head_ref) = git(dir, &["symbolic-ref", "-q", "HEAD"])
        && let Some(loose) = git_path(dir, &head_ref)
    {
        paths.extend(
            loose
                .ancestors()
                .find(|path| path.exists())
                .map(Path::to_path_buf),
        );
    }
    paths.extend(git_path(dir, "packed-refs").filter(|path| path.exists()));
    paths
}
