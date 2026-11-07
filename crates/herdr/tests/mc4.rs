//! MC4: an unreachable machine layer fails loud, against a fake core replaying the spike's
//! recorded frames (`spikes/herdr-core-client/raw/q1.txt`: hello, error shape, refusal).
use std::time::Duration;

use herdr::{Conn, Error};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, duplex};

const T: Duration = Duration::from_millis(300);
const HELLO: &str = r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0.1.18","framed":true,"methods":["machine.list","machine.add"]}}"#;
const REFUSED: &str = r#"{"error":{"code":-32000,"data":{"hint":"this core speaks generation 1","kind":"unsupported_generation"},"message":"protocol generation 2 not supported"},"id":0,"jsonrpc":"2.0"}"#;

fn frame(payload: &Value) -> Vec<u8> {
    let p = serde_json::to_vec(payload).unwrap();
    let mut v = 0u32.to_le_bytes().to_vec();
    v.push(0);
    v.extend_from_slice(&(p.len() as u32).to_le_bytes());
    v.extend(p);
    v
}

/// A core that answers hello with `hello_line`, then serves framed requests from `answer`.
fn fake_core(
    hello_line: &'static str,
    answer: fn(&Value) -> Option<Vec<Value>>,
) -> (tokio::io::DuplexStream, tokio::io::DuplexStream) {
    let (mac_r, mut core_w) = duplex(1 << 16);
    let (core_r, mac_w) = duplex(1 << 16);
    tokio::spawn(async move {
        let mut r = BufReader::new(core_r);
        let mut line = String::new();
        r.read_line(&mut line).await.unwrap();
        core_w
            .write_all(format!("{hello_line}\n").as_bytes())
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
            for msg in answer(&req).unwrap_or_default() {
                core_w.write_all(&frame(&msg)).await.unwrap();
            }
        }
    });
    (mac_r, mac_w)
}

fn list_core(req: &Value) -> Option<Vec<Value>> {
    let id = &req["id"];
    match req["method"].as_str()? {
        "machine.list" => Some(vec![
            json!({"jsonrpc":"2.0","method":"machine.changed","params":{}}),
            json!({"jsonrpc":"2.0","id":id,"result":{"machines":[{"name":"herdr-spike","status":"up"},{"name":"roundup-ci-control","status":"up"}]}}),
        ]),
        "machine.add" => Some(vec![
            json!({"jsonrpc":"2.0","id":id,"result":{"name":req["params"]["name"]}}),
        ]),
        _ => Some(vec![
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"data":{"hint":"see `hc ls --all`","kind":"not_found"},"message":"no terminal"}}),
        ]),
    }
}

#[tokio::test]
async fn mc4_machine_list_returns_recorded_list_and_typed_errors() {
    let (r, w) = fake_core(HELLO, list_core);
    let mut conn = Conn::over(r, w, T).await.unwrap();
    assert_eq!(conn.hello.version, "0.1.18");
    let names: Vec<_> = conn
        .machine_list()
        .await
        .unwrap()
        .into_iter()
        .map(|m| m.name)
        .collect();
    assert_eq!(names, ["herdr-spike", "roundup-ci-control"]);
    assert_eq!(
        conn.events().unwrap().recv().await.unwrap().method,
        "machine.changed"
    );
    assert_eq!(
        conn.machine_add("box.example").await.unwrap(),
        json!({"name":"box.example"})
    );
    let Err(Error::Rpc(e)) = conn.call("terminal.get", json!({})).await else {
        panic!("want Rpc")
    };
    assert_eq!(
        (e.code, e.kind.as_str(), e.hint.as_str()),
        (-32000, "not_found", "see `hc ls --all`")
    );
}

#[tokio::test]
async fn mc4_missing_refused_silent_return_coded_error() {
    // Refused: the core rejects generation 1.
    let (r, w) = fake_core(REFUSED, |_| None);
    let refused = Conn::over(r, w, T).await.err().unwrap();
    assert!(matches!(&refused, Error::Refused(e) if e.kind == "unsupported_generation"));

    // Closed: the pipe ends before any answer.
    let (r, core_w) = duplex(64);
    drop(core_w);
    let closed = Conn::over(r, tokio::io::sink(), T).await.err().unwrap();
    assert!(matches!(closed, Error::Closed));

    // Silent: the core reads hello and never answers.
    let (_core_w, r) = duplex(64);
    let (_core_r, w) = duplex(64);
    let silent = Conn::over(r, w, Duration::from_millis(50))
        .await
        .err()
        .unwrap();
    assert!(matches!(silent, Error::TimedOut));

    // Missing: no program, and a shell that cannot find herdr-core (exit 127).
    let none = Conn::spawn(tokio::process::Command::new("/nonexistent/herdr-core"), T)
        .await
        .err()
        .unwrap();
    assert!(matches!(none, Error::Missing));
    let mut sh = tokio::process::Command::new("sh");
    sh.args(["-c", "exit 127"]);
    assert!(matches!(
        Conn::spawn(sh, T).await.err().unwrap(),
        Error::Missing
    ));

    let codes: Vec<_> = [&refused, &closed, &silent, &none]
        .iter()
        .map(|e| e.code())
        .collect();
    assert_eq!(
        codes,
        [
            "unsupported_generation",
            "core_closed",
            "core_silent",
            "core_missing"
        ]
    );
}

#[tokio::test]
async fn mc4_connect_entry_points_fail_typed_without_a_core() {
    // CI has no herdr-core on PATH, and no host answers `.invalid`.
    if std::env::var_os("PATH")
        .is_some_and(|p| std::env::split_paths(&p).any(|d| d.join("herdr-core").exists()))
    {
        return;
    }
    assert!(matches!(
        Conn::connect_local(T).await.err().unwrap(),
        Error::Missing
    ));
    assert!(
        Conn::connect_ssh("nohost.invalid", Duration::from_secs(10))
            .await
            .is_err()
    );
}
