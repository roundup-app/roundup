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
    Delivery, ListParams, Message, MessageId, MessageKind, MessageStatus, Reason, Route,
    SendParams, SetRouteParams,
};
use contracts::{Actor, ActorKind, EventData, Kind, Verb};
use flight::confirm_ids;
pub use inbox::NoteInbox;
use receiver_view::{gone_drops, idle_batch, send_status};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, code, params, reply};
use serde_json::Value;
use step::Event;
use store::Store;
use tokio::sync::broadcast::error::RecvError;

const MAX_BODY_BYTES: usize = 8192;
const OPEN_BOUND: u32 = 32;

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

    async fn send(&self, ctx: &Ctx, p: SendParams) -> Result<Value, RpcError> {
        // B51(f): the authenticated sender hears when the inbox format is unavailable.
        let uses_inbox = inbox::is_inbox_send(&p);
        if uses_inbox {
            self.refuse_repeat(ctx, &p).await?;
        }
        let message = self.send_message(ctx, p, false).await?;
        if uses_inbox {
            inbox::refuse_mismatch(&self.inner, &message).await?;
        }
        reply(&message)
    }

    /// B51(g): a new send is refused before allocating a Message or question chain.
    async fn refuse_repeat(&self, ctx: &Ctx, p: &SendParams) -> Result<(), RpcError> {
        let Ok(Some(receiver)) = self.resolve_receiver(&p.to).await else {
            return Ok(());
        };
        if self
            .store()?
            .is_inbox_repeat(&ctx.actor, &p.to, &p.body, binding(&receiver).0, None)?
        {
            return Err(RpcError::conflict(inbox::REPEAT));
        }
        Ok(())
    }

    /// `message.send`. `merge` makes the Message the merge of the two oldest pushed digests to
    /// `p.to`, which it drops in the same write (B22), and ignores `p.body` but for its prefix.
    async fn send_message(
        &self,
        ctx: &Ctx,
        p: SendParams,
        merge: bool,
    ) -> Result<Message, RpcError> {
        self.send_message_with(ctx, p, merge, None, None, None)
            .await
    }

    /// `send_message`; with `wake`, the Wake request of that number is fired in the same write (B42);
    /// with `reaction`, the firing is accepted in the same write (NR3).
    async fn send_message_with(
        &self,
        ctx: &Ctx,
        p: SendParams,
        merge: bool,
        wake: Option<u32>,
        reaction: Option<&reaction::Fire>,
        continuation: Option<&continuation::Continue>,
    ) -> Result<Message, RpcError> {
        if is_receiver(&ctx.actor, &p.to) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Message cannot be sent to its own sender",
            ));
        }
        let receiver_status = self.resolve_receiver(&p.to).await?;
        if p.body.is_empty() || p.body.len() > MAX_BODY_BYTES {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("body must be 1 to {MAX_BODY_BYTES} bytes"),
            ));
        }
        if let Some(status) = &receiver_status
            && ended(status)
        {
            return Err(RpcError::conflict(format!(
                "{} cannot receive a Message: its Kind is {:?}",
                p.to, status.status
            )));
        }
        // The reply-to check, the bound check and the insert run while one lock is taken, so a
        // second sender racing for the same receiver's last open slot cannot pass its own check
        // before this one's insert lands (B1).
        let digest = p.kind == MessageKind::Note && pushes::is_digest(&ctx.actor, &p.body);
        let (message, merged) = {
            let mut store = self.store()?;
            // Outside the transaction: a refusal keeps the drops `accept_receiver` reconciled.
            if let Some(node) = &receiver_status {
                accept_receiver(&self.inner, &mut store, node)?;
            }
            store.atomically(|store| {
                if let Some(reply_to) = p.reply_to
                    && store.get(reply_to)?.is_none()
                {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        format!("replyTo names no Message: {reply_to}"),
                    ));
                }
                if let Some(wake) = wake {
                    self.fire_inside(store, wake)?;
                }
                if let Some(fire) = reaction {
                    store.check_firing(fire)?;
                }
                if let Some(c) = continuation
                    && store.accepted(c)?.is_some()
                {
                    return Err(RpcError::conflict("an action was already accepted"));
                }
                if !digest
                    && wake.is_none()
                    && reaction.is_none()
                    && continuation.is_none()
                    && store.count_open(&p.to)? >= OPEN_BOUND
                {
                    return Err(RpcError::conflict(format!(
                        "{} already has {OPEN_BOUND} pending Messages",
                        p.to
                    )));
                }
                // B10: a Message to the user is delivered at once, whatever Routes exist; the
                // user has no `idle` for B2's pending-until-idle rule to wait on.
                let (status, reason) = if p.to == Actor::user().id {
                    (MessageStatus::Delivered, None)
                } else {
                    let route = store
                        .get_route(&ctx.actor.id, &p.to)?
                        .unwrap_or(Delivery::Auto);
                    (send_status(ctx.actor.kind == ActorKind::User, route), None)
                };
                let mut folded = Vec::new();
                let mut body = p.body.clone();
                if merge {
                    let oldest = store.open_digests(&p.to)?;
                    let [first, second, ..] = oldest.as_slice() else {
                        return Err(RpcError::conflict("fewer than two pushed digests to merge"));
                    };
                    body = pushes::merged_body(first, second);
                    folded = vec![first.id, second.id];
                } else if digest && pushes::is_plain_push(&p.body) {
                    // B34: a plain push of a child stands for the older ones it waits with.
                    let names = pushes::names_in(&p.body);
                    let older: Vec<Message> = store
                        .open_digests(&p.to)?
                        .into_iter()
                        .filter(|m| {
                            pushes::is_plain_push(&m.body) && pushes::names_in(&m.body) == names
                        })
                        .collect();
                    let weight = 1 + older.iter().map(|m| pushes::weight(&m.body)).sum::<u32>();
                    body = pushes::counted(&p.body, weight);
                    folded = older.iter().map(|m| m.id).collect();
                }
                let message = store.insert(
                    &ctx.actor,
                    &p.to,
                    p.kind,
                    &body,
                    p.reply_to,
                    status,
                    reason,
                    (self.inner.clock)(),
                    receiver_status.as_ref().map_or((0, 0), binding),
                )?;
                if wake.is_some() {
                    (self.inner.fault)("wake").map_err(RpcError::internal)?;
                }
                if let Some(fire) = reaction {
                    store.accept_firing(fire, message.id)?;
                    (self.inner.fault)("reaction").map_err(RpcError::internal)?;
                }
                if let Some(c) = continuation {
                    store.accept_continuation(c, message.id)?;
                    (self.inner.fault)("continuation").map_err(RpcError::internal)?;
                }
                let mut merged = Vec::new();
                for id in folded {
                    if store.drop_merged(id)? {
                        merged.extend(store.get(id)?);
                    }
                }
                Ok((message, merged))
            })?
        };
        ctx.touch(Verb::Wrote, &item(message.id))?;
        ctx.emit(EventData::MessageSent(message.clone().into()));
        for folded in merged {
            ctx.emit(EventData::MessageDropped(folded.into()));
        }
        match message.status {
            MessageStatus::Delivered => {
                ctx.emit(EventData::MessageDelivered(message.clone().into()))
            }
            MessageStatus::Dropped => ctx.emit(EventData::MessageDropped(message.clone().into())),
            MessageStatus::Pending => {}
        }
        {
            let routing = async {
                // The Status read before the insert may be stale: an `idle` that landed between that read
                // and the insert found nothing pending and no other will follow. Read it again now that
                // the Message is stored; an `idle` after this read finds the Message itself.
                if message.status == MessageStatus::Pending && receiver_status.is_some() {
                    nudge(&self.inner, &p.to).await;
                }
            };
            // A ready future never blocked its caller. Retain evidence only after the
            // existing routing operation yields Pending, never pending-Message duration.
            let mut routing = std::pin::pin!(routing);
            let mut waiting = None;
            std::future::poll_fn(|cx| {
                let poll = routing.as_mut().poll(cx);
                if poll.is_pending() && waiting.is_none() && ctx.actor.kind == ActorKind::Agent {
                    waiting = self
                        .inner
                        .agents
                        .observe_coordination(&ctx.actor.id, message.id);
                }
                poll
            })
            .await;
            drop(waiting);
        }
        Ok(message)
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
            step::retirement_event(retiring, step::restart_event(reserved, Event::Exit)),
            Event::Exit
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
mod tests {
    use std::sync::Mutex as StdMutex;

