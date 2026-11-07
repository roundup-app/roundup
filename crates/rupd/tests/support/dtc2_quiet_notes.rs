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
    /// The newest Status revision the Door reached, read from the Daemon's snapshots.
    fn door_revision(&self) -> u32 {
        snapshots(self.dir.path())
            .iter()
            .flat_map(|v| v["nodes"].as_array().unwrap().clone())
            .filter(|n| n["id"] == self.door)
            .filter_map(|n| n["status_revision"].as_str()?.parse().ok())
            .max()
            .unwrap()
    }

    /// The setup's own settled note (DCL6) is a Door turn that carries quiet notes out; it comes
    /// 2 s after the child rests, so it is let pass before the quiet window is counted.
    async fn let_settled_pass(&self) {
        let _ = tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                let delivered = self
                    .user
                    .request("message.list", json!({}))
                    .await
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|m| {
                        m["to"] == self.door
                            && m["status"] == "delivered"
                            && m["body"].as_str().unwrap().starts_with("[settled]")
                    });
                if delivered {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await;
        // The turn it starts ends, and the Daemon compares what it changed.
        tokio::time::sleep(Duration::from_secs(3)).await;
        self.compared().await;
    }

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
    run.let_settled_pass().await;
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    // Setup's own Messages may have carried the first quiet notes out; only later ones are counted.
    let before = run.digests().await.len();
    run.change("first").await;
    run.change("second").await;
    run.settle_quiet().await;
    assert_eq!(
        run.digests().await.len(),
        before,
        "no inbox write, no prompt"
    );
}

#[tokio::test]
async fn dtc2_a_last_line_change_of_a_child_under_a_wake_starts_no_door_turn() {
    let run = Run::start_live().await;
    let rest = run.door_revision();
    door_waits_on_child(&run).await;
    // The child is idle, so the Wake request fires at once (B42) and the Door takes a turn for it
    // (Working, Idle); the change under test comes after that turn, which would carry it out.
    run.idle(&run.door, rest + 2).await;
    run.let_settled_pass().await;
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    let before = run.digests().await.len();
    run.change("while waiting").await;
    run.settle_quiet().await;
    assert_eq!(
        run.digests().await.len(),
        before,
        "no inbox write, no prompt"
    );
}
