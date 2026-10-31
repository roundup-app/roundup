use super::*;

/// A stand-in Daemon that answers `null` to everything on `socket`; aborting it frees the socket.
fn answering_daemon(socket: &Path) -> tokio::task::JoinHandle<()> {
    let _ = std::fs::remove_file(socket);
    let listener = UnixListener::bind(socket).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let reply = json!({ "jsonrpc": "2.0", "id": request["id"], "result": [] });
                    write_line(&mut write, &reply).await;
                }
            });
        }
    })
}

#[tokio::test]
async fn m5179_a_closed_daemon_fails_the_call_and_the_shim_stays_up() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let daemon = answering_daemon(&socket);
    let mut shim = spawn_shim(&socket, "a1").await;
    assert_eq!(
        shim.call("todo_list", json!({})).await.is_error,
        Some(false)
    );
    daemon.abort();
    let _ = daemon.await;

    let result = shim.call("todo_list", json!({})).await;

    assert_eq!(result.is_error, Some(true));
    let message = error_text(&result);
    assert!(
        message.contains("todo_list") && message.contains("not sent"),
        "{message}"
    );
    assert!(shim.child.try_wait().unwrap().is_none());
}

#[tokio::test]
async fn m5179_the_next_call_reaches_the_reopened_daemon() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let daemon = answering_daemon(&socket);
    let shim = spawn_shim(&socket, "a1").await;
    daemon.abort();
    let _ = daemon.await;
    assert_eq!(shim.call("todo_list", json!({})).await.is_error, Some(true));

    let _reopened = answering_daemon(&socket);

    assert_eq!(
        shim.call("todo_list", json!({})).await.is_error,
        Some(false)
    );
}

#[tokio::test]
async fn m5179_each_call_while_the_daemon_is_down_fails_promptly() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let daemon = answering_daemon(&socket);
    let shim = spawn_shim(&socket, "a1").await;
    daemon.abort();
    let _ = daemon.await;

    for _ in 0..3 {
        assert_eq!(shim.call("todo_list", json!({})).await.is_error, Some(true));
    }
}

#[tokio::test]
async fn m5179_no_error_asks_for_an_mcp_reconnect() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let daemon = answering_daemon(&socket);
    let shim = spawn_shim(&socket, "a1").await;
    daemon.abort();
    let _ = daemon.await;

    let message = error_text(&shim.call("todo_list", json!({})).await);

    assert!(
        !message.contains("/mcp") && !message.contains("Restart roundup"),
        "{message}"
    );
}

/// A Daemon that answers the start handshake, then closes the connection on `todo.list` unanswered.
fn dropping_daemon(socket: &Path) {
    let listener = UnixListener::bind(socket).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    if request["method"] == "todo.list" {
                        return;
                    }
                    let reply = json!({ "jsonrpc": "2.0", "id": request["id"], "result": null });
                    write_line(&mut write, &reply).await;
                }
            });
        }
    });
}

#[tokio::test]
async fn m5179_a_request_lost_after_sending_may_have_been_applied() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    dropping_daemon(&socket);
    let mut shim = spawn_shim(&socket, "a1").await;

    let result = shim.call("todo_list", json!({})).await;

    let message = error_text(&result);
    assert!(
        message.contains("todo_list") && message.contains("may have been applied"),
        "{message}"
    );
    assert!(shim.child.try_wait().unwrap().is_none());
}
