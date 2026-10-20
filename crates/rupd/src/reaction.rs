//! NR1: saved reaction definitions in the Project database. Creation validates everything before it
//! writes, and the Actor is the connection's, never the payload's. A firing is accepted by `messages` in the
//! write that makes its Message (NR3); evaluating a condition is a later slice.
use std::collections::HashSet;
use std::sync::Arc;

use contracts::reaction::{
    Condition, CreateParams, Firing, Observation, Reaction, ReactionId, RunParams, State,
};
use contracts::{Actor, ActorKind};
use rpc::{RpcError, code};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::wake::is_agent;
use crate::{Conn, Daemon};

const MAX_AGENTS: usize = 20;
const MAX_FIRINGS: u32 = 1000;
const MAX_NAME: usize = 256;
const MAX_INSTRUCTION: usize = 16 * 1024;
const SOURCES: [&str; 3] = ["agents", "pr-checks", "instant"];

pub(crate) struct Reactions {
    db: std::sync::Mutex<Connection>,
}

impl Reactions {
    #[cfg(test)]
    pub(crate) fn in_memory() -> Self {
        Self {
            db: std::sync::Mutex::new(
                Connection::open_in_memory().expect("test reaction database"),
            ),
        }
    }

    pub(crate) fn open(data: &std::path::Path) -> Result<Self, rpc::OpenError> {
        Ok(Self {
            db: std::sync::Mutex::new(Connection::open(data.join("project.db"))?),
        })
    }
}

fn invalid(text: impl Into<String>) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, text)
}

fn key(actor: &Actor) -> String {
    format!("{:?}:{}", actor.kind, actor.id)
}

fn instant(name: &str, text: &str) -> Result<OffsetDateTime, RpcError> {
    OffsetDateTime::parse(text, &Rfc3339)
        .map_err(|_| invalid(format!("{name} must be RFC 3339 with a UTC offset")))
}

/// The source a condition names, refused by name when no authoritative capability backs it.
fn supported(args: &Value) -> Result<(), RpcError> {
    let kind = args["condition"]["kind"].as_str().unwrap_or_default();
    if kind.is_empty() || SOURCES.contains(&kind) {
        return Ok(());
    }
    Err(invalid(format!(
        "unsupported condition source `{kind}`: it needs an authoritative source capability (agents, pr-checks and instant are supported)"
    )))
}

/// The definition's own rules, before any lookup.
fn shape(p: &CreateParams, now: OffsetDateTime) -> Result<(u32, bool), RpcError> {
    if p.operation.is_empty() || p.operation.len() > MAX_NAME {
        return Err(invalid("operation must be 1 to 256 bytes"));
    }
    if p.name.trim().is_empty() || p.name.len() > MAX_NAME {
        return Err(invalid("name must be 1 to 256 bytes"));
    }
    if p.instruction.trim().is_empty() || p.instruction.len() > MAX_INSTRUCTION {
        return Err(invalid("instruction must be 1 to 16384 bytes"));
    }
    let expires = instant("expires_at", &p.expires_at)?;
    if expires <= now {
        return Err(invalid("expires_at must be later than now"));
    }
    let max = p.max_firings.unwrap_or(1);
    if max == 0 || max > MAX_FIRINGS {
        return Err(invalid(format!("max_firings must be 1 to {MAX_FIRINGS}")));
    }
    let rearm = p.rearm.unwrap_or(false);
    let agents = matches!(p.condition, Condition::Agents { .. });
    if (rearm || max > 1) && !agents {
        return Err(invalid("only an agents condition may repeat"));
    }
    if max > 1 && !rearm {
        return Err(invalid("max_firings above one needs rearm"));
    }
    match &p.condition {
        Condition::Agents { ids, .. } => {
            if ids.is_empty() || ids.len() > MAX_AGENTS {
                return Err(invalid(format!("ids must name 1 to {MAX_AGENTS} Agents")));
            }
            let mut seen = HashSet::new();
            if let Some(id) = ids.iter().find(|id| !seen.insert(id.as_str())) {
                return Err(invalid(format!("Agent {id} is named twice")));
            }
        }
        Condition::PrChecks { repository, number } => {
            if repository.trim().is_empty() || *number == 0 {
                return Err(invalid("a PR needs a repository and a positive number"));
            }
        }
        Condition::Instant { at, .. } => {
            if instant("at", at)? >= expires {
                return Err(invalid("at must be earlier than expires_at"));
            }
        }
    }
    Ok((max, rearm))
}

