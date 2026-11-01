//! The Claude Code adapter. Hook payloads, the terminal title and the exit status become a Status
//! (ADR 0006); `session`, `hook` and `transcript` are Claude Code's own words, so they must not
//! leak out of this module into public names.

mod brief;
mod conversation;
mod discovery;
pub mod extras;
pub mod inbox;
mod launch;
mod launch_files;
mod models;
mod overview_cache;
mod placement;
mod profiles;
mod rewind;
pub mod toolcall;
pub use placement::Call as PlacementCall;
pub mod plugins;
pub mod skill_setup;
mod skills;
mod vendor_list;

use contracts::{Kind, Status};
use serde_json::Value;

use crate::{AgentAdapter, Observation};

pub use brief::{Role, WORKSTREAM_GUIDANCE};
pub(crate) use discovery::ImportCandidate;
pub use launch::{Folders, INTENT_MISSING, Launcher, STATE_EVENTS, settings_marker};
pub use models::{Lean, Pair, efforts, engines, models};
pub use profiles::{
    DOOR_TOOLS, DOOR_TOOLS_NO_MCP, PROFILES, Profile, SCOUT_TOOLS, SCOUT_TOOLS_NO_MCP, profile,
};
pub use skills::{BANNED, skills};
pub use vendor_list::{Listed, Listing, Live};

/// F4, F5: the program names this Adapter's vendor CLI is started by. The shim and the process
/// scan read the names of every Adapter through a function like this one, and write none.
pub fn programs() -> &'static [&'static str] {
    &["claude"]
}

/// Env vars Claude Code sets when the program running it is itself inside a Claude Code run
/// (A15). The Daemon can inherit these from its own environment; every program it starts must
/// not, or it would believe itself nested in that run too. Handed to [`terminal::Terminals`]
/// at `open_with` time, so no other module needs to name them.
pub const MARKERS: [&str; 8] = [
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
];

/// How long a star right after `PreToolUse` waits for its `PermissionRequest`, in milliseconds,
/// measured from the star. Across 9 dialogs the star precedes its `PermissionRequest` by 18-79 ms;
/// 200 ms is about 2.5 times that. Shorter flickers `idle` before a dialog; longer delays the
/// `idle` of an Esc during an auto-allowed tool.
pub const STAR_HOLD: i64 = 200;

/// How long a lone ◐/◑ title keeps an Agent `working` when no Signal backs it, in milliseconds,
/// measured from the latest spinner title. A working Claude Code alternates ◐/◑ about every
/// 0.96 s (largest gap 0.99 s across `spikes/hooks-state/screen*.jsonl`, outside a dialog); 3000 ms
/// is about 3 times that. Claude Code can draw one spinner after `Stop` with no star after it.
pub const SPINNER_HOLD: i64 = 3000;

/// What Claude Code takes as its own exit: three Ctrl+C presses. A fullscreen session that ends
/// any other way within 10 s of its first frame counts as a failed start, and two failed starts
/// turn fullscreen off for every Claude Code on the machine
/// (code.claude.com/docs/en/fullscreen#fullscreen-renderer-didnt-finish-starting). The first press
/// clears a draft or interrupts a turn, the second arms the exit and the third exits, so three
/// end it from every state (observed on 2.1.302: idle, with a draft, mid-turn). One write of
/// `^C^C` does not end a turn, and `^D^D` does not end a draft. A press lands only once the
/// previous one has been handled, so each waits `EXIT_PRESS_GAP`.
pub const EXIT_KEY: &[u8] = b"\x03";
pub const EXIT_PRESSES: usize = 3;
pub const EXIT_PRESS_GAP: std::time::Duration = std::time::Duration::from_millis(100);

/// How the program's life ended, if it has.
#[derive(Clone, Copy, PartialEq)]
enum Ending {
    Running,
    Exited,
    /// Roundup killed it on purpose, so the exit that follows is not an error.
    Stopped,
    /// A21: roundup could not save the Agent's conversation. Final like `Stopped`: the Exit that
    /// follows (roundup kills the Terminal once this is set) must not overwrite the error.
    Failed,
}

