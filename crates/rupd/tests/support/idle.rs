use super::child_run::{BOUND, Run};

pub async fn idle(run: &Run) {
    tokio::time::timeout(BOUND, async {
        loop {
            let tree = run.user.request("rail.tree", ()).await.unwrap();
            if tree
                .as_array()
                .unwrap()
                .iter()
                .any(|node| node["id"] == run.child && node["status"]["kind"] == "idle")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
