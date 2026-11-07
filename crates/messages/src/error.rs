//! The one error code below a handler returns. Only `impl From<Error> for RpcError` picks a
//! code and message (RB3798c), so the Daemon answers each failure as it did when the code built
//! `RpcError` at every site.

use rpc::{RpcError, code};

/// A failure of a Message store, delivery or inbox operation, by what its caller does about it.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The Daemon's own fault: a store read or write, a serialisation, an injected fault.
    #[error("{0}")]
    Internal(String),
    /// The call names something that is not there.
    #[error("not found: {0}")]
    NotFound(String),
    /// The caller may not do this.
    #[error("{0}")]
    Forbidden(String),
    /// The call is well formed but the state refuses it.
    #[error("{0}")]
    Conflict(String),
    /// The call's parameters are wrong.
    #[error("{0}")]
    InvalidParams(String),
    /// B50: the receiver's inbox cannot take a Message now.
    #[error("{0}")]
    InboxUnavailable(String),
    /// A failure another module already answered with its own code (a Rail read, a Touch, a
    /// parameter parse); passed on unchanged.
    #[error("{}", .0.message)]
    Rpc(#[from] RpcError),
}

impl Error {
    pub(crate) fn internal(cause: impl std::fmt::Display) -> Self {
        Self::Internal(cause.to_string())
    }

    pub(crate) fn not_found(what: impl std::fmt::Display) -> Self {
        Self::NotFound(what.to_string())
    }

    pub(crate) fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden(message.into())
    }

    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub(crate) fn invalid_params(message: impl Into<String>) -> Self {
        Self::InvalidParams(message.into())
    }

    pub(crate) fn inbox_unavailable(message: impl Into<String>) -> Self {
        Self::InboxUnavailable(message.into())
    }
}

impl From<Error> for RpcError {
    fn from(err: Error) -> Self {
        match err {
            Error::Rpc(err) => err,
            Error::NotFound(what) => RpcError::not_found(what),
            Error::Forbidden(message) => RpcError::forbidden(message),
            Error::Conflict(message) => RpcError::conflict(message),
            Error::InvalidParams(message) => RpcError::new(code::INVALID_PARAMS, message),
            Error::InboxUnavailable(message) => RpcError::new(code::INBOX_UNAVAILABLE, message),
            Error::Internal(message) => RpcError::internal(message),
        }
    }
}
