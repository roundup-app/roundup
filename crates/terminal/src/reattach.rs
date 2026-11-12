//! MC14: a Terminal on a remote Machine outlives its ssh. The core replays no output of the outage
//! and offers no byte offset to resume from, so a reattach asks for `history:N` and the viewer drops
//! from the repaint what it already delivered, found by content.

/// Complete lines of the delivered tail that anchor the seam.
const ANCHOR_LINES: usize = 3;
/// How much of the delivered output is kept to find the seam in.
const TAIL: usize = 16 << 10;
/// The repaint is held at most this long (bytes) while its seam is looked for.
const HOLD: usize = 4 << 20;

/// What a repaint is held for, and what it is dropped by.
#[derive(Default)]
pub(super) struct Seam {
    tail: Vec<u8>,
    held: Option<Vec<u8>>,
    anchor: Vec<Vec<u8>>,
}

fn lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes
        .split(|b| *b == b'\n')
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
}

impl Seam {
    /// Note `bytes` as delivered, so the next reattach can find where they end.
    pub(super) fn delivered(&mut self, bytes: &[u8]) {
        self.tail.extend_from_slice(bytes);
        if self.tail.len() > TAIL {
            let cut = self.tail.len() - TAIL;
            self.tail.drain(..cut);
        }
    }

    /// A new attach begins: hold its repaint until the last lines delivered are found in it.
    pub(super) fn reattached(&mut self) {
        let complete = self
            .tail
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |i| i + 1);
        let mut anchor: Vec<Vec<u8>> = lines(&self.tail[..complete])
            .filter(|line| !line.is_empty())
            .map(<[u8]>::to_vec)
            .collect();
        anchor.drain(..anchor.len().saturating_sub(ANCHOR_LINES));
        self.anchor = anchor;
        self.held = Some(Vec::new());
    }

    /// Whether a repaint is still being held.
    pub(super) fn holding(&self) -> bool {
        self.held.is_some()
    }

    /// Take `bytes` from the stream: what to deliver now (empty while a repaint is held).
    pub(super) fn feed(&mut self, bytes: Vec<u8>) -> Vec<u8> {
        let Some(held) = self.held.as_mut() else {
            return bytes;
        };
        held.extend_from_slice(&bytes);
        let size = held.len();
        match self.after_anchor() {
            Some(rest) => {
                self.held = None;
                rest
            }
            None if self.anchor.is_empty() || size > HOLD => self.give_up(),
            None => Vec::new(),
        }
    }

    /// The stream went quiet: deliver the repaint whole, with a note that a gap may lie in it.
    pub(super) fn give_up(&mut self) -> Vec<u8> {
        let held = self.held.take().unwrap_or_default();
        if self.anchor.is_empty() || held.is_empty() {
            return held;
        }
        let mut out = b"\r\n\x1b[2m[output while disconnected may be missing]\x1b[0m\r\n".to_vec();
        out.extend(held);
        out
    }

    /// What follows the last place the anchor's lines run in order in the held repaint. A line may
    /// carry the repaint's own escape sequence before its text, so lines match by their end.
    fn after_anchor(&self) -> Option<Vec<u8>> {
        let held = self.held.as_ref()?;
        if self.anchor.is_empty() {
            return None;
        }
        // Only a line ended by a newline is complete; the last segment is still arriving.
        let complete = held.iter().rposition(|b| *b == b'\n').map(|i| i + 1)?;
        let mut starts = vec![0usize];
        starts.extend(
            held[..complete]
                .iter()
                .enumerate()
                .filter(|(_, b)| **b == b'\n')
                .map(|(i, _)| i + 1),
        );
        let rows: Vec<&[u8]> = starts
            .windows(2)
            .map(|w| {
                let line = &held[w[0]..w[1] - 1];
                line.strip_suffix(b"\r").unwrap_or(line)
            })
            .collect();
        let k = self.anchor.len();
        let at = (k..=rows.len()).rev().find(|end| {
            rows[end - k..*end]
                .iter()
                .zip(&self.anchor)
                .all(|(row, want)| row.ends_with(want))
        })?;
        Some(held[starts[at]..].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numbered(range: std::ops::RangeInclusive<u32>) -> Vec<u8> {
        range
            .flat_map(|n| format!("tick {n}\r\n").into_bytes())
            .collect()
    }

    #[test]
    fn mc14_gap_filled_from_history_without_duplicate_lines() {
        let mut seam = Seam::default();
        let seen = numbered(1..=10);
        seam.delivered(&seen);
        seam.reattached();
        // The core repaints the screen: lines 8..=10 were seen, 11..=20 came during the outage, and
        // the repaint ends inside the next tick.
        let mut repaint = b"\x1b[!p".to_vec();
        repaint.extend(numbered(8..=20));
        let (head, tail) = repaint.split_at(repaint.len() / 2);
        let mut out = seam.feed(head.to_vec());
        out.extend(seam.feed(tail.to_vec()));
        out.extend(seam.feed(numbered(21..=22)));
        assert_eq!(out, numbered(11..=22));
        assert!(!seam.holding());
    }

    #[test]
    fn mc14_a_repaint_without_the_seam_is_delivered_with_a_note() {
        let mut seam = Seam::default();
        seam.delivered(&numbered(1..=3));
        seam.reattached();
        assert!(seam.feed(numbered(90..=95)).is_empty());
        let out = String::from_utf8(seam.give_up()).unwrap();
        assert!(out.contains("may be missing"));
        assert!(out.contains("tick 90") && out.contains("tick 95"));
    }

    #[test]
    fn mc14_a_first_attach_holds_nothing_back() {
        let mut seam = Seam::default();
        seam.reattached();
        assert_eq!(seam.feed(b"first paint".to_vec()), b"first paint");
        assert!(!seam.holding());
    }
}
