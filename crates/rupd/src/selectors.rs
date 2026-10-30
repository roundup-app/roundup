//! Canonicalize Agent and Workstream inputs before authority checks and effects.
use super::*;
use contracts::agent::{NodeKind, RailNode};

fn is_agent(node: &RailNode) -> bool {
    node.kind == NodeKind::Agent || (node.kind == NodeKind::Workstream && node.attempt.is_some())
}

fn select(
    nodes: &[RailNode],
    actor: &Actor,
    last_id: i64,
    text: &str,
    kind: NodeKind,
) -> Result<String, RpcError> {
    let (label, accepts): (&str, fn(&RailNode) -> bool) = match kind {
        NodeKind::Agent => ("Agent", is_agent),
        NodeKind::Workstream => ("Workstream", |node| node.kind == NodeKind::Workstream),
    };
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
        if nodes.iter().any(|n| n.id == text)
            || text
                .parse::<i64>()
                .is_ok_and(|id| id > 0 && id <= last_id && id.to_string() == text)
        {
            return Ok(text.to_owned());
        }
    }
    let name = explicit.unwrap_or(text);
    let matches: Vec<_> = nodes
        .iter()
        .filter(|n| accepts(n) && n.name == name)
        .collect();
    match matches.as_slice() {
        [node] => Ok(node.id.clone()),
        [] => {
            let names: Vec<_> = nodes
                .iter()
                .filter(|n| accepts(n))
                .map(|n| n.name.as_str())
                .collect();
            Err(RpcError::not_found(format!(
                "{label} {name:?}; available {label} Rail names: {}",
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
                "ambiguous {label} {name:?}: {}",
                candidates.join(", ")
            )))
        }
    }
}

fn string(
    nodes: &[RailNode],
    actor: &Actor,
    last_id: i64,
    value: &mut Value,
    user: bool,
) -> Result<(), RpcError> {
    if let Some(text) = value.as_str() {
        if user && text == "you" {
            return Ok(());
        }
        *value = Value::String(select(nodes, actor, last_id, text, NodeKind::Agent)?);
    }
    Ok(())
}

fn owner(
    nodes: &[RailNode],
    actor: &Actor,
    last_id: i64,
    value: &mut Value,
) -> Result<(), RpcError> {
    if value.is_string() {
        let id = select(
            nodes,
            actor,
            last_id,
            value.as_str().unwrap(),
            NodeKind::Agent,
        )?;
        *value = json!({"kind":"agent", "id":id, "parent":null});
    } else if value["kind"] == "agent" {
        // Explicit Actors retain opaque stored identities, including retired owners.
        if value["id"].as_str().is_some_and(|id| {
            id != "me" && !id.starts_with("name:") && !nodes.iter().any(|n| n.name == id)
        }) {
            return Ok(());
        }
        string(nodes, actor, last_id, &mut value["id"], false)?;
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
        if method == "rail.startDoor"
            && let Some(id) = params["id"].as_str()
        {
            let nodes = self.rail().await?;
            let last_id = self.agents.rail_last_id()?;
            params["id"] = select(&nodes, actor, last_id, id, NodeKind::Workstream)?.into();
            return Ok(params);
        }
        if method == "agent.wake" {
            wake::parse_request(params.clone())?;
        }
        // Provenance also filters historical user/Extension Actors and retired Agent identities.
        if method == "provenance.touched"
            && let Some(id) = params["actor_id"].as_str()
            && id != "me"
            && !id.starts_with("name:")
            && (id == actor.id
                || id == "you"
                || id.starts_with("ext:")
                || !self
                    .touches
                    .touched(id)
                    .map_err(RpcError::internal)?
                    .is_empty())
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
            "reaction.create" => fields.push(("target", false)),
            _ => {}
        }
        let has_owner = matches!(method, "todo.create" | "todo.assign");
        let has_list = method == "agent.wake"
            || (method == "reaction.create" && params["condition"]["kind"] == "agents");
        if !has_owner && !has_list && !fields.iter().any(|(field, _)| params[*field].is_string()) {
            return Ok(params);
        }
        let nodes = self.rail().await?;
        let last_id = self.agents.rail_last_id()?;
        // Retained removal receipts keep their authority and key-conflict precedence.
        if method == "rail.remove"
            && let Some(operation) = params["operation"].as_str()
        {
            if actor.kind != ActorKind::User {
                return Err(RpcError::forbidden("only the user retains a Rail removal"));
            }
            if self.agents.rail_deletion(actor, operation)?.is_some()
                && let Some(id) = params["id"].as_str()
                && select(&nodes, actor, last_id, id, NodeKind::Agent)
                    .is_err_and(|e| e.code == code::NOT_FOUND)
            {
                return Err(RpcError::conflict("removal key already names another node"));
            }
        }
        if has_owner && let Some(value) = params.get_mut("owner") {
            owner(&nodes, actor, last_id, value)?;
        }
        for (field, user) in fields {
            if let Some(value) = params.get_mut(field) {
                string(&nodes, actor, last_id, value, user)?;
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
                string(&nodes, actor, last_id, id, false)?;
            }
        }
        Ok(params)
    }
}
