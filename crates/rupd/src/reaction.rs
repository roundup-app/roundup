//! NR1: saved reaction definitions in the Project database. Creation validates everything before it
//! writes, and the Actor is the connection's, never the payload's. A firing is accepted by `messages` in the
//! write that makes its Message (NR3). NR2, NR4 and NR5: an Agents condition is evaluated here from
//! `agent.status` Events and the Rail's present Kinds, never by a Model; PR checks and instants are later
//! slices.
use std::collections::HashSet;
use std::sync::Arc;

use contracts::agent::RailNode;
use contracts::{Event, EventData};
use rpc::Bus;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast::{Receiver, error::RecvError};

use contracts::reaction::{
    Condition, CreateParams, Firing, Observation, PreviewParams, Reaction, ReactionId, RunParams,
    State,
};
use contracts::{Actor, ActorKind};
use rpc::{RpcError, code};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::digest::{Reader, World};
use crate::wake::is_agent;
use crate::{Conn, Daemon};

const MAX_AGENTS: usize = 20;
const MAX_FIRINGS: u32 = 1000;
const MAX_NAME: usize = 256;
const MAX_INSTRUCTION: usize = 16 * 1024;
const SOURCES: [&str; 3] = ["agents", "pr-checks", "instant"];

pub(crate) struct Reactions {
    pub(crate) db: std::sync::Mutex<Connection>,
    /// NR6: a saved reaction's time may have changed; the Timer re-reads.
    pub(crate) changed: tokio::sync::Notify,
    /// Whether the Timer is running.
    pub(crate) timed: std::sync::atomic::AtomicBool,
    /// Serialises activation and every evaluation, so no two decide one reaction at once.
    gate: tokio::sync::Mutex<()>,
    /// Subscribed at open, taken once by the evaluator, so no Event falls between open and run.
    events: std::sync::Mutex<Option<Receiver<Event>>>,
}

impl Reactions {
    #[cfg(test)]
    pub(crate) fn in_memory() -> Self {
        Self {
            db: std::sync::Mutex::new(
                Connection::open_in_memory().expect("test reaction database"),
            ),
            changed: Default::default(),
            timed: Default::default(),
            gate: Default::default(),
            events: Default::default(),
        }
    }

    pub(crate) fn open(data: &std::path::Path) -> Result<Self, rpc::OpenError> {
        Ok(Self {
            db: std::sync::Mutex::new(Connection::open(data.join("project.db"))?),
            changed: Default::default(),
            timed: Default::default(),
            gate: Default::default(),
            events: Default::default(),
        })
    }

    pub(crate) fn listen(&self, events: Receiver<Event>) {
        *self.events.lock().expect("reaction events poisoned") = Some(events);
    }

    pub(crate) fn take_events(&self) -> Option<Receiver<Event>> {
        self.events.lock().expect("reaction events poisoned").take()
    }

    fn watch(&self, id: &str) -> Option<Watch> {
        let db = self.db.lock().expect("reaction database poisoned");
        let state: Option<String> = db
            .query_row(
                "SELECT state FROM reaction_watch WHERE reaction=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        state.and_then(|state| serde_json::from_str(&state).ok())
    }

    fn save_watch(&self, id: &str, watch: &Watch) {
        let state = serde_json::to_string(watch).expect("watch serialises");
        let saved = self.db.lock().expect("reaction database poisoned").execute(
            "INSERT INTO reaction_watch (reaction, state) VALUES (?1, ?2)
             ON CONFLICT(reaction) DO UPDATE SET state = excluded.state",
            params![id, state],
        );
        if let Err(err) = saved {
            eprintln!("reaction: watch not kept: {err}");
        }
    }

    /// Every active reaction whose condition is Agents.
    fn agent_reactions(&self) -> Vec<Reaction> {
        let db = self.db.lock().expect("reaction database poisoned");
        let Ok(mut stmt) = db.prepare("SELECT record FROM reactions ORDER BY rowid") else {
            return Vec::new();
        };
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            .unwrap_or_default();
        rows.iter()
            .filter_map(|record| read(record).ok())
            .filter(|r| r.state == State::Active && matches!(r.condition, Condition::Agents { .. }))
            .collect()
    }
}

/// What the evaluator knows of one Agents reaction, saved after each decision.
#[derive(Clone, Default, Serialize, Deserialize)]
struct Watch {
    /// The Event number up to which the reaction was decided.
    seen: u64,
    /// The named Agents seen finished since it was last armed.
    finished: Vec<String>,
    /// While not armed: the named Agents seen not finished since the last firing.
    unfinished: Vec<String>,
    armed: bool,
    /// Automatic firings accepted; the next one's operation is `auto-<round + 1>`, so a retry after a
    /// crash between the acceptance and this save returns the firing already made.
    round: u32,
    health: String,
    gap: Option<String>,
    recovery: Option<String>,
    evidence: Option<String>,
}

impl Watch {
    /// NR4: only a finish seen while armed counts; once fired, every named Agent must be seen not
    /// finished before the next finish does, so a still-true condition never re-arms.
    fn observe(&mut self, ids: &[String], id: &str, finished: bool) {
        if finished {
            if self.armed && !self.finished.iter().any(|f| f == id) {
                self.finished.push(id.to_owned());
            }
        } else if !self.armed && !self.unfinished.iter().any(|f| f == id) {
            self.unfinished.push(id.to_owned());
            if ids.iter().all(|id| self.unfinished.contains(id)) {
                self.armed = true;
                self.unfinished.clear();
                self.finished.clear();
            }
        }
    }

