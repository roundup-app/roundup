//! B41 to B44: the Daemon decides from `agent.status` Events, never a clock, when an Agent's Wake
//! request holds, fires it as one Message, and sends a parent the note of a child that fails or needs
//! the user (B43). Requests live in `project.db`, so a restart decides them again from the Event log.

use std::collections::HashMap;
use std::sync::Arc;

use contracts::agent::{DigestEntry, NodeKind, RailNode, WakeParams, Woken};
use contracts::{Actor, ActorKind, Event, EventData, Kind};
use rpc::{Bus, RpcError, code};
use tokio::sync::broadcast::{Receiver, error::RecvError};

use crate::digest::{Reader, World};

const MAX_IDS: usize = 20;

/// What the deciding task remembers between Events: serialised by its lock, so a registration and a
/// live Event never decide one request at once.
#[derive(Default)]
pub struct Gate {
    /// The Kind each Agent had at its last Event, to see a change into `error` or `needs-you`.
    kinds: HashMap<String, Kind>,
}

/// A request that fired: its waiter and the Agents it named.
struct Fired {
    waiter: String,
    ids: Vec<String>,
}

#[derive(Clone)]
pub struct Waker {
    pub agents: Arc<agents::Agents>,
    pub reader: Reader,
    pub messages: Arc<messages::Messages>,
    pub digests: Arc<messages::digest::Seen>,
    pub bus: Bus,
    pub gate: Arc<tokio::sync::Mutex<Gate>>,
}

fn is_agent(node: &RailNode) -> bool {
    match node.kind {
        NodeKind::Agent => true,
        NodeKind::Workstream => node.attempt.is_some(),
    }
}

fn kind_of(world: &World, id: &str) -> Option<Kind> {
    world
        .nodes()
        .iter()
        .find(|node| node.id == id && is_agent(node))
        .and_then(|node| node.status.as_ref().map(|status| status.kind))
}

