//! A32: a Clear asks the Door, and a refused Handoff changes nothing.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::EventData;
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
use doors::{as_door, child_of, user_texts};
use waiting::turn_done;

#[tokio::test]
async fn a32_a_clear_is_refused_or_asked_and_a_handoff_is_refused_until_valid() {
    let (project, mut client, door) = clear_fixture("a32_valid_clear", &[]).await;
    let model = project.model.as_ref().unwrap();
    let before = rail_tree(&client).await;
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    let keep = todos[0]["id"].clone();
    client
        .request(
            "message.send",
            json!({"to": door, "kind": "note", "body": "I want a login page"}),
        )
        .await
        .unwrap();
    // The reason starts with a slash command: the Door is asked in words, and nothing is typed as a command.
    let reply = client
        .request(
            "workstream.clear",
            json!({"id": door, "reason": "/clear please: too much fluff"}),
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
    let child = child_of(&client, &door).await;
    let owner = as_door(&project, &door).await;
    // An empty, blank or over-long reason, an unknown id and a sub-Workstream refuse the Clear whatever else is pending.
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
        .request("workstream.clear", json!({"id": child, "reason": "r"}))
        .await
        .unwrap_err();
    assert_eq!(sub.code, rpc::code::INVALID_PARAMS);
    // While the Clear is pending only the Door may answer it.
    for who in [as_door(&project, &child).await, project.client().await] {
        let error = who
            .request(
                "workstream.handoff",
                json!({"id": door, "summary": "s", "keep_todos": [], "keep_pads": []}),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN);
    }
    // The Clear turn ends with the Handoff still pending.
    turn_done(model, &client, &door, "too much fluff").await;
    assert_eq!(
        model
            .journal()
            .iter()
            .filter(|entry| {
                user_texts(entry)
                    .last()
                    .is_some_and(|text| text.contains("workstream_handoff"))
            })
            .count(),
        1,
        "the refused Clears asked nothing; only the valid one did"
    );
    let actor = owner;
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
    // With no Clear pending, not even the Door may hand off.
    let late = actor
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "s", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap_err();
    assert_eq!(late.code, rpc::code::CONFLICT);
    // SessionStart can launch the first turn before workstream.cleared is emitted.
    // Read the completed turn instead of awaiting a Working event already consumed above.
    turn_done(
        model,
        &client,
        &door,
        "Valid handoff after bad ids",
    )
    .await;
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
