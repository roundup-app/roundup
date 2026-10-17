//! X13/X14: the output log of a Terminal and the plain text read from it.
//!
//! The text comes from the same `vt100` parser the screen uses, never from a second one here. The
//! log keeps the last [`LOG_BYTES`] raw bytes plus a checkpoint parser that has already consumed
//! every byte evicted from them, so a read clones the checkpoint and replays the retained bytes
//! into the clone, holding no lock. Control sequences, UTF-8 and screen state that straddle the
//! eviction point or a chunk boundary are therefore the parser's own.
//!
//! Lines. The replay screen is a fixed [`ROWS`] x [`COLS`] grid with [`ROWS`] rows of history. A
//! line is a screen row, joined to the rows it wrapped onto. A row keeps its identity (and its
//! start offset, the offset after the line feed that opened it) while `vt100` moves it, and is
//! read out when it scrolls into history or, for the rows still shown, at the end of the replay.
//! So a line rewritten by cursor movement or erase is read as it ends up, in the place where it
//! began; text erased from the screen before it scrolled away is gone, as on a terminal. Starts
//! never decrease and a line ends where the next begins, so `next` never splits or repeats.
//! Each cell carries the offset after the byte that wrote it last; a read from `after` keeps only
//! cells written after it. Text drawn on the alternate screen is not read once that screen is left.

use std::collections::VecDeque;
use std::ops::ControlFlow;

use contracts::terminal::{Match, Read, Screen, Search};
use regex::RegexBuilder;
use rpc::{RpcError, code};
use vt100::Callbacks;

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
/// The replay screen's size; a longer line wraps onto further rows and is joined again.
const ROWS: u16 = 32;
const COLS: u16 = 200;

/// The last [`LOG_BYTES`] of a Terminal's output; `end` is the running byte count, as `terminal.output`'s offsets.
#[derive(Default)]
pub(crate) struct Log {
    bytes: VecDeque<u8>,
    end: u64,
    /// The parser as of the first retained byte; none while nothing was evicted.
    checkpoint: Option<Box<Replay>>,
}

impl Log {
    pub(crate) fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend(chunk);
        self.end += chunk.len() as u64;
        let extra = self.bytes.len().saturating_sub(LOG_BYTES);
        if extra > 0 {
            let mut offset = self.start();
            let checkpoint = self.checkpoint.get_or_insert_with(Box::default);
            let mut left = extra;
            let (head, tail) = self.bytes.as_slices();
            for slice in [head, tail] {
                let take = slice.len().min(left);
                checkpoint.absorb(&slice[..take], offset);
                offset += take as u64;
                left -= take;
            }
            self.bytes.drain(..extra);
        }
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
        Ok(Window {
            from,
            start: self.start(),
            end: self.end,
            bytes: if from < self.end {
                self.bytes.iter().copied().collect()
            } else {
                Vec::new()
            },
            checkpoint: self.checkpoint.clone(),
        })
    }
}

pub(crate) struct Window {
    from: u64,
    /// The offset of `bytes[0]` and of the checkpoint.
    start: u64,
    end: u64,
    bytes: Vec<u8>,
    checkpoint: Option<Box<Replay>>,
}

impl Window {
    /// Replay the retained bytes and hand each line that holds a byte at or after `from` to `sink`, until it breaks.
    fn each_line(&self, sink: &mut dyn FnMut(Line) -> ControlFlow<()>) {
        if self.from >= self.end {
            return;
        }
        let mut replay = self.checkpoint.clone().unwrap_or_default();
        replay.resync();
        let mut rows = Rows::new(self.from, self.end, sink);
        for (index, byte) in self.bytes.iter().enumerate() {
            let at = self.start + index as u64 + 1;
            // Rows that left the screen before `from` hold no byte at or after it.
            replay.feed(*byte, at, (at > self.from).then_some(&mut rows));
            if rows.stopped {
                return;
            }
        }
        replay.finish(&mut rows);
    }
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
    /// Where the next line starts, or the window's end for the last one.
    end: u64,
    cells: Vec<(char, u64)>,
    newline: bool,
}

impl Line {
    fn text(&self) -> String {
        self.cells.iter().map(|(c, _)| *c).collect()
    }
}

/// A row's tag, kept in its `vt100` row source: the start offset, whether a line feed or text
/// reached it, and a serial that tells the rows on screen and in history apart.
const START_SHIFT: u32 = 17;
const VISITED: u64 = 1 << 16;
const SERIAL: u64 = 0xffff;