impl Waker {
    /// B41: `agent.wake`. Saves the request, decides it at once, and answers `{id, fired}`.
    pub async fn ask(&self, caller: &Actor, params: serde_json::Value) -> Result<Woken, RpcError> {
        if caller.kind != ActorKind::Agent {
            return Err(RpcError::forbidden("only an Agent may ask to be woken"));
        }
        let WakeParams { ids, any } = rpc::params(params)?;
        if ids.is_empty() || ids.len() > MAX_IDS {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("ids must name 1 to {MAX_IDS} Agents"),
            ));
        }
        let mut seen = std::collections::HashSet::new();
        if let Some(repeated) = ids.iter().find(|id| !seen.insert(id.as_str())) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("{} is named twice", self.agents.rail_name(repeated)?),
            ));
        }
        if ids.contains(&caller.id) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "an Agent cannot wait on itself",
            ));
        }
        let mut gate = self.gate.lock().await;
        // The head is read before the Rail, so a finish between the two is replayed below.
        let head = self.bus.subscribe_after(None)?.head();
        let world = self.reader.world().await?;
        if ids.iter().any(|id| kind_of(&world, id).is_none()) {
            return Err(RpcError::not_found("an Agent that is gone"));
        }
        let present: Vec<String> = ids
            .iter()
            .filter(|id| kind_of(&world, id).is_some_and(messages::wake::finished))
            .cloned()
            .collect();
        let wake =
            self.messages
                .save_wake(&caller.id, &ids, any.unwrap_or(false), &present, head)?;
        let id = wake.id;
        let replay = self.replay(&wake);
        self.decide(&mut gate, wake, &replay, &world).await;
        let fired = self.messages.wake(id)?.is_none();
        // B48(a): the one reason a request is saved and waits.
        let why = (!fired).then(|| "already working".to_owned());
        Ok(Woken { id, fired, why })
    }

    /// B44: the saved Events a request has not yet been decided on; none when the log no longer
    /// keeps them, so the present Kinds decide.
    fn replay(&self, wake: &messages::wake::Wake) -> Vec<Event> {
        match self.bus.saved_after(wake.seen) {
            Ok((events, _)) => events,
            Err(err) if err.code == code::EVENTS_EXPIRED => Vec::new(),
            Err(err) => {
                eprintln!("rupd: wake: the event log was not read: {}", err.message);
                Vec::new()
            }
        }
    }

    /// Decides `wake` from `events`, in order, and the Kinds in `world`: records what finished, and
    /// fires the request when it holds. Returns what fired.
    async fn decide(
        &self,
        _gate: &mut Gate,
        mut wake: messages::wake::Wake,
        events: &[Event],
        world: &World,
    ) -> Option<Fired> {
        let before = (wake.finished.clone(), wake.seen);
        for event in events {
            if let Some(seq) = event.seq {
                wake.seen = wake.seen.max(seq);
            }
            if let EventData::AgentStatus(status) = &event.data
                && wake.ids.contains(&status.id)
                && messages::wake::finished(status.status.kind)
                && !wake.finished.contains(&status.id)
            {
                wake.finished.push(status.id.clone());
            }
        }
        for id in wake.ids.clone() {
            // B41(c): an Agent that is gone counts as finished, with Kind `done`.
            let finished = kind_of(world, &id).is_none_or(messages::wake::finished);
            if finished && !wake.finished.contains(&id) {
                wake.finished.push(id);
            }
        }
        if !wake.holds() {
            if (wake.finished.clone(), wake.seen) != before
                && let Err(err) = self.messages.keep_wake(wake.id, &wake.finished, wake.seen)
            {
                eprintln!("rupd: wake: not kept: {}", err.message);
            }
            return None;
        }
        if kind_of(world, &wake.waiter) == Some(Kind::Done) {
            if (wake.finished.clone(), wake.seen) != before {
                let _ = self.messages.keep_wake(wake.id, &wake.finished, wake.seen);
            }
            return None;
        }
        let entries: Vec<DigestEntry> = wake.ids.iter().map(|id| self.entry(id, world)).collect();
        let body = messages::wake::note_body(&entries);
        match self.messages.fire_wake(wake.id, &wake.waiter, body).await {
            Ok(true) => Some(Fired {
                waiter: wake.waiter,
                ids: wake.ids,
            }),
            Ok(false) => None,
            Err(err) => {
                eprintln!("rupd: wake: not fired: {}", err.message);
                None
            }
        }
    }

    fn entry(&self, id: &str, world: &World) -> DigestEntry {
        self.digests
            .entry_of(id, &world.sources(), false)
            .unwrap_or_else(|| DigestEntry {
                name: self.agents.rail_name(id).expect("read wake Agent name"),
                kind: Kind::Done,
                last: String::new(),
                todos: 0,
                pads: Vec::new(),
            })
    }

    /// B44: decides every open request again, from the log and the present Kinds.
    async fn recover(&self) {
        let Ok(world) = self.reader.world().await else {
            return;
        };
        let wakes = match self.messages.wakes() {
            Ok(wakes) => wakes,
            Err(err) => {
                eprintln!("rupd: wake: requests not read: {}", err.message);
                return;
            }
        };
        let mut gate = self.gate.lock().await;
        for wake in wakes {
            let replay = self.replay(&wake);
            self.decide(&mut gate, wake, &replay, &world).await;
        }
    }

    /// One live Event: decide each request it can move, end the requests of an Agent that ended
    /// (B41(f)), and send a parent the note of a child in `error` or `needs-you` (B43).
    async fn live(&self, event: Event) {
        let status = match &event.data {
            EventData::AgentStatus(status) => Some(status),
            EventData::RailChanged => None,
            _ => return,
        };
        let mut gate = self.gate.lock().await;
        let Ok(world) = self.reader.world().await else {
            return;
        };
        let wakes = self.messages.wakes().unwrap_or_default();
        let mut fired = Vec::new();
        for wake in wakes {
            // B41(f): a removed waiter ends its requests. One that stopped keeps them, unfired,
            // since a resume of it (B36) is the same Agent; nothing is sent to a `done` Agent.
            if kind_of(&world, &wake.waiter).is_none() {
                if let Err(err) = self.messages.drop_wakes_of(&wake.waiter) {
                    eprintln!("rupd: wake: not dropped: {}", err.message);
                }
                continue;
            }
            fired.extend(
                self.decide(&mut gate, wake, std::slice::from_ref(&event), &world)
                    .await,
            );
        }
        let Some(status) = status else { return };
        let previous = gate.kinds.insert(status.id.clone(), status.status.kind);
        if previous == Some(status.status.kind)
            || !matches!(status.status.kind, Kind::Error | Kind::NeedsYou)
        {
            return;
        }
        let Some(parent) = world
            .nodes()
            .iter()
            .find(|node| node.id == status.id)
            .and_then(|node| node.parent.clone())
        else {
            return;
        };
        let told_by_wake = fired
            .iter()
            .any(|f| f.waiter == parent && f.ids.contains(&status.id));
        if told_by_wake
            || !world
                .nodes()
                .iter()
                .any(|node| node.id == parent && is_agent(node))
        {
            return;
        }
        if let Some(entry) = self.digests.entry_of(&status.id, &world.sources(), true)
            && !self
                .digests
                .repeats_last_note(&parent, &status.id, status.status.kind)
            && let Err(err) = self.messages.note_attention(&parent, &entry).await
        {
            eprintln!("rupd: wake: note to {parent} not sent: {}", err.message);
        }
    }

    /// Runs until the Bus closes.
    pub async fn run(self, mut events: Receiver<Event>) {
        if let Ok(world) = self.reader.world().await {
            let mut gate = self.gate.lock().await;
            for node in world.nodes().iter().filter(|node| is_agent(node)) {
                if let Some(status) = &node.status {
                    gate.kinds.insert(node.id.clone(), status.kind);
                }
            }
        }
        self.recover().await;
        loop {
            match events.recv().await {
                Ok(event) => self.live(event).await,
                Err(RecvError::Lagged(_)) => self.recover().await,
                Err(RecvError::Closed) => return,
            }
        }
    }
}

