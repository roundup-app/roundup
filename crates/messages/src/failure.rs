//! DCL1: a pending Message the inbox could not take, or that no receipt followed for 30 s while
//! its receiver was eligible, is a delivery failure the Rows can show. The cause is derived from
//! the pending Messages and the Daemon's clock, so a restart rebuilds the 30 s deadline from the stored time of the oldest pending Message.

use std::collections::{HashMap, HashSet};

use super::*;

/// How long an eligible pending Message may go without a receipt before it is a failure.
const DEADLINE_MS: i64 = 30_000;

pub(crate) const UNREADABLE: &str = "transcript unreadable";
pub(crate) const WRITE_FAILED: &str = "inbox write failed";
pub(crate) const NO_RECEIPT: &str = "no receipt after 30 s";

/// Each receiver's current cause, and since when it has been eligible with Messages waiting.
#[derive(Default)]
pub(crate) struct Failures {
    cause: HashMap<String, &'static str>,
    since: HashMap<String, i64>,
    /// Receivers this process has judged: busy time resets their clock, a first sight does not.
    seen: HashSet<String>,
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
    }
}

/// One reconciliation pass, without a new event: every eligible receiver whose Messages waited
/// 30 s since its last attempt gets its cause shown and its original batch written again.
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
        let eligible = nodes.iter().any(|node| {
            node.id == agent
                && !delivery::ended(node)
                && node.status_revision.is_some()
                && node
                    .status
                    .as_ref()
                    .is_some_and(|s| matches!(s.kind, Kind::Idle | Kind::Blocked | Kind::Error))
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
                if now - since >= DEADLINE_MS {
                    failures.since.insert(agent.clone(), now);
                    failures.cause.entry(agent.clone()).or_insert(NO_RECEIPT);
                    true
                } else {
                    false
                }
            } else {
                // Busy, stopped or asking for a permission: that time does not count.
                failures.since.remove(&agent);
                false
            }
        };
        if due {
            delivery::deliver_pending(inner, &agent).await;
        }
    }
}

impl Messages {
    /// DCL1: why Messages to `agent` have not reached it, or `None` when none is failing.
    pub fn delivery_failure(&self, agent: &str) -> Option<&'static str> {
        lock(&self.inner.failures).cause.get(agent).copied()
    }
}
