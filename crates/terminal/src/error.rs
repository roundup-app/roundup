use rpc::RpcError;

/// Every way a Terminal operation fails below the handler. `Terminals` turns it into an
/// `RpcError` once, where it answers a caller.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// `INTERNAL`: the Daemon's fault, never the caller's.
    #[error("{0}")]
    Internal(String),
    /// `INTERNAL`: a lock a panicking thread kept, so its state cannot be trusted.
    #[error("{0} poisoned")]
    Poisoned(&'static str),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    InvalidParams(String),
    /// The connection or owner dropped after the call may have run.
    #[error("{0}")]
    UnknownOutcome(String),
    /// A refusal from `rpc` itself or from a Terminal owner; it keeps its code.
    #[error(transparent)]
    Rpc(#[from] RpcError),
}

impl Error {
    pub(crate) fn internal(err: impl std::fmt::Display) -> Self {
        Self::Internal(err.to_string())
    }

    /// MC4, MC56: a core failure, its code first, so the App shows the code's label and never the
    /// core's own words.
    pub(crate) fn core(err: &herdr::Error) -> Self {
        Self::Internal(format!("{}: {err}", err.code()))
    }

    pub(crate) fn not_found(what: impl std::fmt::Display) -> Self {
        Self::NotFound(what.to_string())
    }

    /// `NOT_FOUND`, whether raised here or answered by a Terminal owner.
    pub(crate) fn is_not_found(&self) -> bool {
        match self {
            Self::NotFound(_) => true,
            Self::Rpc(err) => err.code == rpc::code::NOT_FOUND,
            _ => false,
        }
    }

    pub(crate) fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }

    pub(crate) fn unknown_outcome(message: impl Into<String>) -> Self {
        Self::UnknownOutcome(message.into())
    }
}

/// A poisoned lock answers `Error::Poisoned` instead of going on with state a panic left half-written.
pub(crate) trait Locked<T> {
    fn locked(&self, what: &'static str) -> Result<std::sync::MutexGuard<'_, T>, Error>;
}

impl<T> Locked<T> for std::sync::Mutex<T> {
    fn locked(&self, what: &'static str) -> Result<std::sync::MutexGuard<'_, T>, Error> {
        self.lock().map_err(|_| Error::Poisoned(what))
    }
}

impl From<Error> for RpcError {
    fn from(err: Error) -> Self {
        match err {
            Error::Internal(message) => RpcError::internal(message),
            Error::Poisoned(what) => RpcError::internal(format!("{what} poisoned")),
            Error::NotFound(what) => RpcError::not_found(what),
            Error::Conflict(message) => RpcError::conflict(message),
            Error::InvalidParams(message) => RpcError::new(rpc::code::INVALID_PARAMS, message),
            Error::UnknownOutcome(message) => RpcError::unknown_outcome(message),
            Error::Rpc(err) => err,
        }
    }
}

/// MC32: why a file call on a Machine failed. `code` is herdr-core's `kind` when the core answered
/// (`not_found`, `io`, ...), else the cause's own code (`core_no_method`, `core_closed`, ...).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {message}")]
pub struct FileError {
    pub code: String,
    pub message: String,
}

impl FileError {
    pub(crate) fn core(err: herdr::Error) -> Self {
        match err {
            herdr::Error::Rpc(rpc) => Self {
                code: rpc.kind.clone(),
                message: rpc.to_string(),
            },
            other => Self {
                code: other.code().to_owned(),
                message: other.to_string(),
            },
        }
    }
}

impl From<Error> for FileError {
    fn from(err: Error) -> Self {
        Self {
            code: "core_unreachable".into(),
            message: err.to_string(),
        }
    }
}
