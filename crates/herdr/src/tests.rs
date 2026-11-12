use std::time::Duration;

use crate::conn::Conn;
use crate::error::Error;
use crate::stream::{MAX_ORPHAN_BYTES, streams};
use crate::types::Ev;
use crate::wire::{CLOSE, DATA, MAX_FRAME, frame, read_frame};
use serde_json::Value;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, duplex};
use tokio::sync::oneshot;

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

/// A conn over a fake core that answers hello, then runs `script` on its write side.
async fn core_conn<F, Fut>(script: F) -> (Conn, tokio::task::JoinHandle<()>)
where
    F: FnOnce(tokio::io::DuplexStream, tokio::io::DuplexStream) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    let (mac_r, mut core_w) = duplex(1 << 20);
    let (core_r, mac_w) = duplex(1 << 20);
    let (ready_tx, ready_rx) = oneshot::channel();
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
        let _ = ready_rx.await;
        script(core_w, r.into_inner()).await;
    });
    let conn = Conn::over(mac_r, mac_w, Duration::from_secs(5))
        .await
        .unwrap();
    let _ = ready_tx.send(());
    (conn, core)
}

async fn unclaimed_settles(conn: &Conn, want: impl Fn((usize, usize)) -> bool) -> (usize, usize) {
    for _ in 0..100_000 {
        let h = streams(&conn.channels).unclaimed();
        if want(h) {
            return h;
        }
        tokio::task::yield_now().await;
    }
    streams(&conn.channels).unclaimed()
}

#[tokio::test]
async fn mc17_orphans_freed_on_close_and_on_connection_drop() {
    let (conn, core) = core_conn(|mut w, _r| async move {
        w.write_all(&frame(5, DATA, b"a")).await.unwrap();
        w.write_all(&frame(6, DATA, b"b")).await.unwrap();
        w.write_all(&frame(5, CLOSE, b"{}")).await.unwrap();
        w.flush().await.unwrap();
        // Hold the pipe open until the test has looked, then drop it.
        tokio::time::sleep(Duration::from_millis(500)).await;
    })
    .await;
    // The CLOSE frees channel 5's frames; channel 6's stay until the drop.
    assert_eq!(unclaimed_settles(&conn, |h| h == (1, 1)).await, (1, 1));
    core.await.unwrap();
    assert_eq!(unclaimed_settles(&conn, |h| h.0 == 0).await, (0, 0));
}

#[tokio::test]
async fn mc17_unclaimed_frames_are_bounded() {
    let chunk = vec![7u8; 1 << 20];
    let (conn, _core) = core_conn(move |mut w, _r| async move {
        for i in 0..6u32 {
            w.write_all(&frame(10 + i % 2, DATA, &chunk)).await.unwrap();
        }
        w.flush().await.unwrap();
        tokio::time::sleep(Duration::from_secs(5)).await;
    })
    .await;
    assert_eq!(
        unclaimed_settles(&conn, |h| h.1 >= MAX_ORPHAN_BYTES).await,
        (4, MAX_ORPHAN_BYTES)
    );
}

#[tokio::test]
async fn mc17_attach_after_first_paint_gets_frames_in_order() {
    let (conn, _core) = core_conn(|mut w, mut r| async move {
        let mut buf = [0u8; 512];
        let n = r.read(&mut buf).await.unwrap();
        let id = serde_json::from_slice::<Value>(&buf[9..n]).unwrap()["id"].clone();
        w.write_all(&frame(3, DATA, b"one")).await.unwrap();
        w.write_all(&frame(3, DATA, b"two")).await.unwrap();
        let reply = json!({"jsonrpc":"2.0","id":id,"result":{"channel":3}});
        let body = serde_json::to_vec(&reply).unwrap();
        w.write_all(&frame(0, DATA, &body)).await.unwrap();
        w.flush().await.unwrap();
        tokio::time::sleep(Duration::from_secs(2)).await;
    })
    .await;
    let mut stream = conn.attach("t", 80, 24, 0).await.unwrap();
    assert_eq!(stream.next().await, Some(Ev::Data(b"one".to_vec())));
    assert_eq!(stream.next().await, Some(Ev::Data(b"two".to_vec())));
    assert_eq!(streams(&conn.channels).unclaimed(), (0, 0));
}
