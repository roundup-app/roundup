//! H21: a Door decides its child's permission Decisions.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};
use daemon::next;
use serde_json::{Value, json};

#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/launch_gate.rs"]
#[allow(dead_code)]
mod launch_gate;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::workstream;
use launch_gate::Gate;
use waiting::{idle, until};

/// Each of `ids` has run a turn and stopped, so no later hook of its own can clear a Decision.
async fn worked_then_idle(events: &mut rpc::Client, ids: &[&String]) {
    let mut working = std::collections::BTreeSet::new();
    let mut idle = std::collections::BTreeSet::new();
    while idle.len() < ids.len() {
        let status = next(events, |event| match event {
            EventData::AgentStatus(status) if ids.contains(&&status.id) => Some(status),
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
}

#[tokio::test]
async fn h21_observer_a_door_allows_its_childs_permission_request_and_the_touch_names_it() {
    let project = daemon::start_real("h21_door_allows", &[]);
    let client = project.client().await;
    let door = workstream(&client, "team").await;
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    idle(&client, &door).await;
    client
        .request(
            "agent.spawn",
            json!({"cwd": project.dir.path(), "prompt": "H21 run ls", "parent": door}),
        )
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    // The Door answers from its Message, then the child's own Bash runs.
    model.tool_result("toolu_h21_allow").await;
    model.tool_result("toolu_h21_bash").await;
    assert!(project.dir.path().join("h21-made").is_dir());
    let touch = daemon::h21_poll("the Touch", async || {
        let history = client
            .request("provenance.history", json!({"item": "decision:d1"}))
            .await
            .unwrap();
        history.as_array().unwrap().first().cloned()
    })
    .await;
    assert_eq!(touch["verb"], "wrote");
    assert_eq!(touch["actor"]["kind"], "agent");
    assert_eq!(touch["actor"]["id"], door);
    let open = client.request("decision.list", Value::Null).await.unwrap();
    assert!(open.as_array().unwrap().iter().all(|d| d["id"] != "d1"));
    model.assert_matched();
}

#[tokio::test]
async fn h21_a_message_delivered_after_the_decision_cleared_is_still_typed() {
    let gate = Gate::new();
    std::fs::remove_file(&gate.hold).unwrap();
    let wrapper = gate.wrapper();
    let project = daemon::start_real("h21_typed_after_clear", &[("ROUNDUP_CLAUDE_BIN", &wrapper)]);
    let client = project.client().await;
    let door = workstream(&client, "team").await;
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    // B7 batches pending Messages. Put another note first so the Decision notice
    // cannot accidentally pass only because it heads the submitted prompt.
    // B50(e): a note from the user is typed on its own, so another sender's note is the one that
    // can be batched with the Decision notice.
    let sender = project.client().await;
    sender
        .request(
            "daemon.identify",
            json!({"actor": {"kind": "ext", "id": "h21"}}),
        )
        .await
        .unwrap();
    sender
        .request(
            "message.send",
            json!({"to": door, "kind": "note", "body": "queued before the Decision"}),
        )
        .await
        .unwrap();
    let child: contracts::agent::RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": null, "parent": door}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let _open = daemon::h21_ask(&project, &child.id, "Bash", daemon::h21_bash()).await;
    let decision = daemon::h21_decision(&client, &child.id, None).await;
    let id = decision["id"].as_str().unwrap().to_owned();
    let notes = daemon::h21_notes(&client, &door, 1).await;
    let body = notes[0]["body"].as_str().unwrap().to_owned();
    assert_eq!(notes[0]["status"], "pending");

    daemon::h21_user_answers(&client, &id, "deny")
        .await
        .unwrap();
    let decisions = client.request("decision.list", Value::Null).await.unwrap();
    assert!(decisions.as_array().unwrap().iter().all(|d| d["id"] != id));
    assert!(gate.held.is_file(), "the Door's start is still held");
    std::fs::write(&gate.hold, "").unwrap();

    let model = project.model.as_ref().unwrap();
    let typed = until("the typed Decision notice", || {
        model.journal().iter().find_map(|entry| {
            entry["body"]["messages"]
                .as_array()?
                .iter()
                .filter(|m| m["role"] == "user")
                .filter_map(|m| m["content"].as_str())
                .find(|text| text.contains(&body))
                .map(str::to_owned)
        })
    })
    .await;
    let queued = typed.find("queued before the Decision").unwrap();
    assert!(queued < typed.find(&body).unwrap(), "{typed}");
}

#[tokio::test]
async fn h21_observer_the_childs_and_another_workstreams_agents_are_forbidden_and_the_user_wins() {
    // The child's own answer stays proved by `h21_an_agent_cannot_answer_its_own_decision` (rule 10).
    let project = daemon::start_real("h21_forbidden", &[]);
    let mut events = project.subscribed().await;
    let client = project.client().await;
    let door = workstream(&client, "team").await;
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let elsewhere = workstream(&client, "elsewhere").await;
    let mut agents = Vec::new();
    for parent in [&door, &elsewhere] {
        let node: contracts::agent::RailNode = serde_json::from_value(
            client
                .request(
                    "agent.spawn",
                    json!({"cwd": project.dir.path(), "name":"permission-reader", "prompt": "What should this Agent do?", "parent": parent}),
                )
                .await
                .unwrap(),
        )
        .unwrap();
        agents.push(node.id);
    }
    let (child, other) = (agents[0].clone(), agents[1].clone());
    worked_then_idle(&mut events, &[&door, &child, &other]).await;
    let _open = daemon::h21_ask(&project, &child, "Bash", daemon::h21_bash()).await;
    assert_eq!(
        daemon::h21_decision(&client, &child, None).await["id"],
        "d1"
    );
    let say = |to: &str, body: &str| {
        client.request(
            "message.send",
            json!({"to": to, "kind": "note", "body": body}),
        )
    };
    let model = project.model.as_ref().unwrap();
    say(&other, "H21 other answers").await.unwrap();
    let refused = model.tool_result("toolu_h21_other").await;
    let refused: Value = serde_json::from_str(refused["content"].as_str().unwrap()).unwrap();
    assert_eq!(refused["code"], rpc::code::FORBIDDEN, "{refused}");
    let history = || client.request("provenance.history", json!({"item": "decision:d1"}));
    assert!(history().await.unwrap().as_array().unwrap().is_empty());
    assert_eq!(
        daemon::h21_decision(&client, &child, None).await["id"],
        "d1"
    );

    daemon::h21_user_answers(&client, "d1", "deny")
        .await
        .unwrap();
    say(&door, "H21 door answers late").await.unwrap();
    let late = model.tool_result("toolu_h21_late").await;
    let late: Value = serde_json::from_str(late["content"].as_str().unwrap()).unwrap();
    assert_eq!(late["code"], rpc::code::NOT_FOUND, "{late}");
    let touches = history().await.unwrap();
    assert_eq!(touches.as_array().unwrap().len(), 1);
    assert_eq!(touches[0]["actor"]["kind"], "user");
}
