//! The one failure type of the contracts library: what an order, an owner, a text, an ordinal or a method declaration refuses.

use crate::agent::{ASK_CAP, TITLE_CAP};

/// Every message reads as it did when these were strings; `From<Error> for String` keeps callers' own string plumbing unchanged.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("order ask must not be empty")]
    EmptyOrderAsk,
    #[error("order title must not be empty")]
    EmptyOrderTitle,
    #[error("order done must not be empty")]
    EmptyOrderDone,
    #[error("order limits must not be empty")]
    EmptyOrderLimit,
    #[error("order question must not be empty")]
    EmptyOrderQuestion,
    #[error("order ask is over {ASK_CAP} characters")]
    OrderAskTooLong,
    #[error("order title is over {TITLE_CAP} words")]
    OrderTitleTooLong,
    #[error("an owner selector must be resolved by the Daemon")]
    UnresolvedOwner,
    #[error("must not be empty")]
    TextEmpty,
    #[error("must be at most {0} bytes")]
    TextTooLong(usize),
    #[error("invalid ordinal {0:?}")]
    InvalidOrdinal(String),
    #[error("{name}: fill {field}")]
    IncompleteMetadata {
        name: &'static str,
        field: &'static str,
    },
}

impl From<Error> for String {
    fn from(error: Error) -> String {
        error.to_string()
    }
}
