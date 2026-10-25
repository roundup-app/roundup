//! Messages between Actors, and the Routes that decide how they are delivered. Owner: messages
//! Builder. Stores Messages and Routes, answers the user's and an Actor's calls, and on an `idle`
//! writes it to the receiving Agent's Claude inbox.

pub mod continuation;
pub mod digest;
#[doc(hidden)]
pub mod digest_schema;
pub mod evidence;
mod flight;
mod inbox;
mod pushes;
pub mod reaction;
mod receiver_view;
mod removal;
mod restart;
mod retirement;
#[doc(hidden)]
pub mod schema;
mod send;
mod step;
mod store;
pub mod wake;

use std::future::Future;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll};
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use contracts::agent::RailNode;
use contracts::message::{
    ListParams, Message, MessageId, MessageKind, MessageStatus, Reason, Route, SendParams,
    SetRouteParams,
};
use contracts::{Actor, ActorKind, EventData, Kind, Verb};
use flight::confirm_ids;
pub use inbox::NoteInbox;
use receiver_view::{gone_drops, idle_batch};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, code, params, reply};
use serde_json::Value;
use step::Event;
use store::Store;
use tokio::sync::broadcast::error::RecvError;

const MAX_BODY_BYTES: usize = 8192;

/// Daemon-internal receiver dependency; RPC remains `Module`'s unchanged interface.
/// Implementations must execute `record` exactly once under authoritative lifecycle locks
/// (Rail then Attempts), including `None` for an unowned Terminal. No cached facts are allowed.
/// The callback may take the Message store lock, but must not await, emit events, perform
/// Terminal I/O or reenter Agents. All ownership-dependent mutations finish before it returns;
/// returned facts grant no later mutation authority. Delivery and events follow this operation.
/// Lookup errors do not call `record`; callback errors propagate unchanged. The callback owns
/// rollback of partial work. Poisoned lifecycle locks panic, as in Agents.
pub trait TerminalOwners: Module {
    /// Passive evidence only; implementations without a running Agent collect none.
    fn observe_coordination(&self, _agent: &str, _message: u32) -> Option<agents::MeasurementWait> {
        None
    }

    fn with_terminal_owner(
        &self,
        terminal: &str,
        record: &mut dyn FnMut(Option<&agents::TerminalOwner>) -> Result<(), RpcError>,
    ) -> Result<(), RpcError>;
}

impl TerminalOwners for agents::Agents {
    fn observe_coordination(&self, agent: &str, message: u32) -> Option<agents::MeasurementWait> {
        agents::Agents::observe_coordination(self, agent, message)
    }

    fn with_terminal_owner(
        &self,
        terminal: &str,
        record: &mut dyn FnMut(Option<&agents::TerminalOwner>) -> Result<(), RpcError>,
    ) -> Result<(), RpcError> {
        agents::Agents::with_terminal_owner(self, terminal, record)
    }
}

/// The Daemon's clock in milliseconds; a test passes a fake (B14).
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// What the Daemon lends this module besides its Bus: the log where the Touches of Messages it
/// makes itself (B17) go, and its clock.
pub struct Env {
    pub touches: Arc<provenance::Touches>,
    pub clock: Clock,
    /// Called with an operation's name while it holds the store lock; an `Err` fails that
    /// operation with its text as the cause (B28's injection point).
    pub fault: Fault,
}

/// See `Env::fault`.
pub type Fault = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

impl Env {
    /// The system clock, logging the Daemon-made Messages' Touches to `touches`.
    pub fn system(touches: Arc<provenance::Touches>) -> Self {
        Self {
            touches,
            clock: Arc::new(now_ms),
            fault: Arc::new(|_| Ok(())),
        }
    }
}