    fn unavailable(&mut self, gap: String, recovery: &str) {
        self.health = "unavailable".into();
        self.gap = Some(gap);
        self.recovery = Some(recovery.into());
    }
}

/// NR2: follows the Events and fires a reaction whose Agents condition holds.
#[derive(Clone)]
pub(crate) struct Evaluator {
    pub reactions: Arc<Reactions>,
    pub reader: Reader,
    pub messages: Arc<messages::Messages>,
    pub bus: Bus,
}

fn kind_of(world: &World, id: &str) -> Option<contracts::Kind> {
    node_of(world, id).and_then(|node| node.status.as_ref().map(|status| status.kind))
}

fn node_of<'a>(world: &'a World, id: &str) -> Option<&'a RailNode> {
    world
        .nodes()
        .iter()
        .find(|node| node.id == id && is_agent(node))
}

impl Evaluator {
    /// Runs until the Bus closes: every Agents reaction is decided again from the log at the start and
    /// after a lag, and each live Event decides them.
    pub(crate) async fn run(self, mut events: Receiver<Event>) {
        self.each(None).await;
        loop {
            match events.recv().await {
                Ok(event) => {
                    if matches!(
                        event.data,
                        EventData::AgentStatus(_) | EventData::RailChanged
                    ) {
                        self.each(Some(&event)).await;
                    }
                }
                Err(RecvError::Lagged(_)) => self.each(None).await,
                Err(RecvError::Closed) => return,
            }
        }
    }

    async fn each(&self, live: Option<&Event>) {
        for reaction in self.reactions.agent_reactions() {
            self.observe(&reaction, live).await;
        }
    }

    /// NR2: starts watching `reaction` if it is not, then decides it. The head is read before the Rail,
    /// so a finish between the two is replayed rather than missed.
    pub(crate) async fn observe(&self, reaction: &Reaction, live: Option<&Event>) {
        if !matches!(reaction.condition, Condition::Agents { .. }) {
            return;
        }
        let _gate = self.reactions.gate.lock().await;
        let head = self
            .bus
            .subscribe_after(None)
            .map_or(0, |events| events.head());
        let mut watch = self.reactions.watch(&reaction.id).unwrap_or_else(|| Watch {
            seen: head,
            armed: true,
            health: "observing".into(),
            ..Watch::default()
        });
        self.decide(reaction, &mut watch, head, live).await;
        self.reactions.save_watch(&reaction.id, &watch);
    }

