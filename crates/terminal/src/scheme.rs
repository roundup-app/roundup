//! X17: what the Daemon answers a program that asks its Terminal for colours.
//!
//! The App tells the Daemon its scheme (`terminal.scheme`); from then on the Daemon answers OSC 10
//! and 11 (foreground and background), DA1 (the end marker programs send after a colour query) and
//! DSR 996 (the scheme) for every Terminal, shown or not, and tells each program that turned on
//! mode 2031 whenever the scheme changes. Before the first call it answers nothing.

use contracts::terminal::{Scheme, SchemeParams};
use rpc::RpcError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Query {
    Foreground,
    Background,
    Version,
    DeviceAttributes,
    Scheme,
}

/// What a program's bytes asked of its Terminal that this module handles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Request {
    Ask(Query),
    /// Mode 2031: the program does (true) or does not (false) want a notice on each scheme change.
    Notices(bool),
    /// U5984: a Kitty graphics query with this image id.
    Kitty(u32),
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Palette {
    pub scheme: Scheme,
    background: [u8; 3],
    foreground: [u8; 3],
}

impl Palette {
    pub fn parse(params: &SchemeParams) -> Result<Self, RpcError> {
        Ok(Self {
            scheme: params.scheme,
            background: hex(&params.background)?,
            foreground: hex(&params.foreground)?,
        })
    }

    pub fn params(self) -> SchemeParams {
        let colour = |[r, g, b]: [u8; 3]| format!("#{r:02x}{g:02x}{b:02x}");
        SchemeParams {
            scheme: self.scheme,
            background: colour(self.background),
            foreground: colour(self.foreground),
        }
    }

    pub fn answer(&self, query: Query) -> Vec<u8> {
        match query {
            Query::Foreground => osc_colour(10, self.foreground),
            Query::Background => osc_colour(11, self.background),
            Query::Version => version(),
            Query::DeviceAttributes => b"\x1b[?62;22c".to_vec(),
            Query::Scheme => self.notice(),
        }
    }

    /// DSR 997: 1 for dark, 2 for light. The reply to a query and the notice of a change.
    pub fn notice(&self) -> Vec<u8> {
        let code = match self.scheme {
            Scheme::Dark => 1,
            Scheme::Light => 2,
        };
        format!("\x1b[?997;{code}n").into_bytes()
    }
}

/// XTVERSION: names roundup, never another terminal, so a program takes only the paths the Terminal draws.
/// It needs no scheme, so it is answered before the App sets one.
pub(crate) fn version() -> Vec<u8> {
    b"\x1bP>|roundup\x1b\\".to_vec()
}

/// U5984: the Daemon answers a Kitty graphics query (`ESC _ G ... a=q ... ESC \`) in the stream's
/// order, so its `OK` reaches the program before DA1's reply; the App's emulator draws the images.
/// U6145: only a query for the direct medium (`t=d`, the default) is answered; the emulator reads no
/// file or shared memory and replies with its own error to one.
pub(crate) fn kitty_ok(id: u32) -> Vec<u8> {
    format!("\x1b_Gi={id};OK\x1b\\").into_bytes()
}

#[derive(Default)]
enum Apc {
    #[default]
    Ground,
    Escape,
    Body,
    BodyEscape,
}

/// Finds Kitty graphics queries across chunk boundaries, keeping only each command's control keys.
#[derive(Default)]
pub(crate) struct KittyScan {
    phase: Apc,
    keys: Vec<u8>,
    payload: bool,
}

const KEYS_MAX: usize = 128;

impl KittyScan {
    pub(crate) fn feed(&mut self, bytes: &[u8], out: &mut Vec<Request>) {
        for &byte in bytes {
            self.phase = match (&self.phase, byte) {
                (Apc::Ground | Apc::Escape, 0x1b) => Apc::Escape,
                (Apc::Escape, b'_') => {
                    self.keys.clear();
                    self.payload = false;
                    Apc::Body
                }
                (Apc::Body | Apc::BodyEscape, 0x1b) => Apc::BodyEscape,
                (Apc::BodyEscape, b'\\') => {
                    out.extend(self.finish());
                    Apc::Ground
                }
                (Apc::Body | Apc::BodyEscape, byte) => {
                    if byte == b';' || self.keys.len() >= KEYS_MAX {
                        self.payload = true;
                    }
                    if !self.payload {
                        self.keys.push(byte);
                    }
                    Apc::Body
                }
                _ => Apc::Ground,
            };
        }
    }

