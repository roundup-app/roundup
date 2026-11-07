//! The wire contract: every RPC parameter, result and event, as Rust types.
//! `just contracts` regenerates `contracts/generated/*.ts`; `just contracts-fresh` verifies it.
//! Owned by the Architect. Editing this crate is a Contract change (AGENTS.md rule 4).

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

extern crate self as contracts;

pub mod action;
pub mod agent;
pub mod ask;
pub mod common;
pub mod data;
mod declarations;
pub mod deliverable;
pub mod describe;
pub mod event;
pub mod export;
pub mod feedback;
pub mod github;
pub mod link;
pub mod message;
pub mod methods;
pub mod pad;
pub mod project;
pub mod skill;
pub mod terminal;
pub mod text;
pub mod todo;
pub mod workstream;

pub use common::*;
pub use event::{Event, EventData};
pub use text::Text;
