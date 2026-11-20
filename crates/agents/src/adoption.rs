//! G10-G12: start an Agent in a git worktree the user already works in. The user's pick is the
//! only way in: `agent.adopt` and `agent.adoptable` are no Agent tool, and a path is never chosen
//! by an Agent.

use std::path::{Path, PathBuf};

use contracts::agent::{AdoptParams, Adoptable, RailNode};
use rpc::RpcError;

use super::*;

impl Agents {
    /// The directories an Agent or Terminal of this Rail works in, and those any node records.
    async fn adoption_claims(&self) -> Result<(Vec<PathBuf>, Vec<PathBuf>), RpcError> {
        let recorded: Vec<PathBuf> = self
            .shared
            .rail()
            .tree()?
            .iter()
            .filter_map(|node| node.worktree())
            .map(|worktree| PathBuf::from(worktree.path))
            .collect();
        let mut busy = recorded.clone();
        busy.extend(
            self.shared
                .terminals
                .list()
                .await
                .into_iter()
                .filter(|info| info.running)
                .map(|info| PathBuf::from(info.cwd)),
        );
        Ok((busy, recorded))
    }

    fn require_user(ctx: &Ctx) -> Result<(), RpcError> {
        if ctx.actor.kind == ActorKind::User {
            Ok(())
        } else {
            Err(RpcError::forbidden(
                "only the user's own pick adopts a worktree",
            ))
        }
    }

    pub(super) async fn adoptable(&self, ctx: &Ctx) -> Result<Vec<Adoptable>, RpcError> {
        Self::require_user(ctx)?;
        let (busy, recorded) = self.adoption_claims().await?;
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        tokio::task::spawn_blocking(move || git.adoptable(&project, &busy, &recorded))
            .await
            .map_err(RpcError::internal)?
    }

    pub(super) async fn adopt(&self, ctx: &Ctx, params: AdoptParams) -> Result<RailNode, RpcError> {
        Self::require_user(ctx)?;
        let AdoptParams {
            path,
            branch,
            parent,
        } = params;
        let (busy, recorded) = self.adoption_claims().await?;
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let checked = tokio::task::spawn_blocking({
            let path = PathBuf::from(&path);
            move || git.adopt_check(&project, &path, &branch, &busy, &recorded)
        })
        .await
        .map_err(RpcError::internal)??;
        let spawn: contracts::agent::SpawnParams = serde_json::from_value(serde_json::json!({
            "cwd": checked.path.to_string_lossy(),
            "prompt": null,
            "parent": parent,
        }))
        .map_err(RpcError::internal)?;
        let request = self.spawn_request(ctx, spawn)?;
        let (id, attempt) = self.insert_spawned(&request)?;
        let record = contracts::agent::Worktree {
            path: checked.path.to_string_lossy().into_owned(),
            branch: checked.branch.clone(),
            base: checked.base.clone(),
            adopted: true,
        };
        let recorded = self
            .shared
            .rail()
            .set_worktree(crate::rail::agent_id(&id)?, &record);
        ctx.emit(EventData::RailChanged);
        let started = match recorded {
            Ok(()) => {
                self.run_agent(
                    Launch {
                        id: &id,
                        attempt: &attempt,
                        cwd: Path::new(&record.path),
                        origin: Origin::Fresh,
                        attach: Attach::Now,
                        permission: request.permission,
                        size: request.size,
                    },
                    None,
                    true,
                )
                .await
                .map(drop)
            }
            Err(err) => Err(RpcError::from(err)),
        };
        if let Err(err) = started {
            // G12: a failed start removes the node only; git's side is never touched.
            let mut rail = self.shared.rail();
            let mut runs = self.shared.runs();
            runs.forget(&id);
            self.shared.events.observed.notify_waiters();
            report_undo(
                "remove the adopting Agent from the Rail",
                rail.remove(crate::rail::agent_id(&id)?),
            );
            drop((rail, runs));
            ctx.emit(EventData::RailChanged);
            return Err(err);
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(&id)
    }
}
