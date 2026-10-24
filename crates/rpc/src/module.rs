use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use contracts::{Actor, Event, EventData, Verb};
use provenance::Touches;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::sync::broadcast;

use crate::error::RpcError;

/// How many Events the log keeps (D11): the one number that bounds it.
pub const EVENT_WINDOW: u64 = 10_000;

/// Where the Daemon saves Events (D10). The Daemon's `project.db` implements it.
pub trait EventLog: Send + Sync {
    /// Save `event` and return its Event number.
    fn append(&self, event: &Event) -> Result<u64, RpcError>;
    /// Up to `limit` saved Events numbered above `after`, oldest first, each carrying its number.
    fn read(&self, after: u64, limit: usize) -> Result<Vec<Event>, RpcError>;
    /// The oldest number the log still keeps and the highest it has saved; the oldest is the
    /// highest plus one when the log is empty.
    fn bounds(&self) -> Result<(u64, u64), RpcError>;
}

struct Shared {
    sender: broadcast::Sender<Event>,
    log: Option<Arc<dyn EventLog>>,
    /// Parked across save-and-publish, so the log order is the live order and a subscriber that
    /// takes it sees the log's highest number and the live ring meet with no gap.
    order: Mutex<()>,
}

/// The typed event bus. Cheap to clone; every clone sends to the same subscribers.
#[derive(Clone)]
pub struct Bus {
    shared: Arc<Shared>,
    capacity: usize,
}

impl Default for Bus {
    fn default() -> Self {
        Self::new()
    }
}

impl Bus {
    /// A Bus that saves nothing: its Events carry no number.
    pub fn new() -> Self {
        Self::build(None)
    }

    /// A Bus that saves every Event in `log` (D10).
    pub fn with_log(log: Arc<dyn EventLog>) -> Self {
        Self::build(Some(log))
    }

    fn build(log: Option<Arc<dyn EventLog>>) -> Self {
        // Tokio rounds its ring to a power of two; report the retained event count.
        let capacity = 1024_usize.next_power_of_two();
        Self {
            shared: Arc::new(Shared {
                sender: broadcast::channel(capacity).0,
                log,
                order: Mutex::new(()),
            }),
            capacity,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.shared.sender.subscribe()
    }

    /// Maximum retained events before an unread receiver reports lag.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Publish an event, saving it first. Having no subscribers is
    /// normal, not an error.
    pub fn emit(&self, actor: Actor, data: EventData) {
        let mut event = Event {
            seq: None,
            actor,
            data,
        };
        let _order = self.shared.order.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(log) = &self.shared.log {
            match log.append(&event) {
                Ok(seq) => event.seq = Some(seq),
                Err(err) => eprintln!("rpc: an event was not saved: {}", err.message),
            }
        }
        let _ = self.shared.sender.send(event);
    }

    /// Every saved Event numbered above `after`, oldest first, and the highest saved number (B44):
    /// for a reader that decides from the log once and then follows the live Events. `EVENTS_EXPIRED`
    /// when the log no longer keeps `after + 1`; no log is an empty answer.
    pub fn saved_after(&self, after: u64) -> Result<(Vec<Event>, u64), RpcError> {
        let _order = self.shared.order.lock().unwrap_or_else(|e| e.into_inner());
        let Some(log) = &self.shared.log else {
            return Ok((Vec::new(), 0));
        };
        let (oldest, highest) = log.bounds()?;
        if after + 1 < oldest {
            return Err(RpcError::new(
                crate::error::code::EVENTS_EXPIRED,
                format!(
                    "after {after} is older than the log keeps; the oldest kept Event number is {oldest}"
                ),
            ));
        }
        let mut events = Vec::new();
        let mut last = after;
        while last < highest {
            let chunk = log.read(last, CHUNK)?;
            let Some(newest) = chunk.last().and_then(|event| event.seq) else {
                break;
            };
            last = newest;
            events.extend(chunk);
        }
        Ok((events, highest))
    }

    /// Subscribe from an Event number: every saved Event above `after` from the log, then every
    /// later one live, each once (D11). Without `after`, only Events saved from now on.
    pub fn subscribe_after(&self, after: Option<u64>) -> Result<Subscription, RpcError> {
        let _order = self.shared.order.lock().unwrap_or_else(|e| e.into_inner());
        let live = self.shared.sender.subscribe();
        let (mut last, mut replay_end) = (0, 0);
        if let Some(log) = &self.shared.log {
            let (oldest, highest) = log.bounds()?;
            replay_end = highest;
            last = match after {
                Some(after) if after > highest => {
                    return Err(RpcError::new(
                        crate::error::code::INVALID_PARAMS,
                        format!("after {after} is above the highest saved Event number {highest}"),
                    ));
                }
                Some(after) if after + 1 < oldest => {
                    return Err(RpcError::new(
                        crate::error::code::EVENTS_EXPIRED,
                        format!(
                            "after {after} is older than the log keeps; the oldest kept Event number is {oldest}: start without `--after`, or pass `--after {}`",
                            oldest - 1
                        ),
                    ));
                }
                Some(after) => after,
                None => highest,
            };
        }
        Ok(Subscription {
            log: self.shared.log.clone(),
            live,
            last,
            replay_end,
            backlog: VecDeque::new(),
        })
    }
}

/// How many Events one read of the log returns.
const CHUNK: usize = 256;

/// One subscriber's stream: the log first, the live ring after, and the log again whenever the
/// ring dropped Events this subscriber had not read.
pub struct Subscription {
    log: Option<Arc<dyn EventLog>>,
    live: broadcast::Receiver<Event>,
    /// The highest Event number queued or returned.
    last: u64,
    /// The highest number saved when this subscription began: the log serves up to it, the live
    /// ring serves above it.
    replay_end: u64,
    backlog: VecDeque<Event>,
}

impl Subscription {
    /// The highest Event number saved when this subscription began; 0 for an empty or absent log.
    pub fn head(&self) -> u64 {
        self.replay_end
    }

