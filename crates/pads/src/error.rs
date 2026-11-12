use rpc::RpcError;

/// Every way a Pad operation refuses. Only the handler turns it into an `RpcError`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Internal(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Forbidden(String),
    /// A link that is no Pad link of the shape LK1 and LK4 describe, with the reason.
    #[error("{0}")]
    BadLink(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{message}")]
    Refused { code: i64, message: String },
    #[error("Can't undo: \"{name}\" was removed too")]
    UndoParent { id: String, name: String },
    #[error("Can't undo: a Pad named \"{0}\" already exists")]
    UndoPadName(String),
    /// A refusal from `rpc` itself (parameters, Item access, reply encoding).
    #[error(transparent)]
    Rpc(#[from] RpcError),
}

impl Error {
    pub(crate) fn internal(err: impl std::fmt::Display) -> Self {
        Self::Internal(err.to_string())
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

    pub(crate) fn new(code: i64, message: impl Into<String>) -> Self {
        Self::Refused {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn undo_parent(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self::UndoParent {
            id: id.into(),
            name: name.into(),
        }
    }

    pub(crate) fn undo_pad_name(name: impl Into<String>) -> Self {
        Self::UndoPadName(name.into())
    }
}

impl From<Error> for RpcError {
    fn from(err: Error) -> Self {
        match err {
            Error::Internal(message) => RpcError::internal(message),
            Error::NotFound(what) => RpcError::not_found(what),
            Error::Forbidden(message) => RpcError::forbidden(message),
            Error::BadLink(why) => RpcError::new(rpc::code::INVALID_PARAMS, why),
            Error::Conflict(message) => RpcError::conflict(message),
            Error::Refused { code, message } => RpcError::new(code, message),
            Error::UndoParent { id, name } => RpcError::undo_parent(id, name),
            Error::UndoPadName(name) => RpcError::undo_pad_name(name),
            Error::Rpc(err) => err,
        }
    }
}
