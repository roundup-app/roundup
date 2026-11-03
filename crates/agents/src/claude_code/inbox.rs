//! B50, B51: Claude Code's cross-session inbox, the messaging socket each Agent is launched with
//! (`--messaging-socket-path`). A `note` is one line of NDJSON written to it, after an `auth` line
//! with the session's `peerToken`; the transcript records it with an `origin` of kind `peer` under the
//! `msg_id` sent. The wire format is the one `PEER_PROTOCOL` names: the protocol number Claude Code
//! lists in its own session file.

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

use contracts::agent::Inbox;
use contracts::message::MessageKind;
use serde_json::{Value, json};

use super::Launcher;

/// The `peerProtocol` a session lists in `<config>/sessions/<pid>.json` when it speaks the wire
/// format of `inbox_write`; the fixtures of 2.1.300 and 2.1.302 both list it. A session listing
/// another number, or none, is a `mismatch`.
const PEER_PROTOCOL: u64 = 1;

/// B2706: the modes Claude Code lists for `permissions.defaultMode`.
const MODES: [&str; 4] = ["default", "acceptEdits", "plan", "auto"];

/// B2706: the permission mode a normal Attempt in `cwd` runs in, which is the `from-mode` a note
/// names (a session whose mode differs from its sender's holds the note for approval): the first
/// of the local project, project and user settings that names `permissions.defaultMode`; a value
/// Claude Code does not list, or no layer at all, is `default`.
pub(super) fn default_mode(config: &Path, cwd: &Path) -> String {
    [
        cwd.join(".claude/settings.local.json"),
        cwd.join(".claude/settings.json"),
        config.join("settings.json"),
    ]
    .iter()
    .find_map(|file| {
        let settings: Value = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
        settings["permissions"]["defaultMode"]
            .as_str()
            .map(str::to_owned)
    })
    .filter(|mode| MODES.contains(&mode.as_str()))
    .unwrap_or_else(|| "default".into())
}

/// How long a write to an Agent's socket may block.
const WRITE_BOUND: Duration = Duration::from_secs(2);

/// B50(d): the longest entry text one line of the TUI shows, `[cut]` included.
const LINE_BYTES: usize = 200;
const CUT: &str = "[cut]";

/// One note for an Agent: `id` is the Message's, `from` the sender's name. `one_line` asks for
/// the text to be cut to one line of the TUI (B50(d)).
pub struct Entry {
    pub id: u32,
    pub kind: MessageKind,
    pub from: String,
    pub text: String,
    pub one_line: bool,
}

impl Entry {
    /// B5763a: the entire string the peer compares, excluding the transport Message id.
    /// Questions include their reply identity; notes use their rendered text and labels.
    pub fn content(&self, from: &str, permission_mode: &str) -> String {
        let text = if self.kind == MessageKind::Question {
            format!("[question, replyTo: {}] {}", self.id, self.text)
        } else if self.one_line {
            one_line(&self.text)
        } else {
            self.text.clone()
        };
        format!(
            "<cross-session-message from=\"{from}\" from-name=\"{}\" from-mode=\"{permission_mode}\">\n{text}\n</cross-session-message>",
            attribute(&self.from),
        )
    }
}

const MSG_ID_PREFIX: &str = "00000000-0000-4000-8000-";

/// The `msg_id` of Message `id`: Claude Code wants a UUID and drops a second line carrying one it
/// has taken up, so a note sent twice reaches the Agent once. `message_of` is its inverse.
fn msg_id(id: u32) -> String {
    format!("{MSG_ID_PREFIX}{id:012x}")
}

fn message_of(msg_id: &str) -> Option<u32> {
    u32::from_str_radix(msg_id.strip_prefix(MSG_ID_PREFIX)?, 16).ok()
}

/// B50(d): `text` as one line: cut at a character boundary so the whole, `[cut]` included, is at
/// most 200 bytes, when it is longer.
fn one_line(text: &str) -> String {
    if text.len() <= LINE_BYTES {
        return text.to_owned();
    }
    let mut end = LINE_BYTES - CUT.len();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{CUT}", &text[..end])
}

/// The sender's name as an attribute value of the `cross-session-message` tag, without the
/// characters that would end the attribute or the tag.
fn attribute(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '"' | '<' | '>' | '\n' | '\r' => '_',
            c => c,
        })
        .collect()
}

/// A live session's listing: the `peerProtocol` it names and its `peerToken`.
struct Session {
    id: String,
    protocol: Option<u64>,
    token: String,
}

