//! A26: a Workstream is one Door with Agents nested under it; Workstreams never nest.

use contracts::agent::{NodeKind, RailNode};
use rpc::code;
use serde_json::json;

use crate::common::Fixture;

fn shape(tree: &[RailNode]) -> Vec<(String, Option<String>, u32)> {
    tree.iter()
        .map(|n| (n.id.clone(), n.parent.clone(), n.order))
        .collect()
}

#[tokio::test]
async fn a26_create_workstream_with_a_parent_is_conflict_and_changes_nothing() {
    let mut f = Fixture::new();
    let w = f.workstream("w", None).await;
    let agent = f.spawn(Some(&w), None).await.unwrap().id;
    let before = shape(&f.tree().await);
    f.changed();
    for parent in [&w, &agent] {
        let err = f
            .call(
                "rail.createWorkstream",
                json!({"name": "x", "parent": parent}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, code::CONFLICT);
    }
    assert_eq!(shape(&f.tree().await), before);
    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn a26_move_a_workstream_under_a_workstream_or_agent_is_conflict() {
    let mut f = Fixture::new();
    let a = f.workstream("a", None).await;
    let b = f.workstream("b", None).await;
    let agent = f.spawn(Some(&b), None).await.unwrap().id;
    let before = shape(&f.tree().await);
    f.changed();
    for parent in [&b, &agent] {
        let err = f
            .call("rail.move", json!({"id": a, "parent": parent, "index": 0}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::CONFLICT);
    }
    assert_eq!(shape(&f.tree().await), before);
    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn a26_a_new_workstream_holds_its_door_alone() {
    let f = Fixture::new();
    let w = f.workstream("w", None).await;
    let tree = f.tree().await;
    assert_eq!(tree.len(), 1);
    assert_eq!(
        (tree[0].id.as_str(), tree[0].kind),
        (w.as_str(), NodeKind::Workstream)
    );
}

#[tokio::test]
async fn a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door() {
    let f = Fixture::new();
    let d = f.workstream("d", None).await;
    let a = f.spawn_as(&d, None).await.unwrap().id;
    let b = f.spawn_as_agent(&a).await;
    let tree = f.tree().await;
    let ids: Vec<_> = tree.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids, [d.as_str(), a.as_str(), b.as_str()]);
    assert_eq!(tree[1].parent.as_deref(), Some(d.as_str()));
    assert_eq!(tree[2].parent.as_deref(), Some(a.as_str()));
}

#[tokio::test]
async fn a26_an_agent_parent_param_from_an_agent_is_ignored() {
    let f = Fixture::new();
    let d = f.workstream("d", None).await;
    let other = f.workstream("other", None).await;
    let a = f.spawn_as(&d, None).await.unwrap().id;
    let b = f.spawn_as(&a, Some(&other)).await.unwrap();
    assert_eq!(b.parent.as_deref(), Some(a.as_str()));
}

#[tokio::test]
async fn a26_move_an_agent_under_an_agent_is_conflict() {
    let mut f = Fixture::new();
    let w = f.workstream("w", None).await;
    let a = f.spawn(Some(&w), None).await.unwrap().id;
    let b = f.spawn(Some(&w), None).await.unwrap().id;
    let before = shape(&f.tree().await);
    f.changed();
    let err = f
        .call("rail.move", json!({"id": b, "parent": a, "index": 0}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(shape(&f.tree().await), before);
    assert_eq!(f.changed(), 0);
}
