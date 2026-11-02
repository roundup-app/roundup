//! A6 (rail tree) and A8 (persistence) through the module's RPC surface.

use contracts::agent::{NodeKind, Order, RailNode};
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

impl Fixture {
    async fn mv(&self, id: &str, parent: Option<&str>, index: u32) -> Result<Value, rpc::RpcError> {
        self.call(
            "rail.move",
            json!({"id": id, "parent": parent, "index": index}),
        )
        .await
    }
}

/// `name:order` of the children of `parent`, in tree order.
fn children(tree: &[RailNode], parent: Option<&str>) -> Vec<String> {
    tree.iter()
        .filter(|node| node.parent.as_deref() == parent)
        .map(|node| format!("{}:{}", node.name, node.order))
        .collect()
}

/// What the Rail keeps across a reopen: a running Agent's Status is not kept.
fn shape(tree: &[RailNode]) -> Vec<(String, NodeKind, String, Option<String>, u32)> {
    tree.iter()
        .map(|n| {
            (
                n.id.clone(),
                n.kind,
                n.name.clone(),
                n.parent.clone(),
                n.order,
            )
        })
        .collect()
}

#[tokio::test]
async fn a6_new_workstreams_are_appended_with_contiguous_order() {
    let mut f = Fixture::new();
    let a = f.workstream("a", None).await;
    f.workstream("b", None).await;
    f.spawn(Some(&a), None).await.unwrap();
    let tree = f.tree().await;
    assert_eq!(children(&tree, None), ["a:0", "b:1"]);
    assert_eq!(children(&tree, Some(&a)), ["new-agent:0"]);
    assert_eq!(f.changed(), 3);
}

#[tokio::test]
async fn a6_move_reorders_and_keeps_orders_contiguous_from_zero() {
    let mut f = Fixture::new();
    let a = f.workstream("a", None).await;
    let b = f.workstream("b", None).await;
    let c = f.workstream("c", None).await;
    f.changed();

    assert_eq!(f.mv(&c, None, 0).await.unwrap(), Value::Null);
    assert_eq!(children(&f.tree().await, None), ["c:0", "a:1", "b:2"]);

    let x = f.spawn(Some(&b), None).await.unwrap().id;
    f.changed();
    f.mv(&x, Some(&c), 5).await.unwrap();
    let tree = f.tree().await;
    assert_eq!(children(&tree, Some(&b)), Vec::<String>::new());
    assert_eq!(children(&tree, Some(&c)), ["new-agent:0"]);
    assert_eq!(f.changed(), 1);

    f.mv(&a, None, 2).await.unwrap();
    assert_eq!(children(&f.tree().await, None), ["c:0", "b:1", "a:2"]);
}

async fn equal_door_orders(f: &Fixture) -> [String; 2] {
    let mut ids = Vec::new();
    for name in ["first", "second"] {
        let node = f
            .call(
                "rail.createWorkstream",
                json!({"name": name, "parent": null, "order": {
                    "kind": "work", "ask": "check the release", "limits": []
                }}),
            )
            .await
            .unwrap();
        ids.push(node["id"].as_str().unwrap().to_owned());
    }
    assert_ne!(ids[0], ids[1]);
    ids.try_into().unwrap()
}

async fn assert_door_positions(f: &Fixture, ids: &[String; 2]) {
    let tree = f.tree().await;
    assert_eq!(
        tree.iter()
            .map(|node| (node.id.as_str(), node.order))
            .collect::<Vec<_>>(),
        [(ids[0].as_str(), 0), (ids[1].as_str(), 1)]
    );
    for node in tree {
        assert_eq!(
            node.work,
            Some(Order::Work {
                title: None,
                ask: "check the release".into(),
                done: None,
                limits: vec![],
            })
        );
        assert_eq!(node.terminal_id, None);
        assert_eq!(node.attempt, None);
    }
    assert!(f.terminals.list().await.is_empty());
}

#[tokio::test]
async fn a3903_equal_door_orders_keep_creation_positions() {
    let f = Fixture::new();
    let ids = equal_door_orders(&f).await;
    for _ in 0..3 {
        assert_door_positions(&f, &ids).await;
    }
    let f = f.reopen();
    for _ in 0..3 {
        assert_door_positions(&f, &ids).await;
    }
}

