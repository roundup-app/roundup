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

/// `WakeParams` whose `ids` list was checked while parsing: one to twenty.
#[derive(serde::Deserialize)]
#[serde(try_from = "WakeParams")]
struct WakeRequest(WakeParams);

impl TryFrom<WakeParams> for WakeRequest {
    type Error = &'static str;

    fn try_from(params: WakeParams) -> Result<Self, Self::Error> {
        if params.ids.is_empty() || params.ids.len() > 20 {
            return Err("ids must name 1 to 20 Agents");
        }
        Ok(Self(params))
    }
}

pub(super) fn parse_request(params: serde_json::Value) -> Result<WakeParams, RpcError> {
    Ok(rpc::params::<WakeRequest>(params)?.0)
}

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

pub(crate) fn is_agent(node: &RailNode) -> bool {
    match node.kind {
        NodeKind::Group => false,
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

fn label_of(world: &World, id: &str) -> Option<String> {
    world
        .nodes()
        .iter()
        .find(|node| node.id == id && is_agent(node))
        .and_then(|node| node.status.as_ref().map(|status| status.label.clone()))
}

/// B48(a), DCL3e: "already working", then the first label that names what a hold waits on.
fn why_working(labels: Vec<String>) -> String {
    match labels.iter().find(|label| label.starts_with("waiting on ")) {
        Some(label) => format!("already working, {label}"),
        None => "already working".to_owned(),
    }
}

impl Waker {
    /// B41: `agent.wake`. Saves the request, decides it at once, and answers `{id, fired}`.
    pub async fn ask(&self, caller: &Actor, params: WakeParams) -> Result<Woken, RpcError> {
        if caller.kind != ActorKind::Agent {
            return Err(RpcError::forbidden("only an Agent may ask to be woken"));
        }
        let WakeParams { ids, any } = WakeRequest::try_from(params)
            .map_err(|message| RpcError::new(code::INVALID_PARAMS, message))?
            .0;
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
        let head = self.bus.subscribe_after(Default::default())?.head();
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
        let why = (!fired)
            .then(|| why_working(ids.iter().filter_map(|id| label_of(&world, id)).collect()));
        Ok(Woken { id, fired, why })
    }

    /// B44: the saved Events a request has not yet been decided on; none when the log no longer
    /// keeps them, so the present Kinds decide.
    fn replay(&self, wake: &messages::wake::Wake) -> Vec<Event> {
        match self.bus.saved_after(wake.seen) {
            Ok((events, _)) => events,
            Err(err) if err.code == code::EVENTS_EXPIRED => Vec::new(),
            Err(err) => {
                eprintln!("rupd: wake: the event log was not read: {}", err);
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
                eprintln!("rupd: wake: not kept: {}", err);
            }
            return None;
        }
        if kind_of(world, &wake.waiter) == Some(Kind::Done) {
            if (wake.finished.clone(), wake.seen) != before {
                let _ = self.messages.keep_wake(wake.id, &wake.finished, wake.seen);
            }
            return None;
        }
        let entries: Result<Vec<DigestEntry>, _> =
            wake.ids.iter().map(|id| self.entry(id, world)).collect();
        let entries = match entries {
            Ok(entries) => entries,
            Err(err) => {
                eprintln!("rupd: wake: not fired: {err}");
                return None;
            }
        };
        let body = messages::wake::note_body(&entries);
        match self.messages.fire_wake(wake.id, &wake.waiter, body).await {
            Ok(true) => Some(Fired {
                waiter: wake.waiter,
                ids: wake.ids,
            }),
            Ok(false) => None,
            Err(err) => {
                eprintln!("rupd: wake: not fired: {}", err);
                None
            }
        }
    }

    fn entry(&self, id: &str, world: &World) -> Result<DigestEntry, RpcError> {
        if let Some(entry) = self.digests.entry_of(id, &world.sources(), false) {
            return Ok(entry);
        }
        Ok(DigestEntry {
            name: self.agents.rail_name(id)?,
            kind: Kind::Done,
            last: String::new(),
            todos: 0,
            link: None,
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
                eprintln!("rupd: wake: requests not read: {}", err);
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
                    eprintln!("rupd: wake: not dropped: {}", err);
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
            eprintln!("rupd: wake: note to {parent} not sent: {}", err);
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
/// idle delivery, persistence and transcript acknowledgement.
pub async fn tell_renames(reader: Reader, mut events: rpc::Subscription) {
    while let Some(event) = events.next().await {
        let EventData::RailRenamed { id, name } = event.data else {
            continue;
        };
        let nodes: Vec<RailNode> = match reader
            .call(
                "rail",
                "rail.tree",
                serde_json::Value::Null,
                Actor::daemon(),
            )
            .await
        {
            Ok(nodes) => nodes,
            Err(err) => {
                eprintln!("rupd: Rail rename note for {name} not sent, Rail unreadable: {err}");
                return;
            }
        };
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
                // B51 saves a mismatched-inbox note saved before returning this error.
                rpc::code::INBOX_UNAVAILABLE => {}
                // Ordinary B1/B51 send refusals (including a concurrent stop) must not
                // terminate the observer and prevent later committed names being sent.
                rpc::code::NOT_FOUND | rpc::code::CONFLICT | rpc::code::INVALID_PARAMS => {
                    eprintln!("rupd: Rail rename note for {name} refused: {err}");
                }
                _ => {
                    eprintln!("rupd: Rail rename note for {name} failed: {err}");
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn c6629b_a_bad_wake_ids_list_fails_to_parse() {
        let ids = |n: usize| serde_json::json!({"ids": (0..n).map(|i| i.to_string()).collect::<Vec<_>>()});
        for bad in [0, 21] {
            let err = super::parse_request(ids(bad)).unwrap_err();
            assert_eq!(err.code, rpc::code::INVALID_PARAMS);
            assert!(err.message.contains("ids must name 1 to 20 Agents"));
        }
        for good in [1, 20] {
            assert_eq!(super::parse_request(ids(good)).unwrap().ids.len(), good);
        }
    }

    use super::*;

    #[test]
    fn dcl3e_wake_why_carries_the_hold_label() {
        let labels = vec!["working".to_owned(), "waiting on `npm test`".to_owned()];
        assert_eq!(
            why_working(labels),
            "already working, waiting on `npm test`"
        );
        assert_eq!(why_working(vec!["working".into()]), "already working");
    }
}