impl Launcher {
    /// The socket Agent `agent` is launched to make.
    pub fn socket_path(&self, agent: impl std::fmt::Display) -> PathBuf {
        self.retained_inboxes
            .lock()
            .expect("retained inboxes")
            .get(&agent.to_string())
            .cloned()
            .unwrap_or_else(|| self.socket_dir().join(format!("{agent}.sock")))
    }

    /// Restore only the messaging endpoint of a verified surviving owner.
    pub(crate) fn reattach_inbox(&self, agent: &str, socket: &Path) {
        self.retained_inboxes
            .lock()
            .expect("retained inboxes")
            .insert(agent.to_owned(), socket.to_owned());
    }

    /// The live session listening on `socket`: Claude Code lists each session in
    /// `<config>/sessions/<pid>.json` and keeps its token in a `<pid>.<hash>.key` beside it. A
    /// session that was killed leaves its files, so only a listed process still running counts.
    fn session(&self, socket: &Path) -> Option<Session> {
        let socket = socket.canonicalize().ok()?;
        let sessions = self.conversation_dir.join("sessions");
        let files: Vec<_> = std::fs::read_dir(&sessions).ok()?.flatten().collect();
        let (pid, protocol, id) = files.iter().find_map(|file| {
            let name = file.file_name().into_string().ok()?;
            let pid = name.strip_suffix(".json")?;
            let session: Value = serde_json::from_slice(&std::fs::read(file.path()).ok()?).ok()?;
            let listening = Path::new(session["messagingSocketPath"].as_str()?)
                .canonicalize()
                .ok()?;
            let alive = rustix::process::Pid::from_raw(session["pid"].as_i64()?.try_into().ok()?)
                .is_some_and(|pid| rustix::process::test_kill_process(pid).is_ok());
            let id = session["sessionId"].as_str()?.to_owned();
            (listening == socket && alive)
                .then(|| (pid.to_owned(), session["peerProtocol"].as_u64(), id))
        })?;
        let token = files.iter().find_map(|file| {
            let name = file.file_name().into_string().ok()?;
            name.strip_prefix(&format!("{pid}."))?
                .strip_suffix(".key")?;
            let key: Value = serde_json::from_slice(&std::fs::read(file.path()).ok()?).ok()?;
            key["peerToken"].as_str().map(str::to_owned)
        })?;
        Some(Session {
            id,
            protocol,
            token,
        })
    }

    /// B51: the state of Agent `agent`'s inbox: `missing` when its session is not listening on
    /// its socket; `mismatch` when the session lists a `peerProtocol` other than `PEER_PROTOCOL`.
    pub fn inbox_check(&self, agent: &str) -> Inbox {
        match self.session(&self.socket_path(agent)) {
            None => Inbox::Missing,
            Some(session) if session.protocol == Some(PEER_PROTOCOL) => Inbox::Ok,
            Some(_) => Inbox::Mismatch,
        }
    }

    /// B5763b: the actual peer session, independent of Daemon restart or Agent labels.
    pub fn inbox_session(&self, agent: &str) -> Option<String> {
        self.session(&self.socket_path(agent))
            .map(|session| session.id)
    }

    /// B5763c: only the live receiving session and rupd's own peer origin establish history.
    pub fn inbox_previous(&self, agent: &str, path: &Path) -> Result<Option<String>, Inbox> {
        let session = self.inbox_session(agent).ok_or(Inbox::Missing)?;
        let from = format!("uds:{}", self.socket_dir().join("rupd").display());
        previous(path, &session, &from).map_err(|error| {
            eprintln!("inbox: cannot recover {}: {error}", path.display());
            Inbox::Missing
        })
    }

    /// B5763b: use exactly the renderer and permission mode of the physical inbox write.
    pub fn inbox_content(&self, agent: &str, note: &Entry, yolo: bool) -> String {
        let from = format!("uds:{}", self.socket_dir().join("rupd").display());
        note.content(&from, &self.inbox_mode(agent, yolo))
    }

    fn inbox_mode(&self, agent: &str, yolo: bool) -> String {
        if yolo {
            "bypassPermissions".to_owned()
        } else {
            self.modes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(agent)
                .map(|mode| mode.effective.clone())
                .unwrap_or_else(|| "default".into())
        }
    }

