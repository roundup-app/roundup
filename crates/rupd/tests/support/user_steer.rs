use super::child_run::Run;
use rpc::{Client, RpcError};
use serde_json::{Value, json};

/// The user's own Steer, the one write left that types into the child's Terminal (A4452d).
pub async fn user_steer(run: &Run) -> tokio::task::JoinHandle<Result<Value, RpcError>> {
    let child = run.child.clone();
    let user = Client::connect(&run.daemon.socket).await.unwrap();
    tokio::spawn(async move {
        user.request("agent.prompt", json!({"id":child,"text":"user steer"}))
            .await
    })
}
