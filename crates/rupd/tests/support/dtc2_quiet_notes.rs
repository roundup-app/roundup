//! DTC2: a quiet note about a child starts no Door turn. Real Daemon, a live Door.
use super::*;

/// DTC2: the Door, as itself, asks to be woken when the child finishes.
pub(super) async fn door_waits_on_child(run: &Run) {
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

    /// The setup's own settled note (DCL6) is quiet (DTC6): it is stored, written to no inbox, and
    /// waits for the Door's next turn. `let_settled_pass` waits until it is stored.
    pub(super) async fn let_settled_pass(&self) {
        self.let_settled_passes(1).await;
    }

    /// `n` settled notes are stored for the Door: one delivered earlier counts, so a case whose
    /// setup draws a second one (after a Job's stop note) names how many.
    pub(super) async fn let_settled_passes(&self, n: usize) {
        tokio::time::timeout(Duration::from_secs(40), async {
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            loop {
                tick.tick().await;
                let stored = self
                    .user
                    .request("message.list", json!({}))
                    .await
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|m| {
                        m["to"] == self.door && m["body"].as_str().unwrap().starts_with("[settled]")
                    })
                    .count();
                if stored >= n {
                    break;
                }
            }
        })
        .await
        .expect("the settled note is stored");
        // The turn it starts ends, and the Daemon compares what it changed: take the Door's idle
        // revision from the Rail, then wait for the Daemon's snapshot of that very revision, so
        // the comparison is counted only once it has begun.
        let revision = tokio::time::timeout(Duration::from_secs(40), async {
            loop {
                let tree = self.user.request("rail.tree", json!({})).await.unwrap();
                let door = tree
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|n| n["id"] == self.door)
                    .unwrap()
                    .clone();
                if door["status"]["kind"] == "idle" {
                    break door["status_revision"].as_str().unwrap().parse().unwrap();
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the Door idles after the settled note");
        self.idle(&self.door, revision).await;
        self.compared().await;
    }

    /// The notes to the Door that start with `tag`, stored by the Daemon.
    pub(super) async fn stored(&self, tag: &str) -> Vec<String> {
        self.user
            .request("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["to"] == self.door)
            .filter_map(|m| m["body"].as_str())
            .filter(|body| body.starts_with(tag))
            .map(str::to_owned)
            .collect()
    }

    pub(super) async fn wait_stored(&self, tag: &str) {
        let found = tokio::time::timeout(Duration::from_secs(40), async {
            while self.stored(tag).await.is_empty() {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await;
        assert!(
            found.is_ok(),
            "no {tag} note stored: {:?}",
            self.stored("").await
        );
    }

    /// A hook event of the child, as its own session would report it.
    pub(super) async fn signal(&self, id: &str, payload: Value) {
        let tree = self.user.request("rail.tree", json!({})).await.unwrap();
        let attempt = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()["attempt"]
            .clone();
        self.user
            .request(
                "agent.signal",
                json!({"id":id,"attempt":attempt,"payload":payload}),
            )
            .await
            .unwrap();
    }

    /// The child finishes compacting its context, then a Todo event starts a supervisor pass.
    pub(super) async fn compact(&self, id: &str) {
        self.signal(id, json!({"hook_event_name":"UserPromptSubmit"}))
            .await;
        self.signal(id, json!({"hook_event_name":"PreCompact","trigger":"auto"}))
            .await;
        self.signal(
            id,
            json!({"hook_event_name":"PostCompact","trigger":"auto","compact_summary":"s"}),
        )
        .await;
        self.signal(id, json!({"hook_event_name":"Stop"})).await;
        self.user
            .request("todo.create", json!({"title":"pass"}))
            .await
            .unwrap();
    }

    /// A live Door's Daemon has had time to compare and push: it attempted no push and no send.
    pub(super) async fn settle_quiet(&self) {
        self.compared().await;
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

#[tokio::test]
async fn dtc6_a_settled_note_starts_no_door_turn_and_rides_in_the_next_one() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let rides = |turn: &Vec<String>| turn.iter().any(|e| e.contains("[settled] Every Agent"));
    assert!(
        !super::dtc3_one_turn::rupd_turns(&run).iter().any(rides),
        "the settled note started a turn"
    );
    run.user
        .request(
            "message.send",
            json!({"to":run.door,"kind":"note","body":"next"}),
        )
        .await
        .unwrap();
    wait(|| super::dtc3_one_turn::rupd_turns(&run).iter().any(rides)).await;
}

#[tokio::test]
async fn dtc6_a_waiting_settled_note_is_not_rearmed_by_a_later_child_change() {
    let run = Run::start_live().await;
    run.let_settled_pass().await;
    let child = run.child.clone();
    run.signal(&child, json!({"hook_event_name":"UserPromptSubmit"}))
        .await;
    run.signal(&child, json!({"hook_event_name":"Stop"})).await;
    run.user
        .request("todo.create", json!({"title":"pass"}))
        .await
        .unwrap();
    run.compared().await;
    assert_eq!(run.stored("[settled]").await.len(), 1, "no second note");
}
