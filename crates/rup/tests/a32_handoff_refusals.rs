//! A32: a Clear asks the Door, and a refused Handoff changes nothing.
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
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use clear_fixture::clear_fixture;
use doors::requests_holding;
use waiting::{received, turn_done};

#[tokio::test]
async fn a32_an_empty_reason_changes_nothing() {
    let project = daemon::start_real("a32_invalid_clear", &[]);
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
    let first = model.tool_result("toolu_a32_child").await;
    let a: contracts::agent::RailNode =
        serde_json::from_str(first["content"].as_str().unwrap()).unwrap();
    let second = model.tool_result("toolu_a32_grandchild").await;
    let b: contracts::agent::RailNode =
        serde_json::from_str(second["content"].as_str().unwrap()).unwrap();
    // Wait through all three real turns so late unmatched requests cannot escape the observer.
    let mut working = std::collections::BTreeSet::new();
    let mut idle = std::collections::BTreeSet::new();
    while idle.len() < 3 {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if [&door, &a.id, &b.id].contains(&&status.id) => {
                Some(status)
            }
            _ => None,
        })
        .await;
        if status.status.kind == Kind::Working {
            working.insert(status.id.clone());
        }
        if status.status.kind == Kind::Idle && working.contains(&status.id) {
            idle.insert(status.id);
        }
    }
    let before: Vec<_> = rail_tree(&client)
        .await
        .into_iter()
        .map(|n| (n.id, n.parent, n.iteration, n.worktree))
        .collect();
    for reason in ["", "  \n ", &"x".repeat(2001)] {
        let error = client
            .request("workstream.clear", json!({"id": door, "reason": reason}))
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    }
    let missing = client
        .request("workstream.clear", json!({"id": "9999", "reason": "r"}))
        .await
        .unwrap_err();
    assert_eq!(missing.code, rpc::code::NOT_FOUND);
    let sub = client
        .request("workstream.clear", json!({"id": a.id, "reason": "r"}))
        .await
        .unwrap_err();
    assert_eq!(sub.code, rpc::code::INVALID_PARAMS);
    let after: Vec<_> = rail_tree(&client)
        .await
        .into_iter()
        .map(|n| (n.id, n.parent, n.iteration, n.worktree))
        .collect();
    assert_eq!(after, before);
    // Idle does not drain routine digest/name Messages. Count only the Clear instruction,
    // which clear.rs::ask_text includes in every Handoff request, rather than unrelated turns.
    // No acknowledgement exists for a refused prompt: observe its absence for 300 ms.
    let deadline = std::time::Instant::now() + Duration::from_millis(300);
    loop {
        assert_eq!(
            requests_holding(model, "workstream_handoff"),
            0,
            "invalid clear sends no Handoff request to Claude"
        );
        model.assert_matched();
        if std::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[tokio::test]
async fn a32_only_the_door_may_hand_off() {
    let project = daemon::start_real("a32_handoff_authority", &[]);
    let mut client = project.subscribed().await;
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
    let actor = |id: String| async {
        let who = project.client().await;
        who.request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id,
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
        who
    };
    let owner = actor(door.clone()).await;
    let params = json!({"id": door, "summary": "s", "keep_todos": [], "keep_pads": []});
    let error = owner
        .request("workstream.handoff", params.clone())
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    client
        .request(
            "workstream.clear",
            json!({"id": door, "reason": "authority check"}),
        )
        .await
        .unwrap();
    // Digest turns also emit Working/Idle, so only the request proves Clear arrived.
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            model.assert_matched();
            if model.journal().iter().any(|entry| {
                entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| {
                        messages.iter().any(|message| {
                            message["role"] == "user"
                                && message["content"].as_str().is_some_and(|text| {
                                    text.contains("authority check")
                                        && text.contains("workstream_handoff")
                                })
                        })
                    })
            }) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "clear prompt missing from aimock journal: {:#?}",
            model.journal()
        )
    });
    // Spawn the child during Clear, so its startup digests cannot race Clear's Steer.
    let result = model.tool_result("toolu_a32_child").await;
    let child: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    for who in [actor(child.id).await, project.client().await] {
        let error = who
            .request("workstream.handoff", params.clone())
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN);
    }
    model.assert_matched();
}

