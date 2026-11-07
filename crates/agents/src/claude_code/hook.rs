//! A hook payload, parsed once where it enters. `Hook` is private to this module; the supervisor
//! reads the vendor-neutral `Seen` that `see` returns, so no code outside `claude_code` probes a
//! payload for a vendor field.

use std::path::PathBuf;

use serde_json::Value;

use crate::{Seen, Source};

/// The payload shapes the supervisor reads. A field of the wrong type reads as absent.
enum Hook<'a> {
    SessionStart {
        session_id: Option<&'a str>,
        source: Option<&'a str>,
    },
    UserPromptSubmit {
        prompt: Option<&'a str>,
    },
    /// Any other event, or a payload naming none.
    Other,
}

impl<'a> Hook<'a> {
    fn parse(payload: &'a Value) -> Self {
        let text = |field: &str| payload.get(field).and_then(Value::as_str);
        match text("hook_event_name") {
            Some("SessionStart") => Self::SessionStart {
                session_id: text("session_id"),
                source: text("source"),
            },
            Some("UserPromptSubmit") => Self::UserPromptSubmit {
                prompt: text("prompt"),
            },
            _ => Self::Other,
        }
    }
}

/// What the supervisor needs from one hook payload. `session_id` is kept only as a UUID.
pub(crate) fn see(payload: &Value) -> Seen<'_> {
    let mut seen = Seen {
        name: payload
            .get("hook_event_name")
            .and_then(Value::as_str)
            .unwrap_or("Signal"),
        prompt: None,
        session_start: false,
        conversation: None,
        source: None,
        transcript: payload
            .get("transcript_path")
            .and_then(Value::as_str)
            .map(PathBuf::from),
    };
    match Hook::parse(payload) {
        Hook::SessionStart { session_id, source } => {
            seen.session_start = true;
            seen.conversation = session_id.filter(|id| super::is_uuid(id));
            seen.source = source.map(|source| match source {
                "resume" => Source::Resume,
                "fork" => Source::Fork,
                _ => Source::Other,
            });
        }
        Hook::UserPromptSubmit { prompt } => seen.prompt = Some(prompt.unwrap_or_default()),
        Hook::Other => {}
    }
    seen
}