    use contracts::agent::{NodeKind, RailNode};
    use contracts::{Actor, ActorKind, Event, Kind, Status};
    use provenance::Touches;
    use rpc::code;
    use serde_json::json;
    use tokio::sync::broadcast::Receiver;

    use super::*;

    mod a35_tests;
    mod b_fault_tests;
    mod b_hop_tests;
    mod b_idle_tests;
    mod b_push_tests;
    mod b_resume_tests;
    mod inv_tests;
    mod u3782_tests;

    /// Stands in for the `agents` module's `rail.tree`: the only Rail fact `message.send` needs,
    /// without a real Agent, Terminal or Launcher.
    struct FakeRail(StdMutex<Vec<RailNode>>);

    impl FakeRail {
        fn new(nodes: Vec<RailNode>) -> Arc<Self> {
            Arc::new(Self(StdMutex::new(nodes)))
        }
    }

    impl TerminalOwners for FakeRail {
        fn with_terminal_owner(
            &self,
            terminal: &str,
            record: &mut dyn FnMut(Option<&agents::TerminalOwner>) -> Result<(), RpcError>,
        ) -> Result<(), RpcError> {
            // Mutations and recording share this lifecycle lock; never clone then release it.
            let nodes = self.0.lock().unwrap();
            let mut attached = nodes
                .iter()
                .filter(|n| n.terminal_id.as_deref() == Some(terminal));
            let owner = attached.next().map(|node| agents::TerminalOwner {
                id: node.id.clone(),
                attempt: node.attempt.clone(),
                status_revision: node.status_revision.clone(),
                ended: ended(node) || node.status_revision.is_none(),
            });
            if attached.next().is_some() {
                return Err(RpcError::conflict("ambiguous Terminal ownership"));
            }
            record(owner.as_ref())
        }
    }