struct Inner {
    store: Mutex<Store>,
    /// Answers `rail.tree`, the only thing `message.send` needs to know about a receiver: whether
    /// it names an Agent (or a Door) at all, and that Agent's Kind.
    agents: Arc<dyn TerminalOwners>,
    bus: Bus,
    /// Starts the listener at most once: immediately when `open` already runs on a Tokio
    /// runtime, lazily on the first call otherwise (a caller that builds a `Messages` before
    /// its own runtime exists).
    listener_started: std::sync::Once,
    /// Subscribed at `open`, before any runtime may exist, so no `agent.status` fires between
    /// `open` and the listener's first poll; `start_listener` takes it out at most once.
    events: Mutex<Option<tokio::sync::broadcast::Receiver<contracts::Event>>>,
    /// A `Ctx` for the calls the listener makes on its own behalf (B9's resync), and where the
    /// Touches of the Messages the Daemon makes (B17) are logged.
    touches: Arc<provenance::Touches>,
    clock: Clock,
    fault: Fault,
    // Test observers acknowledge whole background passes, including caught failures.
    #[cfg(test)]
    completed: tokio::sync::broadcast::Sender<&'static str>,
    /// B22: the pushes of each Door's window.
    pushes: tokio::sync::Mutex<pushes::Ledger>,
    // A reservation waits for any accepted prompt to finish before its caller stops Agents.
    delivery: tokio::sync::RwLock<()>,
    /// B39: the Messages being written to an inbox by this Daemon run, so no second `idle`
    /// writes them again. A Message in flight at a kill is not in it.
    typing: Mutex<std::collections::HashSet<u32>>,
    /// B50: the transport of every Message to an Agent; without one nothing is delivered.
    inbox: std::sync::OnceLock<Arc<dyn NoteInbox>>,
}

/// Removes its Messages from `Inner::typing` when the inbox write that carries them is done.
struct Typing<'a> {
    set: &'a Mutex<std::collections::HashSet<u32>>,
    ids: Vec<u32>,
}

impl Drop for Typing<'_> {
    fn drop(&mut self) {
        let mut set = lock(self.set);
        for id in &self.ids {
            set.remove(id);
        }
    }
}

pub struct Messages {
    inner: Arc<Inner>,
}

impl Messages {
    /// `dir` is the Project's data folder (N1). `bus` is for events no call caused, and is
    /// how this module learns a Kind changed (it reads `agent.status`). `agents` answers
    /// the Rail; see `TerminalOwners` for its synchronous lifecycle contract.
    pub fn open(dir: &Path, bus: Bus, agents: Arc<dyn TerminalOwners>) -> Result<Self, OpenError> {
        let env = Env::system(Arc::new(provenance::Touches::in_memory()?));
        Self::open_with(dir, bus, agents, env)
    }

    /// `open`, with the Daemon's own Touch log and clock.
    pub fn open_with(
        dir: &Path,
        bus: Bus,
        agents: Arc<dyn TerminalOwners>,
        env: Env,
    ) -> Result<Self, OpenError> {
        let events = bus.subscribe();
        let inner = Arc::new(Inner {
            store: Mutex::new(Store::open(&dir.join(
                if dir.join("project.db").exists() {
                    "project.db"
                } else {
                    "messages.db"
                },
            ))?),
            agents,
            bus,
            listener_started: std::sync::Once::new(),
            events: Mutex::new(Some(events)),
            touches: env.touches,
            clock: env.clock,
            fault: env.fault,
            #[cfg(test)]
            completed: tokio::sync::broadcast::channel(32).0,
            pushes: tokio::sync::Mutex::default(),
            delivery: tokio::sync::RwLock::default(),
            typing: Mutex::default(),
            inbox: std::sync::OnceLock::new(),
        });
        if tokio::runtime::Handle::try_current().is_ok() {
            start_listener(&inner);
        }
        Ok(Self { inner })
    }

    /// B50: send every Message to an Agent through `inbox`. Set once, before any Message.
    pub fn set_inbox(&self, inbox: Arc<dyn NoteInbox>) {
        let _ = self.inner.inbox.set(inbox);
    }