pub struct ClaudeCode {
    /// A5482c: completed turn identity, start time and final assistant text.
    completed: Option<(String, i64, String)>,
    turn_started: i64,
    status: Option<Status>,
    ending: Ending,
    /// The latest recognised Signal was `PreToolUse`: a dialog may be about to open.
    after_pre_tool_use: bool,
    /// When a star after `PreToolUse` was first seen and not yet resolved.
    star_parked_since: Option<i64>,
    /// The latest ◐/◑ title of a title-working Agent: a spinner gave `working` and no Signal
    /// has come since.
    spinner_at: Option<i64>,
    clock: Box<dyn Fn() -> i64 + Send>,
    /// U3566c: the Agent's published finishes, carried across Attempts by its caller.
    finished: u64,
    /// PS9.1: false only for an Agent whose Kind comes from its Terminal's program status.
    hooked: bool,
}

impl ClaudeCode {
    /// `clock` returns milliseconds since the Unix epoch; it stamps every Status `since`.
    pub fn new(clock: impl Fn() -> i64 + Send + 'static) -> Self {
        Self {
            completed: None,
            turn_started: (clock)(),
            status: None,
            ending: Ending::Running,
            after_pre_tool_use: false,
            star_parked_since: None,
            spinner_at: None,
            clock: Box::new(clock),
            finished: 0,
            hooked: true,
        }
    }

    /// PS9.2: an Agent whose tooling pushes no Signal; its Terminal's program status gives its Kind.
    pub fn without_hooks(mut self) -> Self {
        self.hooked = false;
        self
    }

    /// Continue the Agent's finish count from an earlier Attempt.
    pub(crate) fn set_finished(&mut self, finished: u64) {
        self.finished = finished;
        if let Some(status) = &mut self.status {
            status.finished = finished.to_string();
        }
    }

    pub(crate) fn finished(&self) -> u64 {
        self.finished
    }

    /// An adapter for a program that has just started: working until it says otherwise.
    pub fn starting(clock: impl Fn() -> i64 + Send + 'static) -> Self {
        let mut adapter = Self::new(clock);
        adapter.settle(Kind::Working, "starting".into());
        adapter
    }

    pub(super) fn is_ended(&self) -> bool {
        self.ending != Ending::Running
    }

    pub fn status(&self) -> Option<&Status> {
        self.status.as_ref()
    }

    /// Adopt `kind` and `label`. `since` moves only when the Kind does.
    fn settle(&mut self, kind: Kind, label: String) -> Option<Status> {
        let finishes = self
            .status
            .as_ref()
            .is_some_and(|s| s.kind == Kind::Working)
            && matches!(kind, Kind::Idle | Kind::Done);
        self.settle_counting(kind, label, finishes)
    }

    /// `settle`, with the finish count raised first when `finish` holds.
    fn settle_counting(&mut self, kind: Kind, label: String, finish: bool) -> Option<Status> {
        if kind == Kind::Working && self.status.as_ref().is_some_and(|s| s.kind == Kind::Idle) {
            self.turn_started = (self.clock)();
        }
        let since = match &self.status {
            Some(current) if current.kind == kind => current.since,
            _ => (self.clock)(),
        };
        let finished = self.finished + u64::from(finish);
        let next = Status {
            kind,
            label,
            since,
            finished: finished.to_string(),
        };
        if self.status.as_ref() == Some(&next) {
            return None;
        }
        self.finished = finished;
        self.status = Some(next.clone());
        Some(next)
    }

    /// When the adapter wants an `Observation::Tick`: `STAR_HOLD` after the star it is holding,
    /// or `SPINNER_HOLD` after the latest spinner title of a title-working Agent.
    pub fn tick_at(&self) -> Option<i64> {
        let star = self.star_parked_since.map(|since| since + STAR_HOLD);
        let spinner = self.spinner_at.map(|at| at + SPINNER_HOLD);
        star.into_iter().chain(spinner).min()
    }

