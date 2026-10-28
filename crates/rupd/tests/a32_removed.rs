//! A32: retired RPC calls never enter the Workstream lifecycle.
use std::sync::Arc;
use serde_json::json;
use tokio::net::UnixListener;

fn stored(path: &std::path::Path) -> Vec<(String, Vec<u8>)> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(path).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.is_dir() {
            entries.extend(stored(&path));
        } else if path.is_file() && !path.to_string_lossy().ends_with("-shm") {
            entries.push((path.to_string_lossy().into_owned(), std::fs::read(path).unwrap()));
        }
    }
    entries.sort();
    entries
}

#[tokio::test]
async fn a32_removed_methods_are_unknown_and_change_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().join(".roundup");
    let socket = dir.path().join("rpc.sock");
    let daemon = Arc::new(rupd::Daemon::open(&data).unwrap());
    let server = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    let mut user = rpc::Client::connect(&socket).await.unwrap();
    let door = user.request("rail.createWorkstream", json!({"name":"team"})).await.unwrap();
    let id = door["id"].as_str().unwrap();
    user.request("todo.create", json!({"title":"retain","home":id})).await.unwrap();
    user.request("pad.create", json!({"name":"retain","text":"exact text"})).await.unwrap();
    user.request("message.send", json!({"to":id,"body":"ordinary history"})).await.unwrap();
    std::fs::write(dir.path().join("source.txt"), "original files").unwrap();
    user.request("events.subscribe", ()).await.unwrap();
    let before = stored(dir.path());
    for method in ["workstream.clear", "workstream.handoff"] {
        let error = user.request(method, json!({"id":id,"reason":"retired","without_handoff":true,"summary":"retired","keep_todos":[],"keep_pads":[]})).await.unwrap_err();
        assert_eq!(error.code, rpc::code::METHOD_NOT_FOUND, "{method}: {error}");
        assert_eq!(stored(dir.path()), before, "{method} changed Project storage");
    }
    // This is an absence observation window, not a readiness delay.
    assert!(tokio::time::timeout(std::time::Duration::from_millis(50), user.next_event()).await.is_err());
    server.abort();
}
