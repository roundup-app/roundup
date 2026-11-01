use serde::{Deserialize, Serialize};

/// JSON-RPC 2.0 error codes, plus roundup's own in the server-defined range.
pub mod code {
    pub const PARSE_ERROR: i64 = -32700;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL: i64 = -32603;
    pub const NOT_FOUND: i64 = -32001;
    /// The caller is not allowed to do this (for example, rewriting a Pad it does not own).
    pub const FORBIDDEN: i64 = -32002;
    /// The request is well-formed but conflicts with current state (for example, a blocker cycle).
    pub const CONFLICT: i64 = -32003;
    /// The connection closed after the request line was written but before a reply arrived: the
    /// Daemon may or may not have run the call.
    pub const UNKNOWN_OUTCOME: i64 = -32004;
    /// The Agent is not `idle`, so a Steer would land in the middle of its turn (H11).
    pub const BUSY: i64 = -32005;
    /// A Steer was written and its `UserPromptSubmit` Signal never came (H11).
    pub const NOT_ACCEPTED: i64 = -32006;
    /// The Agent has no turn to Interrupt (H13).
    pub const NOT_RUNNING: i64 = -32007;
    /// An Interrupt was written and the title never changed (H13).
    pub const NOT_ACKED: i64 = -32008;
    /// `events.subscribe` asked to resume from an Event number the log no longer keeps (D11).
    pub const EVENTS_EXPIRED: i64 = -32009;
    /// A pending `inbox` note was asked for by hand while the Agent's Claude inbox is still unusable (B51).
    pub const INBOX_UNAVAILABLE: i64 = -32010;
    /// The roundup App is not open, so no named action can be listed or run (NA6).
    pub const APP_CLOSED: i64 = -32011;
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[error("{message} (code {code})")]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "parse_data"
    )]
    pub data: Option<contracts::RpcErrorData>,
}

// Optional error data from a newer or malformed peer cannot erase its code and diagnostics.
fn parse_data<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<contracts::RpcErrorData>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).ok())
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub fn method_not_found(method: &str) -> Self {
        Self::new(
            code::METHOD_NOT_FOUND,
            format!("method not found: {method}"),
        )
    }

    pub fn not_found(what: impl std::fmt::Display) -> Self {
        Self::new(code::NOT_FOUND, format!("not found: {what}"))
    }

    /// NOT_FOUND for an object another Project owns, marked so a caller asking every Project can skip it.
    pub fn other_project(message: impl Into<String>) -> Self {
        Self {
            data: Some(contracts::RpcErrorData::OtherProject),
            ..Self::new(code::NOT_FOUND, message)
        }
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(code::FORBIDDEN, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(code::CONFLICT, message)
    }

    pub fn undo_parent(id: impl Into<String>, name: impl Into<String>) -> Self {
        let name = name.into();
        Self {
            data: Some(contracts::RpcErrorData::UndoParent {
                id: id.into(),
                name: name.clone(),
            }),
            ..Self::conflict(format!(
                "Can't undo: \"{name}\" was removed too. Undo that first."
            ))
        }
    }

    /// `removable`: the Daemon authorizes the caller's removal action for the blocking item.
    pub fn undo_identity(id: impl Into<String>, name: impl Into<String>, removable: bool) -> Self {
        let name = name.into();
        let next = if removable {
            "Remove that item before trying Undo again."
        } else {
            "This Undo cannot currently be completed; the deletion is retained."
        };
        Self {
            data: Some(contracts::RpcErrorData::UndoIdentity {
                id: id.into(),
                name: name.clone(),
            }),
            ..Self::conflict(format!(
                "Can't undo: \"{name}\" already occupies the removed item's identity. {next}"
            ))
        }
    }

    pub fn undo_pad_name(name: impl Into<String>) -> Self {
        let name = name.into();
        Self {
            data: Some(contracts::RpcErrorData::UndoPadName { name: name.clone() }),
            ..Self::conflict(format!(
                "Can't undo: a Pad named \"{name}\" already exists. Rename that Pad, then try Undo again."
            ))
        }
    }

    pub fn busy(message: impl Into<String>) -> Self {
        Self::new(code::BUSY, message)
    }

    pub fn not_accepted(message: impl Into<String>) -> Self {
        Self::new(code::NOT_ACCEPTED, message)
    }

    /// For failures that are the Daemon's fault, never the caller's.
    pub fn internal(err: impl std::fmt::Display) -> Self {
        Self::new(code::INTERNAL, err.to_string())
    }

    /// The connection dropped before the reply: the call may have run.
    pub fn unknown_outcome(message: impl Into<String>) -> Self {
        Self::new(code::UNKNOWN_OUTCOME, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u3787j_occupied_identity_refusal_matches_removal_authority() {
        for (removable, expected) in [
            (
                true,
                "Can't undo: \"Research\" already occupies the removed item's identity. Remove that item before trying Undo again.",
            ),
            (
                false,
                "Can't undo: \"Research\" already occupies the removed item's identity. This Undo cannot currently be completed; the deletion is retained.",
            ),
        ] {
            assert_eq!(
                RpcError::undo_identity("8", "Research", removable).message,
                expected
            );
        }
    }

    #[test]
    fn u3787a_undo_refusal_names_cause_and_recovery() {
        for (error, expected) in [
            (
                RpcError::undo_parent("7", "Planning"),
                "Can't undo: \"Planning\" was removed too. Undo that first.",
            ),
            (
                RpcError::undo_identity("8", "Research", true),
                "Can't undo: \"Research\" already occupies the removed item's identity. Remove that item before trying Undo again.",
            ),
            (
                RpcError::undo_pad_name("Notes"),
                "Can't undo: a Pad named \"Notes\" already exists. Rename that Pad, then try Undo again.",
            ),
        ] {
            assert_eq!(error.message, expected);
        }
    }

    #[test]
    fn h11_the_steer_and_interrupt_codes_round_trip_through_rpc_error() {
        let codes = [
            (code::BUSY, -32005),
            (code::NOT_ACCEPTED, -32006),
            (code::NOT_RUNNING, -32007),
            (code::NOT_ACKED, -32008),
        ];
        for (code, wire) in codes {
            assert_eq!(code, wire);
            let error = RpcError::new(code, "agent 7");
            let json = serde_json::to_string(&error).unwrap();
            assert_eq!(serde_json::from_str::<RpcError>(&json).unwrap(), error);
        }
        assert_eq!(RpcError::busy("x").code, code::BUSY);
        assert_eq!(RpcError::not_accepted("x").code, code::NOT_ACCEPTED);
    }
}
