//! Terminals: plain shell processes with a PTY. Bytes travel base64-encoded.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct SpawnParams {
    pub cwd: String,
    /// Argv. `None` runs the user's login shell.
    pub command: Option<Vec<String>>,
    pub env: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct TerminalId {
    pub id: String,
}

/// What `agent.run` and `terminal.open` return: the Terminal they started.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Opened {
    pub terminal_id: String,
}

/// X12: start the user's login shell in a Terminal owned by Workstream `workstream`.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct OpenParams {
    pub workstream: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct WriteParams {
    pub id: String,
    /// Base64 of the bytes to type.
    pub data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct ResizeParams {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct TerminalInfo {
    pub id: String,
    pub cwd: String,
    /// Latest OSC 0/2 window title, if any.
    pub title: Option<String>,
    pub running: bool,
    /// `None` while running or when killed by a signal; `-1` when the Daemon could not read the exit status.
    pub exit_code: Option<i32>,
    /// The Workstream or Agent whose bubble shows it (X11, X12); `None` for a raw spawn (X1).
    pub owner: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct OutputEvent {
    pub id: String,
    /// Base64 of the bytes the program wrote.
    pub data: String,
    #[ts(type = "number")]
    pub offset: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct Snapshot {
    pub cols: u16,
    pub rows: u16,
    #[ts(type = "number")]
    pub after: u64,
    pub data: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct TitleEvent {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "terminal/")]
pub struct ExitedEvent {
    pub id: String,
    /// `None` when the program was killed by a signal; `-1` when the Daemon could not read the exit status.
    pub code: Option<i32>,
}
