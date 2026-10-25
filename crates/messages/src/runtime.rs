//! Message store ownership, initialization, clock and failure isolation.

use super::*;

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

pub(super) struct Inner {
    pub(super) store: Mutex<Store>,
    /// Answers `rail.tree`, the only thing `message.send` needs to know about a receiver: whether
    /// it names an Agent (or a Door) at all, and that Agent's Kind.
    pub(super) agents: Arc<dyn TerminalOwners>,
    pub(super) bus: Bus,
    /// Starts the listener at most once: immediately when `open` already runs on a Tokio
    /// runtime, lazily on the first call otherwise (a caller that builds a `Messages` before
    /// its own runtime exists).
    pub(super) listener_started: std::sync::Once,
    /// Subscribed at `open`, before any runtime may exist, so no `agent.status` fires between
    /// `open` and the listener's first poll; `start_listener` takes it out at most once.
    pub(super) events: Mutex<Option<tokio::sync::broadcast::Receiver<contracts::Event>>>,
    /// A `Ctx` for the calls the listener makes on its own behalf (B9's resync), and where the
    /// Touches of the Messages the Daemon makes (B17) are logged.
    pub(super) touches: Arc<provenance::Touches>,
    pub(super) clock: Clock,
    pub(super) fault: Fault,
    // Test observers acknowledge whole background passes, including caught failures.
    #[cfg(test)]
    pub(super) completed: tokio::sync::broadcast::Sender<&'static str>,
    /// B22: the pushes of each Door's window.
    pub(super) pushes: tokio::sync::Mutex<pushes::Ledger>,
    // A reservation waits for any accepted prompt to finish before its caller stops Agents.
    pub(super) delivery: tokio::sync::RwLock<()>,
    /// B39: the Messages being written to an inbox by this Daemon run, so no second `idle`
    /// writes them again. A Message in flight at a kill is not in it.
    pub(super) typing: Mutex<std::collections::HashSet<u32>>,
    /// B50: the transport of every Message to an Agent; without one nothing is delivered.
    pub(super) inbox: std::sync::OnceLock<Arc<dyn NoteInbox>>,
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

    pub(super) fn store(&self) -> Result<MutexGuard<'_, Store>, RpcError> {
        Ok(lock(&self.inner.store))
    }
}
pub(super) fn now() -> SystemTime {
    SystemTime::now()
}

pub(super) fn now_ms() -> i64 {
    i64::try_from(
        now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

/// Takes the store lock, whatever panicked while it was taken before: a writer's transaction
/// rolls back with its panic (`Store::atomically`), so the Store it guards is whole (B28).
pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Runs `Env::fault` for `op` inside the store lock.
pub(super) fn trip(inner: &Inner, op: &str) -> Result<(), String> {
    let _store = lock(&inner.store);
    (inner.fault)(op)
}

pub(super) fn log_failure(op: &str, cause: &str) {
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
pub(super) async fn guarded<T>(op: &str, fut: impl Future<Output = T> + Send) -> Result<T, String> {
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

impl Messages {
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
}