    /// B50(a), B50(c): sends one line per note over `agent`'s socket. A failure, which may come
    /// after some notes went, names `missing`; sending the batch again is safe, since Claude Code
    /// drops a `msg_id` it has taken up.
    pub fn inbox_write(&self, agent: &str, notes: &[Entry], yolo: bool) -> Result<(), Inbox> {
        let permission_mode = self.inbox_mode(agent, yolo);
        let socket = self.socket_path(agent);
        let token = self.session(&socket).ok_or(Inbox::Missing)?.token;
        let mut stream = UnixStream::connect(&socket).map_err(|_| Inbox::Missing)?;
        stream
            .set_write_timeout(Some(WRITE_BOUND))
            .map_err(|_| Inbox::Missing)?;
        let from = format!("uds:{}", self.socket_dir().join("rupd").display());
        let mut lines = vec![json!({ "type": "auth", "token": token })];
        for note in notes {
            let content = note.content(&from, &permission_mode);
            lines.push(json!({
                "msgV": 1, "msg_id": msg_id(note.id), "type": "user",
                "message": { "role": "user", "content": content },
                "priority": "next", "from": from,
            }));
        }
        let mut body = Vec::new();
        for line in &lines {
            serde_json::to_writer(&mut body, line).map_err(|_| Inbox::Missing)?;
            body.push(b'\n');
        }
        stream.write_all(&body).map_err(|_| Inbox::Missing)
    }
}

/// B5763c: read admitted content in transcript order, never Message allocation order.
/// Native input and other peer origins do not change rupd's last admitted entry.
pub fn previous(path: &Path, session: &str, sender: &str) -> std::io::Result<Option<String>> {
    #[derive(serde::Deserialize)]
    struct Origin {
        kind: String,
        from: String,
    }
    #[derive(serde::Deserialize)]
    struct Message {
        content: serde_json::Value,
    }
    #[derive(serde::Deserialize)]
    struct Attachment {
        origin: Option<Origin>,
        prompt: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct Record {
        #[serde(rename = "sessionId")]
        session: Option<String>,
        origin: Option<Origin>,
        message: Option<Message>,
        attachment: Option<Attachment>,
    }
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut last = None;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || !line.ends_with('\n') {
            break;
        }
        let record: Record = serde_json::from_str(&line)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        if record.session.as_deref() != Some(session) {
            continue;
        }
        let (origin, text) = match record.attachment {
            Some(attachment) => (attachment.origin, attachment.prompt),
            None => (
                record.origin,
                record
                    .message
                    .and_then(|message| message.content.as_str().map(str::to_owned)),
            ),
        };
        if let (Some(origin), Some(text)) = (origin, text)
            && origin.kind == "peer"
            && origin.from == sender
        {
            let start = text.find("<cross-session-message ");
            let end = text.rfind("</cross-session-message>");
            last = start.zip(end).and_then(|(start, end)| {
                text.get(start..end + "</cross-session-message>".len())
                    .map(str::to_owned)
            });
        }
    }
    Ok(last)
}

/// The Message ids the transcript at `path` records as another session's message, from byte
/// `from` on, and the offset to continue from: the end of the last complete line.
pub fn recorded(path: &Path, from: u64) -> (Vec<u32>, u64) {
    let Ok(file) = std::fs::File::open(path) else {
        return (Vec::new(), from);
    };
    recorded_from(file, from)
}

fn recorded_from(mut file: impl Read + Seek, from: u64) -> (Vec<u32>, u64) {
    let read = || -> std::io::Result<_> {
        let end = file.seek(SeekFrom::End(0))?;
        let start = from.min(end);
        file.seek(SeekFrom::Start(start))?;
        let line = ReceiptLine {
            reader: std::cell::RefCell::new(BufReader::new(file.take(end - start))),
            complete: std::cell::Cell::new(false),
            bytes: std::cell::Cell::new(0),
            valid: std::cell::Cell::new(true),
            pending: std::cell::RefCell::new(([0; 256], 0, 0)),
        };
        let mut de = serde_json::Deserializer::from_reader(&line);
        let mut ids = Vec::new();
        let mut cursor = start;
        loop {
            use serde::de::DeserializeSeed;
            let result = ReceiptFields::Record.deserialize(&mut de).and_then(|id| {
                de.end()?;
                Ok(id)
            });
            if let Err(error) = &result
                && error.is_io()
            {
                return Err(std::io::Error::other(error.to_string()));
            }
            std::io::copy(&mut &line, &mut std::io::sink())?;
            if !line.complete.get() {
                break;
            }
            cursor = start + line.bytes.get();
            if line.valid.get()
                && let Ok((_, Some(id))) = &result
            {
                ids.push(*id);
            }
            if result.is_err() {
                de = serde_json::Deserializer::from_reader(&line);
            }
            line.complete.set(false);
            line.valid.set(true);
        }
        Ok((ids, cursor))
    };
    read().unwrap_or_else(|_| (Vec::new(), from))
}

