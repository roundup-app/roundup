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
    DeviceAttributes,
    Scheme,
}

/// What a program's bytes asked of its Terminal that this module handles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Request {
    Ask(Query),
    /// Mode 2031: the program does (true) or does not (false) want a notice on each scheme change.
    Notices(bool),
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

    pub fn answer(&self, query: Query) -> Vec<u8> {
        match query {
            Query::Foreground => osc_colour(10, self.foreground),
            Query::Background => osc_colour(11, self.background),
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

/// A CSI the parser did not handle: DA1, DSR 996, or mode 2031 set or reset.
pub(crate) fn from_csi(
    first: Option<u8>,
    second: Option<u8>,
    params: &[&[u16]],
    last: char,
) -> Option<Request> {
    match (first, second, last) {
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
