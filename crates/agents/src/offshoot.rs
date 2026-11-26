use super::*;
use crate::resume::Resumption;

impl Agents {
    /// U7191i: start a new Agent from `id`'s saved conversation as a new session, in the same
    /// Workstream and folder, placed right after `id`. `id` and its conversation are untouched.
    pub(super) async fn offshoot(&self, ctx: &Ctx, id: &str) -> Result<RailNode, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user forks a conversation"));
        }
        let stopped = match self.shared.runs().slot(id) {
            None | Some(Slot::Gone) => true,
            Some(Slot::Running(run)) => run.ended(),
            Some(_) => false,
        };
        if !stopped {
            return Err(RpcError::conflict(format!("{id} is not stopped")));
        }
        let (conversation, cwd, new) = {
            let mut rail = self.shared.rail();
            let source = rail.node(crate::rail::agent_id(id)?)?;
            if source.kind() != NodeKind::Agent {
                return Err(RpcError::conflict(format!("{id} is not an Agent")));
            }
            let Some((conversation, cwd)) = rail.conversation(crate::rail::agent_id(id)?)? else {
                return Err(RpcError::conflict(format!(
                    "{id} has no saved conversation"
                )));
            };
            let taken = rail
                .tree()?
                .into_iter()
                .filter(|node| node.parent == source.parent)
                .map(|node| node.base.name)
                .collect::<Vec<_>>();
            let name = name::unique(&source.base.name, taken.iter().map(String::as_str));
            let model = source.model();
            let effort = source.effort();
            let machine = source.machine();
            let new = rail.insert_agent(rail::NewAgent {
                name: &name,
                parent: source.parent.as_deref(),
                work: None,
                start_attribution: None,
                visibility: contracts::agent::RailVisibility::default(),
                spawn_prompt: None,
                spawner: None,
                role: None,
                model: model.as_deref(),
                effort: effort.as_deref(),
                mode_prompt: None,
                machine: machine.as_deref(),
            })?;
            rail.place_after(crate::rail::agent_id(&new.id)?, crate::rail::agent_id(id)?)?;
            (conversation, cwd, new)
        };
        ctx.emit(EventData::RailChanged);
        let resumed = self
            .resume_conversation(
                ctx,
                &new.id,
                Resumption {
                    ack_bound: RESUME_ACK_BOUND,
                    conversation: Some((&conversation, &cwd)),
                    fork: true,
                    prompt: None,
                    publication: RailPublication::Immediate,
                    mode: None,
                    permission_mode: None,
                    size: (80, 24),
                },
            )
            .await;
        match resumed {
            Ok(node) => Ok(node),
            Err(err) => {
                if err.code != rpc::code::UNKNOWN_OUTCOME {
                    // A failed fork leaves no row; the source is never touched.
                    let mut rail = self.shared.rail();
                    let mut runs = self.shared.runs();
                    runs.forget(&new.id);
                    self.shared.events.observed.notify_waiters();
                    report_undo(
                        "remove the failed offshoot from the Rail",
                        rail.remove(crate::rail::agent_id(&new.id)?),
                    );
                    drop((rail, runs));
                    ctx.emit(EventData::RailChanged);
                }
                Err(err)
            }
        }
    }
}
