//! DCL6 through a real Daemon: the Rail, the Agents, `message.send` and the stored marker answer.
use std::sync::Arc;

use serde_json::{Value, json};

use super::*;
use crate::Daemon;
use crate::auto_tests::{as_door, call, door, running_daemon};

struct Run {
    daemon: Daemon,
    store: Arc<Settlements>,
    door: String,
    dir: tempfile::TempDir,
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let daemon = running_daemon(dir.path());
        let door = door(&daemon).await;
        let store = Arc::new(
            Settlements::open(&dir.path().join("settled.db"))
                .unwrap()
                .without_quiet(),
        );
        store.migrate().unwrap();
        let run = Self {
            daemon,
            store,
            door,
            dir,
        };
        run.stop(&run.door).await;
        run
    }

    async fn spawn(&self, params: Value) -> String {
        let mut params = params;
        params["cwd"] = json!(self.dir.path());
        as_door(&self.daemon, &self.door, "agent.spawn", params).await["id"]
            .as_str()
            .unwrap()
            .into()
    }

    async fn consult(&self) -> String {
        self.spawn(json!({"role":"consult"})).await
    }

    async fn job(&self) -> String {
        let order = json!({"kind":"work","ask":"Do it","done":"Done","limits":[]});
        self.spawn(json!({"role":"job","order":order})).await
    }

    /// The Agent takes a prompt and finishes that turn.
    async fn stop(&self, id: &str) {
        let node = call(&self.daemon, "rail.tree", Value::Null).await;
        let attempt = serde_json::to_value(&node)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .map(|n| n["attempt"].clone())
            .unwrap();
        for event in ["UserPromptSubmit", "Stop"] {
            let payload = json!({"hook_event_name":event,"prompt":"go"});
            let signal = json!({"id":id,"attempt":attempt,"payload":payload});
            call(&self.daemon, "agent.signal", signal).await;
        }
    }

    async fn pass(&self) {
        // The Door has taken in the Daemon's own digests of the children's changes.
        self.take_in(&self.notes("[digest]").await).await;
        self.settle().await;
    }

    /// One settlement pass as `push_changes` runs it, the Door having taken nothing in.
    async fn settle(&self) {
        let reader = self.daemon.reader();
        let messages = self.daemon.sender.get().unwrap().clone();
        let world = reader.world().await.unwrap();
        let waiting = messages.waiting_counts_unquiet().await.unwrap_or_default();
        let held = messages.held_digests().await.unwrap_or_default();
        settle(&reader, &messages, &self.store, &world, &waiting, &held).await;
    }

    async fn notes(&self, marker: &str) -> Vec<Value> {
        call(&self.daemon, "message.list", json!({"to":self.door}))
            .await
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["body"].as_str().unwrap().starts_with(marker))
            .cloned()
            .collect()
    }

    /// The Door's transcript receipt, written to the store as the inbox's confirmation does.
    async fn take_in(&self, notes: &[Value]) {
        let db = Connection::open(self.dir.path().join("data/project.db")).unwrap();
        db.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
        for id in notes.iter().filter(|n| n["status"] == "pending") {
            db.execute(
                "UPDATE messages SET status = 'delivered' WHERE id = ?1",
                [id["id"].as_i64().unwrap()],
            )
            .unwrap();
        }
    }
}

#[tokio::test]
async fn dcl6_quiescence_with_idle_consult_costs_one_door_turn() {
    let run = Run::start().await;
    let consult = run.consult().await;
    // A child that never finished a turn changed nothing worth settling.
    run.pass().await;
    assert!(run.notes("[settled]").await.is_empty());
    run.stop(&consult).await;
    run.pass().await;
    run.pass().await;
    let first = run.notes("[settled]").await;
    assert_eq!(first.len(), 1, "one note for the whole change period");
    run.take_in(&first).await;
    // The note's delivery and the Door's reply change no child: no second note.
    run.stop(&run.door).await;
    run.pass().await;
    assert_eq!(run.notes("[settled]").await.len(), 1);
    // A later child change followed by rest settles exactly once more.
    run.stop(&consult).await;
    run.pass().await;
    run.pass().await;
    assert_eq!(run.notes("[settled]").await.len(), 2);
}

#[tokio::test]
async fn dcl6_door_reply_and_restart_do_not_rearm_settlement() {
    let run = Run::start().await;
    let consult = run.consult().await;
    run.stop(&consult).await;
    run.pass().await;
    let first = run.notes("[settled]").await;
    run.take_in(&first).await;
    // A restart reopens the stored marker; the Door's reply is no child change.
    let reopened = Settlements::open(&run.dir.path().join("settled.db"))
        .unwrap()
        .without_quiet();
    let run = Run {
        store: Arc::new(reopened),
        ..run
    };
    run.stop(&run.door).await;
    run.pass().await;
    assert_eq!(run.notes("[settled]").await.len(), 1);
}

#[tokio::test]
async fn dcl6_open_job_blocks_settlement_until_door_decides() {
    let run = Run::start().await;
    let job = run.job().await;
    run.stop(&job).await;
    run.pass().await;
    // The unreported Job is not counted complete: the Door gets the stop note, not a settled one.
    assert!(run.notes("[settled]").await.is_empty());
    let stop = run.notes("[stopped]").await;
    assert_eq!(stop.len(), 1);
    assert!(stop[0]["body"].as_str().unwrap().contains("resume"));
    run.pass().await;
    assert_eq!(
        run.notes("[stopped]").await.len(),
        1,
        "told once while pending"
    );
    run.take_in(&stop).await;
    run.pass().await;
    assert_eq!(run.notes("[stopped]").await.len(), 1);
    assert_eq!(
        run.notes("[settled]").await.len(),
        1,
        "settles after the Door chose"
    );
}

/// DTC2: a digest no inbox write carries waits for a Message that is no quiet digest, so the stop
/// note is not held back by it and the Door's next turn holds both.
#[tokio::test]
async fn dtc2_a_held_digest_does_not_hold_back_the_stop_note() {
    let run = Run::start().await;
    let job = run.job().await;
    run.stop(&job).await;
    let entry = contracts::agent::DigestEntry {
        name: "open-job".into(),
        kind: Kind::Idle,
        last: String::new(),
        todos: 0,
        link: None,
        pads: vec![],
    };
    let messages = run.daemon.sender.get().unwrap().clone();
    messages.push_digest(&run.door, &job, &entry, true).await;
    assert_eq!(run.notes("[digest]").await.len(), 1);
    run.settle().await;
    assert_eq!(run.notes("[stopped]").await.len(), 1);
}
