//! R16: complete results through the existing reply and Client seams.
use std::io::{BufRead, Write};
use std::os::unix::net::UnixListener;
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};

#[tokio::test]
async fn r16_client_preserves_json_values_and_object_order_after_malformed_frames() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        std::io::BufReader::new(stream.try_clone().unwrap())
            .lines()
            .next()
            .unwrap()
            .unwrap();
        // Invalid numeric syntax and overflow must not resolve the pending request.
        for frame in [r#"{"id":1,"result":01}"#, r#"{"id":1,"result":1e400}"#] {
            writeln!(stream, "{frame}").unwrap();
        }
        // Duplicate keys keep their original position and their last value. Escaped keys
        // and all JSON value kinds survive, including an object wider than the Rail rows.
        let frame = r#"{"jsonrpc":"2.0","id":1,"result":{"z":null,"a":false,"dup":0,"dup":true,"\u0065scaped":"\"\\\n🦀","array":[[],{},null,true,-9223372036854775808,18446744073709551615,-0.0,1.25,1e308,5e-324],"wide":{"0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"11":11,"12":12,"13":13,"14":14,"15":15,"16":16,"17":17,"18":18,"19":19}}}"#;
        writeln!(stream, "{frame}").unwrap();
    });
    let client = Client::connect(&socket).await.unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        client.request("rail.tree", Value::Null),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        result,
        json!({
            "z": null, "a": false, "dup": true, "escaped": "\"\\\n🦀",
            "array": [[], {}, null, true, i64::MIN, u64::MAX, -0.0, 1.25, 1e308, 5e-324],
            "wide": {"0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,
                "10":10,"11":11,"12":12,"13":13,"14":14,"15":15,"16":16,"17":17,"18":18,"19":19}
        })
    );
    assert_eq!(
        result
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["z", "a", "dup", "escaped", "array", "wide"]
    );
    assert!(result["array"][6].as_f64().unwrap().is_sign_negative());
    server.join().unwrap();
}

#[test]
fn r16_reply_preserves_every_rail_field_in_row_order() {
    let expected = json!([{
        "id": "door", "kind": "workstream", "name": "Door 🦀", "parent": null,
        "order": 7, "status": null, "attempt": "9223372036854775807", "status_revision": null,
        "terminal_id": null, "worktree": null, "can_resume": true, "yolo": true, "channel": null,
        "work": null, "stray": [], "model": "model", "effort": "high", "iteration": 3
    }, {
        "id": "next", "kind": "workstream", "name": "Next", "parent": null,
        "order": 8, "status": null, "attempt": null, "status_revision": null,
        "terminal_id": null, "worktree": null, "can_resume": false, "yolo": false, "channel": null,
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

#[tokio::test]
async fn r16_client_preserves_missing_and_null_payload_fallbacks() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut lines = std::io::BufReader::new(stream.try_clone().unwrap()).lines();
        // Missing params, non-object frames and unknown reply ids do not stop routing.
        for frame in [
            json!({"method": "event"}),
            Value::Null,
            json!([]),
            json!({"id": 99999, "result": "unknown"}),
        ] {
            writeln!(stream, "{frame}").unwrap();
        }
        for present in [false, true] {
            let request: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
            let mut frame = json!({"jsonrpc": "2.0", "id": request["id"]});
            if present {
                frame["result"] = Value::Null;
            }
            writeln!(stream, "{frame}").unwrap();
        }
    });
    let client = Client::connect(&socket).await.unwrap();
    for _ in 0..2 {
        assert_eq!(
            tokio::time::timeout(
                Duration::from_secs(5),
                client.request("rail.tree", Value::Null)
            )
            .await
            .unwrap()
            .unwrap(),
            Value::Null
        );
    }
    server.join().unwrap();
}

#[tokio::test]
async fn r16_client_keeps_recursion_limit_and_duplicate_keys_across_object_growth() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        std::io::BufReader::new(stream.try_clone().unwrap())
            .lines()
            .next()
            .unwrap()
            .unwrap();
        let nested = format!("{}0{}", "[".repeat(129), "]".repeat(129));
        writeln!(stream, "{{\"id\":1,\"result\":{nested}}}").unwrap();
        let entries = (0..20)
            .map(|i| format!("\"k{i}\":{i}"))
            .collect::<Vec<_>>()
            .join(",");
        writeln!(
            stream,
            "{{\"id\":1,\"result\":{{{entries},\"k0\":99,\"k19\":100}}}}"
        )
        .unwrap();
    });
    let client = Client::connect(&socket).await.unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        client.request("rail.tree", Value::Null),
    )
    .await
    .unwrap()
    .unwrap();
    let values: Vec<_> = result
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| (key.clone(), value.as_u64().unwrap()))
        .collect();
    assert_eq!(values.len(), 20);
    assert_eq!(values[0], ("k0".to_owned(), 99));
    assert_eq!(values[19], ("k19".to_owned(), 100));
    for (i, (key, value)) in values.iter().enumerate().take(19).skip(1) {
        assert_eq!(key, &format!("k{i}"));
        assert_eq!(*value, u64::try_from(i).unwrap());
    }
    server.join().unwrap();
}

#[tokio::test]
async fn r16_client_preserves_deep_objects_below_the_recursion_limit() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        std::io::BufReader::new(stream.try_clone().unwrap())
            .lines()
            .next()
            .unwrap()
            .unwrap();
        let nested = format!("{}17{}", "{\"child\":".repeat(126), "}".repeat(126));
        writeln!(stream, "{{\"id\":1,\"result\":{nested}}}").unwrap();
    });
    let client = Client::connect(&socket).await.unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        client.request("rail.tree", Value::Null),
    )
    .await
    .unwrap()
    .unwrap();
    let mut child = &result;
    for _ in 0..126 {
        assert_eq!(child.as_object().unwrap().len(), 1);
        child = &child["child"];
    }
    assert_eq!(child, &json!(17));
    server.join().unwrap();
}
