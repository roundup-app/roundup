//! M7, M13, M14: what an Agent caller may reach, read or route, and the one path that types
//! bytes into a Terminal. The user's own questions and permission prompts stay in the
//! requesting Agent's Terminal (A3564a): no Agent types into a Terminal while its Agent waits on
//! the user, and the Daemon never types an answer.

use contracts::{Actor, Kind};
use rpc::RpcError;
use serde_json::Value;

use crate::Shared;
use crate::agent::Runs;

/// M7, H21: the one Reach walk of Agent `m` over the Rail `nodes` and the ids it `created`.
pub(crate) fn reach_of(
    nodes: &[contracts::agent::RailNode],
    created: Vec<String>,
    m: &str,
) -> std::collections::HashSet<String> {
    let mut reach = std::collections::HashSet::new();
    let mut frontier = vec![m.to_owned()];
    for id in created {
        if id != m && reach.insert(id.clone()) {
            frontier.push(id);
        }
    }
    while let Some(parent) = frontier.pop() {
        for node in nodes
            .iter()
            .filter(|n| n.parent.as_deref() == Some(&parent))
        {
            if node.id != m && reach.insert(node.id.clone()) {
                frontier.push(node.id.clone());
            }
        }
    }
    reach
}

impl Shared {
    /// M7, H21: the ids of the nodes in Agent `m`'s Reach, `m` itself excluded: its descendants
    /// on the Rail, and every Workstream `m` created with its descendants.
    pub(crate) fn reach(&self, m: &str) -> Result<std::collections::HashSet<String>, RpcError> {
        let (nodes, created) = {
            let rail = self.rail();
            (rail.tree()?, rail.created_by(m)?)
        };
        Ok(reach_of(&nodes, created, m))
    }

    /// M7: `NOT_FOUND` for an unknown node, then `FORBIDDEN` naming it when Agent `actor` has it
    /// is the Agent itself, unless `itself` (AP4: no other Reach limit). The user and an Extension have no limit.
    pub(crate) fn guard_reach(
        &self,
        actor: &Actor,
        id: &str,
        itself: bool,
    ) -> Result<(), RpcError> {
        self.rail().node(crate::rail::agent_id(id)?)?;
        if actor.kind != contracts::ActorKind::Agent || itself || actor.id != id {
            return Ok(());
        }
        // AP4: an Agent acts on any node but itself.
        Err(RpcError::forbidden(format!(
            "{} may not act on itself",
            self.rail().name_or_gone(id)?
        )))
    }

    /// M13, B54: `FORBIDDEN` naming Terminal `terminal` when Agent `actor` may not read it: a Terminal
    /// may be read by an Agent when its `owner` is the Agent itself, the Workstream it sits in or a
    /// node in its Reach. One with no owner is an Agent's pane: readable, for a read, only by an Agent that started it. The user and an Extension have no limit.
    pub(crate) fn guard_terminal_read(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
        pane_readable: bool,
    ) -> Result<(), RpcError> {
        let _ = (actor, terminal, owner, pane_readable);
        Ok(())
    }

    /// B53: a Show request may also name the pane of a node in the caller's Reach, which M13's read refuses as ownerless.
    pub(crate) fn guard_terminal_show(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
    ) -> Result<(), RpcError> {
        self.guard_terminal_read(actor, terminal, owner, false)
    }

    /// M14: `FORBIDDEN` when Agent `actor` may not set the Route in `params`: its `to` is the
    /// caller (an Agent may not lift its own hold), or `from` or `to` is not an Agent that is the
    /// caller or in its Reach. A Route the module itself refuses as `INVALID_PARAMS` (`to` the
    /// user, `from` equal to `to`) is left to it.
    pub(crate) fn guard_route(&self, actor: &Actor, params: &Value) -> Result<(), RpcError> {
        let to = params["to"].as_str();
        if to == Some(actor.id.as_str()) && params["from"].as_str() != to {
            return Err(RpcError::forbidden(format!(
                "{} may not set a Route to itself",
                self.rail().name_or_gone(&actor.id)?
            )));
        }
        Ok(())
    }
}

impl Shared {
    /// A3564a, AP6: `FORBIDDEN` while the Agent whose Terminal is `terminal` waits on the user.
    pub(crate) fn guard_not_waiting_terminal(&self, terminal: &str) -> Result<(), RpcError> {
        self.guard_waiting(|run| run.terminal_id() == terminal)
    }

    /// AP6: `FORBIDDEN` while Agent `id` waits on the user.
    pub(crate) fn guard_not_waiting(&self, id: &str) -> Result<(), RpcError> {
        let terminal = match self.runs().slot(id) {
            Some(crate::Slot::Running(run)) => Some(run.terminal_id().to_string()),
            _ => None,
        };
        match terminal {
            Some(terminal) => self.guard_not_waiting_terminal(&terminal),
            None => Ok(()),
        }
    }

    fn guard_waiting(&self, is_target: impl Fn(&crate::Run) -> bool) -> Result<(), RpcError> {
        let waiting = {
            let runs = self.runs();
            runs.iter().find_map(|(agent, entry)| match &entry.slot {
                crate::Slot::Running(run)
                    if is_target(run)
                        && run.view().status.as_ref().is_some_and(|status| {
                            status.kind == Kind::NeedsYou
                                && !crate::stop_asks(status.kind, &status.label)
                        }) =>
                {
                    Some(*agent)
                }
                _ => None,
            })
        };
        if let Some(agent) = waiting {
            let name = self
                .rail()
                .name(crate::rail::agent_id(&agent.to_string())?)?;
            return Err(RpcError::forbidden(format!(
                "{name} waits on the user in its Terminal"
            )));
        }
        Ok(())
    }
}

impl crate::Agents {
    /// The one path for `terminal.write` bytes. An Agent's bytes complete before the call returns,
    /// and are refused while the Agent whose Terminal it is waits on the user (`needs-you`): a
    /// native question or permission prompt there takes only the user's input. The caller
    /// enforces the Terminal Reach.
    pub async fn write_terminal(
        &self,
        actor: &Actor,
        terminal: &str,
        bytes: Vec<u8>,
    ) -> Result<(), RpcError> {
        if actor.kind != contracts::ActorKind::Agent {
            return self.shared.terminals.write(terminal, &bytes).await;
        }
        self.shared.guard_not_waiting_terminal(terminal)?;
        self.shared.terminals.write_completed(terminal, bytes).await
    }
}
