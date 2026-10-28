//! U4593: canonicalize Agent inputs once, before authority checks and effects.
use super::*;
use contracts::agent::{NodeKind, RailNode};

fn is_agent(node: &RailNode) -> bool {
    node.kind == NodeKind::Agent || (node.kind == NodeKind::Workstream && node.attempt.is_some())
}

fn select(
    nodes: &[RailNode],
    actor: &Actor,
    text: &str,
    other_nodes: bool,
) -> Result<String, RpcError> {
    let explicit = text.strip_prefix("name:");
    if explicit.is_none() {
        if text == "me" {
            return if actor.kind == ActorKind::Agent {
                Ok(actor.id.clone())
            } else {
                Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "me requires an authenticated Agent",
                ))
            };
        }
        if nodes
            .iter()
            .any(|n| n.id == text && (other_nodes || is_agent(n)))
        {
            return Ok(text.to_owned());
        }
    }
    let name = explicit.unwrap_or(text);
    let matches: Vec<_> = nodes
        .iter()
        .filter(|n| is_agent(n) && n.name == name)
        .collect();
    match matches.as_slice() {
        [node] => Ok(node.id.clone()),
        [] => {
            let names: Vec<_> = nodes
                .iter()
                .filter(|n| is_agent(n))
                .map(|n| n.name.as_str())
                .collect();
            Err(RpcError::not_found(format!(
                "Agent {name:?}; available Agent Rail names: {}",
                if names.is_empty() {
                    "none".into()
                } else {
                    names.join(", ")
                }
            )))
        }
        _ => {
            let candidates: Vec<_> = matches
                .iter()
                .map(|node| {
                    let mut at = node.parent.as_deref();
                    let mut home = "Project root";
                    while let Some(id) = at {
                        let Some(parent) = nodes.iter().find(|n| n.id == id) else {
                            break;
                        };
                        if parent.kind == NodeKind::Workstream {
                            home = &parent.name;
                            break;
                        }
                        at = parent.parent.as_deref();
                    }
                    format!("{home}/{} ({})", node.name, node.id)
                })
                .collect();
            Err(RpcError::conflict(format!(
                "ambiguous Agent {name:?}: {}",
                candidates.join(", ")
            )))
        }
    }
}

fn string(
    nodes: &[RailNode],
    actor: &Actor,
    value: &mut Value,
    other_nodes: bool,
    user: bool,
) -> Result<(), RpcError> {
    if let Some(text) = value.as_str() {
        if user && text == "you" {
            return Ok(());
        }
        *value = Value::String(select(nodes, actor, text, other_nodes)?);
    }
    Ok(())
}

fn owner(nodes: &[RailNode], actor: &Actor, value: &mut Value) -> Result<(), RpcError> {
    if value.is_string() {
        let id = select(nodes, actor, value.as_str().unwrap(), false)?;
        *value = json!({"kind":"agent", "id":id, "parent":null});
    } else if value["kind"] == "agent" {
        string(nodes, actor, &mut value["id"], false, false)?;
    }
    Ok(())
}

impl Daemon {
    pub(crate) async fn resolve_agent_inputs(
        &self,
        actor: &Actor,
        method: &str,
        mut params: Value,
    ) -> Result<Value, RpcError> {
        // Only declared reference fields are interpreted; ids of other objects and prose are untouched.
        let mut fields: Vec<(&str, bool, bool)> = Vec::new();
        if method.starts_with("agent.")
            && !matches!(method, "agent.spawn" | "agent.extras" | "agent.wake")
        {
            fields.push(("id", false, false));
        }
        match method {
            "agent.spawn" => fields.push(("parent", true, false)),
            "rail.move" => {
                fields.push(("id", true, false));
                fields.push(("parent", true, false));
            }
            "rail.rename" | "rail.remove" => fields.push(("id", true, false)),
            "todo.hand" => fields.push(("agent", false, false)),
            "message.send" | "message.list" => fields.push(("to", false, true)),
            "route.set" => {
                fields.push(("from", false, true));
                fields.push(("to", false, true));
            }
            "message.progress"
            | "message.reconcileWork"
            | "message.resumeWork"
            | "message.report"
            | "message.acceptResult"
            | "message.verifyResult"
            | "message.resolveResult" => fields.push(("id", false, false)),
            "deliverable.list" => fields.push(("maker", false, true)),
            "provenance.touched" if params["actor_id"] != Actor::daemon().id => {
                fields.push(("actor_id", false, true))
            }
            "terminal.read" => fields.push(("reader", false, false)),
            "project.importDiscover" | "project.importCommit" => {
                fields.push(("agent", false, false))
            }
            "workstream.rewind" | "workstream.rewindPlan" => fields.push(("agent", false, false)),
            "reaction.create" => fields.push(("target", false, false)),
            _ => {}
        }
        let has_owner = matches!(method, "todo.create" | "todo.assign" | "pad.setOwner");
        let has_list = method == "agent.wake"
            || (method == "reaction.create" && params["condition"]["kind"] == "agents");
        if !has_owner
            && !has_list
            && !fields
                .iter()
                .any(|(field, _, _)| params[*field].is_string())
        {
            return Ok(params);
        }
        let nodes = self.rail().await?;
        if has_owner && let Some(value) = params.get_mut("owner") {
            owner(&nodes, actor, value)?;
        }
        for (field, other_nodes, user) in fields {
            if let Some(value) = params.get_mut(field) {
                string(&nodes, actor, value, other_nodes, user)?;
            }
        }
        let list = if method == "agent.wake" {
            params.get_mut("ids")
        } else if method == "reaction.create" && params["condition"]["kind"] == "agents" {
            params["condition"].get_mut("ids")
        } else {
            None
        };
        if let Some(Value::Array(ids)) = list {
            for id in ids {
                string(&nodes, actor, id, false, false)?;
            }
        }
        Ok(params)
    }
}
