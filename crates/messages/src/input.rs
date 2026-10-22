//! B32: what the user's typed bytes do to the count of unsent Terminal input.

/// B32: what `bytes` the user wrote do to the count of unsent input: whether one ends it (a `\r`
/// that submits, Ctrl-U or Ctrl-C) and whether input remains after the last such byte. Escape
/// sequences (focus and mouse reports, arrow keys) are not text and are not counted.
pub(crate) fn input_effect(bytes: &[u8]) -> (bool, bool) {
    let (mut ended, mut tail) = (false, false);
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' | 0x15 | 0x03 => {
                ended = true;
                tail = false;
            }
            0x1b => {
                // CSI: ESC [ params final(0x40..=0x7e); SS3: ESC O final.
                match bytes.get(i + 1) {
                    Some(b'[') => {
                        i += 2;
                        while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                            i += 1;
                        }
                    }
                    Some(b'O') => i += 2,
                    // U399: ESC then a byte is one Alt chord (`\x1b\r` is ⇧⏎'s new line), input and never a submit.
                    Some(_) => {
                        i += 1;
                        tail = true;
                    }
                    None => {}
                }
            }
            _ => tail = true,
        }
        i += 1;
    }
    (ended, tail)
}