    fn finish(&mut self) -> Option<Request> {
        let keys = std::mem::take(&mut self.keys);
        let rest = keys.strip_prefix(b"G")?;
        let mut query = false;
        let mut direct = true;
        let mut id = 0u32;
        for pair in rest.split(|byte| *byte == b',') {
            match pair {
                b"a=q" => query = true,
                [b't', b'=', medium @ ..] => direct = medium == b"d",
                [b'i', b'=', digits @ ..] => id = std::str::from_utf8(digits).ok()?.parse().ok()?,
                _ => {}
            }
        }
        (query && direct).then_some(Request::Kitty(id))
    }
}

fn osc_colour(code: u8, [r, g, b]: [u8; 3]) -> Vec<u8> {
    // X11 colour syntax with 16 bits a channel; a byte repeated is how xterm widens one.
    format!("\x1b]{code};rgb:{r:02x}{r:02x}/{g:02x}{g:02x}/{b:02x}{b:02x}\x1b\\").into_bytes()
}

fn hex(text: &str) -> Result<[u8; 3], RpcError> {
    let digits = text
        .strip_prefix('#')
        .filter(|digits| digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| {
            RpcError::new(
                rpc::code::INVALID_PARAMS,
                format!("{text:?} is not a #rrggbb colour"),
            )
        })?;
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).expect("checked hex");
    Ok([channel(0), channel(2), channel(4)])
}

/// An OSC the parser did not handle: `10;?` or `11;?`.
pub(crate) fn from_osc(params: &[&[u8]]) -> Option<Request> {
    match params {
        [b"10", b"?"] => Some(Request::Ask(Query::Foreground)),
        [b"11", b"?"] => Some(Request::Ask(Query::Background)),
        _ => None,
    }
}

/// A CSI the parser did not handle: XTVERSION, DA1, DSR 996, or mode 2031 set or reset.
pub(crate) fn from_csi(
    first: Option<u8>,
    second: Option<u8>,
    params: &[&[u16]],
    last: char,
) -> Option<Request> {
    match (first, second, last) {
        (Some(b'>'), None, 'q') if matches!(params, [] | [[] | [0]]) => {
            Some(Request::Ask(Query::Version))
        }
        (None, None, 'c') if matches!(params, [] | [[] | [0]]) => {
            Some(Request::Ask(Query::DeviceAttributes))
        }
        (Some(b'?'), None, 'n') if params == [&[996u16][..]] => Some(Request::Ask(Query::Scheme)),
        (Some(b'?'), None, 'h' | 'l') if params.contains(&&[2031u16][..]) => {
            Some(Request::Notices(last == 'h'))
        }
        _ => None,
    }
}

#[cfg(test)]
mod kitty_tests {
    use super::*;

    #[test]
    fn a_query_split_across_chunks_is_found_and_a_transfer_is_not() {
        let mut scan = KittyScan::default();
        let mut out = Vec::new();
        scan.feed(b"x\x1b_Gi=31,s=1,v=1,a", &mut out);
        scan.feed(b"=q,t=d,f=24;AAAA\x1b", &mut out);
        scan.feed(b"\\\x1b_Ga=T,i=2,f=100;a=q\x1b\\", &mut out);
        assert!(matches!(out.as_slice(), [Request::Kitty(31)]));
    }

    #[test]
    fn u6145_a_file_query_gets_no_ok() {
        let mut scan = KittyScan::default();
        let mut out = Vec::new();
        for medium in ["f", "t", "s"] {
            scan.feed(
                format!("\x1b_Gi=7,s=1,v=1,a=q,t={medium},f=24;AAAA\x1b\\").as_bytes(),
                &mut out,
            );
        }
        assert!(out.is_empty());
        scan.feed(
            b"\x1b_Gi=8,a=q;AAAA\x1b\\\x1b_Gi=9,a=q,t=d;AAAA\x1b\\",
            &mut out,
        );
        assert!(matches!(
            out.as_slice(),
            [Request::Kitty(8), Request::Kitty(9)]
        ));
    }
}
