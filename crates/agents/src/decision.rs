//! The Decision store (`scenarios/decisions.md` H2 to H7, H10): one open Decision per Agent, in
//! memory only (H5); successful answers are retained in Project data (U468).
//! The vendor's payload and reply text are `claude_code`'s; this module carries opaque text.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use contracts::decision::{
    Answer, AnswerParams, AskAnswer, AskCall, AskOutput, AskParams, ClearedEvent, Decision,
    Outcome, PermissionOutput, PromptIdentity,
};
use contracts::{Actor, EventData};
use rpc::{RpcError, code};
use serde_json::Value;
use tokio::sync::oneshot;

use crate::claude_code;
use crate::{Observation, Shared};

/// What the waiting `agent.permission` call returns: the text `rup permission` prints, or the
/// reason it exits 1.
type Reply = Result<String, RpcError>;
type EffectProbe = Arc<dyn Fn(&PromptIdentity) -> Result<(), RpcError> + Send + Sync>;

struct Open {
    decision: Decision,
    prompt: String,
    /// The Attempt the Decision was opened for, so the Observations it causes reach that one.
    attempt: String,
    /// The hook's waiting call; `None` once its connection closed at its `timeout` (H7(c)) and
    /// for a Decision opened without a hook to reply to.
    waiter: Option<oneshot::Sender<Reply>>,
    /// H14: the labels of an `ask_user` Decision, which one of them or an own answer settles;
    /// `None` for a permission Decision, which `allow` or `deny` answers.
    choices: Option<Question>,
    /// Terminal input can settle a native prompt before its next Signal clears the Card.
    identity_available: bool,
    /// The authenticated writer of input for this original question.
    terminal_actor: Option<Actor>,
}

enum PromptInput {
    Captured(PromptIdentity),
    Question(String),
}

struct Question {
    labels: Vec<String>,
    terminal: Option<String>,
}

/// H14: the tool name an `ask_user` Decision carries, and the bounds on what the Agent asks.
const ASK_TOOL: &str = "ask_user";
const MAX_ANSWERS: usize = 4;
const MAX_QUESTION_CHARS: usize = 600;
const MAX_LABEL_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 400;
const MAX_PREVIEW_CHARS: usize = 4000;
const MAX_NOTE_CHARS: usize = 2000;
const RECOMMENDED: &str = " (recommended)";

/// H14: whether an `ask_user` call's question and answers are inside the bounds.
fn valid_ask(question: &str, answers: &[AskAnswer]) -> bool {
    let long = |text: &str, max: usize| text.chars().count() > max;
    let recommended = answers
        .iter()
        .filter(|a| a.label.ends_with(RECOMMENDED))
        .count();
    let distinct = answers
        .iter()
        .enumerate()
        .all(|(i, a)| answers[..i].iter().all(|b| b.label != a.label));
    !question.trim().is_empty()
        && !long(question, MAX_QUESTION_CHARS)
        && answers.len() <= MAX_ANSWERS
        && recommended <= 1
        && distinct
        && answers.iter().all(|a| {
            !a.label.trim().is_empty()
                && !long(&a.label, MAX_LABEL_CHARS)
                && !a.description.trim().is_empty()
                && !long(&a.description, MAX_DESCRIPTION_CHARS)
                && a.preview
                    .as_deref()
                    .is_none_or(|p| !long(p, MAX_PREVIEW_CHARS))
        })
}

pub struct Decisions {
    open: Mutex<HashMap<String, Open>>,
    history: Mutex<rusqlite::Connection>,
    next: Mutex<i64>,
    /// No nonce means capture and guarded effects refuse; unguarded user answers still work.
    daemon: Option<String>,
    before_effect: Option<EffectProbe>,
    /// H4: the secret the App holds; `None` refuses every answer.
    proof: Option<String>,
    /// The `timeout` of the hook's settings (H9); a close at or after it is not a No or an Esc.
    hook_timeout: Duration,
}

impl Decisions {
    pub fn new(proof: Option<String>, hook_timeout: Duration) -> Self {
        let mut nonce = [0u8; 32];
        let daemon = getrandom::fill(&mut nonce)
            .ok()
            .map(|()| nonce.iter().map(|byte| format!("{byte:02x}")).collect());
        let history = rusqlite::Connection::open_in_memory().expect("Decision history database");
        history
            .execute_batch(include_str!("../migrations/003/up.sql"))
            .expect("Decision history schema");
        Self {
            history: Mutex::new(history),
            open: Mutex::new(HashMap::new()),
            next: Mutex::new(0),
            daemon,
            before_effect: None,
            proof,
            hook_timeout,
        }
    }

