//! MC72: a build with the `test-support` feature refuses, unsent, a request the pinned schema does
//! not allow, so no fake core can take a param the real core rejects.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::sync::{Arc, Mutex};
use std::time::Duration;

use herdr::{Conn, Error};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, duplex};

/// A core that answers every request with `{}` and records each one it receives, so only the
/// client's own check can refuse a request.
async fn core() -> (Conn, Arc<Mutex<Vec<Value>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&seen);
    let (mac_r, mut core_w) = duplex(1 << 16);
    let (core_r, mac_w) = duplex(1 << 16);
    tokio::spawn(async move {
        let mut r = BufReader::new(core_r);
        let mut line = String::new();
        r.read_line(&mut line).await.unwrap();
        let hello = json!({"jsonrpc":"2.0","id":0,"result":{"generation":1,"version":"0.1.21","framed":true,"methods":[]}});
        core_w
            .write_all(format!("{hello}\n").as_bytes())
            .await
            .unwrap();
        loop {
            let mut h = [0u8; 9];
            if r.read_exact(&mut h).await.is_err() {
                return;
            }
            let mut p = vec![0u8; u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize];
            r.read_exact(&mut p).await.unwrap();
            let req: Value = serde_json::from_slice(&p).unwrap();
            let reply = json!({"jsonrpc":"2.0","id":req["id"],"result":{}});
            log.lock().unwrap().push(req);
            let body = serde_json::to_vec(&reply).unwrap();
            let mut framed = 0u32.to_le_bytes().to_vec();
            framed.push(0);
            framed.extend_from_slice(&(body.len() as u32).to_le_bytes());
            framed.extend(body);
            core_w.write_all(&framed).await.unwrap();
        }
    });
    let conn = Conn::over(mac_r, mac_w, Duration::from_secs(2))
        .await
        .unwrap();
    (conn, seen)
}

#[tokio::test]
async fn mc72_a_request_the_pinned_schema_does_not_allow_is_refused_unsent() {
    let (conn, seen) = core().await;
    for (method, params) in [
        // What roundup sent before: no `machine`, and a key the schema lacks.
        ("machine.rm", json!({"name": "box"})),
        ("machine.rm", json!({"machine": "box", "extra": 1})),
        // No `target` and no `via`.
        ("machine.add", json!({"name": "box"})),
        // A method the schema holds no params for.
        ("machine.nope", json!({})),
    ] {
        match conn.call(method, params.clone()).await {
            Err(Error::Rpc(e)) => assert_eq!(
                (e.code, e.kind.as_str()),
                (-32602, "invalid_params"),
                "{method} {params}"
            ),
            other => panic!("{method} {params}: {other:?}"),
        }
    }
    // Only the request the schema allows reaches the core.
    conn.machine_rm("box").await.unwrap();
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["params"], json!({"machine": "box"}));
}