fn read(record: &str) -> Result<Reaction, RpcError> {
    serde_json::from_str(record).map_err(RpcError::internal)
}

fn outcome(message: &Option<contracts::message::Message>) -> String {
    message
        .as_ref()
        .and_then(|m| serde_json::to_value(m.status).ok())
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".into())
}

impl Daemon {
    fn messages(&self) -> Result<&Arc<messages::Messages>, RpcError> {
        self.sender
            .get()
            .ok_or_else(|| RpcError::internal("messages are not open"))
    }

    /// NR1: `reaction.create`, `.list`, `.get`, `.stop` and `.run`.
    pub(crate) async fn reaction_call(
        &self,
        conn: &Conn,
        method: &str,
        args: Value,
    ) -> Result<Value, RpcError> {
        let actor = &conn.actor;
        if actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(
                "only the user or an Agent may use reactions",
            ));
        }
        let world = self.reader().world().await?;
        let reaction = match method {
            "reaction.create" => {
                supported(&args)?;
                let p: CreateParams = rpc::params(args)?;
                self.reaction_create(actor, &world, p)?
            }
            "reaction.list" => {
                let db = self
                    .reactions
                    .db
                    .lock()
                    .expect("reaction database poisoned");
                let mut stmt = db
                    .prepare("SELECT actor_key, record FROM reactions ORDER BY rowid")
                    .map_err(RpcError::internal)?;
                let rows = stmt
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
                    .map_err(RpcError::internal)?;
                let mine = key(actor);
                let list = rows
                    .iter()
                    .filter(|(owner, _)| actor.kind == ActorKind::User || *owner == mine)
                    .map(|(_, record)| read(record).and_then(|saved| self.with_firings(saved)))
                    .collect::<Result<Vec<_>, _>>()?;
                return rpc::reply(&list);
            }
            "reaction.get" => {
                let p: ReactionId = rpc::params(args)?;
                self.with_firings(self.reaction_own(actor, &p.id)?.1)?
            }
            "reaction.stop" => {
                let p: ReactionId = rpc::params(args)?;
                let stopped = self.reaction_stop(actor, &p.id)?;
                self.with_firings(stopped)?
            }
            "reaction.run" => {
                let p: RunParams = rpc::params(args)?;
                self.reaction_run(actor, p).await?
            }
            _ => return Err(RpcError::new(code::METHOD_NOT_FOUND, method)),
        };
        rpc::reply(&reaction)
    }

    /// The record with its accepted firings and what is left of the bound, read from the write that
    /// accepted them rather than from the saved definition.
    fn with_firings(&self, mut saved: Reaction) -> Result<Reaction, RpcError> {
        saved.firings = self
            .messages()?
            .firings_of(&saved.id)?
            .into_iter()
            .map(|(f, message)| Firing {
                outcome: outcome(&message),
                id: f.id,
                ordinal: f.ordinal,
                message: f.message,
                matched: f.matched,
                evidence: f.evidence,
                definition: f.definition,
            })
            .collect();
        saved.remaining = saved
            .max_firings
            .saturating_sub(u32::try_from(saved.firings.len()).unwrap_or(u32::MAX));
        Ok(saved)
    }

    /// NR4's explicit run, as far as NR3 needs it: one accepted firing that claims no condition held.
    async fn reaction_run(&self, actor: &Actor, p: RunParams) -> Result<Reaction, RpcError> {
        let (_, saved) = self.reaction_own(actor, &p.id)?;
        let first = self
            .messages()?
            .firings_of(&p.id)?
            .iter()
            .any(|(f, _)| f.operation == p.operation);
        if first {
            return self.with_firings(saved);
        }
        if saved.state == State::Stopped {
            return Err(RpcError::conflict(
                "a stopped reaction cannot run; create a new one",
            ));
        }
        let saved = self.with_firings(saved)?;
        if instant("expires_at", &saved.expires_at)? <= OffsetDateTime::now_utc() {
            return Err(RpcError::conflict("the reaction expired; create a new one"));
        }
        self.agents.guard_reach(actor, &saved.target, true)?;
        let evidence = serde_json::json!({
            "source": "run",
            "condition": "not claimed",
            "by": key(actor),
            "reported": actor.kind == ActorKind::Agent,
        });
        self.messages()?
            .fire_reaction(messages::reaction::Fire {
                reaction: saved.id.clone(),
                operation: p.operation,
                to: saved.target.clone(),
                body: saved.instruction.clone(),
                evidence: evidence.to_string(),
                matched: false,
            })
            .await?;
        self.with_firings(saved)
    }

    fn reaction_create(
        &self,
        actor: &Actor,
        world: &crate::digest::World,
        p: CreateParams,
    ) -> Result<Reaction, RpcError> {
        let request = serde_json::to_string(&p).map_err(RpcError::internal)?;
        let mut db = self
            .reactions
            .db
            .lock()
            .expect("reaction database poisoned");
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(RpcError::internal)?;
        let owner = key(actor);
        let earlier: Option<(String, String)> = tx
            .query_row(
                "SELECT request, record FROM reactions WHERE actor_key=?1 AND operation=?2",
                params![owner, p.operation],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(RpcError::internal)?;
        if let Some((old, record)) = earlier {
            if old != request {
                return Err(RpcError::conflict(
                    "operation already names another definition",
                ));
            }
            return read(&record);
        }
        let now = OffsetDateTime::now_utc();
        let (max, rearm) = shape(&p, now)?;
        let node = |id: &str| {
            world
                .nodes()
                .iter()
                .find(|node| node.id == id && is_agent(node))
                .ok_or_else(|| RpcError::not_found(format!("Agent {id} is not in this Project")))
        };
        let target = node(&p.target)?;
        self.agents.guard_reach(actor, &p.target, true)?;
        if let Condition::Agents { ids, .. } = &p.condition {
            for id in ids {
                node(id)?;
            }
        }
        let project: String = tx
            .query_row("SELECT id FROM reaction_project", [], |r| r.get(0))
            .map_err(RpcError::internal)?;
        let id: String = tx
            .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
            .map_err(RpcError::internal)?;
        let reaction = Reaction {
            project,
            id: id.clone(),
            name: p.name,
            actor: actor.clone(),
            home: target.parent.clone(),
            target: p.target,
            instruction: p.instruction,
            condition: p.condition,
            max_firings: max,
            remaining: max,
            rearm,
            expires_at: p.expires_at,
            created_at: now.format(&Rfc3339).map_err(RpcError::internal)?,
            state: State::Active,
            observation: Observation {
                health: "not-observing".into(),
                cursor: None,
            },
            firings: Vec::new(),
        };
        let record = serde_json::to_string(&reaction).map_err(RpcError::internal)?;
        tx.execute(
            "INSERT INTO reactions (id, actor_key, operation, request, record) VALUES (?1,?2,?3,?4,?5)",
            params![id, owner, p.operation, request, record],
        )
        .map_err(RpcError::internal)?;
        tx.commit().map_err(RpcError::internal)?;
        Ok(reaction)
    }

    /// The saved definition `id` when `actor` may inspect it: the user, or the Agent that authorized it.
    fn reaction_own(&self, actor: &Actor, id: &str) -> Result<(String, Reaction), RpcError> {
        let db = self
            .reactions
            .db
            .lock()
            .expect("reaction database poisoned");
        let row: Option<(String, String)> = db
            .query_row(
                "SELECT actor_key, record FROM reactions WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(RpcError::internal)?;
        let (owner, record) = row.ok_or_else(|| RpcError::not_found("no such reaction"))?;
        if actor.kind != ActorKind::User && owner != key(actor) {
            return Err(RpcError::forbidden("another Agent's reaction"));
        }
        Ok((owner, read(&record)?))
    }

    fn reaction_stop(&self, actor: &Actor, id: &str) -> Result<Reaction, RpcError> {
        let (_, mut saved) = self.reaction_own(actor, id)?;
        if saved.state == State::Stopped {
            return Ok(saved);
        }
        saved.state = State::Stopped;
        let record = serde_json::to_string(&saved).map_err(RpcError::internal)?;
        self.reactions
            .db
            .lock()
            .expect("reaction database poisoned")
            .execute(
                "UPDATE reactions SET record=?2 WHERE id=?1",
                params![id, record],
            )
            .map_err(RpcError::internal)?;
        Ok(saved)
    }
}