    pub(crate) fn with_store(self, path: &std::path::Path) -> Result<Self, rpc::OpenError> {
        let db = rusqlite::Connection::open(path)?;
        // Only retained requests need identities across Daemon runs. Open Cards
        // stay ephemeral; PromptIdentity's nonce still fences their reuse (B6).
        let next = db.query_row(
            "SELECT COALESCE(MAX(CAST(SUBSTR(decision, 2) AS INTEGER)), 0) FROM decision_answers",
            [],
            |row| row.get(0),
        )?;
        Ok(Self {
            history: Mutex::new(db),
            next: Mutex::new(next),
            ..self
        })
    }

    pub(crate) fn set_proof(&mut self, proof: Option<String>) {
        self.proof = proof;
    }

    fn open(&self) -> MutexGuard<'_, HashMap<String, Open>> {
        crate::agent_lock(&self.open).expect("decisions lock")
    }

    fn next_id(&self) -> String {
        let mut next = self.next.lock().expect("decision id lock");
        *next += 1;
        format!("d{next}")
    }

    /// The open Decisions, oldest first.
    pub fn list(&self) -> Vec<Decision> {
        let mut all: Vec<_> = self
            .open()
            .values()
            .map(|open| open.decision.clone())
            .collect();
        all.sort_by(|a, b| (a.opened_at, &a.id).cmp(&(b.opened_at, &b.id)));
        all
    }

    /// The Agent that Decision `id` belongs to, if it is open.
    fn agent_of(&self, id: &str) -> Option<String> {
        self.open()
            .iter()
            .find(|(_, open)| open.decision.id == id)
            .map(|(agent, _)| agent.clone())
    }

    fn identity(&self, entry: &Open) -> Result<PromptIdentity, RpcError> {
        let daemon = self.daemon.as_ref().ok_or_else(|| {
            RpcError::conflict("original prompt identity unavailable for this Daemon run")
        })?;
        if !entry.identity_available
            || entry
                .waiter
                .as_ref()
                .is_some_and(oneshot::Sender::is_closed)
        {
            return Err(RpcError::conflict(format!(
                "original prompt {} identity unavailable",
                entry.decision.id
            )));
        }
        Ok(PromptIdentity {
            daemon: daemon.clone(),
            agent: entry.decision.agent.clone(),
            attempt: entry.attempt.clone(),
            decision: entry.decision.id.clone(),
        })
    }

    fn guard(&self, entry: &Open, identity: &PromptIdentity) -> Result<(), RpcError> {
        let original = self.identity(entry).map_err(|_| {
            RpcError::conflict(format!(
                "original prompt {} of {} Attempt {} identity unavailable",
                identity.decision, identity.agent, identity.attempt
            ))
        })?;
        if original != *identity {
            return Err(original_gone(identity));
        }
        Ok(())
    }

    /// U468: a native question ends with its own call, never a late generic
    /// PostToolUse/Stop Signal from a replaced or concurrent tool.
    pub(crate) fn waits_in_terminal(&self, agent: &str) -> bool {
        self.open()
            .get(agent)
            .and_then(|entry| entry.choices.as_ref())
            .is_some_and(|question| question.terminal.is_some())
    }

    /// Clear Agent `agent`'s Decision, if it has one, and say so. The waiting hook gets `reason`.
    pub(crate) fn clear(&self, bus: &rpc::Bus, agent: &str, outcome: Outcome, reason: &str) {
        let Some(open) = self.open().remove(agent) else {
            return;
        };
        cleared(bus, &open.decision.id, outcome);
        if let Some(waiter) = open.waiter {
            let _ = waiter.send(Err(RpcError::new(code::CONFLICT, reason)));
        }
    }
}

fn original_gone(identity: &PromptIdentity) -> RpcError {
    RpcError::conflict(format!(
        "original prompt {} of {} Attempt {} is no longer available",
        identity.decision, identity.agent, identity.attempt
    ))
}

fn cleared(bus: &rpc::Bus, id: &str, outcome: Outcome) {
    bus.emit(
        Actor::daemon(),
        EventData::DecisionCleared(ClearedEvent {
            id: id.to_owned(),
            outcome,
        }),
    );
}

struct Opened {
    /// `None` for a Decision with no live hook to reply to.
    waiting: Option<oneshot::Receiver<Reply>>,
    id: String,
    started: i64,
}

/// Dropped with the `agent.permission` call it belongs to: if the call is dropped while its
/// Decision is still open, the hook's own side closed the connection (H7(b), H7(c)).
struct HookGuard {
    shared: Arc<Shared>,
    agent: String,
    decision: String,
    started: i64,
    armed: bool,
    /// An `ask_user` call (H14), which has no hook `timeout` to tell a close from.
    asks: bool,
}

impl Drop for HookGuard {
    fn drop(&mut self) {
        if self.armed {
            if self.asks {
                self.shared.ask_closed(&self.agent, &self.decision);
            } else {
                self.shared
                    .hook_closed(&self.agent, &self.decision, self.started);
            }
        }
    }
}

