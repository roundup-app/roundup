//! U7186a, U2540a: the reads the Changes view makes of an Agent's files: what it owns against its
//! default branch, and one file compared with its Base.

use super::*;
use crate::worktree::WorktreeError;
use contracts::agent::CompareTarget;

impl Agents {
    /// U7186a: what the Agent's recorded file writes leave changed against the default branch.
    pub(super) async fn owned_changes(
        &self,
        id: &str,
    ) -> Result<contracts::agent::OwnedChanges, RpcError> {
        self.shared.node(id)?;
        let edits: Vec<String> = self
            .shared
            .runs()
            .agent(id)
            .map(|agent| agent.facts.edits.iter().cloned().collect())
            .unwrap_or_default();
        let git = self.shared.git.bounded();
        let groups = tokio::task::spawn_blocking(move || git.owned_groups(&edits))
            .await
            .map_err(|err| RpcError::from(WorktreeError::Failed(err.to_string())))?;
        Ok(contracts::agent::OwnedChanges { groups })
    }

    /// U2540a: read one comparison within the assigned Worktree.
    pub(super) async fn compare_file(
        &self,
        id: &str,
        path: &str,
        to: CompareTarget,
    ) -> Result<contracts::agent::FileComparison, RpcError> {
        let record = self
            .shared
            .node(id)?
            .worktree()
            .ok_or_else(|| RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")))?;
        let git = self.shared.git.bounded();
        let worktree = worktree::Worktree::from(&record);
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || git.compare_file(&worktree, &path, to))
            .await
            .map_err(|err| RpcError::from(WorktreeError::Failed(err.to_string())))?
    }
}
