use super::*;
use crate::worktree::WorktreeError;

impl Agents {
    /// The Agent's repository: its own Worktree's folder, else the Project's (U7693).
    fn repo_of(&self, id: &str) -> Result<std::path::PathBuf, RpcError> {
        let node = self.shared.node(id)?;
        Ok(node
            .worktree()
            .map_or_else(|| self.project_dir().to_owned(), |w| w.path.into()))
    }

    /// U7693a: one `ls-remote`, off the async runtime.
    pub(super) async fn remote_main(
        &self,
        id: &str,
    ) -> Result<contracts::agent::RemoteMain, RpcError> {
        let (git, repo) = (self.shared.git.clone(), self.repo_of(id)?);
        tokio::task::spawn_blocking(move || git.remote_main(&repo))
            .await
            .map_err(|err| RpcError::from(WorktreeError::Failed(err.to_string())))?
    }

    /// U7693b: fetch the remote's main alone, off the async runtime.
    pub(super) async fn fetch_remote_main(
        &self,
        id: &str,
    ) -> Result<contracts::agent::FetchedMain, RpcError> {
        let (git, repo) = (self.shared.git.clone(), self.repo_of(id)?);
        tokio::task::spawn_blocking(move || git.fetch_remote_main(&repo))
            .await
            .map_err(|err| RpcError::from(WorktreeError::Failed(err.to_string())))?
    }
}