/// Tags rows and cells with offsets as the parser reports each byte; one byte per `process`.
#[derive(Clone, Default)]
struct Marks {
    /// The offset after the byte being processed.
    at: u64,
    /// The offset after the last line feed.
    line_start: u64,
    serial: u64,
    /// Set while the checkpoint takes in evicted bytes: their cells are never read, so only line feeds are tagged.
    absorbing: bool,
}

impl Marks {
    fn tag(&mut self, start: u64, visited: bool) -> u64 {
        self.serial = (self.serial + 1) & SERIAL;
        start << START_SHIFT | if visited { VISITED } else { 0 } | self.serial
    }

    /// The row under the cursor starts at the last line feed unless a line feed or text reached it before.
    fn visit(&mut self, screen: &mut vt100::Screen) {
        let (row, _) = screen.cursor_position();
        let tag = match screen.row_source(row) {
            Some(tag) if tag & VISITED != 0 => return,
            Some(tag) => self.line_start << START_SHIFT | VISITED | tag & SERIAL,
            None => self.tag(self.line_start, true),
        };
        screen.set_row_source(row, Some(tag));
    }
}

impl Callbacks for Marks {
    fn text(&mut self, screen: &mut vt100::Screen, _: char) {
        if self.absorbing {
            return;
        }
        self.visit(screen);
        // The cell written ends just before the cursor; a wide character's second half is a continuation.
        let (row, col) = screen.cursor_position();
        let Some(mut col) = col.checked_sub(1) else {
            return;
        };
        if col > 0
            && screen
                .cell(row, col)
                .is_some_and(vt100::Cell::is_wide_continuation)
        {
            col -= 1;
        }
        screen.set_cell_source(row, col, Some(self.at));
    }

    fn control(&mut self, screen: &mut vt100::Screen, byte: u8) {
        if matches!(byte, 10..=12) {
            self.line_start = self.at;
            self.visit(screen);
        }
    }
}

/// A `vt100` parser fed the output byte by byte, with the rows that scrolled away.
#[derive(Clone)]
struct Replay {
    parser: vt100::Parser<Marks>,
    /// Row 0's tag after the previous byte: when it changes, rows may have scrolled into history.
    top: Option<u64>,
    alt: bool,
}

impl Default for Replay {
    fn default() -> Self {
        let mut replay = Self {
            parser: vt100::Parser::new_with_callbacks(
                ROWS,
                COLS,
                usize::from(ROWS),
                Marks::default(),
            ),
            top: None,
            alt: false,
        };
        let first = replay.parser.callbacks_mut().tag(0, true);
        replay.parser.screen_mut().set_row_source(0, Some(first));
        replay.tag_rows();
        replay
    }
}

impl Replay {
    /// Take in bytes that left the log, whose rows nobody reads: a line at a time, so that each
    /// line feed is exact, and without watching for scrolled rows. `resync` catches up at a read.
    /// The cells written here ended before the log's first byte, so a read never keeps them and
    /// their offsets need only be no later than the segment's end.
    fn absorb(&mut self, bytes: &[u8], first: u64) {
        let mut done = 0;
        self.parser.callbacks_mut().absorbing = true;
        while done < bytes.len() {
            let end = bytes[done..]
                .iter()
                .position(|byte| matches!(byte, 10..=12))
                .map_or(bytes.len(), |line_feed| done + line_feed + 1);
            self.parser.callbacks_mut().at = first + end as u64;
            self.parser.process(&bytes[done..end]);
            done = end;
        }
        self.parser.callbacks_mut().absorbing = false;
    }

    /// Catch the row and screen tracking up with what `absorb` did.
    fn resync(&mut self) {
        self.alt = self.parser.screen().alternate_screen();
        self.tag_rows();
    }

    /// Feed the byte that ends at offset `at`; rows it scrolled into history go to `rows`.
    fn feed(&mut self, byte: u8, at: u64, rows: Option<&mut Rows>) {
        self.parser.callbacks_mut().at = at;
        self.parser.process(&[byte]);
        let screen = self.parser.screen();
        let (alt, top) = (screen.alternate_screen(), screen.row_source(0));
        if alt == self.alt && top == self.top {
            return;
        }
        if let (Some(rows), Some(old), false, false) = (rows, self.top, alt, self.alt) {
            self.read_history(old, rows);
        }
        self.alt = alt;
        self.tag_rows();
    }

