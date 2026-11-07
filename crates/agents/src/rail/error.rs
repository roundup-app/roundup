use rpc::RpcError;

/// RB3798c: what a Rail or Ask store call can fail with, typed until the RPC edge.
#[derive(Debug, thiserror::Error)]
pub(crate) enum StoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Ordinal(#[from] std::num::ParseIntError),
    #[error(transparent)]
    Range(#[from] std::num::TryFromIntError),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Internal(String),
    /// A refusal that carries its own code and data (Undo refusals, a caller's callback).
    #[error(transparent)]
    Refused(#[from] RpcError),
}

impl StoreError {
    pub(crate) fn not_found(what: impl std::fmt::Display) -> Self {
        Self::NotFound(what.to_string())
    }

    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub(crate) fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden(message.into())
    }

    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }

    pub(crate) fn internal(message: impl std::fmt::Display) -> Self {
        Self::Internal(message.to_string())
    }
}

impl From<StoreError> for RpcError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Sql(_)
            | StoreError::Json(_)
            | StoreError::Ordinal(_)
            | StoreError::Range(_)
            | StoreError::Internal(_) => RpcError::internal(error),
            StoreError::NotFound(what) => RpcError::not_found(what),
            StoreError::Conflict(message) => RpcError::conflict(message),
            StoreError::Forbidden(message) => RpcError::forbidden(message),
            StoreError::Invalid(message) => RpcError::new(rpc::code::INVALID_PARAMS, message),
            StoreError::Refused(error) => error,
        }
    }
}
