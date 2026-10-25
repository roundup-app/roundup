//! U3787a: restoration crosses the same socket and Project storage as production clients.
use std::sync::Arc;
use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

struct World {
    _dir: tempfile::TempDir,
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
}
impl Drop for World {
    fn drop(&mut self) { self.server.abort(); }
}
async fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let daemon = Arc::new(rupd::Daemon::open(dir.path()).unwrap());
    let server = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    let client = Client::connect(&socket).await.unwrap();
    World { _dir: dir, client, server }
}
async fn call(w: &World, method: &str, p: Value) -> Value {
    w.client.request(method, p).await.unwrap()
}
#[tokio::test]
async fn u3787a_restore_keeps_the_original_pad_creation() {
    let w = world().await;
    let original = call(&w, "pad.create", json!({"name":"notes", "text":"exact\n雪\n"})).await;
    let deleted = call(&w, "pad.delete", json!({"name":"notes", "operation":"remove-one", "expectedIncarnation":original["incarnation"]})).await;
    let restored = call(&w, "pad.restore", json!({"project":deleted["project"], "operation":"remove-one"})).await;
    assert_eq!(restored["pad"], original);
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, original);
}