// Select fields only at their receipt path. The result marks an object for
// origin precedence (including empty objects), or a peer kind in Text mode,
// together with the decoded Message id.
enum ReceiptFields {
    Record,
    Attachment,
    Origin,
    Text,
}
impl<'de> serde::de::DeserializeSeed<'de> for ReceiptFields {
    type Value = (bool, Option<u32>);
    fn deserialize<D: serde::Deserializer<'de>>(self, de: D) -> Result<Self::Value, D::Error> {
        de.deserialize_any(self)
    }
}
impl<'de> serde::de::Visitor<'de> for ReceiptFields {
    type Value = (bool, Option<u32>);
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("receipt fields")
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        use serde::Deserialize;
        #[derive(Deserialize)]
        #[serde(field_identifier)]
        enum Field {
            #[serde(rename = "origin")]
            Origin,
            #[serde(rename = "attachment")]
            Attachment,
            #[serde(rename = "kind")]
            Kind,
            #[serde(rename = "msg_id")]
            MsgId,
            #[serde(other)]
            Other,
        }
        let mut origin = (false, None);
        let mut attachment = None;
        let mut kind = false;
        let mut id = None;
        while let Some(field) = map.next_key::<Field>()? {
            match (&self, field) {
                (Self::Record | Self::Attachment, Field::Origin) => {
                    origin = map.next_value_seed(ReceiptFields::Origin)?
                }
                (Self::Record, Field::Attachment) => {
                    attachment = map.next_value_seed(ReceiptFields::Attachment)?.1
                }
                (Self::Origin, Field::Kind) => kind = map.next_value_seed(ReceiptFields::Text)?.0,
                (Self::Origin, Field::MsgId) => id = map.next_value_seed(ReceiptFields::Text)?.1,
                _ => {
                    map.next_value::<Skipped>()?;
                }
            }
        }
        Ok((
            !matches!(self, Self::Text),
            if matches!(self, Self::Origin) {
                kind.then_some(id).flatten()
            } else if origin.0 {
                origin.1
            } else {
                attachment
            },
        ))
    }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        while seq.next_element::<Skipped>()?.is_some() {}
        Ok((false, None))
    }
    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok((false, None))
    }
    fn visit_bool<E>(self, _: bool) -> Result<Self::Value, E> {
        Ok((false, None))
    }
    fn visit_i64<E>(self, _: i64) -> Result<Self::Value, E> {
        Ok((false, None))
    }
    fn visit_u64<E>(self, _: u64) -> Result<Self::Value, E> {
        Ok((false, None))
    }
    fn visit_f64<E>(self, _: f64) -> Result<Self::Value, E> {
        Ok((false, None))
    }
    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
        Ok(if matches!(self, Self::Text) {
            (value == "peer", message_of(value))
        } else {
            (false, None)
        })
    }
}

// B5718: only receipt-sized strings reach Serde's scratch buffer. All original
// bytes are consumed and validated; oversized strings become an unmatched name.
struct ReceiptLine<R> {
    // Interior mutability lets one Deserializer retain its bounded scratch
    // across line EOFs while the scanner resets the line boundary.
    reader: std::cell::RefCell<R>,
    complete: std::cell::Cell<bool>,
    bytes: std::cell::Cell<u64>,
    valid: std::cell::Cell<bool>,
    // 256 encoded bytes cover even a fully Unicode-escaped receipt UUID.
    pending: std::cell::RefCell<([u8; 256], usize, usize)>,
}

impl<R: BufRead> ReceiptLine<R> {
    fn byte(&self) -> std::io::Result<Option<u8>> {
        let mut reader = self.reader.borrow_mut();
        let next = reader.fill_buf()?.first().copied();
        if next.is_some() {
            reader.consume(1);
            self.bytes.set(self.bytes.get() + 1);
        }
        if next == Some(b'\n') {
            self.complete.set(true);
            return Ok(None);
        }
        Ok(next)
    }

