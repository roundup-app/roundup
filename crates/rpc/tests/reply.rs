//! R16: complete results through the existing reply and Client seams.
use std::io::{BufRead, Write};
use std::os::unix::net::UnixListener;
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};

#[test]
fn r16_reply_preserves_every_rail_field_in_row_order() {
    let expected = json!([{
        "id": "door", "kind": "workstream", "name": "Door 🦀", "parent": null,
        "order": 7, "status": null, "attempt": "9223372036854775807", "status_revision": null,
        "terminal_id": null, "worktree": null, "can_resume": true, "channel": null,
        "work": null, "stray": [], "model": "model", "effort": "high", "iteration": 3
    }, {
        "id": "next", "kind": "workstream", "name": "Next", "parent": null,
        "order": 8, "status": null, "attempt": null, "status_revision": null,
        "terminal_id": null, "worktree": null, "can_resume": false, "channel": null,
        "work": null, "stray": [], "model": null, "effort": null, "iteration": 1
    }]);
    let nodes: Vec<contracts::agent::RailNode> = serde_json::from_value(expected.clone()).unwrap();
    assert_eq!(rpc::reply(&nodes).unwrap(), expected);
}

#[tokio::test]
async fn r16_client_preserves_complete_results_for_concurrent_replies() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut lines = std::io::BufReader::new(stream.try_clone().unwrap()).lines();
        let requests: Vec<Value> = (0..2)
            .map(|_| serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap())
            .collect();
        for request in requests.iter().rev() {
            let frame = json!({"jsonrpc": "2.0", "id": request["id"], "result": {
                "method": request["method"], "rows": [{"iteration": 3, "can_resume": true,
                "attempt": "9223372036854775807", "stray": [{"pid": 123, "command": "🦀"}]}],
                "null": null, "number": 18446744073709551615_u64, "empty": []
            }});
            writeln!(stream, "{frame}").unwrap();
        }
    });
    let client = Client::connect(&socket).await.unwrap();
    let (a, b) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(
            client.request("rail.tree", Value::Null),
            client.request("daemon.ping", Value::Null)
        )
    })
    .await
    .unwrap();
    for (result, method) in [(a, "rail.tree"), (b, "daemon.ping")] {
        assert_eq!(
            result.unwrap(),
            json!({"method": method,
            "rows": [{"iteration": 3, "can_resume": true, "attempt": "9223372036854775807",
                "stray": [{"pid": 123, "command": "🦀"}]}],
            "null": null, "number": 18446744073709551615_u64, "empty": []})
        );
    }
    server.join().unwrap();
}

#[tokio::test]
async fn r16_client_preserves_error_replies_including_malformed_error_fallback() {
    for (error, expected) in [
        (
            json!({"code": -32004, "message": "the Daemon may have run 🦀"}),
            rpc::RpcError::unknown_outcome("the Daemon may have run 🦀"),
        ),
        (
            Value::Null,
            rpc::RpcError::new(rpc::code::INTERNAL, "malformed error reply"),
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("rupd.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let line = std::io::BufReader::new(stream.try_clone().unwrap())
                .lines()
                .next()
                .unwrap()
                .unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            writeln!(
                stream,
                "{}",
                json!({"jsonrpc": "2.0", "id": request["id"],
                "result": "must not override error", "error": error})
            )
            .unwrap();
        });
        let client = Client::connect(&socket).await.unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            client.request("rail.tree", Value::Null),
        )
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), expected);
        server.join().unwrap();
    }
}

#[tokio::test]
async fn r16_client_preserves_event_notifications_without_reply_ids() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let expected = json!({"actor": {"kind": "agent", "id": "door", "parent": "root"},
        "name": "agent.stray", "data": {"id": "door", "stray": [
            {"pid": 123, "command": "claude 🦀"}, {"pid": 456, "command": "other"}]}});
    let event = expected.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        // A malformed notification must not prevent the following complete event.
        writeln!(
            stream,
            "{}",
            json!({"jsonrpc": "2.0", "method": "event", "params": null})
        )
        .unwrap();
        writeln!(
            stream,
            "{}",
            json!({"jsonrpc": "2.0", "method": "event", "params": event})
        )
        .unwrap();
    });
    let mut client = Client::connect(&socket).await.unwrap();
    let event = tokio::time::timeout(Duration::from_secs(5), client.next_event())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(serde_json::to_value(event).unwrap(), expected);
    server.join().unwrap();
}