    /// The rows above `old`, the tag row 0 had, are the ones that just scrolled away.
    fn read_history(&mut self, old: u64, rows: &mut Rows) {
        let depth = (1..=usize::from(ROWS)).find(|&back| {
            self.parser.screen_mut().set_scrollback(back);
            self.parser.screen().row_source(0) == Some(old)
        });
        for back in (1..=depth.unwrap_or(0)).rev() {
            self.parser.screen_mut().set_scrollback(back);
            rows.push(self.parser.screen(), 0, false);
        }
        self.parser.screen_mut().set_scrollback(0);
    }

    /// Give rows `vt100` made or cleared a tag, so a row leaving the top is always recognised.
    fn tag_rows(&mut self) {
        for row in 0..ROWS {
            if self.parser.screen().row_source(row).is_none() {
                let tag = self.parser.callbacks_mut().tag(0, false);
                self.parser.screen_mut().set_row_source(row, Some(tag));
            }
        }
        self.top = self.parser.screen().row_source(0);
    }

    /// The end of the replay: the rows still shown, down to the last with text or the cursor.
    fn finish(&self, rows: &mut Rows) {
        let screen = self.parser.screen();
        let (cursor, _) = screen.cursor_position();
        let text = (0..ROWS).rev().find(|&row| {
            (0..COLS).any(|col| screen.cell(row, col).is_some_and(vt100::Cell::has_contents))
        });
        let last = text.map_or(cursor, |text| text.max(cursor));
        for row in 0..=last {
            rows.push(screen, row, row == last);
        }
        rows.close();
    }
}

#[derive(Clone, Copy)]
enum Slot {
    /// A cell nothing in the window wrote.
    Gap,
    Char(char, u64),
}

/// Joins wrapped rows into lines and hands them, with their ends, to the sink.
struct Rows<'a> {
    from: u64,
    end: u64,
    sink: &'a mut dyn FnMut(Line) -> ControlFlow<()>,
    open: Vec<Slot>,
    open_start: Option<u64>,
    /// The line before, held until the start of the next gives its end; true when nothing in the
    /// window wrote it.
    held: Option<(Line, bool)>,
    /// No line starts before this: the last start, or the last byte a line holds.
    floor: u64,
    stopped: bool,
}

impl<'a> Rows<'a> {
    fn new(from: u64, end: u64, sink: &'a mut dyn FnMut(Line) -> ControlFlow<()>) -> Self {
        Self {
            from,
            end,
            sink,
            open: Vec::new(),
            open_start: None,
            held: None,
            floor: from,
            stopped: false,
        }
    }

    /// Row `row` of `screen` as shown now; `last` marks the final row of the replay.
    fn push(&mut self, screen: &vt100::Screen, row: u16, last: bool) {
        if self.stopped {
            return;
        }
        let start = screen.row_source(row).map_or(0, |tag| tag >> START_SHIFT);
        self.open_start.get_or_insert(start);
        let base = self.open.len();
        for col in 0..COLS {
            let Some(cell) = screen.cell(row, col) else {
                continue;
            };
            if cell.is_wide_continuation() {
                continue;
            }
            match cell.source() {
                Some(at) if at > self.from && cell.has_contents() => {
                    self.open
                        .extend(cell.contents().chars().map(|c| Slot::Char(c, at)));
                }
                _ => self.open.push(Slot::Gap),
            }
        }
        while self.open.len() > base && matches!(self.open.last(), Some(Slot::Gap)) {
            self.open.pop();
        }
        if last || !screen.row_wrapped(row) {
            self.finish(!last, last);
        }
    }

    fn finish(&mut self, newline: bool, last: bool) {
        let raw = self.open_start.take().unwrap_or(0);
        let slots = std::mem::take(&mut self.open);
        let before = raw < self.from;
        let written = slots.iter().any(|slot| matches!(slot, Slot::Char(..)));
        // The last row adds nothing when the window did not write it: the fresh row after the final
        // line feed, or a row from before the window.
        let nothing = last && !written && (before || raw >= self.end);
        let start = raw.max(self.floor);
        // The line before ends where this one starts. If nothing in the window wrote it, it is
        // still a line when its own line feed came after `from`, and not otherwise.
        if let Some((mut held, ghost)) = self.held.take()
            && !(ghost && raw <= self.from)
        {
            held.end = if nothing { self.end } else { start };
            self.emit(held);
        }
        if nothing {
            return;
        }
        let mut cells = Vec::with_capacity(slots.len());
        let (mut gaps, mut after) = (0, start);
        for slot in slots {
            match slot {
                Slot::Gap => gaps += 1,
                Slot::Char(c, at) => {
                    if !(before && cells.is_empty()) {
                        cells.extend(std::iter::repeat_n((' ', after), gaps));
                    }
                    (gaps, after) = (0, at);
                    cells.push((c, at));
                    self.floor = self.floor.max(at);
                }
            }
        }
        self.floor = self.floor.max(start);
        let line = Line {
            start,
            end: self.end,
            cells,
            newline,
        };
        self.held = Some((line, before && !written));
    }

