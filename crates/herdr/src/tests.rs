use std::time::Duration;

use crate::conn::Conn;
use crate::error::Error;
use crate::wire::{MAX_FRAME, read_frame};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, duplex};

fn header(len: u32) -> Vec<u8> {
    let mut h = vec![0u8; 5];
    h.extend_from_slice(&len.to_le_bytes());
    h
}

#[tokio::test]
async fn mc47_an_oversized_frame_is_a_protocol_error() {
    let mut r = &header(u32::MAX)[..];
    match read_frame(&mut r).await {
        Err(Error::Protocol(m)) => assert!(m.contains(&u32::MAX.to_string())),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn mc47_a_frame_at_the_cap_is_read() {
    let mut bytes = header(MAX_FRAME as u32);
    bytes.extend((0..MAX_FRAME).map(|i| (i % 251) as u8));
    let mut r = &bytes[..];
    let (_, _, p) = read_frame(&mut r).await.unwrap();
    assert!(p.iter().enumerate().all(|(i, b)| *b == (i % 251) as u8) && p.len() == MAX_FRAME);
}

async fn closed_conn() -> Conn {
    let (mac_r, mut core_w) = duplex(1 << 16);
    let (core_r, mac_w) = duplex(1 << 16);
    let core = tokio::spawn(async move {
        let mut r = tokio::io::BufReader::new(core_r);
        let mut line = String::new();
        r.read_line(&mut line).await.unwrap();
        let hello =
            r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0","methods":[]}}"#;
        core_w
            .write_all(format!("{hello}\n").as_bytes())
            .await
            .unwrap();
    });
    let conn = Conn::over(mac_r, mac_w, Duration::from_secs(5))
        .await
        .unwrap();
    core.await.unwrap();
    // A waiter fails once the reader has cleared `pending`, so `closed` is set after it.
    if let Ok(rx) = conn.register(0) {
        assert!(rx.await.is_err());
    }
    conn
}

#[tokio::test]
async fn mc48_a_call_after_the_pipe_closed_is_closed_not_timed_out() {
    let conn = closed_conn().await;
    let t = std::time::Instant::now();
    assert!(matches!(
        conn.call("machine.list", json!({})).await,
        Err(Error::Closed)
    ));
    assert!(t.elapsed() < Duration::from_secs(1));
}

#[tokio::test]
async fn mc48_a_call_registered_after_the_clear_is_closed() {
    let conn = closed_conn().await;
    assert!(matches!(conn.register(99), Err(Error::Closed)));
}
