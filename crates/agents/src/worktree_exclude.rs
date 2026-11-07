//! The repository-local exclude of Worktree folders (G2).

use std::path::Path;

/// Add `.roundup/` to `exclude` (the repository's `info/exclude`), once: it is local, so the
/// user's tracked files and `git status` do not change.
pub(super) fn exclude_worktrees(exclude: &Path) -> std::io::Result<()> {
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing = std::fs::read_to_string(exclude).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == ".roundup/") {
        return Ok(());
    }
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(".roundup/\n");
    std::fs::write(exclude, text)
}
