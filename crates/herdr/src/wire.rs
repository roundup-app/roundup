use tokio::io::{AsyncRead, AsyncReadExt};

use crate::error::{Error, Result};

pub(crate) const DATA: u8 = 0;
pub(crate) const CREDIT: u8 = 1;
pub(crate) const CLOSE: u8 = 2;
pub(crate) const RESIZE: u8 = 3;

/// The longest frame payload read; a longer header is a corrupt or hostile stream.
pub(crate) const MAX_FRAME: usize = 16 << 20;

pub(crate) fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(9 + payload.len());
    v.extend_from_slice(&channel.to_le_bytes());
    v.push(kind);
    v.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    v.extend_from_slice(payload);
    v
}

pub(crate) async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<(u32, u8, Vec<u8>)> {
    let mut h = [0u8; 9];
    r.read_exact(&mut h).await?;
    let channel = u32::from_le_bytes([h[0], h[1], h[2], h[3]]);
    let len = u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize;
    if len > MAX_FRAME {
        return Err(Error::Protocol(format!(
            "frame of {len} bytes exceeds the {MAX_FRAME} byte cap"
        )));
    }
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload).await?;
    Ok((channel, h[4], payload))
}
