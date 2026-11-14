//! The repository-local exclude of Worktree folders (G2).

use std::path::Path;

use super::Git;

/// Add `.roundup/` to `exclude` (the repository's `info/exclude`), once: it is local, so the
/// user's tracked files and `git status` do not change. The file is read and written where the
/// Project's folder is, through `git`'s one file path (MC32).
pub(super) fn exclude_worktrees(git: &Git, exclude: &Path) -> std::io::Result<()> {
    let existing = match git.read_file(exclude) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err),
    };
    if existing.lines().any(|line| line.trim() == ".roundup/") {
        return Ok(());
    }
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(".roundup/\n");
    git.write_file(exclude, text.as_bytes())
}
