//! DTC2: a quiet note about a child starts no Door turn. Real Daemon, a live Door.
use super::*;

/// DTC2: the Door, as itself, asks to be woken when the child finishes.
async fn door_waits_on_child(run: &Run) {
    let door = Client::connect(&run.daemon.socket).await.unwrap();
    door.request(
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":run.door,"parent":null}}),
    )
    .await
    .unwrap();
    door.request("agent.wake", json!({"ids":[run.child]}))
        .await
        .unwrap();
}

impl Run {
    /// A live Door's Daemon has had time to compare and push: it attempted no push and no send.
    async fn settle_quiet(&self) {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let attempts =
            std::fs::read_to_string(self.dir.path().join("attempts")).unwrap_or_default();
        assert!(
            !attempts
                .lines()
                .any(|op| op == "push" || op == "message.send"),
            "send attempted while the Door idles: {attempts}"
        );
    }
}

#[tokio::test]
async fn dtc2_a_status_flip_of_a_child_starts_no_door_turn() {
    let run = Run::start_live().await;
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    run.change("first").await;
    run.change("second").await;
    run.settle_quiet().await;
    assert!(run.digests().await.is_empty(), "no inbox write, no prompt");
}

#[tokio::test]
async fn dtc2_a_last_line_change_of_a_child_under_a_wake_starts_no_door_turn() {
    let run = Run::start_live().await;
    door_waits_on_child(&run).await;
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    run.change("while waiting").await;
    run.settle_quiet().await;
    assert!(run.digests().await.is_empty(), "no inbox write, no prompt");
}
