//! Provenance: the append-only log of Touches. There is no update or delete.

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
