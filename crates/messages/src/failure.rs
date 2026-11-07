//! DCL1, U6248a: a pending Message the inbox could not take, or that no receipt followed after
//! four writes while its receiver was eligible, is a delivery failure the Rows can show. A Message
//! the send path holds by its own rules is never one. The receipt clock starts at the inbox
//! write and backs off exponentially with jitter (30 s, 1, 2, 4 min, then every 8 min).

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use backon::{BackoffBuilder, ExponentialBuilder};

use super::*;

/// Writes that must miss their receipt before the line shows.
const SHOWN_AFTER_MISSES: u32 = 4;

pub(crate) const UNREADABLE: &str = "transcript unreadable";
pub(crate) const WRITE_FAILED: &str = "inbox write failed";
pub(crate) const NO_RECEIPT: &str = "no receipt after four writes";
/// U6260a: why the send path keeps a Message; a waiting Message is never a delivery failure.
pub(crate) const AWAITING_INPUT: &str = "held until the user's first input in this Attempt";
pub(crate) const INBOX_NOT_READY: &str = "held until the receiver's inbox is ready";
pub(crate) const RECEIVER_BUSY: &str = "the receiver is busy; written when it is idle";
pub(crate) const RESTART_RESERVED: &str = "held until the reserved restart ends";

/// The one waiting predicate: why the send path keeps a Message `pending` instead of writing it.
pub(crate) fn waiting_reason(
    admitted: bool,
    inbox: contracts::agent::Inbox,
) -> Option<&'static str> {
    if !admitted {
        Some(AWAITING_INPUT)
    } else if inbox != contracts::agent::Inbox::Ok {
        Some(INBOX_NOT_READY)
    } else {
        None
    }
}

/// Records why `ids` are waiting, or clears them when `reason` is `None`.
pub(crate) fn hold(inner: &Inner, ids: &[u32], reason: Option<&'static str>) {
    let mut waiting = lock(&inner.waiting);
    for id in ids {
        match reason {
            Some(reason) => waiting.insert(*id, reason),
            None => waiting.remove(id),
        };
    }
}

/// Forgets the reason of every Message that left `pending`, however it left (written, refused,
/// dropped or stale), so the map never outgrows the queue.
pub(crate) fn forget_settled(inner: &Inner) {
    let pending: HashSet<u32> = lock(&inner.store)
        .pending_all()
        .expect("message store")
        .into_iter()
        .map(|m| m.id)
        .collect();
    lock(&inner.waiting).retain(|id, _| pending.contains(id));
}

/// `message` as its sender reads it: a `pending` Message carries the reason it waits.
pub(crate) fn with_waiting(inner: &Inner, mut message: Message) -> Message {
    if message.status == MessageStatus::Pending {
        message.waiting = lock(&inner.waiting)
            .get(&message.id)
            .map(|r| (*r).to_owned());
    }
    message
}

/// Each receiver's current cause, and since when it has been eligible with Messages waiting.
pub(crate) struct Failures {
    cause: HashMap<String, &'static str>,
    since: HashMap<String, i64>,
    /// Receivers this process has judged: busy time resets their clock, a first sight does not.
    seen: HashSet<String>,
    /// Receivers whose inbox write this process made and no receipt has matched yet.
    written: HashSet<String>,
    /// Writes of each receiver that missed their receipt.
    misses: HashMap<String, u32>,
    /// Jitter on the redelivery schedule, off under test unless a test seeds it.
    pub(crate) jitter: Option<u64>,
}

impl Default for Failures {
    fn default() -> Self {
        Self {
            cause: HashMap::new(),
            since: HashMap::new(),
            seen: HashSet::new(),
            written: HashSet::new(),
            misses: HashMap::new(),
            jitter: (!cfg!(test)).then(|| {
                use std::hash::{BuildHasher, Hasher};
                std::collections::hash_map::RandomState::new()
                    .build_hasher()
                    .finish()
            }),
        }
    }
}

impl Failures {
    /// How long after its last write `agent` waits for a receipt before writing again.
    fn wait_ms(&self, agent: &str) -> i64 {
        let misses = self.misses.get(agent).copied().unwrap_or(0) as usize;
        let mut schedule = ExponentialBuilder::default()
            .with_min_delay(Duration::from_secs(30))
            .with_factor(2.0)
            .with_max_delay(Duration::from_secs(8 * 60))
            .without_max_times();
        if let Some(seed) = self.jitter {
            schedule = schedule
                .with_jitter()
                .with_jitter_seed(seed ^ misses as u64);
        }
        schedule
            .build()
            .nth(misses)
            .map_or(i64::MAX, |d| d.as_millis() as i64)
    }
}

