//! A32: the iterations a Clear advances and the fresh Door it restarts.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};
use daemon::{next, rail_tree};
use serde_json::{Value, json};
use std::time::Duration;
#[path = "common/clear_fixture.rs"]
#[allow(dead_code)]
mod clear_fixture;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use waiting::{idle, received, turn_done, until};

use clear_fixture::clear_fixture;

#[tokio::test]
async fn a32_message_list_spans_iterations() {
    tokio::time::timeout(Duration::from_secs(60), async {
        let project = daemon::start_real("a32_message_history", &[]);
        let path = project.dir.path();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.name", "roundup"],
            vec!["config", "user.email", "roundup@example.com"],
        ] {
            assert!(
                std::process::Command::new("git")
                    .current_dir(path)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        std::fs::write(path.join("README"), "keep").unwrap();
        for args in [vec!["add", "README"], vec!["commit", "-qm", "base"]] {
            assert!(
                std::process::Command::new("git")
                    .current_dir(path)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let mut client = project.subscribed().await;
        client
            .request("project.setWorktrees", json!({"on": true, "check": null}))
            .await
            .unwrap();
        let door = client
            .request(
                "rail.createWorkstream",
                json!({"name": "team", "parent": null}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        client
            .request("rail.startDoor", json!({"id": door}))
            .await
            .unwrap();
        let model = project.model.as_ref().unwrap();
        // SessionStart also emits Idle (claude_code::hook_status), before the first prompt
        // finishes. Observe that prompt at the model before accepting Idle as its completion.
        until("the Door's startup turn reached the model", || {
            model.journal().iter().any(|entry| {
                entry["body"]["tools"]
                    .as_array()
                    .is_some_and(|tools| !tools.is_empty())
                    && entry["body"]["messages"]
                        .as_array()
                        .is_some_and(|messages| messages.iter().any(|m| m["role"] == "user"
                            && m["content"].as_str().is_some_and(|text|
                                text.contains("Follow this instruction: What is this Workstream for?"))))
            }).then_some(())
        }).await;
        idle(&client, &door).await;
        client
            .request(
                "message.send",
                json!({"to": door, "kind": "note", "body": "first ask"}),
            )
            .await
            .unwrap();
        turn_done(model, &client, &door, "first ask").await;
        assert_eq!(
            client
                .request(
                    "workstream.clear",
                    json!({"id": door, "reason": "history clear"})
                )
                .await
                .unwrap(),
            json!({"pending": true})
        );
        received(model, "history clear").await;
        let actor = project.client().await;
        actor
            .request(
                "daemon.identify",
                contracts::IdentifyParams {
                    actor: contracts::Actor {
                        kind: contracts::ActorKind::Agent,
                        id: door.clone(),
                        parent: None,
                    },
                },
            )
            .await
            .unwrap();
        actor
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "History survived", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
        let cleared = next(&mut client, |event| match event {
            EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
            _ => None,
        })
        .await;
        assert_eq!(cleared.iteration, 2);
        turn_done(model, &client, &door, "History survived").await;
        client
            .request(
                "message.send",
                json!({"to": door, "kind": "note", "body": "second ask"}),
            )
            .await
            .unwrap();
        turn_done(model, &client, &door, "second ask").await;
        let listed = client
            .request("message.list", json!({"id": door}))
            .await
            .unwrap();
        let seen: Vec<(String, u64)> = listed
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| !m["body"].as_str().unwrap().starts_with("[digest]"))
            .map(|m| {
                (
                    m["body"].as_str().unwrap().to_owned(),
                    m["iteration"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            [("first ask".to_owned(), 1), ("second ask".to_owned(), 2)]
        );
        let journal = model.journal();
        for expected in [
            "first ask",
            "history clear",
            "History survived",
            "second ask",
        ] {
            assert!(
                journal.iter().any(|entry| entry["body"]["tools"]
                    .as_array()
                    .is_some_and(|tools| !tools.is_empty())
                    && entry["body"]["messages"]
                        .as_array()
                        .is_some_and(|messages| messages.iter().any(|m| m["role"] == "user"
                            && m["content"]
                                .as_str()
                                .is_some_and(|text| text.contains(expected))))),
                "real Claude did not receive {expected}: {journal:#?}"
            );
        }
        model.assert_matched();
    })
    .await
    .expect("Message history across Clear did not complete");
}

#[tokio::test]
async fn a32_iteration_advances_once() {
    tokio::time::timeout(Duration::from_secs(60), async {
        let (project, mut client, door) = clear_fixture("a32_iteration", &[]).await;
        let model = project.model.as_ref().unwrap();
        let before = rail_tree(&client).await;
        assert_eq!(
            before
                .iter()
                .find(|node| node.id == door)
                .unwrap()
                .iteration,
            Some(1)
        );
        assert!(
            before
                .iter()
                .filter(|node| node.id != door)
                .all(|node| node.iteration.is_none())
        );
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "advance iteration"}),
            )
            .await
            .unwrap();
        received(model, "advance iteration").await;
        let actor = project.client().await;
        actor
            .request(
                "daemon.identify",
                contracts::IdentifyParams {
                    actor: contracts::Actor {
                        kind: contracts::ActorKind::Agent,
                        id: door.clone(),
                        parent: None,
                    },
                },
            )
            .await
            .unwrap();
        actor
            .request(
                "workstream.handoff",
                json!({"id": door, "summary": "Iteration advanced", "keep_todos": [], "keep_pads": []}),
            )
            .await
            .unwrap();
        let cleared = next(&mut client, |event| match event {
            EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
            _ => None,
        })
        .await;
        assert_eq!((cleared.id.as_str(), cleared.iteration), (door.as_str(), 2));
        assert_eq!(
            rail_tree(&client)
                .await
                .iter()
                .find(|node| node.id == door)
                .unwrap()
                .iteration,
            Some(2)
        );
        turn_done(model, &client, &door, "Iteration advanced").await;
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "advance again"}),
            )
            .await
            .unwrap();
        received(model, "advance again").await;
        let journal = model.journal();
        for expected in ["advance iteration", "Iteration advanced", "advance again"] {
            assert!(
                journal.iter().any(|entry| entry["body"]["tools"].is_array()
                    && entry["body"]["messages"]
                        .as_array()
                        .is_some_and(|messages| messages.iter().any(|message| message["role"]
                            == "user"
                            && message["content"]
                                .as_str()
                                .is_some_and(|text| text.contains(expected)
                                    && (expected == "Iteration advanced" || text.contains("workstream_handoff")))))),
                "real Claude did not receive {expected}: {journal:#?}"
            );
        }
        assert_eq!(
            rail_tree(&client)
                .await
                .iter()
                .find(|node| node.id == door)
                .unwrap()
                .iteration,
            Some(2)
        );
        model.assert_matched();
    })
    .await
    .expect("Iteration observer did not complete");
}

#[tokio::test]
async fn a32_without_handoff_archives_everything() {
    let (project, mut client, door) = clear_fixture(
        "a32_without_handoff",
        &[("ROUNDUP_HANDOFF_BOUND_MS", "10000")],
    )
    .await;
    let model = project.model.as_ref().unwrap();
    let child = rail_tree(&client)
        .await
        .into_iter()
        .find(|node| node.parent.as_deref() == Some(&door))
        .unwrap()
        .id;
    let before = rail_tree(&client).await;
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    assert_eq!(
        client
            .request("workstream.clear", json!({"id": door, "reason": "bloat"}))
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let failed = next(&mut client, |event| match event {
        EventData::WorkstreamClearFailed(failed) if failed.id == door => Some(failed),
        _ => None,
    })
    .await;
    assert_eq!(failed.code, rpc::code::NOT_ACKED as i32);
    let after = rail_tree(&client).await;
    let shape = |nodes: Vec<contracts::agent::RailNode>| {
        nodes
            .into_iter()
            .map(|node| (node.id, node.parent, node.iteration, node.worktree))
            .collect::<Vec<_>>()
    };
    assert_eq!(shape(after), shape(before));
    assert_eq!(
        client.request("todo.list", Value::Null).await.unwrap(),
        todos
    );
    assert_eq!(client.request("pad.list", Value::Null).await.unwrap(), pads);
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({
                    "id": door, "reason": "bloat", "without_handoff": true
                })
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.attempt == "2" => {
                Some(status)
            }
            _ => None,
        })
        .await;
        assert_ne!(
            status.status.kind,
            Kind::Error,
            "real Door failed: {:#?}",
            model.journal()
        );
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    assert!(
        client
            .request("todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    let pads = pads.as_array().unwrap();
    assert_eq!(
        pads.iter()
            .map(|pad| pad["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["archive-1"]
    );
    let text = pads[0]["text"].as_str().unwrap();
    for lost in [
        "build the login page",
        "refactor everything",
        "## notes",
        "## scratch",
    ] {
        assert!(text.contains(lost), "{lost} is lost: {text}");
    }
    assert!(rail_tree(&client).await.iter().all(|node| node.id != child));
    for expected in [
        "workstream_handoff",
        "No Handoff was written, so every Todo and Pad was archived.",
    ] {
        assert!(
            model.journal().iter().any(|entry| entry["body"]["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
                && entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| messages.iter().any(|message| message["role"]
                        == "user"
                        && message["content"].as_str().is_some_and(|text| text
                            .contains("bloat")
                            && text.contains(expected))))),
            "real Claude must receive {expected}: {:#?}",
            model.journal()
        );
    }
    client
        .request("agent.stop", json!({"id": door}))
        .await
        .unwrap();
    let stopped = client
        .request("workstream.clear", json!({"id": door, "reason": "r"}))
        .await
        .unwrap_err();
    assert_eq!(stopped.code, rpc::code::CONFLICT);
    model.assert_matched();
}

#[tokio::test]
async fn a32_the_door_restarts_fresh_from_the_handoff() {
    tokio::time::timeout(Duration::from_secs(60), async {
        let (project, mut client, door) = clear_fixture("a32_fresh_handoff", &[]).await;
        let model = project.model.as_ref().unwrap();
        let before = rail_tree(&client).await;
        let first = before.iter().find(|node| node.id == door).unwrap();
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "bloat"}),
            )
            .await
            .unwrap();
        let mut working = false;
        loop {
            let status = next(&mut client, |event| match event {
                EventData::AgentStatus(status) if status.id == door => Some(status),
                _ => None,
            })
            .await;
            working |= status.status.kind == Kind::Working;
            if working && status.status.kind == Kind::Idle {
                break;
            }
        }
        let actor = project.client().await;
        actor
            .request(
                "daemon.identify",
                contracts::IdentifyParams {
                    actor: contracts::Actor {
                        kind: contracts::ActorKind::Agent,
                        id: door.clone(),
                        parent: None,
                    },
                },
            )
            .await
            .unwrap();
        actor
            .request(
                "workstream.handoff",
                json!({"id": door, "summary": "Build the login page.", "keep_todos": [], "keep_pads": []}),
            )
            .await
            .unwrap();
        let cleared = next(&mut client, |event| match event {
            EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
            _ => None,
        })
        .await;
        assert_eq!((cleared.id.as_str(), cleared.iteration), (door.as_str(), 2));
        assert_eq!(
            rail_tree(&client)
                .await
                .iter()
                .find(|node| node.id == door)
                .unwrap()
                .iteration,
            Some(2)
        );
        let mut working = false;
        loop {
            let status = next(&mut client, |event| match event {
                EventData::AgentStatus(status) if status.id == door && status.attempt == "2" => {
                    Some(status)
                }
                _ => None,
            })
            .await;
            working |= status.status.kind == Kind::Working;
            if working && status.status.kind == Kind::Idle {
                break;
            }
        }
        let tree = rail_tree(&client).await;
        let after = tree.iter().find(|node| node.id == door).unwrap();
        assert_eq!(after.attempt.as_deref(), Some("2"));
        assert_ne!(after.terminal_id, first.terminal_id);
        let journal = model.journal();
        let restarted = journal.iter().find(|entry| entry["body"]["tools"].is_array()
            && entry["body"]["messages"].as_array().is_some_and(|messages|
                messages.iter().any(|message| message["role"] == "user"
                    && message["content"].as_str().is_some_and(|text|
                        text.contains("Follow this instruction: Build the login page.")
                        && text.contains("archived in the Pad archive-1")))))
            .unwrap_or_else(|| panic!("real Door receives the Handoff and archive pointer: {journal:#?}"));
        // A resumed conversation would retain the earlier Clear and child-spawn turns.
        let messages = restarted["body"]["messages"].as_array().unwrap();
        assert!(!messages.iter().any(|message| message["role"] == "tool"));
        assert!(!messages.iter().any(|message| message["role"] == "user" && message["content"].as_str()
            .is_some_and(|text| text.contains("workstream_handoff") || text.contains("What is this Workstream for?"))));
        assert!(journal.iter().any(|entry| entry["body"]["tools"].is_array()
            && entry["body"]["messages"].as_array().is_some_and(|messages|
                messages.iter().any(|message| message["role"] == "user"
                    && message["content"].as_str().is_some_and(|text|
                        text.contains("bloat") && text.contains("workstream_handoff"))))));
        model.assert_matched();
    })
    .await
    .expect("fresh Door Handoff observer did not complete");
}
