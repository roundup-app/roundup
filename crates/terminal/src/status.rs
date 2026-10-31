//! PS1–PS6: the Program Status Protocol (OSC 7501), read from a Terminal's output.
//!
//! A program reports `ESC ] 7501 ; state=working : msg=<base64> ST`; the mirror keeps the last
//! accepted report for each `id` as a record and says what changed. vt100 cuts an OSC at 1024
//! bytes, below the protocol's 4096, so a scanner of its own reads the bytes first. Nothing a
//! report holds is ever written back to the PTY; only the fixed feature-detection reply is.

use std::sync::Arc;

use super::{Shared, Terminals};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;

/// The whole report, `7501;` included, in bytes.
const REPORT_MAX: usize = 4096;
const MSG_ENCODED_MAX: usize = 2732;
const MSG_DECODED_MAX: usize = 2048;
const TITLE_ENCODED_MAX: usize = 256;
const TITLE_DECODED_MAX: usize = 192;
const ID_MAX_BYTES: usize = 128;
const ID_MAX_LEVELS: usize = 8;
/// The most records a Terminal holds.
pub const RECORDS_MAX: usize = 256;

const REPORT: &[u8] = b"7501;";
const PROMPT: &[u8] = b"133;A";
const QUERY: &[u8] = b"7501;?";
const REPLY: &[u8] =
    b"\x1b]7501;?:states=idle,working,done,blocked,error,clear:kinds=permission,question,auth";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramState {
    Idle,
    Working,
    Done,
    Blocked,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockedKind {
    Permission,
    Question,
    Auth,
}

/// The last accepted report for one `id` in one Terminal.
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    /// A `/` path of record names; empty is the root record.
    pub id: String,
    pub state: ProgramState,
    pub kind: Option<BlockedKind>,
    pub progress: Option<u8>,
    pub app: Option<String>,
    pub title: Option<String>,
    pub msg: Option<String>,
    /// Milliseconds on the Daemon's clock when the report was applied.
    pub applied: f64,
}

/// One Terminal's records after a report, a drop or a reset changed them.
#[derive(Clone, Debug)]
pub struct Change {
    pub terminal: String,
    pub records: Vec<Arc<Record>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Terminator {
    Bel,
    St,
}

impl Terminator {
    fn bytes(self) -> &'static [u8] {
        match self {
            Self::Bel => b"\x07",
            Self::St => b"\x1b\\",
        }
    }
}

#[derive(Default)]
enum Scan {
    #[default]
    Ground,
    Esc,
    /// Inside an OSC.
    Osc,
    OscEsc,
}

/// What a chunk did to a Terminal.
#[derive(Default)]
pub(crate) struct Outcome {
    /// Bytes for the program: the replies to feature-detection queries.
    pub reply: Vec<u8>,
    /// The records after each change, in order.
    pub changes: Vec<Vec<Arc<Record>>>,
}

#[derive(Default)]
pub(crate) struct Mirror {
    scan: Scan,
    payload: Vec<u8>,
    /// The payload is not one this module reads, or is over the limit: collect nothing more.
    ignore: bool,
    /// Oldest update first.
    records: Vec<Arc<Record>>,
}

impl Mirror {
    pub fn feed(&mut self, bytes: &[u8], now: f64) -> Outcome {
        let mut out = Outcome::default();
        let mut at = 0;
        while at < bytes.len() {
            if matches!(self.scan, Scan::Ground) {
                match bytes[at..].iter().position(|&byte| byte == 0x1b) {
                    Some(esc) => at += esc,
                    None => break,
                }
            }
            self.step(bytes[at], now, &mut out);
            at += 1;
        }
        out
    }