    /// B50(c): the transcript of `agent` records these Messages' entries, so they are `delivered`.
    pub fn confirm_inbox(&self, agent: &str, ids: &[u32]) {
        confirm_ids(&self.inner, agent, ids);
    }

    /// B21, B22: accepts one change of the Subagent's entry. `subagent` is its stable Rail id,
    /// not its mutable display name. Waiting changes compact to the newest entry per id while
    /// retaining their weight. A stopped Door waits until a successful start; a removed Door's
    /// queue is discarded. Other refusals are logged with the receiver and retried by Messages,
    /// so acceptance is successful even when the entry cannot yet be sent.
    pub async fn push_digest(
        &self,
        meta: &str,
        subagent: &str,
        entry: &contracts::agent::DigestEntry,
    ) {
        pushes::push(&self.inner, meta, subagent, entry).await
    }

    /// A32: every Message sent to or by `door`, in order, each with its Iteration.
    pub fn thread(&self, door: &str) -> Result<Vec<Message>, RpcError> {
        self.store()?.thread(door)
    }

    /// A32: the Iteration `door` is in ends here; returns its number.
    pub fn end_iteration(&self, door: &str) -> Result<u32, RpcError> {
        self.store()?.end_iteration(door)
    }

    fn get(&self, ctx: &Ctx, p: MessageId) -> Result<Value, RpcError> {
        let message = self.get_or_not_found(p.id)?;
        require_readable(ctx, &message)?;
        ctx.touch(Verb::Read, &item(p.id))?;
        reply(&message)
    }

    fn list(&self, ctx: &Ctx, p: ListParams) -> Result<Value, RpcError> {
        let mut messages = match &p.id {
            Some(door) => self.store()?.thread(door)?,
            None => self.store()?.list()?,
        };
        if let Some(to) = &p.to {
            messages.retain(|message| &message.to == to);
        }
        if let Some(status) = p.status {
            messages.retain(|message| message.status == status);
        }
        if ctx.actor.kind != ActorKind::User {
            messages.retain(|message| {
                is_sender(message, &ctx.actor) || is_receiver(&ctx.actor, &message.to)
            });
        }
        reply(&messages)
    }

    async fn set_route(&self, ctx: &Ctx, p: SetRouteParams) -> Result<Value, RpcError> {
        let by_agent = ctx.actor.kind == ActorKind::Agent;
        if ctx.actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(
                "only the user or an Agent may set a Route",
            ));
        }
        if p.to == Actor::user().id {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Route cannot deliver to the user",
            ));
        }
        if p.from == p.to {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Route's from and to must differ",
            ));
        }
        let nodes = if by_agent {
            load_rail_nodes(&self.inner).await?
        } else {
            Vec::new()
        };
        let name = |id: &str| {
            if id == Actor::user().id {
                "you"
            } else {
                nodes
                    .iter()
                    .find(|node| node.id == id)
                    .map_or("an Agent that is gone", |node| node.name.as_str())
            }
        };
        {
            let store = self.store()?;
            // M14: a Route the user or an Extension set is never overridden by an Agent (B5).
            if by_agent
                && store.get_route(&p.from, &p.to)?.is_some()
                && !store.route_set_by_agent(&p.from, &p.to)?
            {
                return Err(RpcError::forbidden(format!(
                    "the Route from {} to {} was set by the user",
                    name(&p.from),
                    name(&p.to)
                )));
            }
            store.set_route(
                &p.from,
                &p.to,
                p.delivery,
                if by_agent { "agent" } else { "user" },
            )?;
        }
        if by_agent {
            ctx.touch(Verb::Wrote, &format!("route:{}>{}", p.from, p.to))?;
        }
        let route = Route {
            from: p.from,
            to: p.to,
            delivery: p.delivery,
        };
        ctx.emit(EventData::RouteChanged(route.clone()));
        reply(&route)
    }

    fn list_routes(&self) -> Result<Value, RpcError> {
        reply(&self.store()?.list_routes()?)
    }

    /// `to`'s Status, when it names an Agent or a Door; `None` when it names the user.
    /// `NOT_FOUND` when it names no Actor; `INVALID_PARAMS` when it names a plain
    /// Workstream, which cannot receive a Message.
    async fn resolve_receiver(&self, to: &str) -> Result<Option<RailNode>, RpcError> {
        if to == Actor::user().id {
            return Ok(None);
        }
        let nodes = load_rail_nodes(&self.inner).await?;
        let node = nodes
            .into_iter()
            .find(|node| node.id == to)
            .ok_or_else(|| RpcError::not_found(format!("actor {to}")))?;
        Ok(Some(node))
    }

    fn get_or_not_found(&self, id: u32) -> Result<Message, RpcError> {
        self.store()?
            .get(id)?
            .ok_or_else(|| RpcError::not_found(format!("message {id}")))
    }

    fn store(&self) -> Result<MutexGuard<'_, Store>, RpcError> {
        Ok(lock(&self.inner.store))
    }
}

