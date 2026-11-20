//! G10-G12: start an Agent in a git worktree the user already works in. The user's pick is the
//! only way in: `agent.adopt` and `agent.adoptable` are no Agent tool, and a path is never chosen
//! by an Agent.

use std::path::{Path, PathBuf};

use contracts::agent::{AdoptParams, Adoptable, RailNode};
use rpc::RpcError;

use super::*;

/// Who asks to adopt: the user's pick, or the Project's program inside its directory (G13). The
/// Daemon knows the program by its credential (ST3) before it builds `Program`.
pub enum AdoptBy {
    User,
    Program { dir: PathBuf },
}

impl AdoptBy {
    fn dir(&self) -> Option<&Path> {
        match self {
            Self::User => None,
            Self::Program { dir } => Some(dir),
        }
    }
}

impl Agents {
    /// The directories an Agent or Terminal of this Rail works in, and those any node records.
    /// G15: for the program, a node of an ended Agent counts in neither.
    async fn adoption_claims(
        &self,
        by: &AdoptBy,
    ) -> Result<(Vec<PathBuf>, Vec<PathBuf>), RpcError> {
        let program = matches!(by, AdoptBy::Program { .. });
        let live: std::collections::HashSet<String> = self
            .shared
            .runs()
            .iter()
            .filter(|(_, agent)| match &agent.slot {
                Slot::Running(run) => !run.ended(),
                Slot::Gone => false,
                _ => true,
            })
            .map(|(id, _)| id.to_string())
            .collect();
        let mut recorded: Vec<PathBuf> = Vec::new();
        let mut taken: Vec<PathBuf> = Vec::new();
        for node in self.shared.rail().tree()? {
            let Some(worktree) = node.worktree() else {
                continue;
            };
            let path = PathBuf::from(worktree.path);
            if !program {
                recorded.push(path.clone());
            }
            if !program || live.contains(&node.id) {
                taken.push(path);
            }
        }
        let mut busy = taken;
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

    /// G10, G14: the rows the App's user sees, or only those inside the program's directory.
    pub async fn adoptable_by(&self, ctx: &Ctx, by: AdoptBy) -> Result<Vec<Adoptable>, RpcError> {
        if matches!(by, AdoptBy::User) {
            Self::require_user(ctx)?;
        }
        let (busy, recorded) = self.adoption_claims(&by).await?;
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        tokio::task::spawn_blocking(move || git.adoptable(&project, &busy, &recorded, by.dir()))
            .await
            .map_err(RpcError::internal)?
    }

    /// G10, G13: start an Agent in `params.path`, on the user's pick or the program's call.
    pub async fn adopt_by(
        &self,
        ctx: &Ctx,
        by: AdoptBy,
        params: AdoptParams,
    ) -> Result<RailNode, RpcError> {
        if matches!(by, AdoptBy::User) {
            Self::require_user(ctx)?;
        }
        let AdoptParams {
            path,
            branch,
            launch,
        } = params;
        let (busy, recorded) = self.adoption_claims(&by).await?;
        let (git, project) = (self.shared.git.bounded(), self.project_dir().to_owned());
        let checked = tokio::task::spawn_blocking({
            let path = PathBuf::from(&path);
            move || git.adopt_check(&project, &path, &branch, &busy, &recorded, by.dir())
        })
        .await
        .map_err(RpcError::internal)??;
        let spawn: contracts::agent::SpawnParams = serde_json::from_value(serde_json::json!({
            "cwd": checked.path.to_string_lossy(),
            "prompt": null,
        }))
        .map(
            |spawn: contracts::agent::SpawnParams| contracts::agent::SpawnParams {
                launch,
                ..spawn
            },
        )
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
            Ok(()) => self
                .run_agent(
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
                .map(drop),
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