/// The inbox took a write for `agent`: its receipt clock starts now.
pub(crate) fn wrote(inner: &Inner, agent: &str) {
    let now = (inner.clock)();
    let mut failures = lock(&inner.failures);
    failures.since.insert(agent.to_owned(), now);
    failures.written.insert(agent.to_owned());
}

/// The send path's own rules: whether the inbox takes this Message now (A5556a's first-input
/// gate). The send and the sweep both decide through it, so a Message that waits on its target is never a failure.
pub(crate) fn admitted(inner: &Inner, agent: &str, message: &Message) -> bool {
    inner
        .inbox
        .get()
        .is_none_or(|inbox| inbox.admits(agent, &message.from))
}

pub(crate) fn record(inner: &Inner, agent: &str, cause: &'static str) {
    lock(&inner.failures).cause.insert(agent.to_owned(), cause);
}

/// Receipts matched every pending Message: the failure is repaired.
pub(crate) fn settle(inner: &Inner, agent: &str) {
    let waiting = !lock(&inner.store)
        .list_pending_to(agent)
        .expect("message store")
        .is_empty();
    if !waiting {
        let mut failures = lock(&inner.failures);
        failures.cause.remove(agent);
        failures.since.remove(agent);
        failures.seen.remove(agent);
        failures.written.remove(agent);
        failures.misses.remove(agent);
    }
}

/// One reconciliation pass, without a new event: every eligible receiver whose Messages waited
/// the schedule of its last write gets its cause shown and its original batch written again.
pub(super) async fn sweep(inner: &Arc<Inner>) {
    let (waiting, idle): (Vec<String>, Vec<String>) = {
        let store = lock(&inner.store);
        store
            .receivers()
            .expect("message store")
            .into_iter()
            .partition(|agent| {
                !store
                    .list_pending_to(agent)
                    .expect("message store")
                    .is_empty()
            })
    };
    for agent in &idle {
        settle(inner, agent);
    }
    if waiting.is_empty() {
        return;
    }
    let Ok(nodes) = delivery::load_rail_nodes(inner).await else {
        // Eligibility cannot be established: show the read failure without waiting.
        for agent in &waiting {
            record(inner, agent, UNREADABLE);
        }
        return;
    };
    let now = (inner.clock)();
    for agent in waiting {
        let parked = lock(&inner.store)
            .list_pending_to(&agent)
            .expect("message store")
            .iter()
            .all(|m| !admitted(inner, &agent, m));
        let eligible = !parked
            && nodes.iter().any(|node| {
                node.id == agent
                    && !delivery::ended(node)
                    && node.status_revision.is_some()
                    && node.status.as_ref().is_some_and(delivery::ready)
            });
        let stored = lock(&inner.store)
            .list_pending_to(&agent)
            .expect("message store")
            .iter()
            .map(|m| m.at)
            .min()
            .unwrap_or(now);
        let due = {
            let mut failures = lock(&inner.failures);
            let seen = !failures.seen.insert(agent.clone());
            if eligible {
                let since = *failures.since.entry(agent.clone()).or_insert(if seen {
                    now
                } else {
                    stored.min(now)
                });
                if now - since >= failures.wait_ms(&agent) {
                    failures.since.insert(agent.clone(), now);
                    if failures.written.contains(&agent) {
                        let misses = failures.misses.entry(agent.clone()).or_insert(0);
                        *misses += 1;
                        if *misses >= SHOWN_AFTER_MISSES {
                            failures.cause.entry(agent.clone()).or_insert(NO_RECEIPT);
                        }
                    }
                    true
                } else {
                    false
                }
            } else {
                // Busy, stopped, or asking for a permission: that time does not count.
                failures.since.remove(&agent);
                false
            }
        };
        if due {
            rearm_written(inner, &agent);
            delivery::deliver_pending(inner, &agent).await;
        }
    }
}

/// A write that missed its receipt is written again under the same `msg_id`: its flight and
/// written marks are forgotten, and its repeat check is skipped.
fn rearm_written(inner: &Inner, agent: &str) {
    let store = lock(&inner.store);
    for message in store.list_pending_to(agent).expect("message store") {
        if lock(&inner.inbox_written).remove(&message.id) {
            store.clear_flight(message.id).expect("message store");
            lock(&inner.rewrite).insert(message.id);
        }
    }
}

impl Messages {
    /// DCL1a: one delivery pass for `agent` at once; a fault that persists keeps its cause and every pending Message.
    pub async fn retry_delivery(&self, agent: &str) {
        delivery::deliver_pending(&self.inner, agent).await;
    }

    /// DCL1: why Messages to `agent` have not reached it, or `None` when none is failing.
    pub fn delivery_failure(&self, agent: &str) -> Option<&'static str> {
        lock(&self.inner.failures).cause.get(agent).copied()
    }
}