    fn string(&self, out: &mut [u8]) -> std::io::Result<usize> {
        let mut length = 1;
        out[0] = b'"';
        let mut overflow = false;
        let mut high_surrogate = false;
        loop {
            // The common ASCII run needs neither decoding nor byte-at-a-time I/O.
            let mut reader = self.reader.borrow_mut();
            let buffer = reader.fill_buf()?;
            let run = buffer
                .iter()
                .position(|b| !matches!(b, 0x20..=0x21 | 0x23..=0x5b | 0x5d..=0x7f))
                .unwrap_or(buffer.len());
            if run > 0 {
                if high_surrogate {
                    self.valid.set(false);
                }
                if !overflow && length + run < out.len() {
                    out[length..length + run].copy_from_slice(&buffer[..run]);
                    length += run;
                } else {
                    overflow = true;
                }
                reader.consume(run);
                self.bytes.set(self.bytes.get() + run as u64);
                continue;
            }
            drop(reader);
            let Some(byte) = self.byte()? else {
                return Ok(0);
            };
            let mut unit = [0; 12];
            unit[0] = byte;
            let mut count = 1;
            match byte {
                b'"' => {
                    if high_surrogate {
                        self.valid.set(false);
                    }
                    if overflow {
                        out[..3].copy_from_slice(b"\"~\"");
                        return Ok(3);
                    }
                    out[length] = b'"';
                    return Ok(length + 1);
                }
                b'\\' => {
                    let Some(escape) = self.byte()? else {
                        return Ok(0);
                    };
                    unit[1] = escape;
                    count = 2;
                    if escape == b'u' {
                        let mut value = 0u16;
                        for slot in &mut unit[2..6] {
                            let Some(hex) = self.byte()? else {
                                return Ok(0);
                            };
                            *slot = hex;
                            if let Some(digit) = (hex as char).to_digit(16) {
                                value = (value << 4) | digit as u16;
                            } else {
                                self.valid.set(false);
                            }
                        }
                        count = 6;
                        if high_surrogate {
                            if !(0xdc00..=0xdfff).contains(&value) {
                                self.valid.set(false);
                            }
                            high_surrogate = false;
                        } else if (0xd800..=0xdbff).contains(&value) {
                            high_surrogate = true;
                        } else if (0xdc00..=0xdfff).contains(&value) {
                            self.valid.set(false);
                        }
                    } else {
                        if high_surrogate
                            || !matches!(
                                escape,
                                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't'
                            )
                        {
                            self.valid.set(false);
                        }
                        high_surrogate = false;
                    }
                }
                0x80..=0xff => {
                    if high_surrogate {
                        self.valid.set(false);
                    }
                    count = match byte {
                        0xc2..=0xdf => 2,
                        0xe0..=0xef => 3,
                        0xf0..=0xf4 => 4,
                        _ => 1,
                    };
                    for slot in &mut unit[1..count] {
                        let Some(next) = self.byte()? else {
                            return Ok(0);
                        };
                        *slot = next;
                    }
                    if std::str::from_utf8(&unit[..count]).is_err() {
                        self.valid.set(false);
                    }
                }
                _ => {
                    self.valid.set(false);
                }
            }
            if !overflow && length + count < out.len() {
                out[length..length + count].copy_from_slice(&unit[..count]);
                length += count;
            } else {
                overflow = true;
            }
        }
    }
}

impl<R: BufRead> Read for &ReceiptLine<R> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let mut pending = self.pending.borrow_mut();
        let (buffer, offset, length) = &mut *pending;
        if *offset == *length {
            if self.complete.get() {
                return Ok(0);
            }
            let Some(byte) = self.byte()? else {
                return Ok(0);
            };
            *offset = 0;
            *length = if byte == b'"' {
                let length = self.string(buffer)?;
                if length == 0 {
                    self.valid.set(false);
                }
                length
            } else {
                buffer[0] = byte;
                1
            };
        }
        let count = out.len().min(*length - *offset);
        out[..count].copy_from_slice(&buffer[*offset..*offset + count]);
        *offset += count;
        Ok(count)
    }
}

// Recurse through Serde so its depth limit also bounds discarded containers.
// IgnoredAny's optimized path instead grows its own container stack.
struct Skipped;
impl<'de> serde::Deserialize<'de> for Skipped {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Skipped;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("JSON value")
            }
            fn visit_bool<E>(self, _: bool) -> Result<Skipped, E> {
                Ok(Skipped)
            }
            fn visit_i64<E>(self, _: i64) -> Result<Skipped, E> {
                Ok(Skipped)
            }
            fn visit_u64<E>(self, _: u64) -> Result<Skipped, E> {
                Ok(Skipped)
            }
            fn visit_f64<E>(self, _: f64) -> Result<Skipped, E> {
                Ok(Skipped)
            }
            fn visit_str<E>(self, _: &str) -> Result<Skipped, E> {
                Ok(Skipped)
            }
            fn visit_unit<E>(self) -> Result<Skipped, E> {
                Ok(Skipped)
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Skipped, A::Error> {
                while seq.next_element::<Skipped>()?.is_some() {}
                Ok(Skipped)
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Skipped, A::Error> {
                while map.next_key::<Skipped>()?.is_some() {
                    map.next_value::<Skipped>()?;
                }
                Ok(Skipped)
            }
        }
        de.deserialize_any(Visitor)
    }
}

/// The transcript file a hook payload names.
pub fn transcript_of(payload: &Value) -> Option<PathBuf> {
    payload["transcript_path"].as_str().map(PathBuf::from)
}