    async fn decide(&self, r: &Reaction, w: &mut Watch, head: u64, live: Option<&Event>) {
        let Condition::Agents { ids, any } = &r.condition else {
            return;
        };
        let Ok(expires) = instant("expires_at", &r.expires_at) else {
            return;
        };
        let used = self
            .messages
            .firings_of(&r.id)
            .map_or(u32::MAX, |f| u32::try_from(f.len()).unwrap_or(u32::MAX));
        if r.state != State::Active || used >= r.max_firings || OffsetDateTime::now_utc() >= expires
        {
            return;
        }
        let world =
            match self.reader.world().await {
                Ok(world) => world,
                Err(err) => {
                    w.unavailable(
                    format!("the Agent state was not read after Event {}: {}", w.seen, err.message),
                    "observation resumes at the next successful read; nothing matches meanwhile",
                );
                    return;
                }
            };
        let mut events = match self.bus.saved_after(w.seen) {
            Ok((events, _)) => events,
            Err(err) if err.code == code::EVENTS_EXPIRED => {
                w.gap = Some(format!("the Event history after {} expired", w.seen));
                w.recovery = Some(
                    "the present state of every named Agent decides; an Agent without one stays unmatched"
                        .into(),
                );
                w.seen = head;
                Vec::new()
            }
            Err(err) => {
                w.unavailable(
                    format!("the Events after {} were not read: {}", w.seen, err.message),
                    "observation resumes at the next successful read; nothing matches meanwhile",
                );
                return;
            }
        };
        if let Some(event) = live
            && event.seq.is_none_or(|seq| {
                seq > w.seen
                    && events
                        .last()
                        .and_then(|e| e.seq)
                        .is_none_or(|last| seq > last)
            })
        {
            events.push(event.clone());
        }
        for event in &events {
            if let Some(seq) = event.seq {
                w.seen = w.seen.max(seq);
            }
            if let EventData::AgentStatus(status) = &event.data
                && ids.contains(&status.id)
            {
                w.observe(
                    ids,
                    &status.id,
                    messages::wake::finished(status.status.kind),
                );
            }
        }
        let gone: Vec<&String> = ids
            .iter()
            .filter(|id| kind_of(&world, id).is_none())
            .collect();
        if !gone.is_empty() || node_of(&world, &r.target).is_none() {
            let names: Vec<&str> = gone
                .iter()
                .map(|id| id.as_str())
                .chain(
                    node_of(&world, &r.target)
                        .is_none()
                        .then_some(r.target.as_str()),
                )
                .collect();
            w.unavailable(
                format!(
                    "{} no longer names an Agent with a state; no condition matches it",
                    names.join(", ")
                ),
                "stop this reaction and create one naming the Agents that exist",
            );
            return;
        }
        for id in ids {
            if let Some(kind) = kind_of(&world, id) {
                w.observe(ids, id, messages::wake::finished(kind));
            }
        }
        w.health = "observing".into();
        let facts: Vec<serde_json::Value> = ids
            .iter()
            .filter_map(|id| node_of(&world, id))
            .map(|node| serde_json::json!({ "id": node.id, "name": node.name, "kind": node.status.as_ref().map(|s| s.kind) }))
            .collect();
        let evidence = serde_json::json!({
            "source": "agents",
            "condition": if any.unwrap_or(false) { "any" } else { "all" },
            "cursor": w.seen,
            "finished": w.finished,
            "agents": facts,
            "reported": true,
        })
        .to_string();
        w.evidence = Some(evidence.clone());
        let holds = if any.unwrap_or(false) {
            !w.finished.is_empty()
        } else {
            ids.iter().all(|id| w.finished.contains(id))
        };
        if !(w.armed && holds) {
            return;
        }
        let fired = self
            .messages
            .fire_reaction(messages::reaction::Fire {
                reaction: r.id.clone(),
                operation: format!("auto-{}", w.round + 1),
                to: r.target.clone(),
                body: r.instruction.clone(),
                evidence,
                matched: true,
            })
            .await;
        match fired {
            Ok(_) => {
                w.round += 1;
                w.armed = false;
                w.finished.clear();
                w.unfinished.clear();
            }
            // Stopped, or the bound was spent by an explicit run first: nothing more is accepted.
            Err(err) if err.code == code::CONFLICT => {}
            Err(err) => eprintln!("reaction {}: not fired: {}", r.id, err.message),
        }
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
            let at = crate::reaction_time::canonical(at)?;
            if at <= now {
                return Err(invalid("at must be later than now"));
            }
            if at >= expires {
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
                let created = self.reaction_create(actor, &world, p)?;
                if let Some(evaluator) = self.evaluator() {
                    evaluator.observe(&created, None).await;
                }
                self.with_firings(created)?
            }
            "reaction.preview" => {
                let p: PreviewParams = rpc::params(args)?;
                return rpc::reply(&crate::reaction_time::preview(&p)?);
            }
            "reaction.list" => {
                let rows = {
                    let db = self
                        .reactions
                        .db
                        .lock()
                        .expect("reaction database poisoned");
                    let mut stmt = db
                        .prepare("SELECT actor_key, record FROM reactions ORDER BY rowid")
                        .map_err(RpcError::internal)?;
                    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
                        .map_err(RpcError::internal)?
                };
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
        if let Some(watch) = self.reactions.watch(&saved.id) {
            saved.observation = Observation {
                health: watch.health,
                cursor: Some(watch.seen),
                gap: watch.gap,
                recovery: watch.recovery,
                evidence: watch.evidence,
            };
        }
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
        let waiting = matches!(p.condition, Condition::Instant { .. });
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
                health: if waiting {
                    "waiting".into()
                } else {
                    "not-observing".into()
                },
                cursor: None,
                gap: None,
                recovery: None,
                evidence: None,
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
        self.reactions.changed.notify_one();
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
