//! A16 `rail.remove`.

use std::time::{Duration, Instant};

use agents::KILL_WAIT_BOUND;
use contracts::Kind;
use contracts::agent::{NodeKind, RailNode};
use rpc::code;
use serde_json::{Value, json};

use crate::common::{Fixture, status_of};

impl Fixture {
    async fn remove(&self, id: &str) -> Result<Value, rpc::RpcError> {
        self.call("rail.remove", json!({"id": id})).await
    }
}

async fn start_door(f: &Fixture, id: &str) {
    f.call("rail.startDoor", json!({"id": id})).await.unwrap();
}

/// `name:order` of the children of `parent`, in order; an Agent shows as `agent` whatever its name.
fn names(tree: &[RailNode], parent: Option<&str>) -> Vec<String> {
    let mut kids: Vec<_> = tree
        .iter()
        .filter(|n| n.parent.as_deref() == parent)
        .collect();
    kids.sort_by_key(|n| n.order);
    kids.into_iter()
        .map(|n| match n.kind {
            NodeKind::Agent => format!("agent:{}", n.order),
            _ => format!("{}:{}", n.name, n.order),
        })
        .collect()
}

#[tokio::test]
async fn a16_a_running_agent_is_stopped_and_removed() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();

    f.remove(&agent.id).await.unwrap();

    assert!(f.tree().await.is_empty());
    let terminal_id = agent.terminal_id.unwrap();
    let terminal = f
        .terminals
        .list()
        .await
        .into_iter()
        .find(|t| t.id == terminal_id);
    assert!(terminal.is_none_or(|t| !t.running));
}

#[tokio::test]
async fn a16_a_descendant_holding_the_pty_open_does_not_hang_remove() {
    let f = Fixture::running("trap '' HUP; sleep 20 & touch marker; wait");
    let agent = f.spawn(None, None).await.unwrap();
    let marker = f.dir.path().join("marker");
    for _ in 0..500 {
        if marker.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(marker.exists(), "the descendant never started");
    let began = Instant::now();

    tokio::time::timeout(
        KILL_WAIT_BOUND + Duration::from_secs(5),
        f.remove(&agent.id),
    )
    .await
    .expect("rail.remove returns within the bound")
    .unwrap();

    assert!(began.elapsed() < KILL_WAIT_BOUND + Duration::from_secs(1));
}

#[tokio::test]
async fn a16_a_plain_workstreams_children_move_to_its_parent_at_its_place() {
    let f = Fixture::running("sleep 30");
    f.workstream("before", None).await;
    let g = f.workstream("g", None).await;
    f.workstream("after", None).await;
    let child_a = f.spawn(Some(&g), None).await.unwrap().id;
    let child_b = f.spawn(Some(&g), None).await.unwrap().id;

    f.remove(&g).await.unwrap();

    let tree = f.tree().await;
    assert_eq!(
        names(&tree, None),
        ["before:0", "agent:1", "agent:2", "after:3"]
    );
    assert!(tree.iter().all(|n| n.id != g));
    assert!(tree.iter().any(|n| n.id == child_a));
    assert!(tree.iter().any(|n| n.id == child_b));
}

#[tokio::test]
async fn a16_removing_a_door_stops_it_lifts_its_children_then_deletes_it() {
    let f = Fixture::running("sleep 30");
    f.workstream("before", None).await;
    let team = f.workstream("team", None).await;
    f.workstream("after", None).await;
    let mut agents = vec![];
    for _ in 0..2 {
        agents.push(f.spawn(Some(&team), None).await.unwrap().id);
    }
    start_door(&f, &team).await;

    f.remove(&team).await.unwrap();

    let tree = f.tree().await;
    assert_eq!(
        names(&tree, None),
        ["before:0", "agent:1", "agent:2", "after:3"]
    );
    assert!(tree.iter().all(|n| n.id != team));
    for id in &agents {
        let child = tree.iter().find(|n| &n.id == id).unwrap();
        assert_eq!(child.parent, None);
        assert_eq!(status_of(&tree, id).kind, Kind::Working);
    }
}

#[tokio::test]
async fn a16_unknown_id_is_not_found() {
    let f = Fixture::new();
    let err = f.remove("999").await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
}

#[tokio::test]
async fn a16_siblings_after_it_keep_their_order() {
    let f = Fixture::new();
    let a = f.workstream("a", None).await;
    let b = f.workstream("b", None).await;
    let c = f.workstream("c", None).await;

    f.remove(&b).await.unwrap();

    assert_eq!(names(&f.tree().await, None), ["a:0", "c:1"]);
    assert!(f.tree().await.iter().all(|n| n.id != b));
    assert!(f.tree().await.iter().any(|n| n.id == a));
    assert!(f.tree().await.iter().any(|n| n.id == c));
}

#[tokio::test]
async fn a16_remove_emits_rail_changed() {
    let mut f = Fixture::new();
    let workstream = f.workstream("g", None).await;
    f.changed();

    f.remove(&workstream).await.unwrap();

    assert_eq!(f.changed(), 1);
}

/// A16: a successful delete also drops the id from the Agents module's own run-tracking, not
/// just the Rail, so a Signal for it goes back to `NOT_FOUND` instead of quietly reaching an
/// Agent no longer on the Rail.
#[tokio::test]
async fn a16_a_removed_agents_id_no_longer_answers_agent_signal() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();

    f.remove(&agent.id).await.unwrap();

    let err = f
        .call(
            "agent.signal",
            json!({
                "id": agent.id,
                "attempt": agent.attempt,
                "payload": json!({"hook_event_name": "PreToolUse", "tool_name": "Bash"}),
            }),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
}
