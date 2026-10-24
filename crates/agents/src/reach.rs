//! M7, M13, M14: what an Agent caller may reach, read or route, and the one path that types
//! bytes into a Terminal. The user's own questions and permission prompts stay in the
//! requesting Agent's Terminal (A3564a): no Agent types into a Terminal while its Agent waits on
//! the user, and the Daemon never types an answer.

use contracts::{Actor, Kind};
use rpc::RpcError;
use serde_json::Value;

use crate::Shared;

impl Shared {
    /// M7, H21: the ids of the nodes in Agent `m`'s Reach, `m` itself excluded: its descendants
    /// on the Rail, and every Workstream `m` created with its descendants.
    pub(crate) fn reach(&self, m: &str) -> Result<std::collections::HashSet<String>, RpcError> {
        let (nodes, created) = {
            let rail = self.rail();
            (rail.tree()?, rail.created_by(m)?)
        };
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
        Ok(reach)
    }

    /// M7: `NOT_FOUND` for an unknown node, then `FORBIDDEN` naming it when Agent `actor` has it
    /// outside its Reach (itself too, unless `itself`). The user and an Extension have no limit.
    pub(crate) fn guard_reach(
        &self,
        actor: &Actor,
        id: &str,
        itself: bool,
    ) -> Result<(), RpcError> {
        self.rail().node(id)?;
        if actor.kind != contracts::ActorKind::Agent || (itself && actor.id == id) {
            return Ok(());
        }
        if self.reach(&actor.id)?.contains(id) {
            return Ok(());
        }
        let rail = self.rail();
        Err(RpcError::forbidden(format!(
            "{} is not in the Reach of {}",
            rail.name(id)?,
            rail.name(&actor.id)?
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
        if actor.kind != contracts::ActorKind::Agent {
            return Ok(());
        }
        let name = self.rail().name(&actor.id)?;
        let forbidden = || {
            RpcError::forbidden(format!(
                "terminal {terminal} is forbidden to {0}: not started by {0} or in its Reach",
                name
            ))
        };
        let nodes = self.rail().tree()?;
        let Some(owner) = owner else {
            // B54: an Agent's own pane is readable by an Agent that started it (in its Reach).
            let pane = nodes
                .iter()
                .find(|node| node.terminal_id.as_deref() == Some(terminal));
            return match pane {
                Some(node) if pane_readable && self.reach(&actor.id)?.contains(&node.id) => Ok(()),
                _ => Err(forbidden()),
            };
        };
        if owner == actor.id || self.reach(&actor.id)?.contains(owner) {
            return Ok(());
        }
        let mut at = nodes.iter().find(|node| node.id == actor.id);
        while let Some(node) = at {
            if node.kind == contracts::agent::NodeKind::Workstream && node.id == owner {
                return Ok(());
            }
            at = node
                .parent
                .as_deref()
                .and_then(|parent| nodes.iter().find(|n| n.id == parent));
        }
        Err(forbidden())
    }

    /// B53: a Show request may also name the pane of a node in the caller's Reach, which M13's read refuses as ownerless.
    pub(crate) fn guard_terminal_show(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
    ) -> Result<(), RpcError> {
        let refused = match self.guard_terminal_read(actor, terminal, owner, false) {
            Err(err) if err.code == rpc::code::FORBIDDEN => err,
            other => return other,
        };
        let reach = self.reach(&actor.id)?;
        let is_pane =
            self.rail().tree()?.iter().any(|node| {
                node.terminal_id.as_deref() == Some(terminal) && reach.contains(&node.id)
            });
        if is_pane { Ok(()) } else { Err(refused) }
    }

    /// M14: `FORBIDDEN` when Agent `actor` may not set the Route in `params`: its `to` is the
    /// caller (an Agent may not lift its own hold), or `from` or `to` is not an Agent that is the
    /// caller or in its Reach. A Route the module itself refuses as `INVALID_PARAMS` (`to` the
    /// user, `from` equal to `to`) is left to it.
    pub(crate) fn guard_route(&self, actor: &Actor, params: &Value) -> Result<(), RpcError> {
        let (Some(from), Some(to)) = (params["from"].as_str(), params["to"].as_str()) else {
            return Ok(());
        };
        if to == Actor::user().id || from == to {
            return Ok(());
        }
        if to == actor.id {
            return Err(RpcError::forbidden(format!(
                "{} may not set a Route to itself",
                self.rail().name(&actor.id)?
            )));
        }
        let reach = self.reach(&actor.id)?;
        for node in [from, to] {
            if node != actor.id && !reach.contains(node) {
                let rail = self.rail();
                return Err(RpcError::forbidden(format!(
                    "{} is neither {} nor in its Reach",
                    rail.name(node)?,
                    rail.name(&actor.id)?
                )));
            }
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
        let waiting = {
            let runs = self.shared.runs();
            runs.iter().find_map(|(agent, slot)| match slot {
                crate::Slot::Running(run)
                    if run.terminal_id == terminal
                        && run
                            .adapter
                            .status()
                            .is_some_and(|status| status.kind == Kind::NeedsYou) =>
                {
                    Some(agent.clone())
                }
                _ => None,
            })
        };
        if let Some(agent) = waiting {
            let name = self.shared.rail().name(&agent)?;
            return Err(RpcError::forbidden(format!(
                "{name} waits on the user in its Terminal"
            )));
        }
        self.shared.terminals.write_completed(terminal, bytes).await
    }
}
