//! X13: the output log of a Terminal and the plain text read from it.

use std::collections::VecDeque;

use contracts::terminal::{Match, Read, Screen, Search};
use regex::RegexBuilder;
use rpc::{RpcError, code};

/// How many output bytes a Terminal keeps.
pub(crate) const LOG_BYTES: usize = 1_048_576;
/// The most text any reply holds.
pub(crate) const REPLY_BYTES: usize = 16_384;
/// X16: the most lines a read holds.
pub(crate) const REPLY_LINES: usize = 200;
const MATCH_CHARS: usize = 400;
const MATCHES: usize = 50;
/// What a match costs in the reply beyond its text: its offset and the JSON around it.
const MATCH_OVERHEAD: usize = 32;
const PATTERN_BYTES: usize = 64 * 1024;

/// The last [`LOG_BYTES`] of a Terminal's output; `end` is the running byte count, as `terminal.output`'s offsets.
#[derive(Default)]
pub(crate) struct Log {
    bytes: VecDeque<u8>,
    end: u64,
}

impl Log {
    pub(crate) fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend(chunk);
        self.end += chunk.len() as u64;
        let extra = self.bytes.len().saturating_sub(LOG_BYTES);
        self.bytes.drain(..extra);
    }

    pub(crate) fn end(&self) -> u64 {
        self.end
    }

    fn start(&self) -> u64 {
        self.end - self.bytes.len() as u64
    }

    /// A copy of the log from `after` (or the log's start when that is older), so the caller can work on it holding no lock.
    pub(crate) fn from(&self, after: u64) -> Result<Window, RpcError> {
        if after > self.end {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!(
                    "after {after} is beyond the end of the output, {}",
                    self.end
                ),
            ));
        }
        let from = after.max(self.start());
        let skip = usize::try_from(from - self.start()).unwrap_or(usize::MAX);
        Ok(Window {
            from,
            end: self.end,
            bytes: self.bytes.iter().skip(skip).copied().collect(),
        })
    }
}

pub(crate) struct Window {
    from: u64,
    end: u64,
    bytes: Vec<u8>,
}

/// A reply's cap: the request's `max` may only lower it.
pub(crate) fn cap(max: Option<u32>) -> Result<usize, RpcError> {
    match max {
        None => Ok(REPLY_BYTES),
        Some(max) if max >= 1 && max as usize <= REPLY_BYTES => Ok(max as usize),
        Some(max) => Err(RpcError::new(
            code::INVALID_PARAMS,
            format!("max must be from 1 to {REPLY_BYTES}, not {max}"),
        )),
    }
}

/// One line of output as it ends up on a screen: each character with the offset just after the
/// byte that wrote it last.
struct Line {
    start: u64,
    /// The offset after the line's `\n`, or the window's end for a last line without one.
    end: u64,
    cells: Vec<(char, u64)>,
    newline: bool,
}

impl Line {
    fn text(&self) -> String {
        self.cells.iter().map(|(c, _)| *c).collect()
    }
}

enum Escape {
    None,
    /// After `ESC`.
    Start,
    /// `ESC [`: until a final byte 0x40..=0x7e.
    Csi,
    /// `ESC ]`, `ESC P`, `ESC _`, `ESC ^`, `ESC X`: until BEL (OSC only) or `ESC \`.
    String {
        osc: bool,
    },
    StringEsc {
        osc: bool,
    },
    /// `ESC` and intermediates (0x20..=0x2f): until a final byte.
    Intermediate,
}