fn require_user(ctx: &Ctx, action: &str) -> Result<(), RpcError> {
    if ctx.actor.kind == ActorKind::User {
        return Ok(());
    }
    Err(RpcError::forbidden(format!("only the user may {action}")))
}

/// B11: the user may read any Message; anyone else only one they sent or received.
fn require_readable(ctx: &Ctx, message: &Message) -> Result<(), RpcError> {
    if ctx.actor.kind == ActorKind::User
        || is_sender(message, &ctx.actor)
        || is_receiver(&ctx.actor, &message.to)
    {
        return Ok(());
    }
    Err(RpcError::forbidden(format!(
        "{} may not read message {}",
        ctx.actor.id, message.id
    )))
}

/// Whether `actor` sent `message`: by kind and id together, never id alone, since an Agent and
/// an Extension draw their ids from different namespaces and could share one.
fn is_sender(message: &Message, actor: &Actor) -> bool {
    message.from.kind == actor.kind && message.from.id == actor.id
}

/// Whether `to`, a Message's receiver id, names `actor`: Agents and the user are the only
/// receivers, so an Extension that shares an Agent's id is not that Agent.
fn is_receiver(actor: &Actor, to: &str) -> bool {
    matches!(actor.kind, ActorKind::Agent | ActorKind::User) && actor.id == to
}

fn item(id: u32) -> String {
    format!("message:{id}")
}

fn now() -> SystemTime {
    SystemTime::now()
}

fn now_ms() -> i64 {
    i64::try_from(
        now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

/// B53: a send names its `kind`; a missing or unknown one says which values are allowed.
fn send_params(value: Value) -> Result<SendParams, RpcError> {
    if !matches!(
        value.get("kind").and_then(Value::as_str),
        Some("note" | "question")
    ) {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "kind is required and must be `note` or `question`",
        ));
    }
    params(value)
}

#[async_trait]
impl Module for Messages {
    fn namespaces(&self) -> &'static [&'static str] {
        &["message", "route"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        start_listener(&self.inner);
        let result = guarded(method, self.dispatch(ctx, method, value)).await;
        match result {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(err)) => {
                if err.code == code::INTERNAL {
                    log_failure(method, &err.message);
                }
                Err(err)
            }
            Err(cause) => Err(RpcError::internal(format!("{method} failed: {cause}"))),
        }
    }
}

