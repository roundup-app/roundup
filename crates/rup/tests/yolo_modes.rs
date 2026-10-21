//! A2693a, B2693b: YOLO resume, restart and note receipt in real Claude.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::EventData;
use daemon::next;
use serde_json::{Value, json};
use std::time::Duration;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::{conversation_entries, user_texts};
use waiting::turn_done;

#[tokio::test]
async fn a2693a_real_claude_resumes_yolo_and_restarts_normal() {
    let project = daemon::start_real("a2693a_modes", &[]);
    let client = project.client().await;
    let model = project.model.as_ref().unwrap();
    let initial = "A2693 remember the cobalt otter";
    let node = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"prompt":initial}),
        )
        .await
        .unwrap();
    let id = node["id"].as_str().unwrap();
    turn_done(model, &client, id, initial).await;
    let mut session = None;
    for (mode, prompt, expected) in [
        (None, initial, "default"),
        (
            Some("yolo"),
            "A2693 recall with prompts off",
            "bypassPermissions",
        ),
        (Some("normal"), "A2693 recall with prompts on", "default"),
    ] {
        if let Some(mode) = mode {
            let resumed = client
                .request("agent.resume", json!({"id":id,"mode":mode}))
                .await
                .unwrap();
            assert_eq!(resumed["yolo"], mode == "yolo");
            client
                .request("agent.prompt", json!({"id":id,"text":prompt}))
                .await
                .unwrap();
            turn_done(model, &client, id, prompt).await;
        }
        let entry = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Some(entry) =
                    conversation_entries(&project)
                        .into_iter()
                        .rev()
                        .find(|entry| {
                            entry["type"] == "user"
                                && entry["message"]["content"].to_string().contains(prompt)
                        })
                {
                    break entry;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("Claude records its user turn");
        assert_eq!(entry["permissionMode"], expected);
        let current = entry["sessionId"].as_str().unwrap();
        if let Some(session) = &session {
            assert_eq!(current, session);
        } else {
            session = Some(current.to_owned());
        }
        let journal = model.journal();
        let request = journal
            .iter()
            .rev()
            .find(|entry| {
                user_texts(entry).iter().any(|t| t.contains(prompt))
                    && !entry["body"]["tools"].is_null()
            })
            .unwrap();
        assert!(
            user_texts(request)
                .iter()
                .any(|text| text.contains(initial))
        );
    }
    model.assert_matched();
}

#[tokio::test]
async fn a2693a_real_claude_skips_only_yolo_tool_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let hooks = tempfile::tempdir().unwrap();
    let wrapper = hooks.path().join("rup");
    let calls = hooks.path().join("permissions");
    std::fs::write(&wrapper, format!("#!/bin/sh\nif [ \"$1\" = permission ]; then echo permission >> '{}'; fi\nexec '{}' \"$@\"\n", calls.display(), env!("CARGO_BIN_EXE_rup"))).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = daemon::start_real(
        "a2693a_tools",
        &[("ROUNDUP_RUP_BIN", wrapper.to_str().unwrap())],
    );
    let mut client = project.subscribed().await;
    let model = project.model.as_ref().unwrap();
    let node = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"prompt":"A2693 normal tool"}),
        )
        .await
        .unwrap();
    let id = node["id"].as_str().unwrap();
    for (mode, prompt, expected_calls) in [
        (None, "A2693 normal tool", 1),
        (Some("yolo"), "A2693 yolo tool", 1),
        (Some("normal"), "A2693 restarted tool", 2),
    ] {
        if let Some(mode) = mode {
            client
                .request("agent.resume", json!({"id":id,"mode":mode}))
                .await
                .unwrap();
            client
                .request("agent.prompt", json!({"id":id,"text":prompt}))
                .await
                .unwrap();
        }
        if mode != Some("yolo") {
            let decision = next(&mut client, |event| match event {
                EventData::DecisionOpened(d) if d.agent == id => Some(d),
                _ => None,
            })
            .await;
            assert_eq!(decision.tool, "Bash");
            client
                .request(
                    "decision.answer",
                    json!({"id":decision.id,"answer":"deny","proof":daemon::H21_PROOF}),
                )
                .await
                .unwrap();
        }
        turn_done(model, &client, id, prompt).await;
        assert_eq!(
            std::fs::read_to_string(&calls).unwrap().lines().count(),
            expected_calls
        );
        assert_eq!(
            project.dir.path().join("a2693-effect").exists(),
            mode.is_some()
        );
        let decisions = client.request("decision.list", Value::Null).await.unwrap();
        assert!(decisions.as_array().unwrap().is_empty());
    }
    model.assert_matched();
}