/// The lines of `window`, escape sequences removed, `\r\n` as `\n` and a bare `\r` as an overwrite.
fn lines(window: &Window) -> Vec<Line> {
    let mut out = Vec::new();
    let mut line = Line {
        start: window.from,
        end: window.from,
        cells: Vec::new(),
        newline: false,
    };
    let mut cursor = 0usize;
    let mut escape = Escape::None;
    let mut index = 0usize;
    while index < window.bytes.len() {
        let byte = window.bytes[index];
        let at = window.from + index as u64;
        index += 1;
        match escape {
            Escape::Start => {
                escape = match byte {
                    b'[' => Escape::Csi,
                    b']' => Escape::String { osc: true },
                    b'P' | b'_' | b'^' | b'X' => Escape::String { osc: false },
                    0x20..=0x2f => Escape::Intermediate,
                    _ => Escape::None,
                };
                continue;
            }
            Escape::Csi => {
                if (0x40..=0x7e).contains(&byte) {
                    escape = Escape::None;
                }
                continue;
            }
            Escape::Intermediate => {
                if !(0x20..=0x2f).contains(&byte) {
                    escape = Escape::None;
                }
                continue;
            }
            Escape::String { osc } => {
                escape = match byte {
                    0x07 if osc => Escape::None,
                    0x1b => Escape::StringEsc { osc },
                    _ => Escape::String { osc },
                };
                continue;
            }
            Escape::StringEsc { osc } => {
                escape = match byte {
                    b'\\' => Escape::None,
                    0x1b => Escape::StringEsc { osc },
                    _ => Escape::String { osc },
                };
                continue;
            }
            Escape::None => {}
        }
        match byte {
            0x1b => escape = Escape::Start,
            b'\n' => {
                line.end = at + 1;
                line.newline = true;
                let next = Line {
                    start: at + 1,
                    end: at + 1,
                    cells: Vec::new(),
                    newline: false,
                };
                out.push(std::mem::replace(&mut line, next));
                cursor = 0;
            }
            b'\r' => cursor = 0,
            0x08 => cursor = cursor.saturating_sub(1),
            b'\t' => put(&mut line, &mut cursor, '\t', at + 1),
            0x00..=0x1f | 0x7f => {}
            _ => {
                let (c, len) = decode(&window.bytes[index - 1..]);
                index += len - 1;
                put(&mut line, &mut cursor, c, at + len as u64);
            }
        }
    }
    line.end = window.end;
    if !line.cells.is_empty() || line.start < window.end {
        out.push(line);
    }
    out
}

fn put(line: &mut Line, cursor: &mut usize, c: char, after: u64) {
    match line.cells.get_mut(*cursor) {
        Some(cell) => *cell = (c, after),
        None => line.cells.push((c, after)),
    }
    *cursor += 1;
}

/// The character at the start of `bytes` and its length; U+FFFD for an invalid byte.
fn decode(bytes: &[u8]) -> (char, usize) {
    let width = match bytes[0] {
        0x00..=0x7f => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => return ('\u{fffd}', 1),
    };
    bytes
        .get(..width)
        .and_then(|piece| std::str::from_utf8(piece).ok())
        .and_then(|text| text.chars().next())
        .map_or(('\u{fffd}', 1), |c| (c, width))
}

/// `terminal.read`: whole lines while they fit `cap` and [`REPLY_LINES`]; a first line longer than `cap` is cut on a character boundary.
pub(crate) fn read(window: &Window, cap: usize) -> Read {
    let mut text = String::new();
    let mut next = window.from;
    let mut truncated = false;
    for (count, line) in lines(window).into_iter().enumerate() {
        if count == REPLY_LINES {
            truncated = true;
            break;
        }
        let mut piece = line.text();
        if line.newline {
            piece.push('\n');
        }
        if text.len() + piece.len() <= cap {
            text.push_str(&piece);
            next = line.end;
            continue;
        }
        truncated = true;
        if text.is_empty() {
            let mut used = 0;
            for (c, after) in &line.cells {
                used += c.len_utf8();
                if used > cap {
                    break;
                }
                text.push(*c);
                next = next.max(*after);
            }
        }
        break;
    }
    Read {
        from: window.from,
        next,
        text,
        truncated,
    }
}

/// `terminal.search`.
pub(crate) fn search(window: &Window, pattern: &str, cap: usize) -> Result<Search, RpcError> {
    let regex = RegexBuilder::new(pattern)
        .size_limit(PATTERN_BYTES)
        .build()
        .map_err(|err| {
            RpcError::new(
                code::INVALID_PARAMS,
                format!("pattern is not a usable regular expression: {err}"),
            )
        })?;
    let mut matches = Vec::new();
    let mut used = 0;
    for line in lines(window) {
        let text = line.text();
        if !regex.is_match(&text) {
            continue;
        }
        let text: String = text.chars().take(MATCH_CHARS).collect();
        if !matches.is_empty()
            && (matches.len() == MATCHES || used + text.len() + MATCH_OVERHEAD > cap)
        {
            return Ok(Search {
                matches,
                truncated: true,
                next: line.start,
            });
        }
        used += text.len() + MATCH_OVERHEAD;
        matches.push(Match {
            offset: line.start,
            text,
        });
    }
    Ok(Search {
        matches,
        truncated: false,
        next: window.end,
    })
}

/// `terminal.screen`: `rows` trimmed, kept while they fit `cap`.
pub(crate) fn screen(cols: u16, rows: u16, offset: u64, shown: Vec<String>, cap: usize) -> Screen {
    let mut lines: Vec<String> = shown
        .into_iter()
        .map(|row| row.trim_end().to_owned())
        .collect();
    while lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    let mut used = 0;
    let keep = lines
        .iter()
        .take_while(|row| {
            used += row.len() + 1;
            used <= cap
        })
        .count();
    let truncated = keep < lines.len();
    lines.truncate(keep);
    Screen {
        cols,
        rows,
        offset,
        lines,
        truncated,
    }
}