impl Launcher {
    /// The private folder Agents' messaging sockets are made in.
    pub(super) fn socket_dir(&self) -> &Path {
        self.sockets
            .get_or_init(|| {
                super::launch_files::socket_folder()
                    .expect("a private folder for messaging sockets")
            })
            .path()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_code::toolcall::tests::measured;
    use std::io::Cursor;

    struct Counted<R> {
        inner: R,
        bytes: usize,
        fail: Option<usize>,
    }
    impl<R: Read> Read for Counted<R> {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.fail.is_some_and(|limit| self.bytes >= limit) {
                return Err(std::io::Error::other("injected read"));
            }
            let max = self
                .fail
                .map_or(out.len(), |limit| out.len().min(limit - self.bytes));
            let n = self.inner.read(&mut out[..max])?;
            self.bytes += n;
            Ok(n)
        }
    }
    impl<R: Seek> Seek for Counted<R> {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }
    fn line(id: u32) -> String {
        format!(
            "{{\"origin\":{{\"kind\":\"peer\",\"msg_id\":\"00000000-0000-4000-8000-{id:012x}\"}}}}\n"
        )
    }

    #[test]
    fn b5718a_oversized_complete_records_keep_receipts_with_bounded_allocations() {
        let peer = line(7);
        let peer = peer
            .trim()
            .strip_prefix('{')
            .unwrap()
            .strip_suffix('}')
            .unwrap();
        let attachment = format!("\"attachment\":{{{peer}}}");
        let mut cases = vec![
            (format!("{{\"before\":\"$\",{peer},\"after\":\"$\"}}\n"), vec![7]),
            (format!("{{\"attachment\":{{\"before\":\"$\",{peer},\"after\":\"$\"}}}}\n"), vec![7]),
            (format!("{{\"origin\":{{\"kind\":\"local\"}},{attachment},\"unused\":\"$\"}}\n"), vec![]),
            (format!("{{{peer},{},\"unused\":\"$\"}}\n", attachment.replace("000007", "00000b")), vec![7]),
            (format!("{{\"origin\":null,{attachment},\"unused\":\"$\"}}\n"), vec![7]),
            (format!("{{{peer},\"unused\":\"$\",!}}\n{}", line(11)), vec![11]),
            ("{\"unused\":\"$\\\"origin\\\":{\\\"kind\\\":\\\"peer\\\",\\\"msg_id\\\":\\\"00000000-0000-4000-8000-000000000007\\\"}\"}\n".into(), vec![]),
        ];
        let mut escaped_cases = vec![(cases.last().unwrap().0.clone(), vec![])];
        for invalid in ["\\q", "\\uD800", "\\uDC00", "\t"] {
            cases.push((
                format!("{{{peer},\"unused\":\"${invalid}\"}}\n{}", line(11)),
                vec![11],
            ));
        }
        cases.push((
            format!("{{{peer},\"unused\":\"$é🦀\\uD83D\\uDE00\"}}\n"),
            vec![7],
        ));
        for nested in [false, true] {
            for before in [false, true] {
                let fields = peer
                    .strip_prefix("\"origin\":{")
                    .unwrap()
                    .strip_suffix('}')
                    .unwrap();
                let origin = if before {
                    format!("\"origin\":{{\"unused\":\"$\",{fields}}}")
                } else {
                    format!("\"origin\":{{{fields},\"unused\":\"$\"}}")
                };
                cases.push((
                    if nested {
                        format!("{{\"attachment\":{{{origin}}}}}\n")
                    } else {
                        format!("{{{origin}}}\n")
                    },
                    vec![7],
                ));
            }
        }
        for (field, escaped) in [
            ("\"unused\":\"$\"", true),
            ("\"$\":null", false),
            ("\"unused\":{\"array\":[{\"text\":\"$\"}]}", false),
        ] {
            for before in [false, true] {
                let template = if before {
                    format!("{{{field},{peer}}}\n")
                } else {
                    format!("{{{peer},{field}}}\n")
                };
                if escaped {
                    escaped_cases.push((template.clone(), vec![7]));
                }
                cases.push((template, vec![7]));
            }
        }
        let mut maximum = 0;
        for size in [1, 16, 64] {
            for escaped in [false, true] {
                let large = if escaped {
                    let pattern = format!("\\\\\\u0061{}", "x".repeat(56));
                    pattern.repeat(size * 1024 * 1024 / 64)
                } else {
                    "x".repeat(size * 1024 * 1024)
                };
                let mut transcript = tempfile::NamedTempFile::new().unwrap();
                for (template, want) in if escaped { &escaped_cases } else { &cases } {
                    // B5718a took 7.059 s in CI. Reuse the file and write template
                    // parts directly so fixture copies don't consume the test budget.
                    let file = transcript.as_file_mut();
                    file.rewind().unwrap();
                    let mut parts = template.split('$');
                    file.write_all(parts.next().unwrap().as_bytes()).unwrap();
                    for part in parts {
                        file.write_all(large.as_bytes()).unwrap();
                        file.write_all(part.as_bytes()).unwrap();
                    }
                    let end = file.stream_position().unwrap();
                    file.set_len(end).unwrap();
                    let (result, allocated) = measured(|| recorded(transcript.path(), 0));
                    assert_eq!(result, (want.clone(), end), "{template}");
                    assert!(
                        allocated <= 256 * 1024,
                        "{size} MiB escaped={escaped}: {allocated} bytes, {template}"
                    );
                    maximum = maximum.max(allocated);
                }
            }
        }
        eprintln!("B5718a maximum allocated per scan: {maximum} bytes");
    }

