use rpc::{RpcError, code};

/// RB3798c: every way a Worktree call fails. The wire code and the message prefix are one value
/// here, built once in `From<WorktreeError> for RpcError`.
#[derive(Debug, thiserror::Error)]
pub(crate) enum WorktreeError {
    /// The Worktree directory (or the saved cwd that stood in for it) is gone.
    #[error("worktree_missing: {0}")]
    Missing(String),
    #[error("worktree_branch_missing: {0}")]
    BranchMissing(String),
    #[error("worktree_mismatched: registered to another branch")]
    Mismatched,
    #[error("worktree_detached: no branch checked out")]
    Detached,
    #[error("worktree_unregistered")]
    Unregistered,
    #[error("worktree_unlanded: dirty {dirty}, ahead {ahead}")]
    Unlanded { dirty: usize, ahead: u64 },
    #[error("worktree_dirty: the Worktree has changes")]
    Dirty,
    #[error("worktree_failed: {0}")]
    Failed(String),
}

impl From<WorktreeError> for RpcError {
    fn from(err: WorktreeError) -> Self {
        let message = err.to_string();
        match err {
            WorktreeError::Missing(_) => RpcError::new(code::NOT_FOUND, message),
            WorktreeError::Failed(_) => RpcError::internal(message),
            WorktreeError::BranchMissing(_)
            | WorktreeError::Mismatched
            | WorktreeError::Detached
            | WorktreeError::Unregistered
            | WorktreeError::Unlanded { .. }
            | WorktreeError::Dirty => RpcError::conflict(message),
        }
    }
}
