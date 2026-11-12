//! MC14: a Terminal on a remote Machine outlives its ssh. The core replays no output of the outage
//! and offers no byte offset to resume from, so a reattach asks for `history:N` and the viewer drops
//! from the repaint what it already delivered, found by content.

/// Complete lines of the delivered tail that anchor the seam.
const ANCHOR_LINES: usize = 3;
/// How much of the delivered output is kept to find the seam in.
const TAIL: usize = 16 << 10;
/// The most bytes of a repaint kept back while its seam is looked for.
const KEEP: usize = 4 << 20;

/// A repaint kept back until the lines last delivered are found in it, and dropped up to them.
#[derive(Default)]
pub(super) struct Seam {
    tail: Vec<u8>,
    /// The repaint so far; `None` outside a reattach.
    pending: Option<Vec<u8>>,
    anchor: Vec<Vec<u8>>,
}

/// The lines of `bytes` without their line ends, each with the offset just past its newline.
fn rows(bytes: &[u8]) -> Vec<(usize, &[u8])> {
    let mut end = 0;
    bytes
        .split_inclusive(|b| *b == b'\n')
        .filter(|row| row.ends_with(b"\n"))
        .map(|row| {
            end += row.len();
            let text = row.strip_suffix(b"\n").unwrap_or(row);
            (end, text.strip_suffix(b"\r").unwrap_or(text))
        })
        .collect()
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

    /// A new attach begins: keep its repaint back until the last lines delivered are found in it.
    pub(super) fn reattached(&mut self) {
        let mut anchor: Vec<Vec<u8>> = rows(&self.tail)
            .into_iter()
            .map(|(_, text)| text)
            .filter(|text| !text.is_empty())
            .map(<[u8]>::to_vec)
            .collect();
        anchor.drain(..anchor.len().saturating_sub(ANCHOR_LINES));
        self.anchor = anchor;
        self.pending = Some(Vec::new());
    }

    /// Whether a repaint is still being kept back.
    pub(super) fn waiting(&self) -> bool {
        self.pending.is_some()
    }

    /// Take `bytes` from the stream: what to deliver now (nothing while a repaint is kept back).
    pub(super) fn feed(&mut self, bytes: Vec<u8>) -> Vec<u8> {
        let Some(pending) = self.pending.as_mut() else {
            return bytes;
        };
        pending.extend_from_slice(&bytes);
        let size = pending.len();
        match self.after_anchor() {
            Some(rest) => {
                self.pending = None;
                rest
            }
            None if self.anchor.is_empty() || size > KEEP => self.give_up(),
            None => Vec::new(),
        }
    }

    /// The stream went quiet: deliver the repaint whole, with a note that a gap may lie in it.
    pub(super) fn give_up(&mut self) -> Vec<u8> {
        let repaint = self.pending.take().unwrap_or_default();
        if self.anchor.is_empty() || repaint.is_empty() {
            return repaint;
        }
        let mut out = b"\r\n\x1b[2m[output while disconnected may be missing]\x1b[0m\r\n".to_vec();
        out.extend(repaint);
        out
    }

    /// What follows the last place the anchor's lines run in order in the repaint. A line may carry
    /// the repaint's own escape sequence before its text, so lines match by their end.
    fn after_anchor(&self) -> Option<Vec<u8>> {
        let pending = self.pending.as_ref()?;
        let k = self.anchor.len();
        if k == 0 {
            return None;
        }
        let rows = rows(pending);
        let at = rows.windows(k).rposition(|window| {
            window
                .iter()
                .zip(&self.anchor)
                .all(|((_, row), want)| row.ends_with(want))
        })?;
        let (end, _) = rows.get(at + k - 1)?;
        Some(pending.get(*end..)?.to_vec())
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
        assert!(!seam.waiting());
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
        assert!(!seam.waiting());
    }
}