/// B2704a: turn each committed name into one ordinary Daemon note. The Message module owns
/// idle delivery, Takeover holding, persistence and transcript acknowledgement.
pub async fn tell_renames(reader: Reader, mut events: rpc::Subscription) {
    while let Some(event) = events.next().await {
        let EventData::RailRenamed { id, name } = event.data else {
            continue;
        };
        let nodes: Vec<RailNode> = reader
            .call(
                "rail",
                "rail.tree",
                serde_json::Value::Null,
                Actor::daemon(),
            )
            .await
            .expect("read renamed Agent");
        if !nodes.iter().any(|node| {
            node.id == id
                && is_agent(node)
                && node.terminal_id.is_some()
                && node
                    .status
                    .as_ref()
                    .is_some_and(|status| status.kind != Kind::Done)
        }) {
            continue;
        }
        let sent = reader.call::<contracts::message::Message>("message", "message.send", serde_json::json!({
            "to": id, "kind": "note", "body": format!("you are now called \"{name}\" on the Rail")
        }), Actor::daemon()).await;
        if let Err(err) = sent {
            match err.code {
                // B51 saves a mismatched-inbox note held before returning this error.
                rpc::code::INBOX_UNAVAILABLE => {}
                // Ordinary B1/B51 send refusals (including a concurrent stop) must not
                // terminate the observer and prevent later committed names being sent.
                rpc::code::NOT_FOUND | rpc::code::CONFLICT | rpc::code::INVALID_PARAMS => {
                    eprintln!("rupd: Rail rename note for {name} refused: {err}");
                }
                _ => panic!("queue Rail rename note: {err}"),
            }
        }
    }
}