    /// Claude Code spins ◐/◑ while it works and shows ✳ whenever it is not, a permission dialog
    /// included. A spinner means working, but never ends `needs-you` (a denied dialog resumes the
    /// spinner with no hook). A star means idle only for a working Agent, so it never ends
    /// `needs-you`, `error` or `done`. The one star not read at once follows `PreToolUse`: it may
    /// be the dialog's, which precedes its `PermissionRequest`, so it is parked for `STAR_HOLD`;
    /// reading it as idle would flicker `idle` before `needs-you`. A spinner after that star shows
    /// the tool still running and drops the hold. A spinner that turns an Agent `working` is its
    /// only evidence, so it holds for `SPINNER_HOLD` (A2b); a star or a Signal drops that hold.
    fn retitle(&mut self, title: &str) -> Option<Status> {
        let kind = self.status.as_ref().map(|status| status.kind);
        let first = title.chars().next()?;
        if first == '✳' {
            self.spinner_at = None;
        }
        match first {
            '◐' | '◑' => {
                self.star_parked_since = None;
                if kind == Some(Kind::NeedsYou) {
                    return None;
                }
                if kind != Some(Kind::Working) || self.spinner_at.is_some() {
                    self.spinner_at = Some((self.clock)());
                }
                self.settle(Kind::Working, "working".into())
            }
            '✳' if kind == Some(Kind::Working) && self.after_pre_tool_use => {
                let now = (self.clock)();
                self.star_parked_since.get_or_insert(now);
                None
            }
            '✳' if kind == Some(Kind::Working) => self.settle(Kind::Idle, "idle".into()),
            _ => None,
        }
    }

    /// A parked star that no `PermissionRequest` followed was a plain idle, and so is a spinner
    /// title that nothing followed for `SPINNER_HOLD`.
    fn tick(&mut self) -> Option<Status> {
        if self
            .spinner_at
            .is_some_and(|at| (self.clock)() - at >= SPINNER_HOLD)
        {
            self.spinner_at = None;
            return self.settle(Kind::Idle, "idle".into());
        }
        self.star_parked_since
            .filter(|since| (self.clock)() - since >= STAR_HOLD)?;
        self.star_parked_since = None;
        self.settle(Kind::Idle, "idle".into())
    }

    fn signal(&mut self, payload: &Value) -> Option<Status> {
        let event = payload["hook_event_name"].as_str().unwrap_or_default();
        if event == "UserPromptSubmit" {
            self.turn_started = (self.clock)();
        }
        let (kind, label) = hook_status(payload)?;
        self.after_pre_tool_use = event == "PreToolUse";
        self.star_parked_since = None;
        self.spinner_at = None;
        let changed = self.settle(kind, label);
        if event == "Stop"
            && let Some(text) = payload["last_assistant_message"].as_str()
            && !text.is_empty()
        {
            let next = (
                self.finished.to_string(),
                self.turn_started,
                text.to_owned(),
            );
            if self.completed.as_ref() != Some(&next) {
                self.completed = Some(next);
                return changed.or_else(|| self.status.clone());
            }
        }
        changed
    }

    pub(crate) fn completed_text(&self) -> Option<&(String, i64, String)> {
        self.completed.as_ref()
    }

    fn exit(&mut self, code: Option<i32>) -> Option<Status> {
        self.star_parked_since = None;
        self.spinner_at = None;
        if matches!(self.ending, Ending::Stopped | Ending::Failed) {
            return None;
        }
        self.ending = Ending::Exited;
        match code {
            Some(0) if self.status.as_ref().is_some_and(|s| s.kind == Kind::Done) => None,
            Some(0) => self.settle(Kind::Done, "exited 0".into()),
            Some(code) => self.settle(Kind::Error, format!("exited {code}")),
            None => self.settle(Kind::Error, "exited by signal".into()),
        }
    }

    /// H12: the first prompt was not accepted. Not final: a Signal that arrives later (the user
    /// submitting the text left in the input line) moves the Status on as usual.
    pub fn refuse_prompt(&mut self) -> Option<Status> {
        if self.ending != Ending::Running {
            return None;
        }
        self.star_parked_since = None;
        self.spinner_at = None;
        self.settle(Kind::Error, "prompt not accepted".into())
    }