    #[test]
    fn b5718b_unfinished_records_complete_without_unbounded_allocations() {
        let mut maximum = 0;
        for size in [1, 16, 64] {
            let large = "x".repeat(size * 1024 * 1024);
            for before in [false, true] {
                for inside_string in [false, true] {
                    let peer = line(7);
                    let peer = peer
                        .trim()
                        .strip_prefix('{')
                        .unwrap()
                        .strip_suffix('}')
                        .unwrap();
                    let prefix = line(3);
                    let tail = if before {
                        format!("{{{peer},\"unused\":\"{large}")
                    } else {
                        format!("{{\"unused\":\"{large}")
                    };
                    let suffix = if before {
                        "\"}".to_owned()
                    } else {
                        format!("\",{peer}}}")
                    };
                    let fixture = if inside_string {
                        format!("{prefix}{tail}")
                    } else {
                        format!("{prefix}{tail}{suffix}")
                    };
                    let transcript = tempfile::NamedTempFile::new().unwrap();
                    std::fs::write(transcript.path(), fixture).unwrap();
                    let mut cursor = 0;
                    for scan in 0..3 {
                        let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                        assert_eq!(
                            result,
                            (
                                if scan == 0 { vec![3] } else { vec![] },
                                prefix.len() as u64
                            )
                        );
                        assert!(allocated <= 256 * 1024, "{size} MiB: {allocated} bytes");
                        maximum = maximum.max(allocated);
                        cursor = result.1;
                    }
                    let mut counted = Counted {
                        inner: std::fs::File::open(transcript.path()).unwrap(),
                        bytes: 0,
                        fail: None,
                    };
                    let tail_bytes = transcript.as_file().metadata().unwrap().len() - cursor;
                    assert_eq!(recorded_from(&mut counted, cursor), (vec![], cursor));
                    assert_eq!(counted.bytes as u64, tail_bytes);
                    let finish = if inside_string {
                        format!("{suffix}\n")
                    } else {
                        "\n".into()
                    };
                    std::fs::OpenOptions::new()
                        .append(true)
                        .open(transcript.path())
                        .unwrap()
                        .write_all(finish.as_bytes())
                        .unwrap();
                    let end = transcript.as_file().metadata().unwrap().len();
                    let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                    assert_eq!(result, (vec![7], end));
                    assert!(allocated <= 256 * 1024, "completion: {allocated} bytes");
                    maximum = maximum.max(allocated);
                    counted.bytes = 0;
                    assert_eq!(recorded_from(&mut counted, end), (vec![], end));
                    assert_eq!(counted.bytes, 0);
                }
            }
        }
        eprintln!("B5718b maximum allocated per scan: {maximum} bytes");
    }

    #[test]
    fn b5718b_malformed_unfinished_records_rescan_with_bounded_allocations() {
        let prefix = line(3);
        let peer = line(7);
        for size in [1, 16, 64] {
            let large = "x".repeat(size * 1024 * 1024);
            for (tail, completion) in [("\\q", "\"}"), ("\"}\"", "")] {
                let fixture = format!(
                    "{prefix}{{{},\"unused\":\"{large}{tail}",
                    peer.trim()
                        .strip_prefix('{')
                        .unwrap()
                        .strip_suffix('}')
                        .unwrap()
                );
                let transcript = tempfile::NamedTempFile::new().unwrap();
                std::fs::write(transcript.path(), fixture).unwrap();
                let mut cursor = 0;
                for scan in 0..3 {
                    let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                    assert_eq!(
                        result,
                        (
                            if scan == 0 { vec![3] } else { vec![] },
                            prefix.len() as u64
                        ),
                        "malformed unfinished string, {size} MiB, scan {scan}"
                    );
                    assert!(
                        allocated <= 256 * 1024,
                        "malformed unfinished string, {size} MiB, scan {scan}: {allocated} bytes, bound 256 KiB"
                    );
                    cursor = result.1;
                }
                let finish = format!("{completion}\n{}", line(11));
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(transcript.path())
                    .unwrap()
                    .write_all(finish.as_bytes())
                    .unwrap();
                let end = transcript.as_file().metadata().unwrap().len();
                let (result, allocated) = measured(|| recorded(transcript.path(), cursor));
                assert_eq!(result, (vec![11], end), "malformed recovery, {size} MiB");
                assert!(
                    allocated <= 256 * 1024,
                    "malformed recovery, {size} MiB: {allocated} bytes, bound 256 KiB"
                );
            }
        }
    }