#[tokio::test]
async fn b2693b_real_yolo_receiver_takes_a_note_without_approval() {
    let input = tempfile::tempdir().unwrap();
    let gate = input.path().join("input-gate");
    let project = daemon::start_real(
        "a2693a_modes",
        &[("RUPD_TERMINAL_INPUT_GATE", gate.to_str().unwrap())],
    );
    let mut events = project.subscribed().await;
    let client = project.client().await;
    let model = project.model.as_ref().unwrap();
    let initial = "A2693 remember the cobalt otter";
    let receiver = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"prompt":initial,"name":"receiver"}),
        )
        .await
        .unwrap();
    let sender_prompt = "A2693 recall with prompts on";
    let sender = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"prompt":sender_prompt,"name":"sender"}),
        )
        .await
        .unwrap();
    let id = receiver["id"].as_str().unwrap();
    turn_done(model, &client, id, initial).await;
    turn_done(
        model,
        &client,
        sender["id"].as_str().unwrap(),
        sender_prompt,
    )
    .await;
    let actor = project.client().await;
    actor
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":sender["id"]}}),
        )
        .await
        .unwrap();
    let mut ids = Vec::new();
    for (mode, text, expected) in [
        ("yolo", "A2693 note with prompts off", "bypassPermissions"),
        ("normal", "A2693 note with prompts on", "default"),
    ] {
        client
            .request("agent.resume", json!({"id":id,"mode":mode}))
            .await
            .unwrap();
        if mode == "normal" {
            client
                .request("agent.resume", json!({"id":sender["id"],"mode":"yolo"}))
                .await
                .unwrap();
        }
        std::fs::write(&gate, "pause").unwrap();
        let message = actor
            .request("message.send", json!({"to":id,"kind":"note","body":text}))
            .await
            .unwrap();
        let msg_id = message["id"].as_u64().unwrap();
        ids.push(msg_id);
        next(&mut events, |event| match event {
            EventData::MessageDelivered(m) if m.id as u64 == msg_id => Some(()),
            _ => None,
        })
        .await;
        turn_done(model, &client, id, text).await;
        assert!(
            !gate.with_extension("arrived").exists(),
            "a note wrote to the Terminal"
        );
        std::fs::remove_file(&gate).unwrap();
        let uuid = format!("00000000-0000-4000-8000-{msg_id:012x}");
        let entries = conversation_entries(&project);
        let matching: Vec<_> = entries
            .iter()
            .filter(|e| e["origin"]["msg_id"] == uuid)
            .collect();
        assert_eq!(matching.len(), 1);
        let content = matching[0]["message"]["content"].to_string();
        assert!(content.contains(text));
        assert!(content.contains(expected));
        let requests: Vec<_> = model
            .journal()
            .into_iter()
            .filter(|e| {
                !e["body"]["tools"].is_null() && user_texts(e).iter().any(|t| t.contains(text))
            })
            .collect();
        assert_eq!(requests.len(), 1);
        assert!(
            client
                .request("decision.list", Value::Null)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    let mut audit = project.client().await;
    let subscribed = audit
        .request("events.subscribe", json!({"after":0}))
        .await
        .unwrap();
    let head = subscribed["head"].as_u64().unwrap();
    let mut delivered = Vec::new();
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(event) = audit.next_event().await {
            match event.data {
                EventData::MessageDelivered(m) if ids.contains(&(m.id as u64)) => {
                    delivered.push(m.id as u64)
                }
                EventData::DecisionOpened(d) if d.agent == id => {
                    panic!("a note opened a permission Decision")
                }
                _ => {}
            }
            if event.seq == Some(head) {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(delivered, ids, "one delivery Event per note");
    model.assert_matched();
}