    /// A21: roundup itself could not save the Agent's conversation. Final: no later Observation
    /// changes the Status again, the Exit that follows the Terminal being stopped included.
    pub fn fail(&mut self, label: String) -> Option<Status> {
        if self.ending != Ending::Running {
            return None;
        }
        self.ending = Ending::Failed;
        self.star_parked_since = None;
        self.spinner_at = None;
        self.settle(Kind::Error, label)
    }
}

impl AgentAdapter for ClaudeCode {
    fn observe(&mut self, observation: Observation) -> Option<Status> {
        match observation {
            Observation::Exit { code } => self.exit(code),
            Observation::Stopped if self.ending != Ending::Running => None,
            Observation::Stopped => {
                self.ending = Ending::Stopped;
                self.star_parked_since = None;
                self.spinner_at = None;
                self.settle_counting(Kind::Done, "stopped".into(), false)
            }
            Observation::Program(_) if self.hooked => None,
            Observation::Signal(_)
            | Observation::Title(_)
            | Observation::Tick
            | Observation::Program(_)
                if self.ending != Ending::Running =>
            {
                None
            }
            Observation::Tick => self.tick(),
            Observation::Signal(payload) => self.signal(&payload),
            Observation::Title(title) => self.retitle(&title),
            Observation::Program(status) => self.settle(status.kind, status.label),
        }
    }

    fn has_hook_signal(&self) -> bool {
        self.hooked
    }
}

/// E3: mutable Context travels after the work text so A27's name still comes from the work.
pub(crate) const CONTEXT_START: &str = "\n\n<roundup-context>\n";

/// The hook event a payload names, or `Signal` when it names none.
pub fn event_name(payload: &Value) -> &str {
    payload["hook_event_name"].as_str().unwrap_or("Signal")
}

/// The prompt a `UserPromptSubmit` payload carries (empty when it carries none); `None` for any
/// other payload.
pub fn submitted_prompt(payload: &Value) -> Option<&str> {
    (payload["hook_event_name"] == "UserPromptSubmit")
        .then(|| payload["prompt"].as_str().unwrap_or_default())
}

/// Whether `payload` is the `SessionStart` Signal, which readies a fresh Agent for its first
/// prompt (H12).
pub fn is_session_start(payload: &Value) -> bool {
    payload["hook_event_name"] == "SessionStart"
}

/// E3: what the `SessionStart` hook prints so Claude Code adds `text` to the model's context: the
/// vendor's own JSON, `hookSpecificOutput.additionalContext`.
pub fn session_start_context(text: &str) -> String {
    serde_json::json!({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": text,
        }
    })
    .to_string()
}

