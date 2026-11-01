use super::child_run::{BOUND, Run};
use super::door_terminals::order_child;
use rpc::Client;
use serde_json::json;
use std::sync::Arc;

pub async fn door_terminal() -> (Run, Arc<Client>) {
    let (mut run, caller) = order_child().await;
    // Agent panes are ownerless (M14); a child-owned Run is in the Door's Reach.
    let child = Client::connect(&run.daemon.socket).await.unwrap();
    child
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let opened = child.request("terminal.spawn", json!({
        "cwd":run.dir.path(), "cols":80,"rows":24,"env":{},
        "command":["python3","-u","-c", "import os, tty\ntty.setraw(0)\nprint('READY')\nwhile True:\n b = os.read(0, 1)\n if not b: break\n print('BARRIER' if b == b'\\x00' else 'BYTE:' + b.hex())"]
    })).await.unwrap();
    run.terminal = opened["id"].clone();
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("READY") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (run, caller)
}