    fn step(&mut self, byte: u8, now: f64, out: &mut Outcome) {
        match self.scan {
            Scan::Ground => {
                if byte == 0x1b {
                    self.scan = Scan::Esc;
                }
            }
            Scan::Esc => match byte {
                b']' => {
                    self.scan = Scan::Osc;
                    self.payload.clear();
                    self.ignore = false;
                }
                b'c' => {
                    self.scan = Scan::Ground;
                    if self.drop_where(|_| true) {
                        out.changes.push(self.records.clone());
                    }
                }
                0x1b => {}
                _ => self.scan = Scan::Ground,
            },
            Scan::Osc => match byte {
                0x07 => self.end(Terminator::Bel, now, out),
                0x1b => self.scan = Scan::OscEsc,
                0x18 | 0x1a => self.scan = Scan::Ground,
                _ => self.collect(byte),
            },
            Scan::OscEsc => {
                if byte == b'\\' {
                    self.end(Terminator::St, now, out);
                } else {
                    self.scan = Scan::Esc;
                    self.step(byte, now, out);
                }
            }
        }
    }

    fn collect(&mut self, byte: u8) {
        if self.ignore {
            return;
        }
        if self.payload.len() == REPORT_MAX {
            self.ignore = true;
            self.payload.clear();
            return;
        }
        self.payload.push(byte);
        let wanted =
            |known: &[u8]| known.starts_with(&self.payload) || self.payload.starts_with(known);
        if self.payload.len() <= REPORT.len() && !wanted(REPORT) && !wanted(PROMPT) {
            self.ignore = true;
            self.payload.clear();
        }
    }

    fn end(&mut self, terminator: Terminator, now: f64, out: &mut Outcome) {
        self.scan = Scan::Ground;
        if self.ignore {
            return;
        }
        let payload = std::mem::take(&mut self.payload);
        if payload == QUERY {
            out.reply.extend_from_slice(REPLY);
            out.reply.extend_from_slice(terminator.bytes());
        } else if payload.starts_with(REPORT) {
            if self.apply(&payload[REPORT.len()..], now) {
                out.changes.push(self.records.clone());
            }
        } else if (payload == PROMPT || payload.starts_with(b"133;A;")) && self.drop_running() {
            out.changes.push(self.records.clone());
        }
        self.payload = payload;
        self.payload.clear();
    }

    /// PS4: the program exited, so what it was doing or waiting on is over.
    pub fn exited(&mut self) -> Option<Vec<Arc<Record>>> {
        self.drop_running().then(|| self.records.clone())
    }

    fn drop_running(&mut self) -> bool {
        self.drop_where(|record| {
            matches!(record.state, ProgramState::Working | ProgramState::Blocked)
        })
    }

    /// Drop the records `gone` names; true when there was one.
    fn drop_where(&mut self, gone: impl Fn(&Record) -> bool) -> bool {
        let before = self.records.len();
        self.records.retain(|record| !gone(record));
        self.records.len() != before
    }

    /// PS1–PS3: true when the records changed.
    fn apply(&mut self, pairs: &[u8], now: f64) -> bool {
        let Some(report) = Report::parse(pairs) else {
            return false;
        };
        let Some(state) = report.state else {
            return false;
        };
        let Some(state) = state else {
            // `clear`: the record of the id and every record below it.
            let id = report.id;
            let below = format!("{id}/");
            return self.drop_where(|record| {
                id.is_empty() || record.id == id || record.id.starts_with(&below)
            });
        };
        let kind = report.kind.filter(|_| state == ProgramState::Blocked);
        let record = Arc::new(Record {
            id: report.id,
            state,
            kind,
            progress: report.progress,
            app: report.app,
            title: report.title,
            msg: report.msg,
            applied: now,
        });
        self.records.retain(|old| old.id != record.id);
        if self.records.len() == RECORDS_MAX {
            self.records.remove(0);
        }
        self.records.push(record);
        true
    }
}

struct Report {
    /// `None`: no valid state. `Some(None)`: `clear`.
    state: Option<Option<ProgramState>>,
    kind: Option<BlockedKind>,
    id: String,
    progress: Option<u8>,
    app: Option<String>,
    title: Option<String>,
    msg: Option<String>,
}