impl Messages {
    async fn dispatch(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        trip(&self.inner, method).map_err(RpcError::internal)?;
        match method {
            "message.send" => self.send(ctx, send_params(value)?).await,
            "message.get" => self.get(ctx, params(value)?),
            "message.list" => self.list(ctx, params(value)?),
            "message.drop" => self.drop_message(ctx, params(value)?).await,
            "route.set" => self.set_route(ctx, params(value)?).await,
            "route.list" => self.list_routes(),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

/// Takes the store lock, whatever panicked while it was taken before: a writer's transaction
/// rolls back with its panic (`Store::atomically`), so the Store it guards is whole (B28).
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs `Env::fault` for `op` inside the store lock.
fn trip(inner: &Inner, op: &str) -> Result<(), String> {
    let _store = lock(&inner.store);
    (inner.fault)(op)
}

fn log_failure(op: &str, cause: &str) {
    eprintln!("rupd: messages: {op} failed: {cause}");
}

fn cause_of(panic: Box<dyn std::any::Any + Send>) -> String {
    match panic.downcast::<String>() {
        Ok(text) => *text,
        Err(other) => other
            .downcast_ref::<&str>()
            .map_or_else(|| "panic".to_owned(), |text| (*text).to_owned()),
    }
}

/// `fut`'s output, or the cause of the panic that ended it, logged once with the operation (B28).
async fn guarded<T>(op: &str, fut: impl Future<Output = T> + Send) -> Result<T, String> {
    struct Guarded<F>(Pin<Box<F>>);
    impl<F: Future> Future for Guarded<F> {
        type Output = Result<F::Output, String>;
        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
            match catch_unwind(AssertUnwindSafe(|| self.0.as_mut().poll(cx))) {
                Ok(Poll::Ready(value)) => Poll::Ready(Ok(value)),
                Ok(Poll::Pending) => Poll::Pending,
                Err(panic) => Poll::Ready(Err(cause_of(panic))),
            }
        }
    }
    let result = Guarded(Box::pin(fut)).await;
    if let Err(cause) = &result {
        log_failure(op, cause);
    }
    result
}

/// Starts the status listener at most once for this `Inner` (its `Once`), and only when a Tokio
/// runtime is there to run it on. The subscription itself was already taken at `open`, so no
/// `agent.status` fired between `open` and this first poll is lost.
fn start_listener(inner: &Arc<Inner>) {
    inner.listener_started.call_once(|| {
        spawn_push_clock(Arc::downgrade(inner));
        let events = lock(&inner.events)
            .take()
            .expect("subscribed once, at open");
        spawn_status_listener(Arc::clone(inner), events);
    });
}

/// B22: every half second, sends the pushed digests whose window ended by the Daemon's clock.
fn spawn_push_clock(inner: std::sync::Weak<Inner>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
        // A stalled clock (a suspended host, a paused test clock) owes one pass, not one per missed tick.
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let Some(inner) = inner.upgrade() else {
                break;
            };
            pushes::flush(&inner).await;
            #[cfg(test)]
            let _ = inner.completed.send("clock");
        }
    });
}

/// Reads `agent.status` off `events` for as long as `inner` has a subscriber: an `idle` Kind
/// or live `error` Kind delivers pending Messages (B2, B30, B37); a `done` or
/// exited `error` Kind drops its `pending` Messages with the reason
/// `receiver gone` (B9). A `Lagged` receiver may have missed one of those, so it resyncs from
/// the Rail instead of guessing what it lost (B9), and tries again on its next event while the
/// Rail cannot answer.
fn spawn_status_listener(
    inner: Arc<Inner>,
    mut events: tokio::sync::broadcast::Receiver<contracts::Event>,
) {
    tokio::spawn(async move {
        let mut resync_due = !resync(&inner).await;
        #[cfg(test)]
        let _ = inner.completed.send("initial");
        loop {
            match events.recv().await {
                Ok(contracts::Event {
                    data: EventData::AgentStatus(status),
                    ..
                }) => {
                    let _ = guarded(
                        "on_status",
                        on_status(
                            &inner,
                            &status.id,
                            &status.attempt,
                            &status.status_revision,
                            status.status.kind,
                        ),
                    )
                    .await;
                    #[cfg(test)]
                    let _ = inner.completed.send("on_status");
                }
                Ok(contracts::Event {
                    data: EventData::RailRenamed { id, name },
                    ..
                }) => {
                    lock(&inner.store)
                        .record_sender_name(&id, &name)
                        .expect("message sender name");
                    #[cfg(test)]
                    let _ = inner.completed.send("rename");
                }
                Ok(contracts::Event {
                    data: EventData::RailChanged,
                    ..
                }) => resync_due = true,
                Ok(_) => {}
                Err(RecvError::Lagged(_)) => resync_due = true,
                Err(RecvError::Closed) => break,
            }
            if resync_due {
                resync_due = !resync(&inner).await;
            }
        }
    });
}

