//! Rule 7 as a command: measure the Daemon, compare with the budgets file, fail on a miss.

pub mod budget;
mod error;
pub use error::{Error, Unmatched};
pub use measure::flood;
pub mod gate;
mod launch;
pub mod machine;
pub mod measure;
pub mod webview;

pub mod idle;

pub mod app;

pub mod paired;
