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

#[tokio::test]
async fn a4700a_a_new_workstream_starts_by_rail_name() {
    for selector in ["todo-pad-views", "name:todo-pad-views"] {
        start_workstream_door(Some(selector)).await;
    }
}

#[tokio::test]
async fn a4700b_a_new_workstream_starts_by_id() {
    start_workstream_door(None).await;
}

async fn start_workstream_door(selector: Option<&str>) {
    let fake = format!(
        "#!/bin/sh\nexec python3 '{}/tests/e2e/fake_claude.py' \"$@\"\n",
        env!("CARGO_MANIFEST_DIR")
    );
    let served = Served::start(&fake, &[("FAKE_CLAUDE_PROMPT_LOG", "/dev/null")]).await;
    let user = client_as(&served.socket(), Actor::user()).await;
    let shim = spawn_shim(&served.socket(), "").await;
    let made = shim
        .call(
            "rail_createWorkstream",
            json!({"name":"todo-pad-views","parent":null}),
        )
        .await;
    assert_eq!(made.is_error, Some(false), "{made:?}");
    let made = text(&made);
    let id = made["id"].as_str().unwrap();
    assert!(made["attempt"].is_null());
    assert!(
        user.request("terminal.list", ())
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    let mut events = rpc::Client::connect(&served.socket()).await.unwrap();
    events.request("events.subscribe", ()).await.unwrap();
    let started = shim
        .call("rail_startDoor", json!({"id":selector.unwrap_or(id)}))
        .await;
    assert_eq!(started.is_error, Some(false), "{selector:?}: {started:?}");
    let started = text(&started);
    assert_eq!(started["id"], id);
    tokio::time::timeout(
        Duration::from_secs(4),
        common::NamedRail::idle(&mut events, id),
    )
    .await
    .expect("fake vendor launched and became idle");
    let tree = user.request("rail.tree", ()).await.unwrap();
    let nodes = tree.as_array().unwrap();
    assert_eq!(nodes.len(), 1, "no replacement Workstream");
    assert_eq!(nodes[0]["id"], id);
    assert_eq!(nodes[0]["attempt"], started["attempt"]);
    assert!(!nodes[0]["attempt"].is_null());
    let terminals = user.request("terminal.list", ()).await.unwrap();
    let terminals = terminals.as_array().unwrap();
    assert_eq!(terminals.len(), 1);
    assert_eq!(terminals[0]["id"], started["terminal_id"]);
    assert_eq!(nodes[0]["terminal_id"], started["terminal_id"]);
    assert_eq!(terminals[0]["running"], true);
    user.request("agent.stop", json!({"id":id})).await.unwrap();
}

#[tokio::test]
async fn a4700c_an_unknown_workstream_name_is_named_without_starting() {
    for selector in ["missing-workstream", "name:missing-workstream"] {
        let served = Served::start("#!/bin/sh\nexit 1\n", &[]).await;
        let user = client_as(&served.socket(), Actor::user()).await;
        let shim = spawn_shim(&served.socket(), "").await;
        let made = shim
            .call(
                "rail_createWorkstream",
                json!({"name":"todo-pad-views","parent":null}),
            )
            .await;
        assert_eq!(made.is_error, Some(false), "{made:?}");
        let before = user.request("rail.tree", ()).await.unwrap();
        let terminals = user.request("terminal.list", ()).await.unwrap();
        let refused = shim.call("rail_startDoor", json!({"id":selector})).await;
        assert_eq!(refused.is_error, Some(true), "{refused:?}");
        let error = text(&refused);
        assert_eq!(error["code"], rpc::code::NOT_FOUND);
        let message = error["message"].as_str().unwrap();
        assert!(message.contains("missing-workstream"), "{message}");
        assert!(!message.contains("an Agent that is gone"), "{message}");
        assert_eq!(user.request("rail.tree", ()).await.unwrap(), before);
        assert_eq!(user.request("terminal.list", ()).await.unwrap(), terminals);
    }
}
