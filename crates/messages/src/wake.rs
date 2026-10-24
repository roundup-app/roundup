//! B41 to B44: the saved Wake requests of Agents, and the one write that fires one. The Daemon
//! decides from `agent.status` Events when a request holds; this module keeps the requests across a
//! restart and turns a held request into exactly one Message.

use contracts::agent::DigestEntry;
use contracts::message::{MessageKind, SendParams};
use contracts::{Actor, Kind};
use rpc::{Ctx, RpcError};

use crate::digest::{cut, kind_word};
use crate::{Messages, lock};

pub(crate) const PREFIX: &str = "[wake]";
const ENTRY_BYTES: usize = 512;
const OPEN_REQUESTS: u32 = 8;
/// The text of the refusal that tells a firing its request was already fired.
const GONE: &str = "wake request already fired";

/// One open request: `waiter` is told when `ids` finish, all of them or `any_of` the first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wake {
    pub id: u32,
    pub waiter: String,
    pub ids: Vec<String>,
    pub any_of: bool,
    /// The named Agents seen finished since the request, in the order named.
    pub finished: Vec<String>,
    /// The Event number up to which the request was decided (B44).
    pub seen: u64,
}

impl Wake {
    /// B41: whether the request holds.
    #[must_use]
    pub fn holds(&self) -> bool {
        if self.any_of {
            !self.finished.is_empty()
        } else {
            self.ids.iter().all(|id| self.finished.contains(id))
        }
    }
}

/// B41: a Kind is finished when the Agent has nothing running for the one who waits.
#[must_use]
pub fn finished(kind: Kind) -> bool {
    matches!(kind, Kind::Idle | Kind::Done | Kind::Error | Kind::NeedsYou)
}

/// B42: the body of a firing: `[wake]`, then one entry for each named Agent in the order named.
#[must_use]
pub fn note_body(entries: &[DigestEntry]) -> String {
    let line = |text: &str| text.replace(['\n', '\r'], " ");
    let mut body = PREFIX.to_owned();
    for entry in entries {
        let text = format!(
            "{} is {}\n  last: {}",
            line(&entry.name),
            kind_word(entry.kind),
            line(&entry.last)
        );
        body.push('\n');
        body.push_str(&cut(&text, ENTRY_BYTES));
    }
    body
}

impl Messages {
    /// B41: saves a request for `waiter`. Refused with `CONFLICT` at the eighth open request.
    pub fn save_wake(
        &self,
        waiter: &str,
        ids: &[String],
        any_of: bool,
        finished: &[String],
        seen: u64,
    ) -> Result<Wake, RpcError> {
        let store = lock(&self.inner.store);
        if store.count_wakes(waiter)? >= OPEN_REQUESTS {
            return Err(RpcError::conflict(format!(
                "{waiter} already has {OPEN_REQUESTS} open wake requests"
            )));
        }
        store.insert_wake(waiter, ids, any_of, finished, seen)
    }

    /// B44: every open request, oldest first.
    pub fn wakes(&self) -> Result<Vec<Wake>, RpcError> {
        lock(&self.inner.store).wakes()
    }

    /// B44: the request `id` if it is still open.
    pub fn wake(&self, id: u32) -> Result<Option<Wake>, RpcError> {
        lock(&self.inner.store).wake(id)
    }

    /// B44: the request `id` has been decided up to Event `seen`, with `finished` seen finished.
    pub fn keep_wake(&self, id: u32, finished: &[String], seen: u64) -> Result<(), RpcError> {
        lock(&self.inner.store).update_wake(id, finished, seen)
    }

    /// B41(f): `waiter` ended, so its requests are dropped without a note.
    pub fn drop_wakes_of(&self, waiter: &str) -> Result<(), RpcError> {
        lock(&self.inner.store).delete_wakes_of(waiter)
    }

    /// B42: in one write, removes request `wake` and creates the Message `body` from the Daemon
    /// to `to`. `false` when the request was not open, so nothing was made.
    pub async fn fire_wake(&self, wake: u32, to: &str, body: String) -> Result<bool, RpcError> {
        let ctx = Ctx {
            actor: Actor::daemon(),
            bus: self.inner.bus.clone(),
            touches: std::sync::Arc::clone(&self.inner.touches),
        };
        let params = SendParams {
            to: to.to_owned(),
            kind: MessageKind::Note,
            body,
            reply_to: None,
        };
        match self
            .send_message_with(&ctx, params, false, Some(wake), None, None)
            .await
        {
            Ok(_) => Ok(true),
            Err(err) if err.message == GONE => Ok(false),
            Err(err) => Err(err),
        }
    }

    /// B43: tells `parent`, at once and outside B22's caps, that `entry`'s Agent failed or needs
    /// the user. The note is the digest push of that entry (B33).
    pub async fn note_attention(&self, parent: &str, entry: &DigestEntry) -> Result<(), RpcError> {
        let ctx = Ctx {
            actor: Actor::daemon(),
            bus: self.inner.bus.clone(),
            touches: std::sync::Arc::clone(&self.inner.touches),
        };
        let params = SendParams {
            to: parent.to_owned(),
            kind: MessageKind::Note,
            body: crate::digest::push_body(entry),
            reply_to: None,
        };
        self.send_message(&ctx, params, false).await.map(drop)
    }

    /// B42: inside the write that makes the note, the request goes with it.
    pub(crate) fn fire_inside(
        &self,
        store: &crate::store::Store,
        wake: u32,
    ) -> Result<(), RpcError> {
        if store.delete_wake(wake)? {
            Ok(())
        } else {
            Err(RpcError::conflict(GONE))
        }
    }
}
