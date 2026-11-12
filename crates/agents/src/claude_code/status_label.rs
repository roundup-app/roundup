//! What a hook payload means to the owner: its Kind and the cause-and-next-step labels (U5151b, U5151d).

use contracts::Kind;
use serde_json::Value;

/// What one hook payload says about the Agent. `None` for events that say nothing: the late
/// permission Notification, the spurious `SubagentStop` and display noise; an unknown event also
/// goes to stderr.
pub(super) fn hook_status(payload: &Value) -> Option<(Kind, String)> {
    let text = |field: &str| payload[field].as_str().map(str::to_owned);
    // Only the event name is logged: the rest of a payload carries prompts and tool input.
    let Some(event) = payload["hook_event_name"].as_str() else {
        eprintln!("agents: ignoring a hook payload with no event name");
        return None;
    };
    match event {
        "SessionStart" | "Stop" => Some((Kind::Idle, "idle".into())),
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" => {
            Some((Kind::Working, "working".into()))
        }
        "PermissionRequest" => Some((Kind::NeedsYou, permission_label(payload))),
        "StopFailure" => Some((Kind::Error, failure_label(payload["error"].as_str()))),
        "SessionEnd" => Some((Kind::Done, session_end_label(text("reason").as_deref()))),
        "Notification" | "SubagentStart" | "SubagentStop" | "MessageDisplay" | "PostToolBatch" => {
            None
        }
        other => {
            eprintln!("agents: ignoring an unrecognised hook event {other}");
            None
        }
    }
}

/// U5151d: what a `SessionEnd` reason means to the owner. An unrecognised reason is kept
/// verbatim; a missing or empty one reads as plain `done`.
fn session_end_label(reason: Option<&str>) -> String {
    match reason.map(str::trim).unwrap_or_default() {
        "" | "other" => "done".into(),
        "clear" => "Session cleared; send a message to start again".into(),
        "resume" => "Session replaced by a resumed one".into(),
        "logout" => "Claude signed out; sign in from its Terminal, then send a message".into(),
        "prompt_input_exit" => {
            "Claude was exited from its prompt; send a message to restart it".into()
        }
        "bypass_permissions_disabled" => {
            "Claude ended because bypassing permissions is disabled; check its settings, then retry"
                .into()
        }
        other => format!("Session ended: {other}"),
    }
}

/// U5151b: the cause and next step for a `StopFailure` code. An unrecognised code is kept
/// verbatim; a missing or empty one says Claude gave no reason. The next turn's status replaces
/// the failure mark (U5151c).
fn failure_label(code: Option<&str>) -> String {
    let (cause, next) = match code.map(str::trim).unwrap_or_default() {
        "rate_limit" => (
            "Claude's request limit was reached",
            "wait, then send a message to retry",
        ),
        "overloaded" => ("Claude is overloaded", "wait, then send a message to retry"),
        "authentication_failed" => (
            "Claude could not sign in",
            "open its Terminal, sign in, then retry",
        ),
        "oauth_org_not_allowed" => (
            "This login cannot use the organization",
            "check Claude's organization and login, then retry",
        ),
        "account_on_hold" => (
            "The account is on hold",
            "resolve its account restriction, then retry",
        ),
        "billing_error" => (
            "Claude refused the account's billing",
            "resolve billing in the provider account, then retry",
        ),
        "invalid_request" => (
            "Claude rejected the request",
            "check the Terminal details and revise the request before retrying",
        ),
        "model_not_found" => (
            "The chosen Model is unavailable",
            "choose an available Model, then retry",
        ),
        "server_error" => (
            "Claude's servers failed",
            "send the Agent a message to retry",
        ),
        "max_output_tokens" => (
            "Claude reached its response limit",
            "send a message asking it to continue in smaller steps",
        ),
        "cloud_credential_error" => (
            "Cloud credentials could not load",
            "repair the configured credentials, then retry",
        ),
        "unknown" => (
            "Claude failed without a classified cause",
            "inspect its Terminal, then retry",
        ),
        "" => (
            "Claude ended the turn without a reason",
            "inspect its Terminal, then retry",
        ),
        other => {
            return format!("Claude failed with {other}; inspect its Terminal, then retry.");
        }
    };
    format!("{cause}; {next}.")
}

/// U6248b: the cause of a `StopFailure` label that waiting can heal (`overloaded`, `rate_limit`,
/// `server_error`); `None` for every other label.
pub fn transient_cause(label: &str) -> Option<&'static str> {
    [
        "Claude's request limit was reached",
        "Claude is overloaded",
        "Claude's servers failed",
    ]
    .into_iter()
    .find(|cause| label.starts_with(cause))
}

/// The question being asked; else the tool name, with its command when it has one.
fn permission_label(payload: &Value) -> String {
    let text = |pointer: &str| payload.pointer(pointer).and_then(Value::as_str);
    let tool = text("/tool_name").unwrap_or("tool");
    let question = text("/tool_input/questions/0/question");
    match (question, text("/tool_input/command")) {
        (Some(question), _) => question.to_owned(),
        (None, Some(command)) => format!("{tool}: {command}"),
        (None, None) => tool.to_owned(),
    }
}
