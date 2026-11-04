//! Child coordination and visibility through the real Daemon.
use super::*;

struct B53 {
    served: Served,
    user: rpc::Client,
    door: String,
    child: String,
    terminal: String,
}

async fn b53_fixture() -> B53 {
    b53_fixture_with(&[]).await
}

async fn b53_fixture_with(extra_env: &[(&str, &str)]) -> B53 {
    let served = Served::start(
        "#!/bin/sh\necho launch >> \"$CLAUDE_CONFIG_DIR/launches\"\nsleep 30\n",
        extra_env,
    )
    .await;
    let user = rpc::Client::connect(&served.socket()).await.unwrap();
    let cwd = served.dir.path().to_string_lossy().into_owned();
    let door = user
        .request(
            "rail.createWorkstream",
            json!({"name": "m", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let child = user
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": door}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let tree = user.request("rail.tree", Value::Null).await.unwrap();
    let terminal = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == child.as_str())
        .and_then(|node| node["terminal_id"].as_str())
        .expect("the child has a Terminal")
        .to_owned();
    B53 {
        served,
        user,
        door,
        child,
        terminal,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn b53_a_send_without_a_kind_names_the_field_and_its_values() {
    let fx = b53_fixture().await;
    let shim = spawn_shim(&fx.served.socket(), &fx.door).await;
    let before = fx.user.request("message.list", json!({})).await.unwrap();

    let sent = shim
        .call("message_send", json!({"to": fx.child, "body": "hello"}))
        .await;

    let text = error_text(&sent);
    assert!(
        text.contains(&format!("{}", rpc::code::INVALID_PARAMS)),
        "{text}"
    );
    for word in ["kind", "note", "question"] {
        assert!(text.contains(word), "{text}");
    }
    let after = fx.user.request("message.list", json!({})).await.unwrap();
    assert_eq!(before, after);
}

#[tokio::test(flavor = "multi_thread")]
async fn b53_a_show_request_opens_the_terminal_and_reads_nothing() {
    let fx = b53_fixture().await;
    let mut events = rpc::Client::connect(&fx.served.socket()).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let shim = spawn_shim(&fx.served.socket(), &fx.door).await;
    let before = fx.user.request("message.list", json!({})).await.unwrap();

    let shown = shim.call("terminal_show", json!({"id": fx.terminal})).await;

    assert_eq!(shown.is_error, Some(false), "{shown:?}");
    let seen = tokio::time::timeout(BOUND, async {
        while let Some(event) = events.next_event().await {
            if let contracts::EventData::TerminalShown(shown) = event.data {
                return shown.id;
            }
        }
        panic!("the connection closed before terminal.shown");
    })
    .await
    .expect("terminal.shown arrived");
    assert_eq!(seen, fx.terminal);
    // Nothing else came of it: no Message, and no byte written to the Terminal.
    assert_eq!(
        before,
        fx.user.request("message.list", json!({})).await.unwrap()
    );
    let screen = fx
        .user
        .request("terminal.screen", json!({"id": fx.terminal}))
        .await
        .unwrap();
    assert_eq!(screen["offset"], 0, "{screen}");
}

#[tokio::test(flavor = "multi_thread")]
async fn b53_show_is_forbidden_outside_reach_and_absent_for_an_agent() {
    let fx = b53_fixture().await;
    let cwd = fx.served.dir.path().to_string_lossy().into_owned();
    let other = fx
        .user
        .request(
            "rail.createWorkstream",
            json!({"name": "other", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fx.user
        .request("rail.startDoor", json!({"id": other}))
        .await
        .unwrap();
    let stranger = fx
        .user
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": other}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let tree = fx.user.request("rail.tree", Value::Null).await.unwrap();
    let foreign = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == stranger.as_str())
        .and_then(|node| node["terminal_id"].as_str())
        .unwrap()
        .to_owned();
    let mut events = rpc::Client::connect(&fx.served.socket()).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;

    let outside = door.call("terminal_show", json!({"id": foreign})).await;
    let unknown = door.call("terminal_show", json!({"id": "99999"})).await;
    let agent = spawn_shim(&fx.served.socket(), &fx.child).await;
    let offered = agent.client.list_all_tools().await.unwrap();
    let call = agent
        .client
        .call_tool(
            CallToolRequestParams::new("terminal_show")
                .with_arguments(json!({"id": fx.terminal}).as_object().unwrap().clone()),
        )
        .await;

    assert_eq!(
        serde_json::from_str::<Value>(&error_text(&outside)).unwrap()["code"],
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        serde_json::from_str::<Value>(&error_text(&unknown)).unwrap()["code"],
        rpc::code::NOT_FOUND
    );
    assert!(offered.iter().all(|t| t.name != "terminal_show"));
    assert!(
        call.is_err() || call.unwrap().is_error == Some(true),
        "an Agent's terminal_show must fail"
    );
    // A Daemon-side event for any of the three would have been emitted by now.
    let late = tokio::time::timeout(Duration::from_millis(500), async {
        while let Some(event) = events.next_event().await {
            if matches!(event.data, contracts::EventData::TerminalShown(_)) {
                return true;
            }
        }
        false
    })
    .await;
    assert!(
        late.is_err() || late == Ok(false),
        "terminal.shown was emitted"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn u5531a_door_tool_round_trip_and_reopen() {
    let owner = std::env::var_os("ROUNDUP_TEST_APP_BIN")
        .map(|dir| std::path::PathBuf::from(dir).join("terminal-owner"))
        .unwrap_or_else(|| {
            std::path::PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("terminal-owner")
        });
    assert!(owner.is_file(), "run `cargo build -p terminal --bins`");
    let env = [("RUPD_TERMINAL_OWNER", owner.to_str().unwrap())];
    let mut fx = b53_fixture_with(&env).await;
    let shim = spawn_shim(&fx.served.socket(), &fx.door).await;
    let before = fx.user.request("rail.tree", Value::Null).await.unwrap();
    let terminals = fx.user.request("terminal.list", Value::Null).await.unwrap();
    let original_terminal = terminals
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == fx.terminal)
        .unwrap()
        .clone();
    let tools = shim.client.list_all_tools().await.unwrap();
    let fixture_dir = fx.served.dir.path();
    let config_paths: Vec<_> = [&fx.door, &fx.child]
        .into_iter()
        .flat_map(|id| {
            ["settings.json", "brief.md", "mcp.json"]
                .into_iter()
                .map(move |suffix| {
                    fixture_dir
                        .join(".roundup/agents")
                        .join(format!("{id}.{suffix}"))
                })
        })
        .collect();
    let config_bytes: Vec<_> = config_paths
        .iter()
        .map(|path| std::fs::read(path).unwrap())
        .collect();
    for visibility in ["internal", "internal", "shown"] {
        let result = shim
            .call(
                "agent_set_visibility",
                json!({"id":fx.child,"visibility":visibility}),
            )
            .await;
        assert_eq!(result.is_error, Some(false), "{result:?}");
        let node = text(&result);
        assert_eq!(node["visibility"], visibility);
        let tree = fx.user.request("rail.tree", Value::Null).await.unwrap();
        let original = before
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == fx.child)
            .unwrap();
        let current = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == fx.child)
            .unwrap();
        for key in ["id", "parent", "order", "attempt", "terminal_id"] {
            assert_eq!(original[key], current[key], "{key}");
        }
        assert_eq!(current["visibility"], visibility);
        assert_eq!(
            config_bytes,
            config_paths
                .iter()
                .map(|path| std::fs::read(path).unwrap())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            fx.user
                .request("terminal.screen", json!({"id":fx.terminal}))
                .await
                .unwrap()["offset"],
            0
        );
    }
    assert_eq!(
        serde_json::to_vec(&tools).unwrap(),
        serde_json::to_vec(&shim.client.list_all_tools().await.unwrap()).unwrap()
    );
    let result = shim
        .call(
            "agent_set_visibility",
            json!({"id":fx.child,"visibility":"internal"}),
        )
        .await;
    assert_eq!(result.is_error, Some(false));
    let launches = std::fs::read(fx.served.dir.path().join("launches")).unwrap();
    fx.user
        .request("agent.stop", json!({"id":fx.door}))
        .await
        .unwrap();
    drop(shim);
    fx.served.restart(&env).await;
    let reopened = rpc::Client::connect(&fx.served.socket()).await.unwrap();
    let tree = reopened.request("rail.tree", Value::Null).await.unwrap();
    let node = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == fx.child)
        .unwrap();
    assert_eq!(node["visibility"], "internal");
    let terminals = reopened
        .request("terminal.list", Value::Null)
        .await
        .unwrap();
    let terminal = terminals
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == node["terminal_id"])
        .expect("the same child still has its verified Terminal");
    assert!(original_terminal["incarnation"].is_string());
    assert!(original_terminal["program_pid"].is_number());
    assert_eq!(terminal["incarnation"], original_terminal["incarnation"]);
    assert_eq!(terminal["program_pid"], original_terminal["program_pid"]);
    assert_eq!(terminal["running"], true);
    let original = before
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == fx.child)
        .unwrap();
    for key in ["id", "parent", "order", "attempt"] {
        assert_eq!(node[key], original[key], "{key}");
    }
    assert_eq!(
        std::fs::read(fx.served.dir.path().join("launches")).unwrap(),
        launches
    );
    reopened
        .request("agent.stop", json!({"id":fx.child}))
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn u5531a_visibility_authority_is_enforced_by_the_daemon() {
    let fx = b53_fixture().await;
    let other = fx
        .user
        .request("rail.createWorkstream", json!({"name":"other"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let child_rpc = client_as(&fx.served.socket(), agent(&fx.child)).await;
    let nested = child_rpc
        .request("agent.spawn", json!({"cwd":fx.served.dir.path()}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut touches = Vec::new();
    for id in [&fx.door, &fx.child, &nested, &other] {
        let item = format!("agent:{id}");
        let history = fx
            .user
            .request("provenance.history", json!({"item":item}))
            .await
            .unwrap();
        touches.push((item, history));
    }
    let before = fx.user.request("rail.tree", Value::Null).await.unwrap();
    let launches = std::fs::read(fx.served.dir.path().join("launches")).unwrap();
    let events = fx
        .user
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    for (actor, target) in [
        (&fx.door, &nested),
        (&fx.child, &fx.child),
        (&fx.door, &fx.door),
        (&other, &fx.child),
        (&fx.child, &fx.door),
    ] {
        let client = client_as(&fx.served.socket(), agent(actor)).await;
        let error = client
            .request(
                "agent.setVisibility",
                json!({"id":target,"visibility":"internal"}),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN, "{error:?}");
        let error = client
            .request(
                "agent.setVisibility",
                json!({"id":"999999","visibility":"internal"}),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::NOT_FOUND);
    }
    assert_eq!(
        before,
        fx.user.request("rail.tree", Value::Null).await.unwrap()
    );

    let error = fx
        .user
        .request(
            "agent.setVisibility",
            json!({"id":fx.child,"visibility":"hidden"}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    for (item, history) in touches {
        assert_eq!(
            history,
            fx.user
                .request("provenance.history", json!({"item":item}))
                .await
                .unwrap(),
            "refused calls write no Touch for {item}"
        );
    }
    assert_eq!(
        events,
        fx.user
            .request("events.subscribe", Value::Null)
            .await
            .unwrap(),
        "refused calls emit no mutation events"
    );
    assert_eq!(
        launches,
        std::fs::read(fx.served.dir.path().join("launches")).unwrap()
    );
    for actor in [
        Actor::user(),
        Actor {
            kind: ActorKind::Ext,
            id: "fixture".into(),
            parent: None,
        },
    ] {
        let client = client_as(&fx.served.socket(), actor).await;
        assert_eq!(
            client
                .request(
                    "agent.setVisibility",
                    json!({"id":fx.child,"visibility":"internal"})
                )
                .await
                .unwrap()["visibility"],
            "internal"
        );
        assert_eq!(
            client
                .request(
                    "agent.setVisibility",
                    json!({"id":fx.door,"visibility":"internal"})
                )
                .await
                .unwrap_err()
                .code,
            rpc::code::FORBIDDEN
        );
    }
    let shim = spawn_shim(&fx.served.socket(), &fx.child).await;
    assert!(
        !shim
            .client
            .list_all_tools()
            .await
            .unwrap()
            .iter()
            .any(|t| t.name == "agent_set_visibility")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn u5531a_spawn_visibility_is_atomic_and_defaults_shown() {
    let fx = b53_fixture().await;
    let door = client_as(&fx.served.socket(), agent(&fx.door)).await;
    for (input, expected) in [
        (Value::Null, "shown"),
        (json!("shown"), "shown"),
        (json!("internal"), "internal"),
    ] {
        let mut args = json!({"cwd":fx.served.dir.path(),"name":"helper"});
        if !input.is_null() {
            args["visibility"] = input;
        }
        let node = door.request("agent.spawn", args).await.unwrap();
        assert_eq!(node["visibility"], expected);
        assert_eq!(node["parent"], fx.door);
        let tree = fx.user.request("rail.tree", Value::Null).await.unwrap();
        assert_eq!(
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == node["id"])
                .unwrap()["visibility"],
            expected
        );
    }
    let child = client_as(&fx.served.socket(), agent(&fx.child)).await;
    let before = fx.user.request("rail.tree", Value::Null).await.unwrap();
    let launches = std::fs::read(fx.served.dir.path().join("launches")).unwrap();
    let events = fx
        .user
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    assert_eq!(
        child
            .request(
                "agent.spawn",
                json!({"cwd":fx.served.dir.path(),"visibility":"internal"})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        before,
        fx.user.request("rail.tree", Value::Null).await.unwrap()
    );
    assert_eq!(
        events,
        fx.user
            .request("events.subscribe", Value::Null)
            .await
            .unwrap()
    );
    assert_eq!(
        launches,
        std::fs::read(fx.served.dir.path().join("launches")).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn u5531c_promotion_stays_shown_until_a_new_safe_door_choice() {
    let fx = b53_fixture().await;
    let door = client_as(&fx.served.socket(), agent(&fx.door)).await;
    let child = client_as(&fx.served.socket(), agent(&fx.child)).await;
    let choose = json!({"id":fx.child,"visibility":"internal"});
    for (payload, promoted) in [
        (
            json!({"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"true"}}),
            true,
        ),
        (
            json!({"hook_event_name":"Stop","prompt_id":"turn","last_assistant_message":"All done"}),
            false,
        ),
        (json!({"hook_event_name":"Stop","prompt_id":"turn"}), false),
        (
            json!({"hook_event_name":"Stop","prompt_id":"turn","last_assistant_message":""}),
            false,
        ),
    ] {
        fx.user.request("agent.signal",json!({"id":fx.child,"attempt":"1","payload":{"hook_event_name":"UserPromptSubmit","prompt_id":"turn"}})).await.unwrap();
        door.request("agent.setVisibility", choose.clone())
            .await
            .unwrap();
        fx.user
            .request(
                "agent.signal",
                json!({"id":fx.child,"attempt":"1","payload":payload}),
            )
            .await
            .unwrap();
        let tree = fx.user.request("rail.tree", Value::Null).await.unwrap();
        assert_eq!(
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == fx.child)
                .unwrap()["visibility"],
            if promoted { "shown" } else { "internal" }
        );
        if promoted {
            assert_eq!(
                door.request("agent.setVisibility", choose.clone())
                    .await
                    .unwrap_err()
                    .code,
                rpc::code::INVALID_PARAMS
            );
        }
        fx.user.request("agent.signal",json!({"id":fx.child,"attempt":"1","payload":{"hook_event_name":"UserPromptSubmit","prompt_id":"resumed"}})).await.unwrap();
        let tree = fx.user.request("rail.tree", Value::Null).await.unwrap();
        assert_eq!(
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == fx.child)
                .unwrap()["visibility"],
            if promoted { "shown" } else { "internal" }
        );
    }
    // U5940a: a question Message or a Clarification order never keeps a child shown.
    let shown = |tree: &Value| {
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == fx.child)
            .unwrap()["visibility"]
            .clone()
    };
    door.request("agent.setVisibility", choose.clone())
        .await
        .unwrap();
    child
        .request(
            "message.send",
            json!({"to":fx.door,"kind":"question","body":"Which target?"}),
        )
        .await
        .unwrap();
    assert_eq!(
        shown(&fx.user.request("rail.tree", Value::Null).await.unwrap()),
        "internal"
    );
    child
        .request(
            "agent.setOrder",
            json!({"id":fx.child,"order":{"kind":"clarification","question":"Which release?"}}),
        )
        .await
        .unwrap();
    assert_eq!(
        door.request("agent.setVisibility", choose).await.unwrap()["visibility"],
        "internal"
    );
}