    /// The next Event; `None` once the Bus closes and the log is read out.
    pub async fn next(&mut self) -> Option<Event> {
        loop {
            if let Some(event) = self.backlog.pop_front() {
                return Some(event);
            }
            if self.last < self.replay_end {
                self.fill(self.replay_end);
                continue;
            }
            match self.live.recv().await {
                Ok(event) => match event.seq {
                    Some(seq) if seq <= self.last => {}
                    Some(seq) => {
                        self.fill(seq - 1);
                        self.last = seq;
                        self.backlog.push_back(event);
                    }
                    None => return Some(event),
                },
                // The ring dropped Events; the log has them. The ring's later Events at or below
                // what the log gave are skipped above.
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let end = self.log.as_ref().and_then(|l| l.bounds().ok()).map(|b| b.1);
                    self.fill(end.unwrap_or(self.last));
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    }

    /// Queue the saved Events above `last` up to `until`.
    fn fill(&mut self, until: u64) {
        self.read_log(until);
        // Numbers the log no longer keeps are not coming; do not wait on them.
        self.last = self.last.max(until);
    }

    fn read_log(&mut self, until: u64) {
        let Some(log) = &self.log else { return };
        while self.last < until {
            match log.read(self.last, CHUNK) {
                Ok(events) if !events.is_empty() => {
                    for event in events {
                        let seq = event.seq.unwrap_or(0);
                        if seq > until {
                            return;
                        }
                        self.last = seq;
                        self.backlog.push_back(event);
                    }
                }
                Ok(_) => return,
                Err(err) => {
                    eprintln!("rpc: the event log was not read: {}", err.message);
                    return;
                }
            }
        }
    }
}

/// What one call knows: who made it, where to publish events, where to log Touches.
pub struct Ctx {
    pub actor: Actor,
    pub bus: Bus,
    pub touches: Arc<Touches>,
}

impl Ctx {
    /// Log a read or write of `item` (`todo:<id>`, `pad:<name>` or `agent:<id>`) by the caller.
    pub fn touch(&self, verb: Verb, item: &str) -> Result<(), RpcError> {
        self.touches
            .record(&self.actor, verb, item)
            .map_err(RpcError::internal)
    }

    /// Publish an event caused by this call.
    pub fn emit(&self, data: EventData) {
        self.bus.emit(self.actor.clone(), data);
    }
}

/// One module of the Daemon. Owns one or more method namespaces (the part before the first dot).
/// A module's answer to a call: a `Value`, or JSON text already written, which the Daemon sends
/// without first building a `Value` tree for it.
pub enum Reply {
    Value(Value),
    Json(String),
}

#[async_trait]
pub trait Module: Send + Sync {
    fn namespaces(&self) -> &'static [&'static str];

    /// `method` is the full name, for example `todo.create`.
    async fn call(&self, ctx: &Ctx, method: &str, params: Value) -> Result<Value, RpcError>;

    /// `call`, for a method whose reply is large enough that its `Value` tree costs more than
    /// writing it. The default wraps `call`.
    async fn call_reply(&self, ctx: &Ctx, method: &str, params: Value) -> Result<Reply, RpcError> {
        self.call(ctx, method, params).await.map(Reply::Value)
    }
}

/// Decode request parameters; a bad shape is the caller's error.
pub fn params<T: DeserializeOwned>(value: Value) -> Result<T, RpcError> {
    serde_json::from_value(value).map_err(|err| {
        RpcError::new(
            crate::error::code::INVALID_PARAMS,
            format!("invalid params: {err}"),
        )
    })
}

/// Encode a result as JSON text, for `Module::call_reply`.
pub fn json<T: Serialize>(value: &T) -> Result<Reply, RpcError> {
    serde_json::to_string(value)
        .map(Reply::Json)
        .map_err(RpcError::internal)
}

/// Encode a result.
pub fn reply<T: Serialize>(value: &T) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(RpcError::internal)
}
