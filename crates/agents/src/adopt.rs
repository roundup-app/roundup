//! G10, G11: `agent.adoptable` and `agent.adopt`, the user's consent to start an Agent in a
//! worktree of the Project that the user made (`scenarios/worktrees.md`).

use contracts::agent::{AdoptParams, AdoptableList, RailNode, SpawnParams};

use super::*;

impl Agents {
    /// G10: every worktree of the Project's repository but the primary checkout, with the first
    /// reason it cannot be adopted. Reads only.
    pub(super) async fn adoptable(&self) -> Result<AdoptableList, RpcError> {
        let claims = self.claims().await?;
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let rows = tokio::task::spawn_blocking(move || git.adoptable(&project, &claims))
            .await
            .map_err(RpcError::internal)??;
        Ok(AdoptableList { rows })
    }

    /// G10, G11: start an Agent in the worktree at `path`, which must still have `branch`
    /// checked out. The worktree is never changed.
    pub(super) async fn adopt(&self, ctx: &Ctx, params: AdoptParams) -> Result<RailNode, RpcError> {
        let AdoptParams { path, branch } = params;
        let claims = self.claims().await?;
        let (git, project, at, named) = (
            self.shared.git.bounded(),
            self.project_dir().to_owned(),
            PathBuf::from(&path),
            branch.clone(),
        );
        let worktree =
            tokio::task::spawn_blocking(move || git.adoption(&project, &claims, &at, &named))
                .await
                .map_err(RpcError::internal)??;
        self.launcher.trust_adopted(&worktree.path);
        let record = contracts::agent::Worktree {
            path: worktree.path.to_string_lossy().into_owned(),
            branch: worktree.branch,
            base: worktree.base,
            adopted: true,
        };
        let params = SpawnParams {
            start_attribution: None,
            visibility: None,
            cols: None,
            rows: None,
            permission_mode: None,
            engine: None,
            machine: None,
            cwd: record.path.clone(),
            prompt: None,
            parent: None,
            role: None,
            order: None,
            name: Some(branch.chars().take(name::MAX_CHARS).collect()),
            app_named: Some(true),
            model: None,
            effort: None,
            scout: None,
            extras: None,
        };
        let node = self
            .spawn_with(ctx, params, None, Some(&record))
            .await
            .inspect_err(|_| self.launcher.forget_adopted(&worktree.path))?;
        Ok(node)
    }

    /// What the Rail already holds: every node's Worktree path and every running Terminal's
    /// working directory.
    async fn claims(&self) -> Result<worktree::Claims, RpcError> {
        let recorded = self
            .shared
            .rail()
            .worktree_paths()?
            .into_iter()
            .map(PathBuf::from)
            .collect();
        let cwds = self
            .shared
            .terminals
            .list()
            .await
            .into_iter()
            .filter(|terminal| terminal.running)
            .map(|terminal| PathBuf::from(terminal.cwd))
            .collect();
        Ok(worktree::Claims { recorded, cwds })
    }
}
