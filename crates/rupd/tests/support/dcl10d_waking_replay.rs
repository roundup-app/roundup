//! DCL10d: a restart replays a told end note as waking, a told quiet note as quiet.
use super::*;

fn entry(name: &str, kind: contracts::Kind, last: &str) -> String {
    serde_json::to_string(&contracts::agent::DigestEntry {
        name: name.into(),
        kind,
        link: None,
        last: last.into(),
        todos: 0,
        pads: vec![],
    })
    .unwrap()
}

#[tokio::test]
async fn dcl10d_a_replayed_end_note_wakes_the_door_within_2s() {
    let mut run = Run::start_live().await;
    run.let_settled_pass().await;
    let quiet = run
        .user
        .request(
            "agent.spawn",
            json!({"name":"other","parent":run.door,"cwd":run.dir.path(),"prompt":"What should this Agent do?"}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    // The Daemon was killed after telling both notes and before queueing them (DCL4).
    {
        let db = storage::connect(run.dir.path()).unwrap();
        let sql = "INSERT INTO push_intents (door, child, entry, weight, waking) VALUES (?1, ?2, ?3, 1, ?4)";
        db.execute(
            sql,
            rusqlite::params![
                run.door,
                run.child,
                entry("review", contracts::Kind::Done, "ended-note"),
                true
            ],
        )
        .unwrap();
        db.execute(
            sql,
            rusqlite::params![
                run.door,
                quiet,
                entry("other", contracts::Kind::Working, "quiet-note"),
                false
            ],
        )
        .unwrap();
    }
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    (run.daemon, run.log) = launch(run.dir.path(), run.data.path(), &run.model);
    run.user = Client::connect(&run.daemon.socket).await.unwrap();
    let find = |all: &[Value], word: &str| {
        all.iter()
            .find(|m| m["body"].as_str().unwrap().contains(word))
            .cloned()
    };
    tokio::time::timeout(BOUND, async {
        while find(&inbox(&run).await, "ended-note").is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the replayed end note reached the Door");
    let all = inbox(&run).await;
    let ended = find(&all, "ended-note").unwrap();
    // DTC2: the end note is written to the Door's inbox and delivered, the quiet one waits.
    assert_eq!(ended["status"], "delivered", "{ended}");
    if let Some(quiet) = find(&all, "quiet-note") {
        assert_ne!(quiet["status"], "delivered", "{quiet}");
    }
}

async fn inbox(run: &Run) -> Vec<Value> {
    let all = run.user.request("message.list", json!({})).await.unwrap();
    all.as_array()
        .unwrap()
        .iter()
        .filter(|m| m["to"] == run.door)
        .cloned()
        .collect()
}
