//! Messages between Actors, and the Routes that decide how they are delivered. Owner: messages
//! Builder. Stores Messages and Routes, answers the user's and an Actor's calls, and on an `idle`
//! writes it to the receiving Agent's Claude inbox.

pub mod continuation;
mod contract_handlers;
mod delivery;
pub mod digest;
#[doc(hidden)]
pub mod digest_schema;
mod dispatch;
pub mod evidence;
mod flight;
mod inbox;
mod pushes;
pub mod reaction;
mod receiver_view;
mod removal;
pub mod restart;
mod retirement;
mod routes;
mod runtime;
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

use async_trait::async_trait;
use contracts::agent::RailNode;
use contracts::message::{
    ListParams, Message, MessageId, MessageKind, MessageStatus, Reason, Route, SendParams,
    SetRouteParams,
};
use contracts::{Actor, ActorKind, EventData, Kind, Verb};
#[cfg(test)]
use delivery::on_status;
use delivery::{
    Pick, accept_receiver, accept_reservation, binding, deliver_pending as nudge, ended,
    load_rail_nodes, reconcile, sender_name, start_listener,
};
use dispatch::{is_receiver, item, require_user, send_params};
use flight::confirm_ids;
pub use inbox::NoteInbox;
use receiver_view::{gone_drops, idle_batch};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, code, params, reply};
use runtime::{Inner, guarded, lock, log_failure, trip};
use send::MAX_BODY_BYTES;
use serde_json::Value;
use step::Event;
use store::Store;
use tokio::sync::broadcast::error::RecvError;

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

pub struct Messages {
    inner: Arc<Inner>,
}

#[cfg(test)]
mod tests;