/// A3516b: read the immutable Brief named by the normal Agent's start hook and add it to
/// E3's reply. The path belongs to the hook command, so vendor relaunches keep the delivery.
pub fn read_start_context(stdout: &str) -> Result<String, String> {
    let Some(path) = std::env::var_os("ROUNDUP_BRIEF_FILE") else {
        return Ok(stdout.to_owned());
    };
    let brief = std::fs::read_to_string(&path).map_err(|err| {
        format!(
            "cannot read Brief {}: {err}",
            std::path::Path::new(&path).display()
        )
    })?;
    let reply: Value =
        serde_json::from_str(stdout).map_err(|err| format!("cannot read start Context: {err}"))?;
    let context = reply["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .ok_or("start Context has no additionalContext")?;
    // P10: only fixed guidance may precede the shared Brief; identity follows its cache prefix.
    let (guidance, context) = match context.strip_suffix(WORKSTREAM_GUIDANCE) {
        Some(context) => (WORKSTREAM_GUIDANCE, context),
        None => ("", context),
    };
    Ok(session_start_context(&format!(
        "{guidance}{brief}\n{context}"
    )))
}

/// H20: typed outside the paste markers, so the model's first user message holds typed text that
/// asks it to act on the pasted block instead of treating the block as bare quoted paste.
pub const LEAD_IN: &str = "Follow this instruction: ";

/// The bytes of a Steer (H11, H20): `LEAD_IN`, then `text` as one bracketed paste, then `\r`, written
/// as `write_submitted` does. A paste followed by a pause submitted 8 of 8 times in the spike and a bare
/// `text\r` failed once, so the paste markers stay. `text` loses its `ESC` bytes, so it cannot
/// close the paste early and type what follows as keys.
pub fn steer_bytes(text: &str) -> Vec<u8> {
    let mut bytes = LEAD_IN.as_bytes().to_vec();
    bytes.extend(verbatim_bytes(&text.replace('\x1b', "")));
    bytes
}

/// A41: retain the first slash of the user's Ask while keeping H11's paste fence.
pub(super) fn verbatim_bytes(text: &str) -> Vec<u8> {
    let mut bytes = b"\x1b[200~".to_vec();
    bytes.extend_from_slice(text.as_bytes());
    bytes.extend_from_slice(b"\x1b[201~\r");
    bytes
}

/// How long the `\r` of a Steer waits behind its paste: Claude Code takes an `\r` that arrives
/// with the end of a paste as part of the paste and leaves the text unsubmitted.
const SUBMIT_PAUSE: std::time::Duration = std::time::Duration::from_millis(100);

/// Write `bytes` from `steer_bytes` or `verbatim_bytes`: everything up to the final `\r`, a
/// flush, `SUBMIT_PAUSE`, then the `\r` on its own. The Terminal's input thread runs this whole,
/// so no other write comes between the two.
pub(super) fn write_submitted(
    writer: &mut dyn std::io::Write,
    bytes: &[u8],
    accepted: Option<&std::sync::Mutex<bool>>,
) -> std::io::Result<()> {
    let paste = bytes
        .strip_suffix(b"\r")
        .expect("a Steer's bytes end with the submitting carriage return");
    writer.write_all(paste)?;
    writer.flush()?;
    std::thread::sleep(SUBMIT_PAUSE);
    // A hook can arrive before the input thread reports completion to its caller.
    // Only the final write holds this gate, so paste settling never blocks Signals.
    let mut accepted = accepted.map(|gate| gate.lock().expect("slash-command write gate"));
    writer.write_all(b"\r")?;
    writer.flush()?;
    if let Some(accepted) = &mut accepted {
        **accepted = true;
    }
    Ok(())
}

/// The bytes of an Interrupt (H13): one `ESC`, which ends Claude Code's turn.
pub fn interrupt_bytes() -> Vec<u8> {
    vec![0x1b]
}

/// A21: the conversation a `SessionStart` payload names, accepted only as a UUID; `None` for any
/// other payload, or one whose `session_id` is not a UUID.
pub fn conversation_id(payload: &Value) -> Option<String> {
    (payload["hook_event_name"] == "SessionStart")
        .then(|| payload["session_id"].as_str())
        .flatten()
        .filter(|id| is_uuid(id))
        .map(str::to_owned)
}

/// A22: whether a `SessionStart` payload says it began with `--resume`; `None` for any other
/// payload.
pub fn session_source(payload: &Value) -> Option<&str> {
    (payload["hook_event_name"] == "SessionStart")
        .then(|| payload["source"].as_str())
        .flatten()
}

/// `8-4-4-4-12` lowercase or uppercase hex, dashes at those exact positions; no other form (no
/// braces, no `urn:uuid:`) is accepted as a conversation id.
fn is_uuid(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|&i| bytes[i] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| matches!(i, 8 | 13 | 18 | 23) || b.is_ascii_hexdigit())
}

/// What one hook payload says about the Agent. `None` for events that say nothing: the late
/// permission Notification, the spurious `SubagentStop` and display noise; an unknown event also
/// goes to stderr.
fn hook_status(payload: &Value) -> Option<(Kind, String)> {
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
        "Notification" | "SubagentStop" | "MessageDisplay" | "PostToolBatch" => None,
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
            return format!(
                "Claude failed with {other}; inspect its Terminal, then retry. The next turn replaces this mark."
            );
        }
    };
    format!("{cause}; {next}. The next turn replaces this mark.")
}

/// The question being asked; else the tool name, with its command when it has one.
fn permission_label(payload: &Value) -> String {
    let tool = payload["tool_name"].as_str().unwrap_or("tool");
    let input = &payload["tool_input"];
    if let Some(question) = input["questions"][0]["question"].as_str() {
        return question.to_owned();
    }
    match input["command"].as_str() {
        Some(command) => format!("{tool}: {command}"),
        None => tool.to_owned(),
    }
}

