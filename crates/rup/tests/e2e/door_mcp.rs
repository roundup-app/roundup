//! B24 and DCL7a through the real Daemon and the pinned Claude behind aimock: a Door reads its
//! Brief, calls its tools over MCP, and the Daemon's effects and authentication are read back.

use std::time::Duration;

use contracts::agent::RailNode;
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, EventData};
use serde_json::json;

use super::daemon::{self, Project};
use crate::{HOLD_PLAIN, REDUCE, SHOW_ME, actor, client_as, start_door};

#[tokio::test]
async fn b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp() {
    let project = daemon::start_real(
        "b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp",
        &[],
    );
    let mut client = project.subscribed().await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "workstream", "parent": null, "order":{"kind":"work","ask":"What is this Workstream for?","limits":[]}}),
        )
        .await
        .unwrap();
    let door = workstream["id"].as_str().unwrap().to_owned();
    client
        .request("rail.startDoor", json!({ "id": door }))
        .await
        .unwrap();

    let updated = project
        .next(&mut client, |data| match data {
            EventData::TodoUpdated(todo) if !todo.body.is_empty() => Some(todo),
            _ => None,
        })
        .await;
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_update_todo").await;
    assert!(
        result["content"]
            .as_str()
            .unwrap()
            .contains("owned files: none yet"),
        "{result}"
    );
    let journal = model.journal();
    let request = &journal
        .iter()
        .find(|entry| entry["body"]["tools"].is_array())
        .unwrap()["body"];
    let brief = request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "system")
        .map(|m| m["content"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(brief.contains("coordinating Door"), "{request}");
    assert!(
        !brief.contains(HOLD_PLAIN),
        "LC3: the Door's Brief omits the pinned hold:Plain body"
    );
    assert!(
        brief.contains(REDUCE) && brief.contains(SHOW_ME),
        "Q6: the pinned reduce and show-me bodies"
    );
    assert!(!brief.contains(&format!("Agent id is {door}")));
    assert_eq!(updated.title, "plan the workstream");
    assert_eq!(updated.body, "owned files: none yet");
    assert_eq!(
        updated.creator,
        Actor {
            kind: ActorKind::Agent,
            id: door,
            parent: None
        }
    );
    let stored: Vec<Todo> = serde_json::from_value(
        project
            .client()
            .await
            .request("todo.list", json!(null))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (&stored[0].title, &stored[0].body),
        (&updated.title, &updated.body)
    );
}

/// DCL7a: wait until the fake model has been asked something containing `needle`.
async fn model_saw(project: &Project, needle: &str) {
    let model = project.model.as_ref().unwrap();
    let asked = || {
        model
            .journal()
            .iter()
            .map(|entry| entry["body"]["messages"].to_string())
            .collect::<Vec<_>>()
    };
    let seen = tokio::time::timeout(project.bound(), async {
        let mut tick = tokio::time::interval(Duration::from_millis(25));
        while !asked().iter().any(|body| body.contains(needle)) {
            tick.tick().await;
        }
    })
    .await;
    if seen.is_err() {
        let user = project.client().await;
        eprintln!("DBG tree {:#?}", project.rail_tree(&user).await);
        eprintln!("DBG msgs {:#?}", user.request("message.list", json!({})).await);
    }
    assert!(
        seen.is_ok(),
        "the model was never asked {needle:?}: {:#?}",
        asked().last()
    );
}

/// DCL7a: a Door at `door`, a Job `open-job` and, when `consult`, a Consult `idle-consult` under
/// it, each having finished its first turn.
async fn door_with_children(project: &Project, consult: bool) -> (String, String, String) {
    let user = project.client().await;
    let door = start_door(&user).await;
    let as_door = client_as(project, actor(ActorKind::Agent, &door)).await;
    let spawn = |name: &str, role: &str, ask: &str| {
        json!({"name": name, "parent": door, "cwd": project.dir.path(), "role": role,
            "prompt": ask, "order": {"kind": "work", "ask": ask, "limits": []}})
    };
    let job = as_door
        .request("agent.spawn", spawn("open-job", "job", "Do the one thing."))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut ids = vec![job.clone()];
    let mut idle = String::new();
    if consult {
        idle = as_door
            .request(
                "agent.spawn",
                spawn("idle-consult", "consult", "Answer when asked."),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        ids.push(idle.clone());
    }
    daemon::h21_poll("every child to finish a turn", async || {
        let tree = project.rail_tree(&user).await;
        ids.iter()
            .all(|id| {
                tree.iter()
                    .any(|n| n.id == *id && n.status.as_ref().is_some_and(|s| s.finished != "0"))
            })
            .then_some(())
    })
    .await;
    (door, job, idle)
}

#[tokio::test]
async fn dcl7_update_reconciles_todos_and_pads_through_mcp() {
    let project = daemon::start_real("dcl7_update_reconciles_todos_and_pads_through_mcp", &[]);
    let user = project.client().await;
    for title in ["untouched", "reconcile"] {
        user.request("todo.create", json!({ "title": title }))
            .await
            .unwrap();
    }
    user.request(
        "pad.create",
        json!({"name": "notes", "text": "before the update"}),
    )
    .await
    .unwrap();

    door_with_children(&project, false).await;

    // The Daemon's own stop note about the open Job is the delivered update; the Door answers it
    // with the two scripted tool calls.
    let model = project.model.as_ref().unwrap();
    model.tool_result("toolu_dcl7_pad").await;
    let todos: Vec<Todo> =
        serde_json::from_value(user.request("todo.list", json!(null)).await.unwrap()).unwrap();
    let by_title = |title: &str| todos.iter().find(|t| t.title == title).unwrap();
    assert_eq!(by_title("reconcile").body, "job ended");
    assert_eq!(by_title("untouched").body, "");
    let pad: Pad = serde_json::from_value(
        user.request("pad.read", json!({"name": "notes"}))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(pad.text, "after the update");
}

#[tokio::test]
async fn dcl7_restart_resumes_only_jobs_selected_by_door() {
    let mut project = daemon::start_real("dcl7_restart_resumes_only_jobs_selected_by_door", &[]);
    let (door, job, consult) = door_with_children(&project, true).await;
    model_saw(&project, "[stopped]").await;
    let before = project.model.as_ref().unwrap().journal().len();

    let claude = daemon::aimock::routed_claude(project.dir.path());
    let home = project.dir.path().join("home");
    let url = project.model.as_ref().unwrap().url.clone();
    project.crash();
    project.restart(&[
        ("ROUNDUP_CLAUDE_BIN", claude.to_str().unwrap()),
        ("HOME", home.to_str().unwrap()),
        ("CLAUDE_CODE_OAUTH_TOKEN", ""),
        ("AIMOCK_URL", &url),
    ]);
    let user = project.client().await;
    let tree = project.rail_tree(&user).await;
    let node = |tree: &[RailNode], id: &str| tree.iter().find(|n| n.id == id).cloned().unwrap();
    let (job_before, consult_before) = (node(&tree, &job), node(&tree, &consult));
    // (c) Nothing is launched or resumed by the restart itself.
    assert!(job_before.terminal_id.is_none() && consult_before.terminal_id.is_none());
    assert_eq!(project.model.as_ref().unwrap().journal().len(), before);

    user.request("rail.startDoor", json!({ "id": door }))
        .await
        .unwrap();
    // The first batch of the new Attempt carries the snapshot.
    user.request(
        "message.send",
        json!({"to": door, "kind": "note", "body": "Where do things stand?"}),
    )
    .await
    .unwrap();
    // (b) The Door's start text holds the open-Job snapshot, and only the Job is resumed, by the
    // Door's own call.
    model_saw(&project, "[open jobs]").await;
    model_saw(&project, &format!("- {job} open-job (attempt 1)")).await;
    let result = project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_dcl7_resume")
        .await;
    assert!(result["is_error"] != true, "{result}");
    // The Attempt moves when the resumed Agent's session starts, which can follow the tool result.
    daemon::h21_poll("the resumed Job's new Attempt", async || {
        let tree = project.rail_tree(&user).await;
        (node(&tree, &job).attempt != job_before.attempt).then_some(())
    })
    .await;
    let tree = project.rail_tree(&user).await;
    let consult_after = node(&tree, &consult);
    assert_eq!(consult_after.attempt, consult_before.attempt);
    assert!(consult_after.terminal_id.is_none());
}
