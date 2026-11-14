use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::conn::{GENERATION, MIN_CORE};

/// herdr-core's error object: `code`, and `data.kind` and `data.hint`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub hint: String,
}

impl RpcError {
    pub(crate) fn from_value(v: &Value) -> RpcError {
        let text = |p: &str| {
            v.get("data")
                .and_then(|d| d.get(p))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        RpcError {
            code: v.get("code").and_then(Value::as_i64).unwrap_or_default(),
            message: v
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            kind: text("kind"),
            hint: text("hint"),
        }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({}, {}): {}",
            self.message, self.code, self.kind, self.hint
        )
    }
}

/// Why a core could not be read. Each cause is its own variant.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// `herdr-core` is not on the host's PATH (or the local program does not exist).
    #[error("herdr-core is missing")]
    Missing,
    /// The core refused the protocol generation, or answered one other than ours.
    #[error("herdr-core refused protocol generation {GENERATION}: {0}")]
    Refused(RpcError),
    /// CH7077g: the core's `hello` named a version older than [`MIN_CORE`], or none this client reads.
    #[error(
        "herdr-core {0} is older than {MIN_CORE}, the oldest this build runs on; update herdr-core"
    )]
    TooOld(String),
    /// MC32: the core's `hello` lists no such method, so the call is not made and nothing else
    /// (no exec) stands in for it.
    #[error("herdr-core lists no {0}; update herdr-core")]
    NoMethod(String),
    /// The pipe closed before or during the call.
    #[error("connection to herdr-core closed")]
    Closed,
    /// No answer within the timeout.
    #[error("herdr-core did not answer")]
    TimedOut,
    /// The core answered the call with an error.
    #[error("herdr-core error: {0}")]
    Rpc(RpcError),
    /// The core said something outside the protocol.
    #[error("herdr-core protocol error: {0}")]
    Protocol(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    /// The code a caller returns for this cause.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Missing => "core_missing",
            Error::Refused(_) => "unsupported_generation",
            Error::TooOld(_) => "core_too_old",
            Error::NoMethod(_) => "core_no_method",
            Error::Closed => "core_closed",
            Error::TimedOut => "core_silent",
            Error::Rpc(_) => "core_error",
            Error::Protocol(_) => "core_protocol",
            Error::Io(_) => "core_io",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
