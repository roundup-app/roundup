//! U4593: canonicalize Agent inputs once, before authority checks and effects.
use super::*;
use contracts::agent::{NodeKind, RailNode};

fn is_agent(node: &RailNode) -> bool {
    node.kind == NodeKind::Agent || (node.kind == NodeKind::Workstream && node.attempt.is_some())
}

fn select(nodes: &[RailNode], actor: &Actor, text: &str) -> Result<String, RpcError> {
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
        if actor.kind == ActorKind::Agent && text == actor.id {
            return Ok(actor.id.clone());
        }
        if nodes.iter().any(|n| n.id == text) {
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
    user: bool,
) -> Result<(), RpcError> {
    if let Some(text) = value.as_str() {
        if user && text == "you" {
            return Ok(());
        }
        *value = Value::String(select(nodes, actor, text)?);
    }
    Ok(())
}

fn owner(nodes: &[RailNode], actor: &Actor, value: &mut Value) -> Result<(), RpcError> {
    if value.is_string() {
        let id = select(nodes, actor, value.as_str().unwrap())?;
        *value = json!({"kind":"agent", "id":id, "parent":null});
    } else if value["kind"] == "agent" {
        string(nodes, actor, &mut value["id"], false)?;
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
        // Provenance also filters historical user/Extension Actors and retired Agent identities.
        if method == "provenance.touched"
            && let Some(id) = params["actor_id"].as_str()
            && id != "me"
            && !id.starts_with("name:")
            && !self
                .touches
                .touched(id)
                .map_err(RpcError::internal)?
                .is_empty()
        {
            return Ok(params);
        }
        // Only declared reference fields are interpreted; ids of other objects and prose are untouched.
        let mut fields: Vec<(&str, bool)> = Vec::new();
        if method.starts_with("agent.")
            && !matches!(method, "agent.spawn" | "agent.extras" | "agent.wake")
        {
            fields.push(("id", false));
        }
        match method {
            "agent.spawn" if actor.kind == ActorKind::Agent => {
                if let Some(parent) = params.get_mut("parent") {
                    *parent = json!(actor.id);
                }
            }
            "agent.spawn" => fields.push(("parent", false)),
            "rail.move" => {
                fields.push(("id", false));
                fields.push(("parent", false));
            }
            "rail.rename" | "rail.remove" => fields.push(("id", false)),
            "todo.hand" => fields.push(("agent", false)),
            "message.send" | "message.list" => fields.push(("to", true)),
            "route.set" => {
                fields.push(("from", true));
                fields.push(("to", true));
            }
            "message.progress"
            | "message.reconcileWork"
            | "message.resumeWork"
            | "message.report"
            | "message.acceptResult"
            | "message.verifyResult"
            | "message.resolveResult" => fields.push(("id", false)),
            "deliverable.list" => fields.push(("maker", true)),
            "provenance.touched" if params["actor_id"] != Actor::daemon().id => {
                fields.push(("actor_id", true))
            }
            "terminal.read" if params["after"].is_null() => fields.push(("reader", false)),
            "project.importDiscover" | "project.importCommit" => fields.push(("agent", false)),
            "workstream.rewind" | "workstream.rewindPlan" => fields.push(("agent", false)),
            "reaction.create" => fields.push(("target", false)),
            _ => {}
        }
        let has_owner = matches!(method, "todo.create" | "todo.assign" | "pad.setOwner");
        let has_list = method == "agent.wake"
            || (method == "reaction.create" && params["condition"]["kind"] == "agents");
        if !has_owner && !has_list && !fields.iter().any(|(field, _)| params[*field].is_string()) {
            return Ok(params);
        }
        let nodes = self.rail().await?;
        if has_owner && let Some(value) = params.get_mut("owner") {
            owner(&nodes, actor, value)?;
        }
        for (field, user) in fields {
            if let Some(value) = params.get_mut(field) {
                string(&nodes, actor, value, user)?;
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
                string(&nodes, actor, id, false)?;
            }
        }
        Ok(params)
    }
}
