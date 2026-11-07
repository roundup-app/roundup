//! The Run an Agent's lifecycle state lives in, and the Slot that holds it.

pub(crate) mod fold;
mod run;
pub(crate) use run::{Fold, Run, Slot};