impl Report {
    /// `None` drops the whole report: over a limit or bad base64.
    fn parse(pairs: &[u8]) -> Option<Self> {
        let mut report = Self {
            state: None,
            kind: None,
            id: String::new(),
            progress: None,
            app: None,
            title: None,
            msg: None,
        };
        for pair in pairs.split(|&byte| byte == b':') {
            let Some(at) = pair.iter().position(|&byte| byte == b'=') else {
                continue;
            };
            let (key, value) = (&pair[..at], &pair[at + 1..]);
            match key {
                b"state" => {
                    report.state = match value {
                        b"idle" => Some(Some(ProgramState::Idle)),
                        b"working" => Some(Some(ProgramState::Working)),
                        b"done" => Some(Some(ProgramState::Done)),
                        b"blocked" => Some(Some(ProgramState::Blocked)),
                        b"error" => Some(Some(ProgramState::Error)),
                        b"clear" => Some(None),
                        _ => report.state,
                    }
                }
                b"kind" => {
                    report.kind = match value {
                        b"permission" => Some(BlockedKind::Permission),
                        b"question" => Some(BlockedKind::Question),
                        b"auth" => Some(BlockedKind::Auth),
                        _ => report.kind,
                    }
                }
                b"id" => {
                    if value.len() > ID_MAX_BYTES
                        || value.split(|&b| b == b'/').count() > ID_MAX_LEVELS
                    {
                        return None;
                    }
                    if let Some(id) = line(value)
                        && id.split('/').all(|level| !level.is_empty())
                    {
                        report.id = id;
                    }
                }
                b"progress" => {
                    if !value.is_empty()
                        && value.iter().all(u8::is_ascii_digit)
                        && let Ok(percent) = std::str::from_utf8(value).unwrap_or("").parse::<u8>()
                        && percent <= 100
                    {
                        report.progress = Some(percent);
                    }
                }
                b"app" => report.app = line(value).or(report.app),
                b"title" => {
                    report.title =
                        text(value, TITLE_ENCODED_MAX, TITLE_DECODED_MAX)?.or(report.title)
                }
                b"msg" => {
                    report.msg = text(value, MSG_ENCODED_MAX, MSG_DECODED_MAX)?.or(report.msg)
                }
                _ => {}
            }
        }
        Some(report)
    }
}

/// One line of UTF-8 with no control character.
fn line(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    (!text.chars().any(char::is_control)).then(|| text.to_owned())
}

/// A base64 field. Outer `None` drops the report (over a limit or invalid base64); inner `None`
/// skips the pair (not a line).
fn text(value: &[u8], encoded_max: usize, decoded_max: usize) -> Option<Option<String>> {
    if value.len() > encoded_max {
        return None;
    }
    let decoded = STANDARD.decode(value).ok()?;
    if decoded.len() > decoded_max {
        return None;
    }
    Some(line(&decoded))
}

impl Shared {
    /// PS1: tell the Daemon what a Terminal's records are now.
    pub(super) fn changed(&self, number: u64, records: Vec<Arc<Record>>) {
        let _ = self.status.send(Arc::new(Change {
            terminal: number.to_string(),
            records,
        }));
    }

    /// PS4: the Terminal's program exited.
    pub(super) fn program_exited(&self, number: u64) {
        let screen = self
            .table()
            .get(&number)
            .map(|entry| Arc::clone(&entry.screen));
        let records =
            screen.and_then(|screen| screen.lock().expect("terminal screen lock").status.exited());
        if let Some(records) = records {
            self.changed(number, records);
        }
    }
}

impl Terminals {
    /// PS1: every change to any Terminal's program status records, one per applied report.
    pub fn subscribe_status(&self) -> tokio::sync::broadcast::Receiver<Arc<Change>> {
        self.shared.status.subscribe()
    }
}
