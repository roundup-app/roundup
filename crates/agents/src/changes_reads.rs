//! U7186a, U2540a: the reads the Changes view makes of an Agent's files: what it owns against its
//! default branch, and one file compared with its Base.

use super::*;
use crate::worktree::WorktreeError;
use contracts::agent::{CompareTarget, OwnedGroupKey};

impl Agents {
    /// U7186a: what the Agent's recorded file writes leave changed against the default branch.
    pub(super) async fn owned_changes(
        &self,
        id: &str,
    ) -> Result<contracts::agent::OwnedChanges, RpcError> {
        let edits = self.recorded_edits(id)?;
        let git = self.shared.git.bounded();
        let groups = tokio::task::spawn_blocking(move || git.owned_groups(&edits))
            .await
            .map_err(|err| RpcError::from(WorktreeError::Failed(err.to_string())))?;
        Ok(contracts::agent::OwnedChanges { groups })
    }

    /// The absolute paths the Agent's file-writing tool calls recorded.
    fn recorded_edits(&self, id: &str) -> Result<Vec<String>, RpcError> {
        self.shared.node(id)?;
        Ok(self
            .shared
            .runs()
            .agent(id)
            .map(|agent| agent.facts.edits.iter().cloned().collect())
            .unwrap_or_default())
    }

    /// U2540a: read one comparison within the assigned Worktree, or (U7853a) within the checkout
    /// of the owned `group`, which an Agent with no Worktree is read through.
    pub(super) async fn compare_file(
        &self,
        id: &str,
        path: &str,
        to: CompareTarget,
        group: Option<OwnedGroupKey>,
    ) -> Result<contracts::agent::FileComparison, RpcError> {
        let git = self.shared.git.bounded();
        let path = path.to_owned();
        let read = match group {
            Some(group) => {
                let edits = self.recorded_edits(id)?;
                tokio::task::spawn_blocking(move || {
                    git.compare_group_file(&edits, &group, &path, to)
                })
                .await
            }
            None => {
                let record =
                    self.shared.node(id)?.worktree().ok_or_else(|| {
                        RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}"))
                    })?;
                let worktree = worktree::Worktree::from(&record);
                tokio::task::spawn_blocking(move || git.compare_file(&worktree.path, &path, to))
                    .await
            }
        };
        read.map_err(|err| RpcError::from(WorktreeError::Failed(err.to_string())))?
    }
}
