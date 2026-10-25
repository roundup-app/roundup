//! Terminals: plain shell processes with a PTY. Bytes travel base64-encoded.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SpawnParams {
    pub cwd: String,
    /// Argv. `None` runs the user's login shell.
    pub command: Option<Vec<String>>,
    pub env: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct TerminalId {
    pub id: String,
}

/// What `agent.run` and `terminal.open` return: the Terminal they started.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Opened {
    pub terminal_id: String,
}

/// X12: start the user's login shell, owned by `workstream` or the Project when absent.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct OpenParams {
    pub workstream: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct WriteParams {
    pub id: String,
    /// Base64 of the bytes to type.
    pub data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ResizeParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

/// The App's light or dark colour scheme.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Scheme {
    Light,
    Dark,
}

/// The scheme every Terminal's program is told it runs in (X17), with the two colours the Daemon
/// reports for an OSC 10 or 11 query as `#rrggbb`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct SchemeParams {
    pub scheme: Scheme,
    pub background: String,
    pub foreground: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct TerminalInfo {
    pub id: String,
    /// Opaque, non-secret identity of this original Terminal; stable until removal, never reused
    /// by another Terminal or Project, including after a Daemon restart. Confers no authority.
    pub incarnation: String,
    pub cwd: String,
    /// Latest OSC 0/2 window title, if any.
    pub title: Option<String>,
    /// The basename of `command[0]`, else of `$SHELL`; a bubble's name until the program sets a title (U164).
    pub program: String,
    pub running: bool,
    /// `None` while running or when killed by a signal; `-1` when the Daemon could not read the exit status.
    pub exit_code: Option<i32>,
    /// The Workstream, Agent or absolute Project folder path whose bubble shows it (X11, X12); `None` for a raw spawn (X1).
    pub owner: Option<String>,
}

/// X14: what `terminal.output` returns: the offset of the first byte the stream delivers.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct OutputStarted {
    #[specta(type = specta_typescript::Number)]
    pub offset: u64,
}

/// X14: the `terminal.output` notification of a connection that selected the Terminal `id`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct OutputEvent {
    pub id: String,
    /// Base64 of the bytes the program wrote.
    pub data: String,
    #[specta(type = specta_typescript::Number)]
    pub offset: u64,
}

/// X14: the `terminal.gap` notification: the subscriber fell behind, bytes `from..to` were not
/// delivered and `terminal.output` bytes resume at `to`. Recover with `terminal.snapshot`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct OutputGap {
    pub id: String,
    #[specta(type = specta_typescript::Number)]
    pub from: u64,
    #[specta(type = specta_typescript::Number)]
    pub to: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Snapshot {
    pub cols: u16,
    pub rows: u16,
    #[specta(type = specta_typescript::Number)]
    pub after: u64,
    pub data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct TitleEvent {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ExitedEvent {
    pub id: String,
    /// `None` when the program was killed by a signal; `-1` when the Daemon could not read the exit status.
    pub code: Option<i32>,
}

/// X13, X16: `terminal.read`. New output as plain text: from `after`, or from `reader`'s cursor.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ReadParams {
    pub id: String,
    /// Read from this offset (a `next`, or the `offset` of a screen); the cursor stays as it was.
    /// Absent: read from `reader`'s cursor and move it to `next`.
    #[specta(type = Option<specta_typescript::Number>)]
    pub after: Option<u64>,
    /// The Agent id whose cursor a read without `after` uses; `rup` fills it. With neither
    /// `after` nor `reader` the call is `INVALID_PARAMS`.
    pub reader: Option<String>,
    /// Lowers the 16 384-byte cap of the reply, which also holds at most 200 lines.
    pub max: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Read {
    /// Where the text begins: `after`, or the log's start when `after` is older.
    #[specta(type = specta_typescript::Number)]
    pub from: u64,
    /// Where to read from next.
    #[specta(type = specta_typescript::Number)]
    pub next: u64,
    pub text: String,
    pub truncated: bool,
}

/// X13: `terminal.search`. The lines of the output log that match a regular expression.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SearchParams {
    pub id: String,
    /// A regular expression (Rust `regex` syntax), matched against each line.
    pub pattern: String,
    /// Search from this offset; the log's start when absent.
    #[specta(type = Option<specta_typescript::Number>)]
    pub after: Option<u64>,
    /// Lowers the 16 384-byte cap of the reply.
    pub max: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Match {
    /// The byte offset of the line's start.
    #[specta(type = specta_typescript::Number)]
    pub offset: u64,
    /// The line, cut at 400 characters.
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Search {
    pub matches: Vec<Match>,
    pub truncated: bool,
    /// Where to search from for the rest when `truncated`, else the log's end.
    #[specta(type = specta_typescript::Number)]
    pub next: u64,
}

/// X13: `terminal.screen`. The screen as it is now, as plain text.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Screen {
    pub cols: u16,
    pub rows: u16,
    /// The log's end when the screen was copied; read from here for what is new.
    #[specta(type = specta_typescript::Number)]
    pub offset: u64,
    /// One string per row, trailing blanks trimmed and trailing empty rows dropped.
    pub lines: Vec<String>,
    pub truncated: bool,
}
