//! The one error type below the handler (RB3798c). Only `From<Error> for RpcError` picks a code.
use rpc::RpcError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The Todo, deletion or removal named is not there: `NOT_FOUND`.
    #[error("not found: {0}")]
    NotFound(String),
    /// The caller may not act on this object: `FORBIDDEN`.
    #[error("{0}")]
    Forbidden(String),
    /// The request conflicts with current state: `CONFLICT`.
    #[error("{0}")]
    Conflict(String),
    /// The params are well-formed JSON the method refuses: `INVALID_PARAMS`.
    #[error("{0}")]
    InvalidParams(String),
    /// Undo is blocked because the removed item's parent was removed too.
    #[error("Can't undo: \"{name}\" was removed too. Undo that first.")]
    UndoParent { id: String, name: String },
    /// Undo is blocked because another item occupies the removed item's identity.
    #[error("Can't undo: \"{name}\" already occupies the removed item's identity.")]
    UndoIdentity {
        id: String,
        name: String,
        removable: bool,
    },
    /// A SQLite statement failed: `INTERNAL`.
    #[error("{0}")]
    Sql(#[from] rusqlite::Error),
    /// A stored or replied value did not encode or decode: `INTERNAL`.
    #[error("{0}")]
    Codec(#[from] serde_json::Error),
    /// The store broke an invariant of its own: `INTERNAL`.
    #[error("{0}")]
    Internal(String),
    /// A failure a coordinator or the call context raised; it keeps its code.
    #[error(transparent)]
    Rpc(#[from] RpcError),
}

impl Error {
    pub(crate) fn internal(why: impl std::fmt::Display) -> Self {
        Self::Internal(why.to_string())
    }
}

impl From<Error> for RpcError {
    fn from(error: Error) -> Self {
        match error {
            Error::NotFound(what) => Self::not_found(what),
            Error::Forbidden(why) => Self::forbidden(why),
            Error::Conflict(why) => Self::conflict(why),
            Error::InvalidParams(why) => Self::new(rpc::code::INVALID_PARAMS, why),
            Error::UndoParent { id, name } => Self::undo_parent(id, name),
            Error::UndoIdentity {
                id,
                name,
                removable,
            } => Self::undo_identity(id, name, removable),
            Error::Rpc(error) => error,
            error @ (Error::Sql(_) | Error::Codec(_) | Error::Internal(_)) => Self::internal(error),
        }
    }
}