    fn close(&mut self) {
        if let Some((held, _)) = self.held.take() {
            self.emit(held);
        }
    }

    fn emit(&mut self, line: Line) {
        if !self.stopped && (self.sink)(line).is_break() {
            self.stopped = true;
        }
    }
}

/// `terminal.read`: whole lines while they fit `cap` and [`REPLY_LINES`]; a first line longer than `cap` is cut on a character boundary.
pub(crate) fn read(window: &Window, cap: usize) -> Read {
    let mut text = String::new();
    let mut next = window.from;
    let mut truncated = false;
    let mut count = 0;
    window.each_line(&mut |line| {
        if count == REPLY_LINES {
            truncated = true;
            return ControlFlow::Break(());
        }
        count += 1;
        let mut piece = line.text();
        if line.newline {
            piece.push('\n');
        }
        if text.len() + piece.len() <= cap {
            text.push_str(&piece);
            next = line.end;
            return ControlFlow::Continue(());
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
        ControlFlow::Break(())
    });
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
    let mut stopped_at = None;
    window.each_line(&mut |line| {
        let text = line.text();
        if !regex.is_match(&text) {
            return ControlFlow::Continue(());
        }
        let text: String = text.chars().take(MATCH_CHARS).collect();
        if !matches.is_empty()
            && (matches.len() == MATCHES || used + text.len() + MATCH_OVERHEAD > cap)
        {
            stopped_at = Some(line.start);
            return ControlFlow::Break(());
        }
        used += text.len() + MATCH_OVERHEAD;
        matches.push(Match {
            offset: line.start,
            text,
        });
        ControlFlow::Continue(())
    });
    Ok(Search {
        matches,
        truncated: stopped_at.is_some(),
        next: stopped_at.unwrap_or(window.end),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A log of lines `z` whose first `FILLER + cut` bytes are evicted, with `scene` starting
    /// `cut` bytes before the first retained byte; pushed in chunks that do not line up with it.
    fn evicted_log(scene: &[u8], cut: usize) -> (Log, u64) {
        const FILLER: usize = 7;
        let evicted = FILLER + cut;
        let tail = LOG_BYTES + evicted - FILLER - scene.len();
        let mut bytes = b"f".repeat(FILLER - 2);
        bytes.extend(b"\r\n");
        bytes.extend(scene);
        bytes.extend(b"z\r\n".repeat(tail / 3));
        bytes.extend(match tail % 3 {
            0 => &b""[..],
            1 => b"\n",
            _ => b"\r\n",
        });
        assert_eq!(bytes.len(), LOG_BYTES + evicted);
        let mut log = Log::default();
        bytes.chunks(4093).for_each(|chunk| log.push(chunk));
        (log, evicted as u64)
    }

    #[test]
    fn x14_a_prefix_evicted_inside_an_escape_or_character_is_replayed_by_the_parser() {
        // CSI is bytes 0-4, "red" 5-7, an OSC 8-14, "é" 15-16, "!" 17, CRLF 18-19. A character
        // is read while the window holds its last byte, so an OSC cut open shows nothing and
        // "é" cut between its bytes is still whole.
        let scene = "\x1b[31mred\x1b]0;ti\x07é!\r\n".as_bytes();
        for (cut, shown) in [
            (0, "red\u{e9}!"),
            (2, "red\u{e9}!"),
            (6, "ed\u{e9}!"),
            (10, "\u{e9}!"),
            (16, "\u{e9}!"),
            (17, "!"),
        ] {
            let (log, evicted) = evicted_log(scene, cut);
            assert_eq!(log.start(), evicted, "{cut}");
            let got = read(&log.from(0).unwrap(), REPLY_BYTES);
            assert_eq!(got.from, evicted, "{cut}");
            assert!(got.truncated, "{cut}");
            let head = format!("{shown}\nz\nz\n");
            assert!(got.text.starts_with(&head), "{cut}: {:?}", &got.text[..16]);
            // The first line ends at its LF, 20 - `cut` bytes in, and `next` is the end of the last whole line.
            let found = search(&log.from(0).unwrap(), "^z$", REPLY_BYTES).unwrap();
            assert_eq!(found.matches[0].offset, evicted + 20 - cut as u64, "{cut}");
        }
    }
}