    #[test]
    fn b5635a_receipt_reads_only_appended_bytes() {
        let record = format!(
            "{{\"unused\":\"{}\",\"nested\":{{\"array\":[1,2,3]}}}}\n",
            "x".repeat(900)
        );
        let fixture = record.repeat((30 * 1024 * 1024) / record.len() + 1);
        let transcript = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(transcript.path(), fixture).unwrap();
        let mut file = Counted {
            inner: std::fs::File::open(transcript.path()).unwrap(),
            bytes: 0,
            fail: None,
        };
        let ((ids, mut offset), allocated) = measured(|| recorded_from(&mut file, 0));
        assert!(ids.is_empty());
        assert!(
            allocated <= 256 * 1024,
            "initial scan {allocated} bytes, bound 256 KiB"
        );
        file.bytes = 0;
        let (_, allocated) = measured(|| recorded_from(&mut file, offset));
        assert_eq!(file.bytes, 0);
        assert!(
            allocated <= 64 * 1024,
            "unchanged scan {allocated} bytes, bound 64 KiB"
        );
        let mut appended = 0;
        for id in 1..=100 {
            let line = line(id);
            appended += line.len();
            std::fs::OpenOptions::new()
                .append(true)
                .open(transcript.path())
                .unwrap()
                .write_all(line.as_bytes())
                .unwrap();
            let (ids, next) = recorded_from(&mut file, offset);
            assert_eq!(ids, [id]);
            assert_eq!(next - offset, line.len() as u64);
            offset = next;
        }
        assert_eq!(file.bytes, appended);
    }

    #[test]
    fn b5635a_receipt_fields_and_cursor_failures() {
        for (prefix, want) in [
            ("null", vec![7]),
            ("{}", vec![]),
            ("{\"kind\":\"local\"}", vec![]),
        ] {
            let nested = line(7);
            let record = format!("{{\"origin\":{prefix},\"attachment\":{}}}\n", nested.trim());
            assert_eq!(recorded_from(Cursor::new(record.as_bytes()), 0).0, want);
        }
        for record in [
            "bad\n",
            "{}\n",
            "{\"origin\":{\"kind\":\"peer\",\"msg_id\":\"foreign\"}}\n",
        ] {
            assert_eq!(
                recorded_from(Cursor::new(record), 0),
                (vec![], record.len() as u64)
            );
        }
        let mut bytes = line(9).into_bytes();
        let complete = bytes.len() as u64;
        bytes.extend_from_slice(b"\xf0\x9f");
        assert_eq!(recorded_from(Cursor::new(&bytes), 0), (vec![9], complete));
        assert_eq!(recorded_from(Cursor::new(b"{}\n"), 99), (vec![], 3));
        let bytes = line(9) + &line(10);
        let mut file = Counted {
            inner: Cursor::new(bytes),
            bytes: 0,
            fail: Some(complete as usize),
        };
        assert_eq!(recorded_from(&mut file, 0), (vec![], 0));
        let prefix = line(3);
        let oversized = prefix.clone()
            + &line(7)
            + &format!("{{\"unused\":\"{}\"}}\n", "x".repeat(1024 * 1024));
        let mut file = Counted {
            inner: Cursor::new(oversized),
            bytes: 0,
            fail: Some(16 * 1024),
        };
        assert_eq!(
            recorded_from(&mut file, prefix.len() as u64),
            (vec![], prefix.len() as u64)
        );
        struct FailedSeek;
        impl Read for FailedSeek {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                unreachable!()
            }
        }
        impl Seek for FailedSeek {
            fn seek(&mut self, _: SeekFrom) -> std::io::Result<u64> {
                Err(std::io::Error::other("seek"))
            }
        }
        assert_eq!(recorded_from(FailedSeek, 17), (vec![], 17));
        assert_eq!(
            recorded(Path::new("/absent/receipt.jsonl"), 17),
            (vec![], 17)
        );
    }
}