async fn on_status(inner: &Arc<Inner>, agent: &str, attempt: &str, revision: &str, kind: Kind) {
    let at = (
        contracts::agent::parse_positive_ordinal(attempt).expect("wire Attempt"),
        contracts::agent::parse_positive_ordinal(revision).expect("wire Status revision"),
    );
    // StopFailure ends a turn, not its Terminal. Read authoritative liveness so a late
    // error cannot reopen an exited Attempt or close a resumed one.
    let (closed, ready) = if kind == Kind::Error {
        let Ok(nodes) = load_rail_nodes(inner).await else {
            return;
        };
        let node = nodes
            .iter()
            .find(|node| node.id == agent && binding(node).0 == at.0);
        (
            node.is_none_or(ended),
            node.is_some_and(|node| {
                binding(node) == at && node.status.as_ref().is_some_and(|s| s.kind == Kind::Error)
            }),
        )
    } else {
        (kind == Kind::Done, kind == Kind::Idle)
    };
    {
        let mut store = lock(&inner.store);
        if let Err(cause) = (inner.fault)("on_status") {
            panic!("{cause}");
        }
        reconcile(inner, &mut store, agent, at, closed, false, false).expect("message store");
    }
    if !closed && ready {
        on_idle(inner, agent, at, Pick::Next).await;
    }
}

/// Resync after bus lag or Rail changes so missed endings cannot leave Messages deliverable.
/// A failed Rail read is retried on the next event; it never guesses that an Agent recovered.
async fn resync(inner: &Arc<Inner>) -> bool {
    let known = {
        let store = lock(&inner.store);
        store
            .receivers()
            .expect("message store")
            .into_iter()
            .map(|id| {
                let generation = store.generation(&id).expect("message store");
                (id, generation)
            })
            .collect::<Vec<_>>()
    };
    let Ok(nodes) = load_rail_nodes(inner).await else {
        return false;
    };
    let mut store = lock(&inner.store);
    for (id, generation) in known {
        if !nodes.iter().any(|node| node.id == id)
            && store.generation(&id).expect("message store") == generation
        {
            // Restart reservations end at removal; retirement protection is permanent.
            store.end_restart(&id).expect("message store");
            // B8: a removed Agent cannot be resumed, so nothing in flight waits for it.
            store.clear_flights_to(&id).expect("message store");
            let attempt = generation.map_or(0, |state| state.attempt);
            reconcile(
                inner,
                &mut store,
                &id,
                (attempt, i64::MAX),
                true,
                true,
                false,
            )
            .expect("message store");
        }
    }
    for node in nodes {
        reconcile(
            inner,
            &mut store,
            &node.id,
            binding(&node),
            ended(&node),
            permanently_ended(&node),
            true,
        )
        .expect("message store");
    }
    true
}

/// Read the Rail as the Daemon and persist its current sender names for removal/reopen.
async fn load_rail_nodes(inner: &Inner) -> Result<Vec<RailNode>, RpcError> {
    let ctx = Ctx {
        actor: Actor::daemon(),
        bus: inner.bus.clone(),
        touches: Arc::clone(&inner.touches),
    };
    let tree = inner.agents.call(&ctx, "rail.tree", Value::Null).await?;

    let nodes: Vec<RailNode> = serde_json::from_value(tree).map_err(RpcError::internal)?;
    record_sender_names(inner, &nodes)?;
    Ok(nodes)
}

