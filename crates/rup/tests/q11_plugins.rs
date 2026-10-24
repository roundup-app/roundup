//! Q11: plugins survive a real Daemon launch, resume and Workstream Clear.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::EventData;
use daemon::next;
use serde_json::{Value, json};

#[path = "common/clear_fixture.rs"]
#[allow(dead_code)]
mod clear_fixture;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/launch_gate.rs"]
#[allow(dead_code)]
mod launch_gate;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use clear_fixture::clear_fixture;
use doors::child_of;
use launch_gate::Gate;
use waiting::{idle, until};

#[tokio::test]
async fn q11_plugins_survive_real_daemon_launch_resume_and_workstream_clear() {
    let gate = Gate::new();
    let wrapper = gate.wrapper();
    // This observer expects a successful restart, so use the loaded-host bound.
    let (project, mut client, door) =
        clear_fixture("a32_plugins", &[("ROUNDUP_CLAUDE_BIN", &wrapper)]).await;
    let model = project.model.as_ref().unwrap();
    let a = child_of(&client, &door).await;
    until("initial Door and children launched", || {
        (gate.rows().len() == 3).then_some(())
    })
    .await;
    for id in [&door, &a] {
        client
            .request("agent.stop", json!({"id": id}))
            .await
            .unwrap();
        client
            .request(
                if id == &door {
                    "rail.startDoor"
                } else {
                    "agent.resume"
                },
                json!({"id": id}),
            )
            .await
            .unwrap();
        let prompt = format!("Q11 plugin inventory after resume {id}");
        if id == &door {
            client
                .request("takeover.end", json!({"agent": id}))
                .await
                .unwrap();
        }
        client
            .request(
                "message.send",
                json!({"to": id, "kind": "note", "body": prompt}),
            )
            .await
            .unwrap();
        let phase = format!("resume_{id}");
        until("resumed Claude finishes the plugin probe", || {
            model
                .journal()
                .iter()
                .any(|entry| {
                    entry["response"]["fixture"]["match"]["toolCallId"]
                        == format!("toolu_q11_{phase}_{}", if id == &door { 0 } else { 2 })
                })
                .then_some(())
        })
        .await;
        idle(&client, id).await;
        if id == &door {
            client
                .request("takeover.begin", json!({"agent": id}))
                .await
                .unwrap();
        }
    }
    until("Door and child resumed", || {
        (gate.rows().len() == 5).then_some(())
    })
    .await;
    let before_clear = gate.rows();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "start a fresh iteration", "without_handoff": true})
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
    until("fresh Door launched", || {
        (gate.rows().len() == 6).then_some(())
    })
    .await;
    let after_clear = gate.rows();
    let resumes = |row: &Value| {
        row["argv"]
            .as_array()
            .unwrap()
            .iter()
            .any(|arg| arg == "--resume")
    };
    assert!(resumes(&before_clear[3]) && resumes(&before_clear[4]));
    assert!(!resumes(&after_clear[5]));
    for row in &after_clear {
        let argv = row["argv"].as_array().unwrap();
        let paths: Vec<_> = argv
            .windows(2)
            .filter(|pair| pair[0] == "--plugin-dir")
            .map(|pair| std::path::Path::new(pair[1].as_str().unwrap()))
            .collect();
        // LC5: the same bundles survive every role's launch, resume and Clear.
        let bundled = [("hope", "13.1.0"), ("hunch", "0.9.4"), ("hold", "0.0.9")];
        let wanted = &bundled;
        assert_eq!(paths.len(), wanted.len());
        for (path, &(name, version)) in paths.iter().zip(wanted) {
            let manifest: Value = serde_json::from_slice(
                &std::fs::read(path.join(".claude-plugin/plugin.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(manifest["name"], name);
            assert_eq!(manifest["version"], version);
        }
        assert_eq!(row["functionHooks"], "1");
    }
    idle(&client, &door).await;
    for (phase, skills) in [
        ("initial_door", &["hope:intent"][..]),
        (
            "initial_child",
            &["hope:intent", "hunch:fly", "hold:grasp"][..],
        ),
        ("resume_1", &["hope:intent"][..]),
        ("resume_2", &["hope:intent", "hunch:fly", "hold:grasp"][..]),
        ("clear", &["hope:intent"][..]),
    ] {
        for (index, skill) in skills.iter().enumerate() {
            // Match the real result before journal truncation can hide a long resumed conversation.
            let call = format!("toolu_q11_{phase}_{index}");
            let expected = if *skill == "hunch:fly" {
                // hunch's skills require explicit user invocation; resolving that policy proves loading.
                "<tool_use_error>Skill hunch:fly cannot be used with Skill tool due to disable-model-invocation.".to_owned()
            } else {
                format!("Launching skill: {skill}")
            };
            until(&format!("{phase} loaded {skill}"), || {
                model
                    .journal()
                    .iter()
                    .any(|entry| {
                        let matched = &entry["response"]["fixture"]["match"];
                        matched["toolCallId"] == call && matched["toolResultContains"] == expected
                    })
                    .then_some(())
            })
            .await;
        }
    }
    model.assert_matched();
}