impl Shared {
    /// H2: open Agent `id`'s Decision for `payload` and, for one with a hook to reply to, wait
    /// until it is answered or cleared.
    pub(crate) async fn permission(
        self: &Arc<Self>,
        actor: Actor,
        id: &str,
        payload: Value,
    ) -> Result<PermissionOutput, RpcError> {
        let prompt = payload["tool_input"].to_string();
        let request = claude_code::permission_request(&payload);
        let signal = claude_code::as_permission_signal(payload);
        let opened = self.open_decision(actor, id, request, signal, None, prompt)?;
        let Some(rx) = opened.waiting else {
            return Ok(PermissionOutput {
                output: String::new(),
            });
        };
        let mut guard = HookGuard {
            shared: Arc::clone(self),
            agent: id.to_owned(),
            decision: opened.id,
            started: opened.started,
            armed: true,
            asks: false,
        };
        let reply = rx.await;
        guard.armed = false;
        match reply {
            Ok(reply) => reply.map(|output| PermissionOutput { output }),
            Err(_) => Err(RpcError::internal("the Decision was dropped")),
        }
    }

    /// H14: open the calling Agent's `ask_user` Decision and wait until the user answers it or it
    /// is cleared.
    pub(crate) async fn ask(
        self: &Arc<Self>,
        actor: Actor,
        params: AskCall,
    ) -> Result<AskOutput, RpcError> {
        if actor.kind != contracts::ActorKind::Agent {
            return Err(RpcError::forbidden("only an Agent asks the user"));
        }
        let AskCall {
            question: AskParams { question, answers },
            terminal,
        } = params;
        if !valid_ask(&question, &answers) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!(
                    "ask_user takes a question of up to {MAX_QUESTION_CHARS} characters and up to {MAX_ANSWERS} answers of distinct labels, at most one ending{RECOMMENDED}"
                ),
            ));
        }
        let labels = answers.iter().map(|a| a.label.clone()).collect();
        let id = actor.id.clone();
        let mut input = serde_json::json!({ "question": question, "answers": answers });
        if let Some(terminal) = &terminal {
            input["terminal"] = terminal.clone().into();
        }
        let request = claude_code::PermissionRequest {
            tool: ASK_TOOL.to_owned(),
            args: input.to_string(),
            answerable: true,
            identity_available: true,
        };
        let signal = serde_json::json!({ "tool_name": ASK_TOOL, "tool_input": input });
        let opened = self.open_decision(
            actor,
            &id,
            request,
            claude_code::as_permission_signal(signal),
            Some(Question { labels, terminal }),
            input.to_string(),
        )?;
        let rx = opened.waiting.expect("an ask_user Decision waits");
        let mut guard = HookGuard {
            shared: Arc::clone(self),
            agent: id,
            decision: opened.id,
            started: opened.started,
            armed: true,
            asks: true,
        };
        let reply = rx.await;
        guard.armed = false;
        match reply {
            Ok(reply) => {
                let text = reply?;
                serde_json::from_str::<AskOutput>(&text)
                    .map_err(|err| RpcError::internal(format!("the answer was unreadable: {err}")))
            }
            Err(_) => Err(RpcError::internal("the Decision was dropped")),
        }
    }

    /// Replace Agent `id`'s Decision with a new one for `request` and tell the adapter `signal`.
    fn open_decision(
        self: &Arc<Self>,
        actor: Actor,
        id: &str,
        request: claude_code::PermissionRequest,
        signal: Value,
        choices: Option<Question>,
        prompt: String,
    ) -> Result<Opened, RpcError> {
        let started = (self.clock)();
        let (rx, attempt, decision) = {
            // `runs` before `decisions`, as every other path: an Agent that ends cannot be left
            // with a Decision opened after its clear.
            let runs = self.runs();
            let Some(crate::Slot::Running(run)) = runs.get(id) else {
                return Err(RpcError::not_found(format!("agent {id}")));
            };
            if run.ended || run.closing {
                return Err(RpcError::not_found(format!("agent {id} has ended")));
            }
            let decision = Decision {
                id: self.decisions.next_id(),
                agent: id.to_owned(),
                tool: request.tool,
                args: request.args,
                opened_at: started,
                answerable: request.answerable,
                failure: None,
            };
            let (tx, rx) = oneshot::channel();
            let waiter = decision.answerable.then_some(tx);
            let mut open = self.decisions.open();
            let replaced = open.insert(
                id.to_owned(),
                Open {
                    decision: decision.clone(),
                    prompt,
                    attempt: run.attempt.clone(),
                    waiter,
                    choices,
                    identity_available: request.identity_available,
                    terminal_actor: None,
                },
            );
            if let Some(old) = replaced {
                cleared(&self.bus, &old.decision.id, Outcome::Replaced);
                if let Some(waiter) = old.waiter {
                    let _ = waiter.send(Err(RpcError::new(code::CONFLICT, "superseded")));
                }
            }
            self.bus.emit(
                actor.clone(),
                EventData::DecisionOpened(decision.clone().into()),
            );
            (rx, run.attempt.clone(), decision)
        };
        if let Err(err) = self.observe(actor, id, &attempt, Observation::Signal(signal)) {
            self.decisions
                .clear(&self.bus, id, Outcome::AgentGone, "the Agent ended");
            return Err(err);
        }
        Ok(Opened {
            waiting: decision.answerable.then_some(rx),
            id: decision.id,
            started,
        })
    }

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
        Err(RpcError::forbidden(format!(
            "node {id} is not in the Reach of {}",
            actor.id
        )))
    }

    /// M13: `FORBIDDEN` naming Terminal `terminal` when Agent `actor` may not read it: a Terminal
    /// may be read by an Agent when its `owner` is the Agent itself, the Workstream it sits in or a
    /// node in its Reach. One with no owner is no Agent's. The user and an Extension have no limit.
    pub(crate) fn guard_terminal_read(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
    ) -> Result<(), RpcError> {
        if actor.kind != contracts::ActorKind::Agent {
            return Ok(());
        }
        let forbidden = || {
            RpcError::forbidden(format!(
                "terminal {terminal} is not one of {}'s Runs or its Workstream's",
                actor.id
            ))
        };
        let owner = owner.ok_or_else(forbidden)?;
        if owner == actor.id || self.reach(&actor.id)?.contains(owner) {
            return Ok(());
        }
        let nodes = self.rail().tree()?;
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
        let refused = match self.guard_terminal_read(actor, terminal, owner) {
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
                actor.id
            )));
        }
        let reach = self.reach(&actor.id)?;
        for node in [from, to] {
            if node != actor.id && !reach.contains(node) {
                return Err(RpcError::forbidden(format!(
                    "{node} is neither {} nor in its Reach",
                    actor.id
                )));
            }
        }
        Ok(())
    }

    /// B6: capture only the live original, never a Decision inferred from equal prompt text.
    pub(crate) fn capture(&self, actor: &Actor, id: &str) -> Result<PromptIdentity, RpcError> {
        if actor.kind == contracts::ActorKind::Agent {
            let agent = self.decisions.agent_of(id).ok_or_else(|| {
                RpcError::conflict(format!("original prompt {id} is unavailable"))
            })?;
            if !self.reach(&actor.id)?.contains(&agent) {
                return Err(RpcError::forbidden(format!(
                    "decision {id} is outside the Reach of {}",
                    actor.id
                )));
            }
        }
        let runs = self.runs();
        let open = self.decisions.open();
        let entry = open
            .values()
            .find(|o| o.decision.id == id)
            .ok_or_else(|| RpcError::conflict(format!("original prompt {id} is unavailable")))?;
        let Some(crate::Slot::Running(run)) = runs.get(&entry.decision.agent) else {
            return Err(RpcError::conflict(format!(
                "original prompt {id} Agent is unavailable"
            )));
        };
        if run.ended || run.closing || run.attempt != entry.attempt {
            return Err(RpcError::conflict(format!(
                "original prompt {id} Attempt is unavailable"
            )));
        }
        self.decisions.identity(entry)
    }

    /// H21: the open Decisions `actor` may see: every one for the user, only those of Agents in
    /// its Reach for an Agent.
    pub(crate) fn decisions_for(&self, actor: &Actor) -> Result<Vec<Decision>, RpcError> {
        let all = self.decisions.list();
        if actor.kind != contracts::ActorKind::Agent {
            return Ok(all);
        }
        let reach = self.reach(&actor.id)?;
        Ok(all
            .into_iter()
            .filter(|d| reach.contains(&d.agent))
            .collect())
    }

    /// U468: history uses the same authenticated Reach as the live Decision list.
    pub(crate) fn answers_for(
        &self,
        actor: &Actor,
        agent: &str,
    ) -> Result<Vec<contracts::decision::AnsweredDecision>, RpcError> {
        if actor.kind == contracts::ActorKind::Agent && !self.reach(&actor.id)?.contains(agent) {
            return Err(RpcError::forbidden(format!(
                "{agent} is outside the Reach of {}",
                actor.id
            )));
        }
        let history = self
            .decisions
            .history
            .lock()
            .expect("Decision history lock");
        let mut statement = history
            .prepare("SELECT record FROM decision_answers WHERE agent = ?1 AND completed = 1 ORDER BY seq")
            .map_err(RpcError::internal)?;
        let rows = statement
            .query_map([agent], |row| row.get::<_, String>(0))
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            serde_json::from_str(&row.map_err(RpcError::internal)?).map_err(RpcError::internal)
        })
        .collect()
    }

    /// H21: whether Agent `m` may answer Decision `id`: `NOT_FOUND` for an unknown id, then
    /// `FORBIDDEN` outside its Reach, then `CONFLICT` under a Takeover.
    fn may_answer(&self, m: &str, id: &str) -> Result<(), RpcError> {
        let Some(agent) = self.decisions.agent_of(id) else {
            return Err(RpcError::not_found(format!("decision {id}")));
        };
        if !self.reach(m)?.contains(&agent) {
            return Err(RpcError::forbidden(format!(
                "decision {id} is of {agent}, which is not in the Reach of {m}"
            )));
        }
        if self.takeover.as_ref().is_some_and(|active| active(&agent)) {
            return Err(RpcError::conflict(format!(
                "{agent} is under a Takeover; the user decides at its Terminal"
            )));
        }
        Ok(())
    }

    /// H3, H14, H21: the `answer` for Decision `id`: the user's, which needs `proof`, or an
    /// Agent's, which needs the Decision's Agent in its Reach and ignores `proof`.
    pub(crate) fn answer(&self, ctx: &rpc::Ctx, params: AnswerParams) -> Result<(), RpcError> {
        // Capture only an authenticated, in-Reach original. A refusal after a
        // concurrent replacement must never annotate the replacement request.
        let original = if ctx.actor.kind == contracts::ActorKind::Agent {
            let reach = self.reach(&ctx.actor.id)?;
            let open = self.decisions.open();
            open.values()
                .find(|entry| {
                    entry.decision.id == params.id && reach.contains(&entry.decision.agent)
                })
                .filter(|entry| {
                    params
                        .identity
                        .as_ref()
                        .is_none_or(|identity| self.decisions.guard(entry, identity).is_ok())
                })
                .map(|entry| (entry.decision.agent.clone(), entry.attempt.clone()))
        } else {
            None
        };
        let id = params.id.clone();
        let result = self.answer_checked(ctx, params);
        if let (Err(error), Some((agent, attempt))) = (&result, original) {
            let mut open = self.decisions.open();
            if let Some(entry) = open
                .get_mut(&agent)
                .filter(|entry| entry.decision.id == id && entry.attempt == attempt)
            {
                entry.decision.failure = Some(contracts::decision::FailedAnswer {
                    attempt,
                    answered_by: ctx.actor.clone(),
                    failed_at: (self.clock)(),
                    error_code: error.code,
                    message: error.message.clone(),
                });
            }
        }
        result
    }

    fn answer_checked(&self, ctx: &rpc::Ctx, params: AnswerParams) -> Result<(), RpcError> {
        let AnswerParams {
            id,
            answer,
            note,
            proof,
            identity,
        } = params;
        let id = id.as_str();
        let answer = answer.as_deref();
        let proof = proof.as_deref();
        if note.chars().count() > MAX_NOTE_CHARS {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("note is up to {MAX_NOTE_CHARS} characters"),
            ));
        }
        let actor = ctx.actor.clone();
        if actor.kind == contracts::ActorKind::Agent {
            if let Some(identity) = &identity {
                self.guard_reach(&actor, &identity.agent, false)?;
                if self
                    .takeover
                    .as_ref()
                    .is_some_and(|active| active(&identity.agent))
                {
                    return Err(RpcError::conflict(format!(
                        "{} is under a Takeover; the user decides at its Terminal",
                        identity.agent
                    )));
                }
            } else {
                self.may_answer(&actor.id, id)?;
            }
        } else if self.decisions.proof.is_none() || self.decisions.proof.as_deref() != proof {
            return Err(RpcError::forbidden("decision.answer needs the App's proof"));
        }
        self.deliver_answer(ctx, params_for_delivery(id, answer, &note, identity), None)
    }

    fn deliver_answer(
        &self,
        ctx: &rpc::Ctx,
        params: AnswerParams,
        terminal: Option<(&str, u32)>,
    ) -> Result<(), RpcError> {
        let AnswerParams {
            id,
            answer,
            note,
            identity,
            ..
        } = params;
        let id = id.as_str();
        let answer = answer.as_deref();
        let mut actor = ctx.actor.clone();
        let mut history = self
            .decisions
            .history
            .lock()
            .expect("Decision history lock");
        let (agent, attempt, outcome, waiter, text) = {
            let runs = self.runs();
            let mut open = self.decisions.open();
            if let Some(identity) = &identity {
                let Some(crate::Slot::Running(run)) = runs.get(&identity.agent) else {
                    return Err(original_gone(identity));
                };
                if run.ended
                    || run.closing
                    || run.attempt != identity.attempt
                    || identity.decision != id
                {
                    return Err(original_gone(identity));
                }
                let entry = open
                    .get(&identity.agent)
                    .ok_or_else(|| original_gone(identity))?;
                self.decisions.guard(entry, identity)?;
                if let Some(probe) = &self.decisions.before_effect {
                    probe(identity)?;
                }
            }
            let Some((agent, entry)) = open.iter_mut().find(|(_, o)| o.decision.id == id) else {
                return Err(RpcError::not_found(format!("decision {id}")));
            };
            if let Some((owner, pid)) = terminal {
                let Some(crate::Slot::Running(run)) = runs.get(owner) else {
                    return Err(RpcError::conflict("the original question's Attempt ended"));
                };
                if agent != owner
                    || run.ended
                    || run.closing
                    || run.attempt != entry.attempt
                    || self.terminals.program_pid(&run.terminal_id) != Some(pid)
                    || entry.choices.is_none()
                {
                    return Err(RpcError::conflict(
                        "the original Terminal question is unavailable",
                    ));
                }
                actor = entry.terminal_actor.clone().ok_or_else(|| {
                    RpcError::forbidden(
                        "a native question response needs authenticated Terminal input",
                    )
                })?;
                if !matches!(
                    actor.kind,
                    contracts::ActorKind::User | contracts::ActorKind::Agent
                ) {
                    return Err(RpcError::forbidden(
                        "only the user or an Agent in Reach may answer",
                    ));
                }
                if actor.kind == contracts::ActorKind::Agent {
                    if !self.reach(&actor.id)?.contains(owner) {
                        return Err(RpcError::forbidden(
                            "the Terminal writer has no Reach over this question",
                        ));
                    }
                    if self.takeover.as_ref().is_some_and(|active| active(owner)) {
                        return Err(RpcError::conflict("the child is under a Takeover"));
                    }
                }
            }
            if !entry.decision.answerable {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("decision {id} can only be answered in the Terminal"),
                ));
            }
            let (text, outcome) = match &entry.choices {
                Some(choices) => {
                    let own = answer.is_none() && !note.trim().is_empty();
                    if !own && !answer.is_some_and(|a| choices.labels.iter().any(|c| c == a)) {
                        return Err(RpcError::new(
                            code::INVALID_PARAMS,
                            format!(
                                "decision {id} takes one of its listed answers, or a note as your own"
                            ),
                        ));
                    }
                    let output = AskOutput {
                        answer: answer.map(str::to_owned),
                        note: note.to_owned(),
                    };
                    (
                        serde_json::to_string(&output).expect("an answer is JSON"),
                        Outcome::Answered,
                    )
                }
                None => match answer.and_then(Answer::from_word) {
                    Some(word) if note.is_empty() => (
                        claude_code::reply(word),
                        match word {
                            Answer::Allow => Outcome::Allow,
                            Answer::Deny => Outcome::Deny,
                        },
                    ),
                    _ => {
                        return Err(RpcError::new(
                            code::INVALID_PARAMS,
                            "answer is allow or deny, with no note",
                        ));
                    }
                },
            };
            if entry
                .waiter
                .as_ref()
                .expect("an answerable Decision waits")
                .is_closed()
            {
                // The caller has gone; its guard is about to clear the Decision as a close.
                return Err(RpcError::not_found(format!("decision {id}")));
            }
            let record = contracts::decision::AnsweredDecision {
                decision: Decision {
                    failure: None,
                    ..entry.decision.clone()
                },
                kind: if entry.choices.is_some() {
                    contracts::decision::RequestKind::Question
                } else {
                    contracts::decision::RequestKind::Permission
                },
                prompt: entry.prompt.clone(),
                attempt: entry.attempt.clone(),
                answer: answer.map(str::to_owned),
                note: note.clone(),
                answered_by: actor.clone(),
                answered_at: (self.clock)(),
            };
            let agent = agent.clone();
            let attempt = entry.attempt.clone();
            // Stage an unobserved draft before consuming the actionable request.
            // No SQLite write lock may span observe or Touch (the same Project DB).
            let tx = history.transaction().map_err(RpcError::internal)?;
            tx.execute(
                "INSERT INTO decision_answers(decision, agent, record) VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    id,
                    agent,
                    serde_json::to_string(&record).map_err(RpcError::internal)?
                ],
            )
            .map_err(RpcError::internal)?;
            tx.commit().map_err(RpcError::internal)?;
            let waiter = entry.waiter.take().expect("an answerable Decision waits");
            open.remove(&agent);
            (agent, attempt, outcome, waiter, text)
        };
        cleared(&self.bus, id, outcome);
        let ctx = rpc::Ctx {
            actor: actor.clone(),
            bus: ctx.bus.clone(),
            touches: Arc::clone(&ctx.touches),
        };
        if let Err(err) = ctx.touch(contracts::Verb::Wrote, &format!("decision:{id}")) {
            eprintln!("agents: no Touch for the answer to Decision {id}: {err}");
        }
        if let Err(err) = self.observe(actor, &agent, &attempt, Observation::Answered) {
            eprintln!("agents: {agent}: answered Decision {id} after the Agent ended: {err}");
        }
        // H9: the hook wakes after Answered, so its next Stop cannot be overtaken.
        // A closed hook leaves only an incomplete draft, never a successful record.
        waiter
            .send(Ok(text))
            .map_err(|_| RpcError::not_found(format!("decision {id}")))?;
        history
            .execute(
                "UPDATE decision_answers SET completed = 1 WHERE decision = ?1",
                [id],
            )
            .map_err(|error| {
                RpcError::unknown_outcome(format!(
                    "Decision delivered but answer record commit failed: {error}"
                ))
            })?;
        Ok(())
    }

    /// H14: the `ask_user` call was dropped while its Decision was open, so the Agent moved on.
    fn ask_closed(&self, agent: &str, decision: &str) {
        let attempt = {
            let mut open = self.decisions.open();
            let Some(entry) = open.get(agent).filter(|o| o.decision.id == decision) else {
                return;
            };
            let attempt = entry.attempt.clone();
            open.remove(agent);
            attempt
        };
        cleared(&self.bus, decision, Outcome::Terminal);
        if let Err(err) = self.observe(Actor::daemon(), agent, &attempt, Observation::Dismissed) {
            eprintln!(
                "agents: {agent}: dismissed Decision {decision} after the Agent ended: {err}"
            );
        }
    }

    /// The hook's connection closed while its Decision was open and nothing of the Daemon's made
    /// it close (H7(b), H7(c)).
    fn hook_closed(&self, agent: &str, decision: &str, started: i64) {
        let attempt = {
            let mut open = self.decisions.open();
            let Some(entry) = open.get_mut(agent).filter(|o| o.decision.id == decision) else {
                return;
            };
            let waited = (self.clock)() - started;
            if waited >= i64::try_from(self.decisions.hook_timeout.as_millis()).unwrap_or(i64::MAX)
            {
                entry.decision.answerable = false;
                entry.waiter = None;
                eprintln!("agents: {agent}: the hook timed out; answer in the Terminal");
                return;
            }
            let attempt = entry.attempt.clone();
            open.remove(agent);
            attempt
        };
        cleared(&self.bus, decision, Outcome::Terminal);
        if let Err(err) = self.observe(Actor::daemon(), agent, &attempt, Observation::Dismissed) {
            eprintln!(
                "agents: {agent}: dismissed Decision {decision} after the Agent ended: {err}"
            );
        }
    }
}

