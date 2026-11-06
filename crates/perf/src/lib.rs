//! Rule 7 as a command: measure the Daemon, compare with the budgets file, fail on a miss.
#![deny(clippy::unwrap_used, clippy::expect_used)]
#![deny(clippy::panic, clippy::indexing_slicing)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
#![cfg_attr(test, allow(clippy::panic, clippy::indexing_slicing))]

pub mod budget;
pub use measure::flood;
pub mod gate;
mod launch;
pub mod machine;
pub mod measure;
pub mod webview;

pub mod idle;

pub mod app;

pub mod paired;
