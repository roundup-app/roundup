//! Provenance: the append-only log of Touches. There is no update or delete.

pub mod migration;
#[doc(hidden)]
pub mod schema;
mod store;

use std::sync::Mutex;

use rusqlite::Connection;

pub struct Touches {
    db: Mutex<Connection>,
}

#[cfg(test)]
mod tests;

/// Milliseconds since the Unix epoch, truncated toward zero.
pub fn now_ms() -> i64 {
    let millis = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    i64::try_from(millis).unwrap_or(i64::MAX)
}