/// Save the last Rail names observed by Messages for delivery after removal.
fn record_sender_names(inner: &Inner, nodes: &[RailNode]) -> Result<(), RpcError> {
    let mut store = lock(&inner.store);
    store.atomically(|store| {
        for node in nodes {
            store.record_sender_name(&node.id, &node.name)?;
        }
        Ok(())
    })
}

/// B2's `<sender's name>`: the Rail name for an Agent, since a Rail node can be renamed; the
/// Actor's id for the user (`you`), the Daemon and an Extension.
async fn sender_name(inner: &Inner, from: &Actor) -> Result<String, RpcError> {
    if from.kind != ActorKind::Agent {
        return Ok(from.id.clone());
    }
    load_rail_nodes(inner).await?;
    lock(&inner.store).sender_name(&from.id)
}

/// B3563c: writes every pending Message to `agent`'s Claude inbox as one batch, in id order. The
/// inbox write leaves each in flight until its transcript receipt (B50); a missing or mismatched
/// inbox leaves them `pending` for the next eligible event.
///
/// `Pick::Fresh` is for work that became deliverable while its receiver was already `idle` (a
/// Message just sent or passed on to it): no `idle` event will follow for it, so the batch the next
/// `idle` would pick is written now, though its Status revision is the current one.
async fn on_idle(inner: &Arc<Inner>, agent: &str, at: store::Binding, pick: Pick) {
    let _delivery = inner.delivery.read().await;
    let state = match inner.inbox.get() {
        Some(inbox) => inbox.check(agent).await,
        None => contracts::agent::Inbox::Missing,
    };
    let found = {
        let store = lock(&inner.store);
        if matches!(
            step::retirement_event(
                store.retirement(agent).expect("message store").is_some(),
                step::restart_event(
                    store.is_reserved(agent).expect("message store"),
                    Event::Idle
                )
            ),
            Event::Busy
        ) || store.require_generation(agent, at).is_err()
        {
            return;
        }
        // A just-sent Message is bound to the current revision, which the queue excludes.
        let upto = (at.0, at.1.saturating_add(i64::from(pick == Pick::Fresh)));
        let typing = lock(&inner.typing);
        let pending = store
            .pending_queue(agent, upto)
            .expect("message store")
            .into_iter()
            .filter(|m| !typing.contains(&m.id))
            .collect::<Vec<_>>();
        drop(typing);
        let ids = idle_batch(&pending);
        pending
            .into_iter()
            .filter(|m| ids.contains(&m.id))
            .collect::<Vec<_>>()
    };
    if !found.is_empty() {
        inbox::send(inner, agent, at, pick, found, state).await;
    }
}

/// Which pending Messages an `idle` may type.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pick {
    /// An `idle` event: those bound to an earlier Status revision.
    Next,
    /// The receiver is idle already: those bound to this revision too.
    Fresh,
}

/// B2, B13, B37: delivers pending Messages when the receiver is ready for a turn.
async fn nudge(inner: &Arc<Inner>, agent: &str) {
    let Ok(nodes) = load_rail_nodes(inner).await else {
        return;
    };
    if let Some(node) = nodes.iter().find(|node| {
        node.id == agent
            && !ended(node)
            && node
                .status
                .as_ref()
                .is_some_and(|s| matches!(s.kind, Kind::Idle | Kind::Error))
    }) {
        on_idle(inner, agent, binding(node), Pick::Fresh).await;
    }
}

fn binding(node: &RailNode) -> store::Binding {
    (
        node.attempt.as_deref().map_or(0, |n| {
            contracts::agent::parse_positive_ordinal(n).expect("Rail Attempt")
        }),
        node.status_revision.as_deref().map_or(i64::MAX, |n| {
            contracts::agent::parse_positive_ordinal(n).expect("Rail Status revision")
        }),
    )
}

