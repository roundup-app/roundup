//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{
    child_attempt, door_peer_request, door_terminal, idle, order_child, start_answer_door,
};
use takeover_run::BOUND;

use rpc::Client;
use serde_json::{Value, json};

#[tokio::test]
async fn b6_a_door_read_of_a_taken_over_child_waits_for_the_takeover_end() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let terminal = run.terminal.clone();
    let read = tokio::spawn(async move {
        caller
            .request("terminal.snapshot", json!({"id":terminal}))
            .await
    });
    // The user's own read is never held.
    run.user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert!(!read.is_finished(), "a Door read ran during Takeover");
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let snapshot = tokio::time::timeout(BOUND, read).await.unwrap().unwrap();
    run.finish().await;
    assert!(snapshot.unwrap()["cols"].is_number());
}

#[tokio::test]
async fn a2693a_resume_mode_survives_a_held_call() {
    for mode in ["normal", "yolo"] {
        let (run, caller) = order_child().await;
        idle(&run).await;
        run.user
            .request("takeover.begin", json!({"agent":run.child}))
            .await
            .unwrap();
        let receipt = caller
            .request("agent.resume", json!({"id":run.child,"mode":mode}))
            .await
            .unwrap();
        assert_eq!(receipt["params"]["mode"], mode);
        assert_eq!(child_attempt(&run).await, run.attempt);
        run.user
            .request("takeover.end", json!({"agent":run.child}))
            .await
            .unwrap();
        let history = tokio::time::timeout(BOUND, async {
            loop {
                let history = caller
                    .request("agent.actionHistory", json!({"id":run.child}))
                    .await
                    .unwrap();
                if history[0]["outcome"]["status"] == "completed" {
                    break history;
                }
                assert_ne!(history[0]["outcome"]["status"], "dropped", "{history}");
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(history[0]["params"]["mode"], mode);
        let tree = run.user.request("rail.tree", Value::Null).await.unwrap();
        let node = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap();
        assert_eq!(node["yolo"], mode == "yolo");
        run.finish().await;
    }
}

#[tokio::test]
async fn a2693a_an_unauthorized_mode_change_stops_nothing() {
    let (run, _) = order_child().await;
    idle(&run).await;
    let victim = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    let stranger = Client::connect(&run.daemon.socket).await.unwrap();
    stranger
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let err = stranger
        .request("agent.resume", json!({"id":victim["id"],"mode":"yolo"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::FORBIDDEN);
    assert_eq!(child_attempt(&run).await, run.attempt);
    let tree = run.user.request("rail.tree", Value::Null).await.unwrap();
    let after = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == victim["id"])
        .unwrap();
    assert_eq!(after["attempt"], victim["attempt"]);
    assert_eq!(after["terminal_id"], victim["terminal_id"]);
    let terminals = run
        .user
        .request("terminal.list", Value::Null)
        .await
        .unwrap();
    assert!(
        terminals
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == victim["terminal_id"] && t["running"] == true)
    );
    run.finish().await;
}

#[tokio::test]
async fn dv1_publication_uses_the_authenticated_maker_despite_a_user_claim() {
    let (run, _caller) = door_terminal().await;
    let (door, terminal) = start_answer_door(&run).await;
    let replies=door_peer_request(&run,&terminal,json!([
        {"id":1,"method":"daemon.identify","params":{"actor":{"kind":"user","id":"you"}}},
        {"id":2,"method":"deliverable.publish","params":{"key":"authentic","title":"Result","target":{"kind":"external","url":"https://example.com/pr/1"}}}
    ])).await;
    let record = replies
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == 2)
        .unwrap()["result"]
        .clone();
    assert_eq!(record["maker"]["kind"], "agent");
    assert_eq!(record["maker"]["id"], door);
    run.user
        .request("agent.stop", json!({"id":door}))
        .await
        .unwrap();
    run.finish().await;
}

#[tokio::test]
async fn dv4_agent_user_claim_cannot_remove_publication() {
    let (run, _caller) = door_terminal().await;
    let (door, terminal) = start_answer_door(&run).await;
    let record=run.user.request("deliverable.publish",json!({"key":"user-result","title":"Result","target":{"kind":"external","url":"https://example.com/pr/1"}})).await.unwrap();
    let replies=door_peer_request(&run,&terminal,json!([
        {"id":1,"method":"daemon.identify","params":{"actor":{"kind":"user","id":"you"}}},
        {"id":2,"method":"deliverable.remove","params":{"project":record["project"],"id":record["id"]}}
    ])).await;
    assert_eq!(
        replies
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == 2)
            .unwrap()["error"]["code"],
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        run.user
            .request(
                "deliverable.get",
                json!({"project":record["project"],"id":record["id"]})
            )
            .await
            .unwrap(),
        record
    );
    run.user
        .request("agent.stop", json!({"id":door}))
        .await
        .unwrap();
    run.finish().await;
}
