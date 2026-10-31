//! Q11: plugins survive a real Daemon launch and resume.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use serde_json::{Value, json};

#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/launch_gate.rs"]
#[allow(dead_code)]
mod launch_gate;
#[path = "common/plugin_fixture.rs"]
#[allow(dead_code)]
mod plugin_fixture;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::child_of;
use launch_gate::Gate;
use plugin_fixture::plugin_fixture;
use waiting::{idle, until};

#[tokio::test]
async fn q11_plugins_survive_real_daemon_launch_and_resume() {
    let gate = Gate::new();
    let wrapper = gate.wrapper();
    let (project, client, door) =
        plugin_fixture("a32_plugins", &[("ROUNDUP_CLAUDE_BIN", &wrapper)]).await;
    let model = project.model.as_ref().unwrap();
    let a = child_of(&client, &door).await;
    until(
        project.bound(),
        "initial Door and children launched",
        || (gate.rows().len() == 3).then_some(()),
    )
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
        client
            .request(
                "message.send",
                json!({"to": id, "kind": "note", "body": prompt}),
            )
            .await
            .unwrap();
        let phase = format!("resume_{id}");
        until(
            project.bound(),
            "resumed Claude finishes the plugin probe",
            || {
                model
                    .journal()
                    .iter()
                    .any(|entry| {
                        entry["response"]["fixture"]["match"]["toolCallId"]
                            == format!("toolu_q11_{phase}_{}", if id == &door { 0 } else { 2 })
                    })
                    .then_some(())
            },
        )
        .await;
        idle(project.bound(), &client, id).await;
    }
    until(project.bound(), "Door and child resumed", || {
        (gate.rows().len() == 5).then_some(())
    })
    .await;
    let launches = gate.rows();
    let resumes = |row: &Value| {
        row["argv"]
            .as_array()
            .unwrap()
            .iter()
            .any(|arg| arg == "--resume")
    };
    assert!(resumes(&launches[3]) && resumes(&launches[4]));
    for row in &launches {
        let argv = row["argv"].as_array().unwrap();
        let paths: Vec<_> = argv
            .windows(2)
            .filter(|pair| pair[0] == "--plugin-dir")
            .map(|pair| std::path::Path::new(pair[1].as_str().unwrap()))
            .collect();
        // LC5: the same bundles survive every role's launch and resume.
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
    idle(project.bound(), &client, &door).await;
    for (phase, skills) in [
        ("initial_door", &["hope:intent"][..]),
        (
            "initial_child",
            &["hope:intent", "hunch:fly", "hold:grasp"][..],
        ),
        ("resume_1", &["hope:intent"][..]),
        ("resume_2", &["hope:intent", "hunch:fly", "hold:grasp"][..]),
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
            until(project.bound(), &format!("{phase} loaded {skill}"), || {
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