#[tokio::test]
async fn a3903_equal_door_orders_keep_an_explicit_move() {
    let f = Fixture::new();
    let [first, second] = equal_door_orders(&f).await;
    f.mv(&second, None, 0).await.unwrap();
    let ids = [second, first];
    for _ in 0..3 {
        assert_door_positions(&f, &ids).await;
    }
    let f = f.reopen();
    for _ in 0..3 {
        assert_door_positions(&f, &ids).await;
    }
}

#[tokio::test]
async fn a6_an_agent_cannot_move_into_its_own_descendant() {
    let mut f = Fixture::new();
    let w = f.workstream("w", None).await;
    let a = f.spawn(Some(&w), None).await.unwrap().id;
    let b = f.spawn_as_agent(&a).await;
    f.changed();
    for target in [&a, &b] {
        let err = f.mv(&a, Some(target), 0).await.unwrap_err();
        assert_eq!(err.code, code::CONFLICT);
    }
    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn a6_rename_changes_the_name_and_announces_it() {
    let mut f = Fixture::new();
    let a = f.workstream("a", None).await;
    f.changed();
    f.call("rail.rename", json!({"id": a, "name": "renamed"}))
        .await
        .unwrap();
    assert_eq!(children(&f.tree().await, None), ["renamed:0"]);
    assert_eq!(f.changed(), 1);
}

#[tokio::test]
async fn a6_unknown_nodes_are_not_found() {
    let f = Fixture::new();
    let err = f.mv("999", None, 0).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    let err = f
        .call(
            "rail.createWorkstream",
            json!({"name": "x", "parent": "999"}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
}

#[tokio::test]
async fn a6_the_tree_lists_parents_before_their_children() {
    let f = Fixture::new();
    let a = f.workstream("a", None).await;
    let b = f.workstream("b", None).await;
    f.spawn(Some(&a), None).await.unwrap();
    f.spawn(Some(&b), None).await.unwrap();
    f.mv(&b, None, 0).await.unwrap();
    let names: Vec<_> = f.tree().await.into_iter().map(|n| n.name).collect();
    assert_eq!(names, ["b", "new-agent", "a", "new-agent"]);
}

#[tokio::test]
async fn a8_workstreams_names_parents_and_order_survive_reopening() {
    let f = Fixture::new();
    let a = f.workstream("a", None).await;
    let b = f.workstream("b", None).await;
    f.spawn(Some(&a), None).await.unwrap();
    f.mv(&b, None, 0).await.unwrap();
    let before = shape(&f.tree().await);
    let after = shape(&f.reopen().tree().await);
    assert_eq!(after, before);
}

#[tokio::test]
async fn a7_workstream_restart_preserves_membership_and_fences_old_signals() {
    let f = Fixture::running("exec sleep 30");
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    assert_eq!(workstream["kind"], "workstream");
    assert_eq!(workstream["attempt"], Value::Null);
    let child = f.spawn(Some(id), None).await.unwrap();
    let first = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    assert_eq!(first["attempt"], "1");
    let live = f
        .call("rail.startDoor", json!({"id":id}))
        .await
        .unwrap_err();
    assert_eq!(live.code, code::CONFLICT);
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let second = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    assert_eq!(second["attempt"], "2");
    assert_ne!(first["terminal_id"], second["terminal_id"]);
    // A20: an earlier Attempt's Signal is ignored, never an error to the caller.
    let stale = f.call("agent.signal", json!({"id":id,"attempt":"1","payload":{"hook_event_name":"UserPromptSubmit","prompt":"wrong name"}})).await.unwrap();
    assert_eq!(stale, Value::Null);
    let tree = f.tree().await;
    assert_eq!(
        tree.iter()
            .find(|n| n.id == child.id)
            .unwrap()
            .parent
            .as_deref(),
        Some(id)
    );
    assert_eq!(tree.iter().find(|n| n.id == id).unwrap().name, "workstream");
    for target in [id, child.id.as_str()] {
        f.call("agent.stop", json!({"id":target})).await.unwrap();
    }
}

#[tokio::test]
async fn a8_a12_reopen_preserves_ordinal_with_reused_terminal_numbers() {
    let f = Fixture::running("exec sleep 30");
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap().to_owned();
    let first = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let f = f.reopen();
    assert!(f.terminals.list().await.is_empty());
    let node = &f.tree().await[0];
    assert_eq!(node.terminal_id, None);
    assert_eq!(node.attempt.as_deref(), Some("1"));
    assert_eq!(node.status_revision, None);
    let next = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    assert_eq!(first["terminal_id"], next["terminal_id"]);
    assert_eq!(next["attempt"], "2");
    // A20: the earlier Attempt is ignored; a malformed one is refused.
    let earlier = f
        .call("agent.signal", json!({"id":id,"attempt":"1","payload":{}}))
        .await
        .unwrap();
    assert_eq!(earlier, Value::Null);
    for (stamp, expected) in [
        ("", code::INVALID_PARAMS),
        ("01", code::INVALID_PARAMS),
        ("+2", code::INVALID_PARAMS),
        ("0", code::INVALID_PARAMS),
        ("9223372036854775808", code::INVALID_PARAMS),
    ] {
        let err = f
            .call(
                "agent.signal",
                json!({"id":id,"attempt":stamp,"payload":{}}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, expected, "{stamp}");
    }
    let missing = f
        .call("agent.signal", json!({"id":id,"payload":{}}))
        .await
        .unwrap_err();
    assert_eq!(missing.code, code::INVALID_PARAMS);
    f.call(
        "agent.signal",
        json!({"id":id,"attempt":"2","payload":{"hook_event_name":"Stop"}}),
    )
    .await
    .unwrap();
    f.call("agent.stop", json!({"id":id})).await.unwrap();
}

#[tokio::test]
async fn a7_failed_door_attempt_consumes_attempt_and_retry_keeps_children() {
    let f = Fixture::running("exec sleep 30");
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    let child = f.spawn(Some(id), None).await.unwrap();
    std::fs::remove_file(f.dir.path().join("rup")).unwrap();
    assert!(f.call("rail.startDoor", json!({"id":id})).await.is_err());
    let tree = f.tree().await;
    let stopped = tree.iter().find(|n| n.id == id).unwrap();
    assert_eq!(stopped.attempt.as_deref(), Some("1"));
    assert_eq!(stopped.terminal_id, None);
    assert_eq!(
        tree.iter()
            .find(|n| n.id == child.id)
            .unwrap()
            .parent
            .as_deref(),
        Some(id)
    );
    std::fs::write(f.dir.path().join("rup"), "").unwrap();
    let next = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    assert_eq!(next["attempt"], "2");
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    f.call("agent.stop", json!({"id":child.id})).await.unwrap();
}

#[tokio::test]
async fn a25_create_workstream_returns_a_node_of_kind_workstream() {
    let f = Fixture::new();
    let node = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    assert_eq!(node["kind"], "workstream");
    assert!(
        f.tree()
            .await
            .iter()
            .all(|n| n.kind == NodeKind::Workstream)
    );
}

#[tokio::test]
async fn a25_the_old_method_and_kind_do_not_exist() {
    let f = Fixture::new();
    let err = f
        .call("rail.createRoom", json!({"name":"room","parent":null}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::METHOD_NOT_FOUND);
    f.workstream("w", None).await;
    let tree = serde_json::to_string(&f.tree().await).unwrap();
    assert!(!tree.contains("\"room\""));
}

#[tokio::test]
async fn r16_empty_workstreams_keep_every_presentation_field() {
    let f = Fixture::new();
    let mut expected = Vec::new();
    for n in 0..40 {
        let node = f
            .call("rail.createWorkstream", json!({"name": format!("w{n}")}))
            .await
            .unwrap();
        expected.push(serde_json::from_value::<RailNode>(node).unwrap());
    }
    let tree = f.tree().await;
    assert_eq!(tree, expected);
    assert!(tree.iter().all(|n| !n.can_resume
        && n.channel.is_none()
        && n.stray.is_empty()
        && n.attempt.is_none()
        && n.status_revision.is_none()));
}

#[tokio::test]
async fn a2703a_rejected_calls_use_rail_names() {
    let f = Fixture::new();
    rusqlite::Connection::open(f.dir.path().join("agents.db")).unwrap()
        .execute_batch("DELETE FROM sqlite_sequence WHERE name = 'nodes'; INSERT INTO sqlite_sequence(name,seq) VALUES('nodes',7012)").unwrap();
    let first = f.spawn(None, None).await.unwrap();
    let second = f.spawn(None, None).await.unwrap();
    for (id, name) in [(&first.id, "sad"), (&second.id, "ancestor")] {
        f.call("rail.rename", json!({"id":id,"name":name}))
            .await
            .unwrap();
    }
    let error = f.mv(&first.id, Some(&second.id), 0).await.unwrap_err();
    assert_eq!(error.code, code::CONFLICT);
    assert!(
        !error.message.contains("7013")
            && !error.message.contains("7014")
            && error.message.contains("sad")
            && error.message.contains("ancestor"),
        "{error}"
    );
    let actor = contracts::Actor {
        kind: contracts::ActorKind::Agent,
        id: second.id.clone(),
        parent: None,
    };
    let ctx = rpc::Ctx { actor, ..f.ctx() };
    let error = rpc::Module::call(
        &f.agents,
        &ctx,
        "agent.setOrder",
        json!({"id":first.id,"order":{"kind":"work","title":"x","ask":"x","limits":[]}}),
    )
    .await
    .unwrap_err();
    assert!(
        !error.message.contains("7013")
            && !error.message.contains("7014")
            && error.message.contains("sad")
            && error.message.contains("ancestor"),
        "{error}"
    );
    for method in ["agent.prompt", "agent.interrupt"] {
        let ctx = rpc::Ctx {
            actor: contracts::Actor {
                kind: contracts::ActorKind::Ext,
                id: "extension".into(),
                parent: None,
            },
            ..f.ctx()
        };
        for (id, name) in [(&first.id[..], "sad"), ("8013", "an Agent that is gone")] {
            let error = rpc::Module::call(&f.agents, &ctx, method, json!({"id":id,"text":"hello"}))
                .await
                .unwrap_err();
            assert_eq!(error.code, code::FORBIDDEN);
            assert!(
                error.message.contains(name) && !error.message.contains(id),
                "{method}: {error}"
            );
        }
    }
    let missing = f.mv("8013", None, 0).await.unwrap_err();
    assert!(
        missing.message.contains("an Agent that is gone") && !missing.message.contains("8013"),
        "{missing}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a2741a_delayed_consumer_keeps_each_committed_name() {
    let f = std::sync::Arc::new(Fixture::running("exec sleep 30"));
    let node = f.spawn(None, None).await.unwrap();
    f.call("rail.rename", json!({"id":node.id,"name":"sad"}))
        .await
        .unwrap();
    let mut events = f.bus.subscribe();
    for name in ["sad-2", "sad-3"] {
        f.call("rail.rename", json!({"id":node.id,"name":name}))
            .await
            .unwrap();
    }
    assert_eq!(
        crate::common::renames(&mut events),
        [
            (node.id.clone(), "sad-2".into()),
            (node.id.clone(), "sad-3".into())
        ]
    );
    assert_eq!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .name,
        "sad-3"
    );

    let gate = std::sync::Arc::new(tokio::sync::Barrier::new(2));
    let mut calls = Vec::new();
    for name in ["concurrent-a", "concurrent-b"] {
        let f = std::sync::Arc::clone(&f);
        let gate = std::sync::Arc::clone(&gate);
        let id = node.id.clone();
        calls.push(tokio::spawn(async move {
            gate.wait().await;
            f.call("rail.rename", json!({"id":id,"name":name}))
                .await
                .unwrap();
        }));
    }
    for call in calls {
        call.await.unwrap();
    }
    let changes = crate::common::renames(&mut events);
    assert_eq!(changes.len(), 2);
    let mut names: Vec<_> = changes
        .iter()
        .map(|(id, name)| {
            assert_eq!(id, &node.id);
            name.as_str()
        })
        .collect();
    names.sort_unstable();
    assert_eq!(names, ["concurrent-a", "concurrent-b"]);
    assert_eq!(
        changes.last().unwrap().1,
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .name
    );
}

#[tokio::test]
async fn a2741a_only_committed_rpc_name_changes_are_exposed() {
    use contracts::{Actor, ActorKind};
    use rpc::Module;
    let mut f = Fixture::running("exec sleep 30");
    let owner = f.spawn(None, None).await.unwrap();
    let target = f.spawn_as_agent(&owner.id).await;
    let stranger = f.spawn(None, None).await.unwrap();
    let workstream = f.workstream("work", None).await;
    f.changed();
    let mut events = f.bus.subscribe();
    let mut agent = f.ctx();
    agent.actor = Actor {
        kind: ActorKind::Agent,
        id: owner.id.clone(),
        parent: None,
    };
    // Named cases share one observation window; the final unrelated rename bounds absence.
    f.call("rail.rename", json!({"id":target,"name":"by-user"}))
        .await
        .unwrap();
    f.agents
        .call(
            &agent,
            "rail.rename",
            json!({"id":target,"name":"by-agent"}),
        )
        .await
        .unwrap();
    f.call("rail.rename", json!({"id":target,"name":"by-agent"}))
        .await
        .unwrap(); // same name
    let denied = f
        .agents
        .call(
            &agent,
            "rail.rename",
            json!({"id":stranger.id,"name":"forbidden"}),
        )
        .await
        .unwrap_err();
    assert_eq!(denied.code, code::FORBIDDEN, "unauthorized Agent");
    let missing = f
        .call("rail.rename", json!({"id":"999999","name":"missing"}))
        .await
        .unwrap_err();
    assert_eq!(missing.code, code::NOT_FOUND, "unknown target");
    let created = f.workstream("created", None).await; // creation
    f.mv(&created, None, 0).await.unwrap(); // reorder
    f.mv(&stranger.id, Some(&workstream), 0).await.unwrap(); // move
    f.call("agent.signal", json!({"id":stranger.id,"attempt":f.attempt(&stranger.id).await,"payload":{"hook_event_name":"Stop"}})).await.unwrap(); // Status
    f.call("rail.rename", json!({"id":workstream,"name":"barrier"}))
        .await
        .unwrap();
    assert_eq!(
        crate::common::renames(&mut events),
        [
            (target.clone(), "by-user".into()),
            (target.clone(), "by-agent".into()),
            (workstream.clone(), "barrier".into())
        ]
    );
    assert_eq!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == stranger.id)
            .unwrap()
            .name,
        stranger.name
    );
    // Three successful RPC calls (including same-name), create, reorder, move and barrier.
    assert_eq!(f.changed(), 7);
}

#[tokio::test]
async fn a2741a_workstream_changes_keep_the_door_destination_without_starting() {
    for running in [true, false] {
        let f = Fixture::running("echo launch >> \"$(dirname \"$0\")/launches\"; exec sleep 30");
        let id = f.workstream("sad", None).await;
        f.call("rail.startDoor", json!({"id":id})).await.unwrap();
        let launches = crate::common::until_file(&f.dir.path().join("launches")).await;
        if !running {
            f.call("agent.stop", json!({"id":id})).await.unwrap();
        }
        let before = f.tree().await;
        let terminals = serde_json::to_value(f.terminals.list().await).unwrap();
        let mut events = f.bus.subscribe();
        for name in ["sad-2", "sad-3"] {
            f.call("rail.rename", json!({"id":id,"name":name}))
                .await
                .unwrap();
        }
        assert_eq!(
            crate::common::renames(&mut events),
            [(id.clone(), "sad-2".into()), (id.clone(), "sad-3".into())],
            "running={running}"
        );
        let after = f.tree().await;
        assert_eq!(
            after
                .iter()
                .map(|n| (&n.id, &n.attempt, &n.terminal_id))
                .collect::<Vec<_>>(),
            before
                .iter()
                .map(|n| (&n.id, &n.attempt, &n.terminal_id))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            serde_json::to_value(f.terminals.list().await).unwrap(),
            terminals
        );
        assert_eq!(
            std::fs::read_to_string(f.dir.path().join("launches")).unwrap(),
            launches
        );
        assert_eq!(after.iter().find(|n| n.id == id).unwrap().name, "sad-3");
    }
}