fn ended(node: &RailNode) -> bool {
    node.status_revision.is_none()
        || node.status.as_ref().is_none_or(|s| {
            s.kind == Kind::Done || (s.kind == Kind::Error && node.terminal_id.is_none())
        })
}

fn permanently_ended(node: &RailNode) -> bool {
    node.status_revision.is_none() || (ended(node) && node.terminal_id.is_none())
}

fn accept_receiver(inner: &Inner, store: &mut Store, node: &RailNode) -> Result<(), RpcError> {
    if store.retirement(&node.id)?.is_some() {
        return Err(RpcError::conflict("receiver reserved for retirement"));
    }
    reconcile(
        inner,
        store,
        &node.id,
        binding(node),
        ended(node),
        permanently_ended(node),
        false,
    )?;
    store.require_generation(&node.id, binding(node))
}

/// Both A35 operations can select an already stopped Agent; reconcile its ordinary B9
/// ending first so a new reservation never revives final records.
fn accept_reservation(inner: &Inner, store: &mut Store, node: &RailNode) -> Result<(), RpcError> {
    let at = binding(node);
    reconcile(
        inner,
        store,
        &node.id,
        at,
        ended(node),
        permanently_ended(node),
        false,
    )?;
    if ended(node) {
        if store
            .generation(&node.id)?
            .is_none_or(|state| state.attempt != at.0)
        {
            return Err(RpcError::conflict("stale receiver Attempt"));
        }
        Ok(())
    } else {
        store.require_generation(&node.id, at)
    }
}

fn reconcile(
    inner: &Inner,
    store: &mut Store,
    agent: &str,
    at: store::Binding,
    closed: bool,
    permanent: bool,
    restart: bool,
) -> Result<(), RpcError> {
    let mut events = Vec::new();
    let result = reconcile_into(store, agent, at, closed, permanent, restart, &mut events);
    for event in events {
        inner.bus.emit(Actor::daemon(), event);
    }
    result
}

fn reconcile_into(
    store: &mut Store,
    agent: &str,
    at: store::Binding,
    closed: bool,
    permanent: bool,
    restart: bool,
    events: &mut Vec<EventData>,
) -> Result<(), RpcError> {
    let previous = store.generation(agent)?;
    let reserved = store.is_reserved(agent)?;
    let retiring = store.retirement(agent)?.is_some();
    let through = if permanent {
        Some((at.0, i64::MAX))
    } else if closed {
        Some(at)
    } else if previous.is_none_or(|state| state.attempt < at.0) {
        Some((at.0.saturating_sub(1), i64::MAX))
    } else {
        None
    };
    if let Some(through) = through.filter(|_| {
        matches!(
            step::retirement_event(retiring, step::restart_event(reserved, Event::ReceiverExit)),
            Event::ReceiverExit
        )
    }) {
        // B8: a Message written and not confirmed waits for the Agent to be resumed.
        let rebind = (through.0 < at.0).then_some((at.0, 0));
        let keep = Some(rebind);
        for message in store.drop_all_pending(
            agent,
            Reason::ReceiverGone,
            through,
            gone_drops,
            keep,
            restart,
        )? {
            events.push(EventData::MessageDropped(message.into()));
        }
    }
    if previous.is_some_and(|state| state.attempt > at.0) {
        return Ok(());
    }
    let mut state =
        previous
            .filter(|state| state.attempt == at.0)
            .unwrap_or(store::ReceiverState {
                attempt: at.0,
                revision: at.1,
                closed_revision: -1,
                closed: false,
            });
    state.revision = state.revision.max(at.1);
    if closed {
        state.closed_revision = state.closed_revision.max(at.1);
    }
    state.closed |= retiring || (permanent && !reserved);
    store.set_generation(agent, state)
}

#[cfg(test)]
mod tests;
