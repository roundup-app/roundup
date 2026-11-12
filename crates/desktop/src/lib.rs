//! The App: starts a Daemon for each open Project and passes calls and events to the webview (`scenarios/app.md`).

pub mod alert;
mod config;
mod daemon;
mod diagnostics;
mod facts;
mod feedback;
mod fork;
mod fork_app;
#[cfg(any(test, feature = "idle-perf"))]
mod idle;
mod launch;
mod menu;
mod menu_bar;
mod navigation;
mod open;
mod paste;
mod project_task;
mod projects;
mod reopen;
mod store;
mod update;
mod window;

mod builder;
mod commands;
mod run;

/// A lock result's guard; a lock a panicking holder poisoned is used as it was left.
pub(crate) trait Unpoisoned {
    type Guard;
    fn unpoisoned(self) -> Self::Guard;
}

impl<G> Unpoisoned for std::sync::LockResult<G> {
    type Guard = G;
    fn unpoisoned(self) -> G {
        self.unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub use builder::build;
pub(crate) use builder::build_with_feedback;
pub use config::{CALL_BOUND, Config, READY_BOUND};
pub use projects::{AppState, Listed, Project};
pub use run::{context, handle_menu_event, handle_run_event, run};
