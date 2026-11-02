// T4902 removes the retired T29 migration; the same non-duration upgrade boundary is retained.
//! U4454c, U4454d: no Time or Timeline reads or stores measurements.
use rpc::{Client, code};
use serde_json::json;
use std::sync::Arc;
use tokio::net::UnixListener;

async fn serve(dir: &std::path::Path) -> Client {
    let daemon = Arc::new(rupd::Daemon::open(dir).unwrap());
    let socket = dir.join("rupd.sock");
    tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
    ));
    Client::connect(&socket).await.unwrap()
}

#[tokio::test]
async fn u4454c_the_daemon_serves_no_measurement_summary() {
    let dir = tempfile::tempdir().unwrap();
    let client = serve(dir.path()).await;
    for method in ["project.measurementSummary", "project.measurements"] {
        let refusal = client.request(method, json!({})).await.unwrap_err();
        assert_eq!(refusal.code, code::METHOD_NOT_FOUND, "{method}");
    }
}