#[tokio::test]
async fn a32_a_valid_clear_only_asks_the_door() {
    let (project, mut client, door) = clear_fixture("a32_valid_clear", &[]).await;
    let model = project.model.as_ref().unwrap();
    let before = rail_tree(&client).await;
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    client
        .request(
            "message.send",
            json!({"to": door, "kind": "note", "body": "I want a login page"}),
        )
        .await
        .unwrap();
    let reply = client
        .request(
            "workstream.clear",
            json!({"id": door, "reason": "too much fluff"}),
        )
        .await
        .unwrap();
    assert_eq!(reply, json!({"pending": true}));
    let ask = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            model.assert_matched();
            for entry in model.journal() {
                if let Some(messages) = entry["body"]["messages"].as_array() {
                    for message in messages {
                        if message["role"] == "user"
                            && let Some(text) = message["content"].as_str()
                            && text.contains("too much fluff")
                            && text.contains("workstream_handoff")
                        {
                            return text.to_owned();
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("Clear missing from aimock journal");
    assert!(ask.contains("1. I want a login page"), "{ask}");
    for todo in todos.as_array().unwrap() {
        assert!(
            ask.contains(&format!(
                "{} \"{}\"",
                todo["id"],
                todo["title"].as_str().unwrap()
            )),
            "{ask}"
        );
    }
    assert!(ask.contains("scratch (owner "), "{ask}");
    let shape = |nodes: Vec<contracts::agent::RailNode>| {
        nodes
            .into_iter()
            .map(|node| (node.id, node.parent, node.iteration, node.worktree))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        shape(rail_tree(&client).await),
        shape(before),
        "nothing leaves the Rail before Handoff"
    );
    assert_eq!(
        client.request("todo.list", Value::Null).await.unwrap(),
        todos
    );
    assert_eq!(client.request("pad.list", Value::Null).await.unwrap(), pads);
    let second = client
        .request("workstream.clear", json!({"id": door, "reason": "again"}))
        .await
        .unwrap_err();
    assert_eq!(second.code, rpc::code::CONFLICT);
    // Finish the real Clear turn before checking the complete request journal.
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
    model.assert_matched();
}

#[tokio::test]
async fn a32_a_bad_id_in_the_handoff_keeps_the_clear_pending() {
    let (project, mut client, door) = clear_fixture("a32_bad_handoff", &[]).await;
    let model = project.model.as_ref().unwrap();
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let keep = todos[0]["id"].clone();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "bad handoff observer"})
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    turn_done(model, &client, &door, "bad handoff observer").await;
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"]
                            .as_str()
                            .is_some_and(|text| text.contains("bad handoff observer")
                                && text.contains("workstream_handoff")))
                )),
        "Clear must reach real Claude"
    );
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
    for bad in [
        json!({"keep_todos": [999], "keep_pads": []}),
        json!({"keep_todos": [], "keep_pads": ["nope"]}),
        json!({"keep_todos": [], "keep_pads": [], "summary": " "}),
    ] {
        let mut params = json!({"id": door, "summary": "s"});
        params
            .as_object_mut()
            .unwrap()
            .extend(bad.as_object().unwrap().clone());
        let err = actor
            .request("workstream.handoff", params)
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::INVALID_PARAMS);
    }
    assert_eq!(
        client.request("todo.list", Value::Null).await.unwrap(),
        todos,
        "a bad Handoff changes nothing"
    );
    actor.request("workstream.handoff", json!({"id": door, "summary": "Valid handoff after bad ids", "keep_todos": [keep], "keep_pads": []})).await.unwrap();
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    // SessionStart can launch the first turn before workstream.cleared is emitted.
    // Read the completed turn instead of awaiting a Working event already consumed above.
    turn_done(
        model,
        &client,
        &door,
        "Follow this instruction: Valid handoff after bad ids",
    )
    .await;
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"].as_str().is_some_and(|text| text
                            .contains("Follow this instruction: Valid handoff after bad ids")))
                )),
        "the real Door must receive the valid Handoff: {:#?}",
        model.journal()
    );
    model.assert_matched();
}

#[tokio::test]
async fn a32_no_slash_command_is_typed() {
    let (project, mut client, door) = clear_fixture("a32_no_slash", &[]).await;
    let model = project.model.as_ref().unwrap();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "/clear please"})
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    received(model, "/clear please").await;
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"]
                            .as_str()
                            .is_some_and(|text| text.contains("/clear please")
                                && text.contains("workstream_handoff")))
                )),
        "Clear must reach real Claude"
    );
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
            json!({"id": door, "summary": "Slash-free handoff", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    turn_done(model, &client, &door, "Slash-free handoff").await;
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"].as_str().is_some_and(
                            |text| text.contains("Follow this instruction: Slash-free handoff")
                        ))
                )),
        "the real Door must receive the valid Handoff: {:#?}",
        model.journal()
    );
    for entry in model.journal() {
        for message in entry["body"]["messages"].as_array().unwrap() {
            if message["role"] == "user"
                && let Some(text) = message["content"].as_str()
            {
                assert!(!text.starts_with('/'), "slash command typed: {text}");
            }
        }
    }
    model.assert_matched();
}