impl crate::Agents {
    /// U468: accept a native vendor form response only from that exact running
    /// program, never its tools or MCP shim. Proof stays on decision.answer's path.
    pub fn answer_terminal_question(
        &self,
        ctx: &rpc::Ctx,
        pid: u32,
        response: contracts::decision::TerminalAnswer,
    ) -> Result<(), RpcError> {
        let owner = self
            .running_programs()
            .into_iter()
            .find(|(_, program)| *program == pid)
            .map(|(owner, _)| owner)
            .ok_or_else(|| {
                RpcError::forbidden("only the live primary program reports a native answer")
            })?;
        let answer = {
            let open = self.shared.decisions.open();
            let entry = open
                .get(&owner)
                .filter(|entry| entry.decision.id == response.id)
                .ok_or_else(|| {
                    RpcError::conflict("the original Terminal question is unavailable")
                })?;
            let choices = entry
                .choices
                .as_ref()
                .ok_or_else(|| RpcError::forbidden("this is not a question"))?;
            if choices.terminal.is_none() {
                return Err(RpcError::forbidden("this question has no native form"));
            }
            choices
                .labels
                .contains(&response.text)
                .then_some(response.text.clone())
        };
        let note = if answer.is_some() {
            response.note
        } else if response.note.is_empty() {
            response.text
        } else {
            format!("{}\n{}", response.text, response.note)
        };
        if note.chars().count() > MAX_NOTE_CHARS || (answer.is_none() && note.trim().is_empty()) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a question answer needs nonempty text of up to 2000 characters",
            ));
        }
        self.shared.deliver_answer(
            ctx,
            params_for_delivery(&response.id, answer.as_deref(), &note, None),
            Some((&owner, pid)),
        )
    }

    /// Supply B6's observer immediately before a guarded effect, within its identity
    /// critical section. Configure before the first call. A refusal has no effect;
    /// observers must not reenter Agents.
    #[must_use]
    pub fn with_prompt_effect(
        self,
        probe: impl Fn(&PromptIdentity) -> Result<(), RpcError> + Send + Sync + 'static,
    ) -> Self {
        self.configure(|shared| shared.decisions.before_effect = Some(Arc::new(probe)))
    }

    /// B6: guarded Terminal bytes are checked on its input thread while `runs` then
    /// `decisions` exclude Attempt changes, answers and prompt replacement. User input
    /// invalidates the original identity without removing H7's still-visible Decision.
    /// An identity is no authority: the caller must enforce the existing Terminal Reach.
    /// `actor` preserves the RPC role's scheduling/guards; `source` is the socket's
    /// authenticated writer, retained only as native answer provenance.
    pub async fn write_terminal(
        &self,
        actor: &Actor,
        source: &Actor,
        terminal: &str,
        bytes: Vec<u8>,
        identity: Option<PromptIdentity>,
    ) -> Result<(), RpcError> {
        let shared = Arc::clone(&self.shared);
        let terminal_id = terminal.to_owned();
        let user = actor.kind == contracts::ActorKind::User;
        let check = identity.map(PromptInput::Captured).or_else(|| {
            let runs = shared.runs();
            let open = shared.decisions.open();
            runs.iter().find_map(|(agent, slot)| match slot {
                crate::Slot::Running(run) if run.terminal_id == terminal_id => open
                    .get(agent)
                    .filter(|entry| entry.choices.is_some())
                    .map(|entry| PromptInput::Question(entry.decision.id.clone())),
                _ => None,
            })
        });
        let Some(check) = check else {
            if user && !bytes.is_empty() {
                // Invalidate before queueing: a guarded effect already at its physical write
                // wins first; otherwise no later guarded bytes can pass this input.
                let runs = shared.runs();
                let mut open = shared.decisions.open();
                for (agent, slot) in runs.iter() {
                    if let crate::Slot::Running(run) = slot
                        && run.terminal_id == terminal_id
                        && let Some(entry) = open.get_mut(agent)
                    {
                        entry.identity_available = false;
                    }
                }
            }
            return if actor.kind != contracts::ActorKind::Agent {
                shared.terminals.write(terminal, &bytes).await
            } else {
                shared.terminals.write_completed(terminal, bytes).await
            };
        };
        let actor = actor.clone();
        let source = source.clone();
        shared
            .terminals
            .clone()
            .write_with(terminal, move |writer| {
                let runs = shared.runs();
                let mut open = shared.decisions.open();
                let unavailable = || match &check {
                    PromptInput::Captured(identity) => original_gone(identity),
                    PromptInput::Question(_) => {
                        RpcError::conflict("the original Terminal question is unavailable")
                    }
                };
                let agent = match &check {
                    PromptInput::Captured(identity) => {
                        let Some(crate::Slot::Running(run)) = runs.get(&identity.agent) else {
                            return Err(unavailable());
                        };
                        if run.ended
                            || run.closing
                            || run.attempt != identity.attempt
                            || run.terminal_id != terminal_id
                        {
                            return Err(unavailable());
                        }
                        identity.agent.as_str()
                    }
                    PromptInput::Question(decision) => runs
                        .iter()
                        .find_map(|(agent, slot)| match slot {
                            crate::Slot::Running(run)
                                if run.terminal_id == terminal_id && !run.ended && !run.closing =>
                            {
                                open.get(agent)
                                    .filter(|entry| {
                                        entry.decision.id == *decision
                                            && entry.attempt == run.attempt
                                    })
                                    .map(|_| agent.as_str())
                            }
                            _ => None,
                        })
                        .ok_or_else(unavailable)?,
                };
                let entry = open.get_mut(agent).ok_or_else(unavailable)?;
                if actor.kind == contracts::ActorKind::Agent
                    && entry.choices.is_some()
                    && !shared.reach(&actor.id)?.contains(agent)
                {
                    return Err(RpcError::forbidden(
                        "the Terminal writer has no Reach over this question",
                    ));
                }
                if !user && shared.takeover.as_ref().is_some_and(|active| active(agent)) {
                    return Err(RpcError::conflict(format!("{agent} is under a Takeover")));
                }
                if let PromptInput::Captured(identity) = &check {
                    shared.decisions.guard(entry, identity)?;
                    if let Some(probe) = &shared.decisions.before_effect {
                        probe(identity)?;
                    }
                }
                // Consume before attempting IO: partial input cannot authorize a reply or a retry.
                if matches!(check, PromptInput::Captured(_)) || (user && !bytes.is_empty()) {
                    entry.identity_available = false;
                }
                if !bytes.is_empty() {
                    entry.terminal_actor = None;
                }
                writer
                    .write_all(&bytes)
                    .and_then(|()| writer.flush())
                    .map_err(|error| {
                        RpcError::unknown_outcome(format!(
                            "Terminal prompt input may be partial: {error}"
                        ))
                    })?;
                if !bytes.is_empty() {
                    entry.terminal_actor = Some(source);
                }
                Ok(())
            })
            .await
    }
}

fn params_for_delivery(
    id: &str,
    answer: Option<&str>,
    note: &str,
    identity: Option<PromptIdentity>,
) -> AnswerParams {
    AnswerParams {
        id: id.to_owned(),
        answer: answer.map(str::to_owned),
        note: note.to_owned(),
        proof: None,
        identity,
    }
}
