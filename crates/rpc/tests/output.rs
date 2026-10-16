//! X14 downstream intake: actual Client, isolated socket, no Daemon.
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast::error::{RecvError, TryRecvError};
use tokio::time::timeout;

async fn reply(stream: UnixStream, flood: bool) {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let request: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    if flood {
        for offset in 0..256 {
            let frame = json!({"jsonrpc":"2.0","method":"event","params":{
                "actor":{"kind":"user","id":"daemon","parent":null},
                "name":"terminal.output","data":{"id":"1","offset":offset * 8192,
                "data":"YWFh".repeat(2730) + "YWE="}}});
            write.write_all(format!("{frame}\n").as_bytes()).await.unwrap();
        }
        for name in ["rail.changed", "terminal.changed"] {
            let frame = json!({"jsonrpc":"2.0","method":"event","params":{
                "actor":{"kind":"user","id":"daemon","parent":null},"name":name}});
            write.write_all(format!("{frame}\n").as_bytes()).await.unwrap();
        }
    }
    let response = json!({"jsonrpc":"2.0","id":request["id"],"result":true});
    write.write_all(format!("{response}\n").as_bytes()).await.unwrap();
    // The reply is a processing barrier after the flood; EOF proves socket release.
    assert!(lines.next_line().await.unwrap().is_none());
}

#[tokio::test]
async fn x14_rpc_output_intake_is_bounded_without_stranding_replies() {
    timeout(Duration::from_secs(10), async {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("rpc.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let server = tokio::spawn(async move {
            let first = tokio::spawn(reply(listener.accept().await.unwrap().0, true));
            let second = tokio::spawn(reply(listener.accept().await.unwrap().0, false));
            first.await.unwrap();
            second.await.unwrap();
        });
        let mut client = Client::connect(&socket).await.unwrap();
        let mut output = client.take_output().unwrap();
        assert!(client.take_output().is_none());
        assert_eq!(client.request("events.subscribe", Value::Null).await.unwrap(), true);
        let other = Client::connect(&socket).await.unwrap();
        assert_eq!(other.request("daemon.ping", Value::Null).await.unwrap(), true);
        for name in ["rail.changed", "terminal.changed"] {
            assert_eq!(serde_json::to_value(client.next_event().await.unwrap()).unwrap()["name"], name);
        }
        assert_eq!(output.recv().await.unwrap_err(), RecvError::Lagged(192));
        for offset in 192..256 {
            let event = serde_json::to_value(output.recv().await.unwrap()).unwrap();
            assert_eq!(event["data"]["offset"], offset * 8192);
            assert_eq!(event["data"]["data"].as_str().unwrap().len(), 10924);
        }
        assert!(matches!(output.try_recv(), Err(TryRecvError::Empty)));
        drop(client);
        assert!(matches!(output.recv().await, Err(RecvError::Closed)));
        drop(other);
        server.await.unwrap();
    }).await.expect("all socket and reply waits are bounded");
}
