//! The wire contract: every RPC parameter, result and event, as Rust types.
//! `just contracts` regenerates `contracts/generated/*.ts`; `just contracts-fresh` verifies it.
//! Owned by the Architect. Editing this crate is a Contract change (AGENTS.md rule 4).

extern crate self as contracts;

pub mod agent;
pub mod ask;
pub mod attachment;
pub mod checkpoint;
pub mod common;
mod declarations;
pub mod deliverable;
pub mod event;
pub mod export;
pub mod github;
pub mod link;
pub mod message;
pub mod methods;
pub mod pad;
pub mod project;
pub mod reaction;
pub mod terminal;
pub mod todo;
pub mod workstream;

pub use common::*;
pub use event::{Event, EventData};