/// LC13: the last recorded usage is the live context, including both cache token counts.
/// An absent path or usage gives no measurement; an unreadable named file is an error.
pub fn context_tokens(payload: &Value) -> Result<Option<u64>, rpc::RpcError> {
    use std::io::BufRead;
    let Some(path) = inbox::transcript_of(payload) else {
        return Ok(None);
    };
    let file = std::fs::File::open(path).map_err(rpc::RpcError::internal)?;
    let mut last = None;
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(rpc::RpcError::internal)?;
        // A trailing record may still be being written when the hook runs.
        let Ok(record) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let usage = record
            .get("usage")
            .or_else(|| record.get("message").and_then(|m| m.get("usage")));
        if let Some(usage) = usage.filter(|u| u.is_object()) {
            last = Some(
                [
                    "input_tokens",
                    "cache_read_input_tokens",
                    "cache_creation_input_tokens",
                ]
                .into_iter()
                .fold(0u64, |sum, key| {
                    sum.saturating_add(usage[key].as_u64().unwrap_or(0))
                }),
            );
        }
    }
    Ok(last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    };

    struct Clocked {
        now: Arc<AtomicI64>,
        adapter: ClaudeCode,
    }

    impl Clocked {
        fn new() -> Self {
            let now = Arc::new(AtomicI64::new(0));
            let clock = now.clone();
            let adapter = ClaudeCode::new(move || clock.load(Ordering::SeqCst));
            Self { now, adapter }
        }

        fn at(&mut self, ms: i64, observation: Observation) -> Option<Kind> {
            self.now.store(ms, Ordering::SeqCst);
            self.adapter.observe(observation);
            self.adapter.status().map(|s| s.kind)
        }

        fn signal(&mut self, ms: i64, event: &str) -> Option<Kind> {
            self.at(ms, Observation::Signal(json!({ "hook_event_name": event })))
        }

        fn title(&mut self, ms: i64, title: &str) -> Option<Kind> {
            self.at(ms, Observation::Title(title.into()))
        }
    }

    #[test]
    fn a2b_a_lone_spinner_after_stop_reads_idle() {
        let mut a = Clocked::new();
        a.signal(0, "UserPromptSubmit");
        assert_eq!(a.signal(100, "Stop"), Some(Kind::Idle));
        assert_eq!(a.title(1500, "◐ task"), Some(Kind::Working));
        assert_eq!(a.adapter.tick_at(), Some(1500 + SPINNER_HOLD));
        assert_eq!(
            a.at(1500 + SPINNER_HOLD - 1, Observation::Tick),
            Some(Kind::Working)
        );
        assert_eq!(
            a.at(1500 + SPINNER_HOLD, Observation::Tick),
            Some(Kind::Idle)
        );
        assert_eq!(a.adapter.tick_at(), None);
    }

    #[test]
    fn a2b_alternating_spinners_keep_working() {
        let mut a = Clocked::new();
        a.signal(0, "UserPromptSubmit");
        a.signal(100, "Stop");
        let mut at = 1000;
        for glyph in ["◐", "◑", "◐", "◑", "◐"] {
            assert_eq!(a.title(at, glyph), Some(Kind::Working));
            assert_eq!(a.at(at + 960, Observation::Tick), Some(Kind::Working));
            at += 960;
        }
        assert_eq!(a.at(at + SPINNER_HOLD, Observation::Tick), Some(Kind::Idle));
    }

    #[test]
    fn a2b_a_signal_drops_the_spinner_hold() {
        let mut a = Clocked::new();
        a.signal(0, "Stop");
        a.title(1000, "◐");
        assert!(a.adapter.tick_at().is_some());
        assert_eq!(a.signal(1100, "PostToolUse"), Some(Kind::Working));
        assert_eq!(a.adapter.tick_at(), None);
        assert_eq!(a.at(60_000, Observation::Tick), Some(Kind::Working));

        a.signal(61_000, "Stop");
        a.title(62_000, "◑");
        a.title(62_500, "✳");
        assert_eq!(a.adapter.tick_at(), None);
    }
}
