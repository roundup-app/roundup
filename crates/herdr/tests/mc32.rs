//! MC32: files are read and written through herdr-core's file methods, against a fake core that
//! lists the methods `schema/herdr-core-0.1.20.json` advertises and answers with its recorded errors.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use herdr::{Conn, Edit, Error};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, duplex};

const SCHEMA: &str = include_str!("../schema/herdr-core-0.1.20.json");

fn frame(payload: &Value) -> Vec<u8> {
    let p = serde_json::to_vec(payload).unwrap();
    let mut v = 0u32.to_le_bytes().to_vec();
    v.push(0);
    v.extend_from_slice(&(p.len() as u32).to_le_bytes());
    v.extend(p);
    v
}

/// The error object the schema records for `method` with error `kind`.
fn recorded(method: &str, kind: &str) -> Value {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    schema["methods"][method]["samples"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|s| {
            s["error"]["data"]["kind"]
                .eq(kind)
                .then(|| s["error"].clone())
        })
        .unwrap()
}

/// A core listing `methods`, holding `files`, and recording every method it is called with.
fn fake_core(
    methods: Vec<String>,
    files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    seen: Arc<Mutex<Vec<String>>>,
) -> (tokio::io::DuplexStream, tokio::io::DuplexStream) {
    let (mac_r, mut core_w) = duplex(1 << 16);
    let (core_r, mac_w) = duplex(1 << 16);
    tokio::spawn(async move {
        let mut r = BufReader::new(core_r);
        let mut line = String::new();
        r.read_line(&mut line).await.unwrap();
        let hello = json!({"jsonrpc":"2.0","id":0,"result":{"generation":1,"version":"0.1.20","framed":true,"methods":methods}});
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
            let method = req["method"].as_str().unwrap().to_owned();
            seen.lock().unwrap().push(method.clone());
            let path = req["params"]["path"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let reply = {
                let mut files = files.lock().unwrap();
                match method.as_str() {
                    "file.write" if path.starts_with("/ro/") => {
                        json!({"error": recorded("file.write", "io")})
                    }
                    "file.write" => {
                        let data = req["params"]["data"].as_str().unwrap();
                        let bytes = base64::engine::general_purpose::STANDARD
                            .decode(data)
                            .unwrap();
                        let n = bytes.len();
                        files.insert(path.clone(), bytes);
                        json!({"result": {"path": path, "bytes": n}})
                    }
                    "file.read" => match files.get(&path) {
                        None => json!({"error": recorded("file.read", "not_found")}),
                        Some(b) => {
                            let text = String::from_utf8(b.clone()).unwrap();
                            let lines = text.lines().count();
                            json!({"result": {"text": text, "first": 1, "last": lines, "lines": lines}})
                        }
                    },
                    "file.edit" => match files.get_mut(&path) {
                        None => json!({"error": recorded("file.edit", "not_found")}),
                        Some(b) => {
                            let mut text = String::from_utf8(b.clone()).unwrap();
                            for e in req["params"]["edits"].as_array().unwrap() {
                                text = text.replacen(
                                    e["old"].as_str().unwrap(),
                                    e["new"].as_str().unwrap(),
                                    1,
                                );
                            }
                            *b = text.into_bytes();
                            json!({"result": {"path": path, "bytes": b.len()}})
                        }
                    },
                    _ => {
                        json!({"error": {"code": -32000, "data": {"kind": "unexpected", "hint": ""}, "message": method}})
                    }
                }
            };
            let mut msg = json!({"jsonrpc":"2.0","id":req["id"]});
            msg.as_object_mut()
                .unwrap()
                .extend(reply.as_object().unwrap().clone());
            core_w.write_all(&frame(&msg)).await.unwrap();
        }
    });
    (mac_r, mac_w)
}

fn advertised() -> Vec<String> {
    let schema: Value = serde_json::from_str(SCHEMA).unwrap();
    serde_json::from_value(schema["advertised"].clone()).unwrap()
}

struct Core {
    conn: Conn,
    seen: Arc<Mutex<Vec<String>>>,
}

async fn core(methods: Vec<String>) -> Core {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (r, w) = fake_core(methods, Arc::default(), seen.clone());
    let conn = Conn::over(r, w, Duration::from_secs(2)).await.unwrap();
    Core { conn, seen }
}

#[tokio::test]
async fn mc32_read_and_write_use_file_methods() {
    let c = core(advertised()).await;
    let bytes = "alpha\nbeta\ngamma\n".as_bytes();
    assert_eq!(
        c.conn.file_write("/w/a.txt", None, bytes).await.unwrap(),
        17
    );
    assert_eq!(
        c.conn.file_read("/w/a.txt", None).await.unwrap().as_bytes(),
        bytes
    );
    let edit = Edit {
        old: "beta".into(),
        new: "BETA".into(),
    };
    c.conn.file_edit("/w/a.txt", None, &[edit]).await.unwrap();
    assert_eq!(
        c.conn.file_read("/w/a.txt", None).await.unwrap(),
        "alpha\nBETA\ngamma\n"
    );
    // Only file methods reached the core: no terminal.run, so no exec.
    let seen = c.seen.lock().unwrap().clone();
    assert!(seen.iter().all(|m| m.starts_with("file.")), "{seen:?}");
    assert_eq!(seen.len(), 4);
}

#[tokio::test]
async fn mc32_file_error_is_coded() {
    let c = core(advertised()).await;
    for (err, kind) in [
        (
            c.conn.file_read("/w/missing.txt", None).await.unwrap_err(),
            "not_found",
        ),
        (
            c.conn
                .file_write("/ro/x.txt", None, b"no")
                .await
                .unwrap_err(),
            "io",
        ),
    ] {
        match err {
            Error::Rpc(e) => {
                assert_eq!((e.code, e.kind.as_str()), (-32000, kind));
                assert!(!e.message.is_empty());
            }
            other => panic!("{other:?}"),
        }
    }
    let Error::Rpc(e) = c.conn.file_read("/w/missing.txt", None).await.unwrap_err() else {
        panic!()
    };
    assert_eq!(e.hint, "check the path, or hc exec ls");
}

#[tokio::test]
async fn mc32_no_file_method_is_coded_error() {
    let methods = advertised()
        .into_iter()
        .filter(|m| !m.starts_with("file."))
        .collect();
    let c = core(methods).await;
    let err = c.conn.file_read("/w/a.txt", None).await.unwrap_err();
    assert!(matches!(err, Error::NoMethod(ref m) if m == "file.read"));
    assert_eq!(err.code(), "core_no_method");
    // The core was never called: no file call, and no exec as a stand-in.
    assert!(c.seen.lock().unwrap().is_empty());
}