    #[async_trait]
    impl Module for FakeRail {
        fn namespaces(&self) -> &'static [&'static str] {
            &["agent", "rail"]
        }

        async fn call(&self, _ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
            match method {
                "rail.tree" => Ok(serde_json::to_value(&*self.0.lock().unwrap()).unwrap()),
                _ => Err(RpcError::method_not_found(method)),
            }
        }
    }

    mod node;
    pub(crate) use node::node;

    fn agent_node(id: &str, kind: Kind) -> RailNode {
        node(
            id,
            NodeKind::Agent,
            false,
            Some(Status {
                kind,
                label: "status".into(),
                since: 0,
                finished: "0".into(),
            }),
        )
    }

    fn agent(id: &str) -> Actor {
        Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        }
    }

    /// The Claude inbox as tests see it: entries written are kept as `(agent, text)`.
    /// With `confirm`, a write also stands for the transcript receipt, as Claude Code's would.
    struct FakeInbox {
        state: StdMutex<contracts::agent::Inbox>,
        entries: StdMutex<Vec<(String, u32, contracts::message::MessageKind, String)>>,
        confirm: std::sync::atomic::AtomicBool,
        inner: StdMutex<std::sync::Weak<Inner>>,
    }

    impl FakeInbox {
        fn set(&self, state: contracts::agent::Inbox) {
            *self.state.lock().unwrap() = state;
        }

        /// Every entry written, in order, as `(agent, id, kind, text)`.
        fn entries(&self) -> Vec<(String, u32, contracts::message::MessageKind, String)> {
            self.entries.lock().unwrap().clone()
        }

        /// `(agent, text)` of every entry written.
        fn typed(&self) -> Vec<(String, String)> {
            self.entries().into_iter().map(|e| (e.0, e.3)).collect()
        }

        /// The ids of every entry written, in order.
        fn written(&self) -> Vec<u32> {
            self.entries().into_iter().map(|e| e.1).collect()
        }

        /// Whether a write also stands for the transcript receipt.
        fn receipt(&self, on: bool) {
            self.confirm.store(on, std::sync::atomic::Ordering::SeqCst);
        }
    }

    #[async_trait]
    impl NoteInbox for FakeInbox {
        async fn check(&self, _agent: &str) -> contracts::agent::Inbox {
            *self.state.lock().unwrap()
        }

        fn write(
            &self,
            agent: &str,
            notes: &[agents::claude_code::inbox::Entry],
        ) -> Result<(), contracts::agent::Inbox> {
            let state = *self.state.lock().unwrap();
            if state != contracts::agent::Inbox::Ok {
                return Err(state);
            }
            let ids: Vec<u32> = notes.iter().map(|n| n.id).collect();
            self.entries.lock().unwrap().extend(
                notes
                    .iter()
                    .map(|n| (agent.to_owned(), n.id, n.kind, n.text.clone())),
            );
            if self.confirm.load(std::sync::atomic::Ordering::SeqCst)
                && let Some(inner) = self.inner.lock().unwrap().upgrade()
            {
                crate::flight::confirm_ids(&inner, agent, &ids);
            }
            Ok(())
        }
    }

    /// An inbox whose check blocks until released: delivery is in progress meanwhile.
    struct GatedInbox {
        inbox: Arc<FakeInbox>,
        entered: Arc<tokio::sync::Notify>,
        release: Arc<tokio::sync::Notify>,
    }

    #[async_trait]
    impl NoteInbox for GatedInbox {
        async fn check(&self, agent: &str) -> contracts::agent::Inbox {
            self.entered.notify_one();
            self.release.notified().await;
            self.inbox.check(agent).await
        }

        fn write(
            &self,
            agent: &str,
            notes: &[agents::claude_code::inbox::Entry],
        ) -> Result<(), contracts::agent::Inbox> {
            self.inbox.write(agent, notes)
        }
    }

    /// A `FakeInbox` for `messages`, not yet set on it.
    fn fake_inbox(messages: &Messages, confirm: bool) -> Arc<FakeInbox> {
        Arc::new(FakeInbox {
            state: StdMutex::new(contracts::agent::Inbox::Ok),
            entries: StdMutex::default(),
            confirm: confirm.into(),
            inner: StdMutex::new(Arc::downgrade(&messages.inner)),
        })
    }

    /// Sets a new `FakeInbox` on `messages`.
    fn attach_inbox(messages: &Messages, confirm: bool) -> Arc<FakeInbox> {
        let inbox = fake_inbox(messages, confirm);
        messages.set_inbox(inbox.clone());
        inbox
    }

    struct Harness {
        messages: Messages,
        bus: Bus,
        bus_events: Receiver<Event>,
        touches: Arc<Touches>,
        inbox: Arc<FakeInbox>,
    }

    impl Harness {
        /// No inbox is set: Messages to an Agent stay `pending`.
        fn new(dir: &Path, rail: Vec<RailNode>) -> Self {
            Self::open(dir, FakeRail::new(rail), false)
        }

        /// An `ok` inbox that records every entry and confirms it at once.
        fn with_inbox(dir: &Path, rail: Vec<RailNode>) -> Self {
            Self::open(dir, FakeRail::new(rail), true)
        }

        fn open(dir: &Path, rail: Arc<FakeRail>, with_inbox: bool) -> Self {
            let bus = Bus::new();
            let bus_events = bus.subscribe();
            let messages = Messages::open(dir, bus.clone(), rail).unwrap();
            let inbox = if with_inbox {
                attach_inbox(&messages, true)
            } else {
                fake_inbox(&messages, true)
            };
            Self {
                messages,
                bus,
                bus_events,
                touches: Arc::new(Touches::in_memory().unwrap()),
                inbox,
            }
        }

        fn ctx(&self, actor: Actor) -> Ctx {
            Ctx {
                actor,
                bus: self.bus.clone(),
                touches: Arc::clone(&self.touches),
            }
        }

        async fn call_as(
            &self,
            actor: Actor,
            method: &str,
            params: Value,
        ) -> Result<Value, RpcError> {
            self.messages.call(&self.ctx(actor), method, params).await
        }

        async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
            self.call_as(Actor::user(), method, params).await
        }

        /// Event names, oldest first.
        fn events(&mut self) -> Vec<String> {
            let mut seen = Vec::new();
            while let Ok(event) = self.bus_events.try_recv() {
                let event = serde_json::to_value(&event.data).unwrap();
                seen.push(event["name"].as_str().unwrap().to_owned());
            }
            seen
        }

        fn touches(&self, id: u32) -> Vec<(Verb, String)> {
            self.touches
                .history(&item(id))
                .unwrap()
                .into_iter()
                .map(|t| (t.verb, t.actor.id))
                .collect()
        }
    }

    #[tokio::test]
    async fn b1_send_assigns_sequential_ids_from_is_the_caller_and_touches_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);

        let first = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(first["id"], 1);
        assert_eq!(first["from"]["id"], "a");
        assert_eq!(first["to"], "b");
        assert_eq!(first["kind"], "note");
        assert_eq!(first["body"], "hi");
        assert_eq!(first["replyTo"], Value::Null);
        assert_eq!(first["status"], "pending");
        assert_eq!(first["reason"], Value::Null);
        assert!(first["at"].as_i64().unwrap() > 0, "at: {:?}", first["at"]);

        let second = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "question", "body": "ok?"}),
            )
            .await
            .unwrap();
        assert_eq!(second["id"], 2);
        assert_eq!(second["kind"], "question");

        assert_eq!(h.events(), ["message.sent", "message.sent"]);
        assert_eq!(h.touches(1), [(Verb::Wrote, "a".to_owned())]);
    }

    #[tokio::test]
    async fn b1_kind_other_than_note_or_question_is_invalid_params() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "shout", "body": "hi"}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::INVALID_PARAMS);
    }

    #[tokio::test]
    async fn b1_a_to_that_names_no_actor_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![]);

        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "ghost", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::NOT_FOUND);
    }

    #[tokio::test]
    async fn b1_a_to_that_is_a_group_or_the_sender_is_invalid_params() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![node("g", NodeKind::Workstream, false, None)],
        );

        for to in ["g", "a"] {
            let err = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to": to, "kind": "note", "body": "hi"}),
                )
                .await
                .unwrap_err();
            assert_eq!(
                err.code,
                if to == "g" {
                    code::CONFLICT
                } else {
                    code::INVALID_PARAMS
                },
                "to {to}"
            );
        }
    }

    #[tokio::test]
    async fn b1_a_door_can_receive() {
        let dir = tempfile::tempdir().unwrap();
        let meta = node(
            "m",
            NodeKind::Workstream,
            true,
            Some(Status {
                kind: Kind::Idle,
                label: "status".into(),
                since: 0,
                finished: "0".into(),
            }),
        );
        let h = Harness::new(dir.path(), vec![meta]);

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "m", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(sent["to"], "m");
    }

    #[tokio::test]
    async fn b1_empty_or_oversized_body_is_invalid_params() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

        let empty = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": ""}),
            )
            .await
            .unwrap_err();
        let big = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "x".repeat(8193)}),
            )
            .await
            .unwrap_err();

        assert_eq!(
            (empty.code, big.code),
            (code::INVALID_PARAMS, code::INVALID_PARAMS)
        );
    }

    #[tokio::test]
    async fn b1_a_reply_to_that_names_no_message_is_invalid_params() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi", "replyTo": 9}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::INVALID_PARAMS);
    }

    #[tokio::test]
    async fn b1_reply_to_round_trips_on_a_successful_send() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![agent_node("a", Kind::Idle), agent_node("b", Kind::Idle)],
        );
        let first = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(first["id"], 1);

        let second = h
            .call_as(
                agent("b"),
                "message.send",
                json!({"to": "a", "kind": "note", "body": "ok", "replyTo": 1}),
            )
            .await
            .unwrap();

        assert_eq!(second["replyTo"], 1);
    }

    #[tokio::test]
    async fn b1_dropped_messages_do_not_count_toward_the_bound_of_32() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap();
        for _ in 0..32 {
            let dropped = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to": "b", "kind": "note", "body": "hi"}),
                )
                .await
                .unwrap();
            assert_eq!(dropped["status"], "dropped");
        }

        let still_accepted = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(still_accepted["status"], "dropped");
    }

    #[tokio::test]
    async fn b1_a_receiver_that_is_done_or_error_is_conflict() {
        for kind in [Kind::Done, Kind::Error] {
            let dir = tempfile::tempdir().unwrap();
            let h = Harness::new(dir.path(), vec![agent_node("b", kind)]);

            let err = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to": "b", "kind": "note", "body": "hi"}),
                )
                .await
                .unwrap_err();

            assert_eq!(err.code, code::CONFLICT, "{kind:?}");
        }
    }

    #[tokio::test]
    async fn b1_a_receiver_at_the_bound_of_32_is_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
        for n in 0..32 {
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
            )
            .await
            .unwrap();
        }

        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::CONFLICT);
        assert!(err.message.contains("32"), "{}", err.message);
    }

    #[tokio::test]
    async fn b1_a_body_of_exactly_8192_bytes_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "x".repeat(8192)}),
            )
            .await
            .unwrap();

        assert_eq!(sent["status"], "pending");
    }

    #[tokio::test]
    async fn b1_the_bound_of_32_is_per_receiver_not_shared() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
        );
        for n in 0..32 {
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
            )
            .await
            .unwrap();
        }

        let to_c = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "c", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(to_c["status"], "pending");
    }

    #[tokio::test]
    async fn b1_a_rejected_call_at_the_bound_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
        for n in 0..32 {
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
            )
            .await
            .unwrap();
        }
        h.events();

        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::CONFLICT);
        assert_eq!(
            h.events(),
            Vec::<String>::new(),
            "the bound check must run before the insert, so a rejected call emits no event"
        );
        let phantom = h.call("message.get", json!({"id": 33})).await.unwrap_err();
        assert_eq!(
            phantom.code,
            code::NOT_FOUND,
            "no row was ever inserted for the rejected call"
        );
    }

    #[tokio::test]
    async fn b1_a_message_to_the_user_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![]);

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "you", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(sent["to"], "you");
    }

    #[tokio::test]
    async fn b10_a_message_to_the_user_is_delivered_at_once_and_never_fills_their_slots() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![]);

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "you", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(sent["status"], "delivered");
        assert_eq!(sent["reason"], Value::Null);
        assert_eq!(h.events(), ["message.sent", "message.delivered"]);

        // 32 more Messages to the user, none of which ever becomes `pending`, so
        // a 33rd still succeeds: the bound never fills for the user (B10).
        for _ in 0..32 {
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "you", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        }
        let still_accepted = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "you", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(still_accepted["status"], "delivered");
    }

    #[tokio::test]
    async fn b1_a_rejected_call_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

        let rejected = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "shout", "body": "hi"}),
            )
            .await
            .unwrap_err();
        assert_eq!(rejected.code, code::INVALID_PARAMS);
        assert_eq!(h.events(), Vec::<String>::new());

        let first = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(first["id"], 1, "the rejected call used no id");
        assert_eq!(
            h.touches(1),
            [(Verb::Wrote, "a".to_owned())],
            "no Touch for the rejected call"
        );
    }

    #[tokio::test]
    async fn b3_drop_takes_back_only_a_pending_message_of_the_user_and_only_for_the_user() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
        let note = |body: &str| json!({"to": "b", "kind": "note", "body": body});
        h.call_as(agent("a"), "message.send", note("from an agent"))
            .await
            .unwrap();
        h.call("message.send", note("from the user")).await.unwrap();
        h.events();

        let by_agent = h
            .call_as(agent("a"), "message.drop", json!({"id": 2}))
            .await
            .unwrap_err();
        let not_the_users = h.call("message.drop", json!({"id": 1})).await.unwrap_err();
        let unknown = h.call("message.drop", json!({"id": 99})).await.unwrap_err();
        assert_eq!(
            (by_agent.code, not_the_users.code, unknown.code),
            (code::FORBIDDEN, code::CONFLICT, code::NOT_FOUND)
        );
        assert!(h.events().is_empty());

        let dropped = h.call("message.drop", json!({"id": 2})).await.unwrap();
        assert_eq!(
            (&dropped["status"], &dropped["reason"]),
            (&json!("dropped"), &json!("removed"))
        );
        assert_eq!(h.events(), ["message.dropped"]);
        let again = h.call("message.drop", json!({"id": 2})).await.unwrap_err();
        assert_eq!(again.code, code::CONFLICT);
    }

    #[tokio::test]
    async fn b11_a_forbidden_get_leaves_no_touch() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

        let forbidden = h
            .call_as(agent("c"), "message.get", json!({"id": 1}))
            .await
            .unwrap_err();

        assert_eq!(forbidden.code, code::FORBIDDEN);
        assert_eq!(h.touches(1), [(Verb::Wrote, "a".to_owned())]);
    }

    #[tokio::test]
    async fn b4_a_drop_route_drops_the_message_without_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap();
        h.events();

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(sent["status"], "dropped");
        assert_eq!(h.events(), ["message.sent", "message.dropped"]);
    }

    #[tokio::test]
    async fn b5_the_default_route_is_auto() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(sent["status"], "pending");
        assert_eq!(h.call("route.list", Value::Null).await.unwrap(), json!([]));
    }

    /// M14: an Agent's Route is stored as the Agent's, and never replaces one the user set.
    #[tokio::test]
    async fn b2705a_a_user_set_route_refusal_names_its_endpoints() {
        let dir = tempfile::tempdir().unwrap();
        let mut sender = agent_node("7013", Kind::Working);
        sender.name = "sad".into();
        let mut receiver = agent_node("8027", Kind::Working);
        receiver.name = "review".into();
        let rail = FakeRail::new(vec![sender, receiver]);
        let h = Harness::open(dir.path(), rail.clone(), false);
        let set = |delivery: &str| json!({"from": "7013", "to": "8027", "delivery": delivery});
        h.call("route.set", set("drop")).await.unwrap();

        let refused = h
            .call_as(agent("m"), "route.set", set("auto"))
            .await
            .unwrap_err();
        assert_eq!(
            refused.message,
            "the Route from sad to review was set by the user"
        );
        rail.0.lock().unwrap()[0].name = "glad".into();
        rail.0.lock().unwrap()[1].name = "checked".into();
        let renamed = h
            .call_as(agent("m"), "route.set", set("auto"))
            .await
            .unwrap_err();
        assert_eq!(
            renamed.message,
            "the Route from glad to checked was set by the user"
        );
        rail.0.lock().unwrap().clear();
        let gone = h
            .call_as(agent("m"), "route.set", set("auto"))
            .await
            .unwrap_err();
        assert_eq!(
            gone.message,
            "the Route from an Agent that is gone to an Agent that is gone was set by the user"
        );
        assert_eq!(
            h.call("route.list", Value::Null).await.unwrap(),
            json!([
                {"from":"7013", "to":"8027", "delivery":"drop"}
            ])
        );
        h.call_as(
            agent("m"),
            "route.set",
            json!({"from": "b", "to": "c", "delivery": "drop"}),
        )
        .await
        .unwrap();
        h.call_as(
            agent("m"),
            "route.set",
            json!({"from": "b", "to": "c", "delivery": "auto"}),
        )
        .await
        .unwrap();
        h.call(
            "route.set",
            json!({"from": "b", "to": "c", "delivery": "drop"}),
        )
        .await
        .unwrap();
        let replaced = h
            .call_as(
                agent("m"),
                "route.set",
                json!({"from": "b", "to": "c", "delivery": "auto"}),
            )
            .await
            .unwrap_err();

        assert_eq!(
            (refused.code, replaced.code),
            (code::FORBIDDEN, code::FORBIDDEN)
        );
    }

    #[tokio::test]
    async fn b5_route_set_is_the_users_call_and_route_list_returns_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path(), vec![]);

        let forbidden = h
            .call_as(
                ext("x"),
                "route.set",
                json!({"from": "a", "to": "b", "delivery": "drop"}),
            )
            .await
            .unwrap_err();
        assert_eq!(forbidden.code, code::FORBIDDEN);

        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap();
        assert_eq!(h.events(), ["route.changed"]);

        let routes = h.call("route.list", Value::Null).await.unwrap();
        assert_eq!(
            routes,
            json!([{"from": "a", "to": "b", "delivery": "drop"}])
        );
    }

    #[tokio::test]
    async fn b5_a_route_to_the_user_or_from_itself_is_invalid_params() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![]);

        let to_user = h
            .call(
                "route.set",
                json!({"from": "a", "to": "you", "delivery": "drop"}),
            )
            .await
            .unwrap_err();
        let self_route = h
            .call(
                "route.set",
                json!({"from": "a", "to": "a", "delivery": "drop"}),
            )
            .await
            .unwrap_err();

        assert_eq!(
            (to_user.code, self_route.code),
            (code::INVALID_PARAMS, code::INVALID_PARAMS)
        );
    }

    #[tokio::test]
    async fn b5_a_route_change_does_not_affect_an_already_pending_message() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
        let pending = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(pending["status"], "pending");

        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap();

        let still_pending = h.call("message.get", json!({"id": 1})).await.unwrap();
        assert_eq!(still_pending["status"], "pending");
    }

    #[tokio::test]
    async fn b5_changing_an_existing_route_applies_to_messages_sent_after_it() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "auto"}),
        )
        .await
        .unwrap();

        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap();
        assert_eq!(
            h.call("route.list", Value::Null).await.unwrap(),
            json!([{"from": "a", "to": "b", "delivery": "drop"}]),
            "the stored Route must have been updated, not left as auto"
        );

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(sent["status"], "dropped");
    }

    #[tokio::test]
    async fn b5_a_route_applies_only_to_its_own_sender_not_every_sender_to_the_receiver() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
        );
        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap();

        let from_a = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        let from_c = h
            .call_as(
                agent("c"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(from_a["status"], "dropped", "a's Route to b is drop");
        assert_eq!(
            from_c["status"], "pending",
            "c has no Route to b, so the default auto applies, not a's drop Route"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn b1_concurrent_sends_at_the_bound_never_both_succeed() {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let touches = Arc::new(Touches::in_memory().unwrap());
        let messages = Arc::new(
            Messages::open(
                dir.path(),
                bus.clone(),
                FakeRail::new(vec![agent_node("b", Kind::Working)]),
            )
            .unwrap(),
        );
        let make_ctx = |actor: Actor| Ctx {
            actor,
            bus: bus.clone(),
            touches: Arc::clone(&touches),
        };
        for _ in 0..40 {
            // Exercise the same SQL admission/transaction path without paying for
            // 40 WAL databases and 1,240 durable seed inserts. Durability is not B1's race.
            *messages.inner.store.lock().unwrap() =
                Store::open(std::path::Path::new(":memory:")).unwrap();
            for n in 0..31 {
                messages
                    .call(
                        &make_ctx(agent("a")),
                        "message.send",
                        json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
                    )
                    .await
                    .unwrap();
            }

            let m1 = Arc::clone(&messages);
            let c1 = make_ctx(agent("a"));
            let m2 = Arc::clone(&messages);
            let c2 = make_ctx(agent("a"));
            let (r1, r2) = tokio::join!(
                tokio::spawn(async move {
                    m1.call(
                        &c1,
                        "message.send",
                        json!({"to": "b", "kind": "note", "body": "x"}),
                    )
                    .await
                }),
                tokio::spawn(async move {
                    m2.call(
                        &c2,
                        "message.send",
                        json!({"to": "b", "kind": "note", "body": "y"}),
                    )
                    .await
                }),
            );
            let successes = [r1.unwrap(), r2.unwrap()]
                .into_iter()
                .filter(Result::is_ok)
                .count();
            assert_eq!(
                successes, 1,
                "exactly one of two sends racing for the last open slot should pass"
            );
        }
    }

    #[tokio::test]
    async fn b8_routes_messages_and_statuses_survive_reopening_and_the_id_sequence_continues() {
        let dir = tempfile::tempdir().unwrap();
        let rail = vec![
            agent_node("b", Kind::Working),
            agent_node("c", Kind::Working),
            agent_node("d", Kind::Working),
        ];
        {
            let h = Harness::new(dir.path(), rail.clone());
            h.call(
                "route.set",
                json!({"from": "a", "to": "b", "delivery": "auto"}),
            )
            .await
            .unwrap();
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "c", "kind": "note", "body": "still waiting"}),
            )
            .await
            .unwrap();
            h.call(
                "route.set",
                json!({"from": "a", "to": "d", "delivery": "drop"}),
            )
            .await
            .unwrap();
            h.call_as(
                agent("a"),
                "message.send",
                json!({"to": "d", "kind": "note", "body": "never typed"}),
            )
            .await
            .unwrap();
        }

        let h = Harness::new(dir.path(), rail);
        let message = h.call("message.get", json!({"id": 1})).await.unwrap();
        assert_eq!(
            (&message["status"], &message["reason"]),
            (&json!("pending"), &Value::Null)
        );
        let pending = h.call("message.get", json!({"id": 2})).await.unwrap();
        assert_eq!(pending["status"], "pending");
        let dropped = h.call("message.get", json!({"id": 3})).await.unwrap();
        assert_eq!(dropped["status"], "dropped");
        let routes = h.call("route.list", Value::Null).await.unwrap();
        assert_eq!(
            routes,
            json!([
                {"from": "a", "to": "b", "delivery": "auto"},
                {"from": "a", "to": "d", "delivery": "drop"},
            ])
        );

        let next = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "again"}),
            )
            .await
            .unwrap();
        assert_eq!(next["id"], 4);
    }

    #[tokio::test]
    async fn b11_send_touches_wrote_get_touches_read_list_touches_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
        h.call_as(agent("b"), "message.get", json!({"id": 1}))
            .await
            .unwrap();
        h.call_as(agent("b"), "message.list", json!({}))
            .await
            .unwrap();

        assert_eq!(
            h.touches(1),
            [(Verb::Wrote, "a".to_owned()), (Verb::Read, "b".to_owned()),]
        );
    }

    #[tokio::test]
    async fn b11_drop_touches_wrote_by_the_user() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call(
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

        h.call("message.drop", json!({"id": 1})).await.unwrap();

        assert_eq!(
            h.touches(1),
            [
                (Verb::Wrote, "you".to_owned()),
                (Verb::Wrote, "you".to_owned()),
            ]
        );
    }

    #[tokio::test]
    async fn b11_provenance_touched_lists_a_message_under_each_actor_that_touched_it() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
        h.call_as(agent("b"), "message.get", json!({"id": 1}))
            .await
            .unwrap();

        let by_sender: Vec<_> = h
            .touches
            .touched("a")
            .unwrap()
            .into_iter()
            .map(|t| (t.verb, t.item))
            .collect();
        let by_reader: Vec<_> = h
            .touches
            .touched("b")
            .unwrap()
            .into_iter()
            .map(|t| (t.verb, t.item))
            .collect();

        assert_eq!(by_sender, [(Verb::Wrote, "message:1".to_owned())]);
        assert_eq!(by_reader, [(Verb::Read, "message:1".to_owned())]);
    }

    #[tokio::test]
    async fn b11_reading_is_by_actor_the_user_may_read_any_an_agent_only_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
        );
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

        let forbidden = h
            .call_as(agent("c"), "message.get", json!({"id": 1}))
            .await
            .unwrap_err();
        assert_eq!(forbidden.code, code::FORBIDDEN);

        h.call_as(agent("a"), "message.get", json!({"id": 1}))
            .await
            .unwrap();
        h.call_as(agent("b"), "message.get", json!({"id": 1}))
            .await
            .unwrap();
        h.call("message.get", json!({"id": 1})).await.unwrap();
    }

    #[tokio::test]
    async fn b11_list_for_an_agent_returns_only_messages_it_sent_or_received() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
        );
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
        h.call_as(
            agent("c"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "yo"}),
        )
        .await
        .unwrap();

        let listed_by_a = h
            .call_as(agent("a"), "message.list", json!({}))
            .await
            .unwrap();
        let ids: Vec<_> = listed_by_a
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].clone())
            .collect();
        assert_eq!(ids, [json!(1)]);

        let listed_by_b = h
            .call_as(agent("b"), "message.list", json!({}))
            .await
            .unwrap();
        assert_eq!(listed_by_b.as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn b11_list_to_filters_by_receiver() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(
            dir.path(),
            vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
        );
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "c", "kind": "note", "body": "yo"}),
        )
        .await
        .unwrap();

        let listed = h.call("message.list", json!({"to": "b"})).await.unwrap();
        let ids: Vec<_> = listed
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].clone())
            .collect();

        assert_eq!(ids, [json!(1)]);
    }

    #[tokio::test]
    async fn b11_list_for_an_agent_never_matches_an_extension_sharing_its_id() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("y", Kind::Idle)]);
        let ext_x = Actor {
            kind: ActorKind::Ext,
            id: "x".into(),
            parent: None,
        };
        h.call_as(
            ext_x,
            "message.send",
            json!({"to": "y", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

        let listed_by_agent_x = h
            .call_as(agent("x"), "message.list", json!({}))
            .await
            .unwrap();

        assert_eq!(
            listed_by_agent_x.as_array().unwrap().len(),
            0,
            "Agent x must not see the Extension x's Message just because the id strings match"
        );
    }

    #[tokio::test]
    async fn b11_reading_an_agent_never_matches_an_extension_sharing_its_id() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("y", Kind::Idle)]);
        let ext_x = Actor {
            kind: ActorKind::Ext,
            id: "x".into(),
            parent: None,
        };
        let sent = h
            .call_as(
                ext_x,
                "message.send",
                json!({"to": "y", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        let id = sent["id"].as_u64().unwrap() as u32;

        let err = h
            .call_as(agent("x"), "message.get", json!({"id": id}))
            .await
            .unwrap_err();

        assert_eq!(
            err.code,
            code::FORBIDDEN,
            "Agent x may not read a Message the Extension x sent, just because the id strings match"
        );
    }

    fn ext(id: &str) -> Actor {
        Actor {
            kind: ActorKind::Ext,
            id: id.into(),
            parent: None,
        }
    }

    #[tokio::test]
    async fn b11_an_extension_sharing_a_receivers_id_cannot_read_or_list_its_messages() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        let got = h
            .call_as(ext("b"), "message.get", json!({"id": sent["id"]}))
            .await
            .unwrap_err();
        let listed = h
            .call_as(ext("b"), "message.list", json!({}))
            .await
            .unwrap();

        assert_eq!(got.code, code::FORBIDDEN);
        assert_eq!(listed.as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn b1_only_an_agent_or_the_user_is_its_own_receiver() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("a", Kind::Idle)]);
        let to_you = json!({"to": "you", "kind": "note", "body": "hi"});

        let user = h.call("message.send", to_you).await.unwrap_err();
        let agent_self = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "a", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap_err();
        let extension = h
            .call_as(
                ext("a"),
                "message.send",
                json!({"to": "a", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(
            (user.code, agent_self.code),
            (code::INVALID_PARAMS, code::INVALID_PARAMS)
        );
        assert_eq!(extension["status"], "pending");
    }

    #[tokio::test]
    async fn b11_list_status_filters_by_status() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
        for body in ["first", "second"] {
            h.call(
                "message.send",
                json!({"to": "b", "kind": "note", "body": body}),
            )
            .await
            .unwrap();
        }
        h.call("message.drop", json!({"id": 1})).await.unwrap();

        let listed = h
            .call("message.list", json!({"status": "pending"}))
            .await
            .unwrap();
        let ids: Vec<_> = listed
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].clone())
            .collect();

        assert_eq!(ids, [json!(2)]);
    }

    fn door(id: &str, parent: Option<&str>) -> RailNode {
        let mut door = node(
            id,
            NodeKind::Workstream,
            true,
            Some(Status {
                kind: Kind::Idle,
                label: "status".into(),
                since: 0,
                finished: "0".into(),
            }),
        );
        door.parent = parent.map(Into::into);
        door
    }

    #[tokio::test]
    async fn b2_a_message_to_an_idle_door_reaches_its_inbox_without_a_later_status_event() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::with_inbox(
            dir.path(),
            vec![door("m", None), agent_node("a", Kind::Working)],
        );

        let sent = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "m", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();

        assert_eq!(h.inbox.typed().len(), 1);
        let got = h
            .call("message.get", json!({"id": sent["id"]}))
            .await
            .unwrap();
        assert_eq!(got["status"], "delivered");
    }
}
