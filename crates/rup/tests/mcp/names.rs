use super::*;

#[tokio::test]
async fn m2706a_actions_name_rail_nodes() {
    named_actions(false).await;
}

#[tokio::test]
async fn m2706a_actions_use_names_after_rename() {
    named_actions(true).await;
}

async fn named_actions(rename: bool) {
    let mut fx = common::NamedRail::start().await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    let user = spawn_shim(&fx.served.socket(), "").await;
    if rename {
        let discarded = door.call("agent_discard", json!({"id":fx.child})).await;
        assert_eq!(discarded.is_error, Some(false), "{discarded:?}");
        // Discard removes the identity permanently; recreate its precondition before renaming.
        fx.child = fx.spawn("Writer").await;
    }
    for phase in 0..=usize::from(rename) {
        if phase == 1 {
            fx.rename().await;
        }
        let (door_name, child_name) = if phase == 0 {
            ("Research", "Writer")
        } else {
            ("Planning", "Author")
        };
        let moved = door
            .call(
                "rail_move",
                json!({"id":fx.child,"parent":fx.door,"index":0}),
            )
            .await;
        assert_eq!(moved.is_error, Some(false), "{moved:?}");
        assert_eq!(
            moved.content[0].as_text().unwrap().text,
            format!("moved {child_name} to {door_name}")
        );
        let tree = fx.user.request("rail.tree", ()).await.unwrap();
        let child = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == fx.child)
            .unwrap();
        assert_eq!(child["parent"], fx.door);
        assert_eq!(child["order"], 0);
        let moved = user
            .call("rail_move", json!({"id":fx.door,"parent":null,"index":0}))
            .await;
        assert_eq!(
            moved.content[0].as_text().unwrap().text,
            format!("moved {door_name} to Project root")
        );
    }
    // Discard deletes its node; names must have been resolved before the call.
    let name = if rename { "Author" } else { "Writer" };
    let tree = fx.user.request("rail.tree", ()).await.unwrap();
    let path = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == fx.child)
        .unwrap()["worktree"]["path"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(Path::new(&path).exists());
    let discarded = door.call("agent_discard", json!({"id":fx.child})).await;
    assert_eq!(discarded.is_error, Some(false), "{discarded:?}");
    assert_eq!(
        discarded.content[0].as_text().unwrap().text,
        format!("discarded Worktree of Agent {name}")
    );
    assert!(!Path::new(&path).exists());
    let tree = fx.user.request("rail.tree", ()).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .all(|node| node["id"] != fx.child)
    );
    for phase in 0..=usize::from(rename) {
        let name = if phase == 0 { "Research" } else { "Planning" };
        fx.user
            .request("rail.rename", json!({"id":fx.door,"name":name}))
            .await
            .unwrap();
        let mut events = fx.begin_clear().await;
        let handed = door
            .call(
                "workstream_handoff",
                json!({"summary":"Reviewed the work","keep_todos":[],"keep_pads":[]}),
            )
            .await;
        assert_eq!(handed.is_error, Some(false), "{handed:?}");
        assert_eq!(
            handed.content[0].as_text().unwrap().text,
            format!("handed off Workstream {name}")
        );
        assert_eq!(
            fx.cleared(&mut events).await,
            u32::try_from(phase).unwrap() + 2
        );
    }
}

#[tokio::test]
async fn m2706a_data_names_every_referenced_agent() {
    let fx = common::NamedRail::start().await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    let child = spawn_shim(&fx.served.socket(), &fx.child).await;
    for renamed in [false, true] {
        if renamed {
            fx.rename().await;
        }
        let (parent, name, peer) = if renamed {
            ("Planning", "Author", "Editor")
        } else {
            ("Research", "Writer", "Reviewer")
        };
        let tree = text(&door.call("rail_tree", json!({})).await);
        let node = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == fx.child)
            .unwrap();
        assert_eq!(node["name"], name);
        assert_eq!(node["parent_name"], parent);
        let context = text(&child.call("agent_context", json!({})).await);
        assert_eq!(context["self"]["name"], name);
        assert_eq!(context["parent"]["name"], parent);
        assert_eq!(context["ask"]["name"], parent);
        assert_eq!(context["peers"][0]["name"], peer);
        let digest = text(&door.call("agent_digest", json!({})).await);
        assert!(
            digest["children"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["name"] == name)
        );
    }
}

#[tokio::test]
async fn m2706a_non_agent_identifiers_keep_their_meaning() {
    let fx = common::NamedRail::start().await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    let todo = fx
        .user
        .request("todo.create", json!({"title":"Notes"}))
        .await
        .unwrap();
    let deleted = door
        .call(
            "todo_delete",
            json!({"operation": "named-delete", "ids": [todo["id"]]}),
        )
        .await;
    assert_eq!(
        deleted.content[0].as_text().unwrap().text,
        json!({"operation":"named-delete","deleted":[todo["id"]],"missing":[],"state":"deleted"})
            .to_string()
    );
    let terminal = fx
        .user
        .request("terminal.open", json!({"workstream":fx.door}))
        .await
        .unwrap()["terminal_id"]
        .clone();
    assert_ne!(
        terminal, fx.door,
        "Terminal and owner identities must differ in this fixture"
    );
    let shown = door.call("terminal_show", json!({"id":terminal})).await;
    assert_eq!(
        shown.content[0].as_text().unwrap().text,
        format!("showing Terminal {}", terminal.as_str().unwrap())
    );
}

#[tokio::test]
async fn m2706a_a_failed_name_lookup_sends_no_action() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("invalid-rail.sock");
    let mut seen = fake_daemon(
        &socket,
        &[
            "daemon.identify",
            "agent.channelUp",
            "rail.tree",
            "agent.discard",
        ],
    );
    let shim = spawn_shim(&socket, "7013").await;
    let reply = shim.call("agent_discard", json!({"id":"7014"})).await;
    assert_eq!(reply.is_error, Some(true));
    let raw = reply.content[0].as_text().unwrap().text.as_str();
    assert!(!raw.contains("7013") && !raw.contains("7014"), "{raw}");
    let mut reads = 0;
    while let Ok(request) = seen.try_recv() {
        assert_ne!(request["method"], "agent.discard");
        reads += usize::from(request["method"] == "rail.tree");
    }
    assert_eq!(reads, 2, "startup and the action each read the Rail");
}
