//! E2704b: real Claude answers with the current rail name.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use daemon::aimock;

use serde_json::json;
use std::time::Duration;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::{as_door, conversation_entries};
use waiting::idle;

/// E2704b uses the subscription model, never aimock. Run explicitly with an authorized OAuth
/// token; all settings, sessions, transcripts and Projects remain in disposable directories.
#[tokio::test]
#[ignore = "real-model observer: requires an authorized CLAUDE_CODE_OAUTH_TOKEN"]
async fn e2704b_real_claude_answers_with_current_rail_name() {
    assert!(
        std::env::var_os("CLAUDE_CODE_OAUTH_TOKEN").is_some(),
        "authorized subscription credential required"
    );
    fn answers(project: &daemon::Project) -> Vec<(String, String)> {
        let mut questions = std::collections::HashMap::<String, bool>::new();
        let mut answers = Vec::new();
        for row in conversation_entries(project) {
            if row["type"] != "user" && row["type"] != "assistant" {
                continue;
            }
            let session = row["sessionId"]
                .as_str()
                .expect("transcript session identity");
            let identity_question = questions.entry(session.to_owned()).or_default();
            if row["type"] == "user" {
                if let Some(text) = row["message"]["content"].as_str() {
                    *identity_question =
                        row["origin"]["kind"] != "peer" && text.contains("who are you?");
                } else if row["origin"]["kind"] == "peer" {
                    *identity_question = false;
                }
            }
            if row["type"] != "assistant" || !*identity_question {
                continue;
            }
            if let Some(content) = row["message"]["content"].as_array() {
                for block in content {
                    if block["type"] == "text" {
                        answers.push((
                            row["uuid"]
                                .as_str()
                                .expect("transcript entry identity")
                                .to_owned(),
                            block["text"].as_str().unwrap().to_owned(),
                        ));
                    }
                }
            }
        }
        answers
    }
    let vendor = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../node_modules/@anthropic-ai/claude-code/bin/claude.exe");
    let version = std::process::Command::new(&vendor)
        .arg("--version")
        .output()
        .unwrap();
    let mut evidence = Vec::new();
    for role in ["agent", "door", "scout"] {
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("claude-config");
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        // Reuse isolated onboarding/trust setup, then remove the fixture's API-key helper.
        aimock::configure(&config, dir.path());
        std::fs::write(config.join("settings.json"), "{}").unwrap();
        let project = daemon::start_in(
            dir,
            tempfile::tempdir().unwrap(),
            &[
                ("ROUNDUP_CLAUDE_BIN", vendor.to_str().unwrap()),
                ("HOME", home.to_str().unwrap()),
                ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
                ("DISABLE_AUTOUPDATER", "1"),
            ],
        );
        let user = project.client().await;
        let node = if role == "door" {
            let workstream = user
                .request("rail.createWorkstream", json!({"name":"sad","parent":null,"order":{"kind":"work","title":"Identity observation","ask":"who are you? Answer in one short sentence.","done":"Identity answered","limits":["Read only"]}}))
                .await
                .unwrap();
            user.request(
                "rail.startDoor",
                json!({"id":workstream["id"],"model":"sonnet","effort":"low"}),
            )
            .await
            .unwrap()
        } else if role == "scout" {
            let parent = user.request("agent.spawn", json!({"name":"parent","cwd":project.dir.path(),"model":"sonnet","effort":"low"})).await.unwrap();
            idle(project.bound(), &user, parent["id"].as_str().unwrap()).await;
            let caller = as_door(&project, parent["id"].as_str().unwrap()).await;
            let scout = caller.request("agent.spawn", json!({"name":"sad","cwd":project.dir.path(),"scout":true,"model":"sonnet","order":{"kind":"work","title":"Identity observation","ask":"who are you? Answer in one short sentence.","done":"Identity answered","limits":["Read only"]}})).await.unwrap();
            user.request("agent.stop", json!({"id":parent["id"]}))
                .await
                .unwrap();
            scout
        } else {
            user.request(
                "agent.spawn",
                json!({"name":"sad","cwd":project.dir.path(),"model":"sonnet","effort":"low","prompt":"who are you? Answer in one short sentence."}),
            )
            .await
            .unwrap()
        };
        let id = node["id"].as_str().unwrap();
        idle(project.bound(), &user, id).await;
        let mut observations = Vec::new();
        for name in ["sad", "sad-2"] {
            if name == "sad-2" {
                user.request("rail.rename", json!({"id":id,"name":name}))
                    .await
                    .unwrap();
                tokio::time::timeout(Duration::from_secs(120), async {
                    loop {
                        let notes = user
                            .request("message.list", json!({"to":id}))
                            .await
                            .unwrap();
                        if notes.as_array().unwrap().iter().any(|m| {
                            m["body"] == "you are now called \"sad-2\" on the Rail"
                                && m["status"] == "delivered"
                        }) {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                })
                .await
                .expect("rename note acknowledged in transcript");
                idle(project.bound(), &user, id).await;
            }
            let before = if name == "sad" {
                Vec::new()
            } else {
                answers(&project)
            };
            if name == "sad-2" {
                tokio::time::timeout(Duration::from_secs(120), async {
                    loop {
                        match user
                        .request(
                            "agent.prompt",
                            json!({"id":id,"text":"who are you? Answer in one short sentence."}),
                        )
                        .await
                    {
                        Ok(_) => break,
                        Err(err) if err.code == rpc::code::BUSY => {
                            tokio::time::sleep(Duration::from_millis(100)).await
                        }
                        Err(err) => panic!("identity prompt refused: {err}"),
                    }
                    }
                })
                .await
                .expect("startup prompt released the Agent");
            }
            let answer = tokio::time::timeout(Duration::from_secs(120), async {
                loop {
                    let found = answers(&project);
                    if let Some(answer) = found.iter().find(|answer| !before.contains(answer)) {
                        break answer.1.clone();
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            })
            .await
            .expect("real model answered the identity question");
            idle(project.bound(), &user, id).await;
            assert!(answer.contains(name), "{role}: {answer}");
            assert!(
                !answer
                    .replace(name, "")
                    .split(|c: char| !c.is_alphanumeric())
                    .any(|word| word == id),
                "{role}: {answer}"
            );
            let context = user
                .request("agent.context", json!({"id":id}))
                .await
                .unwrap();
            observations.push(json!({"name":name,"context":context,"answer":answer}));
        }
        let notes = user
            .request("message.list", json!({"to":id}))
            .await
            .unwrap();
        let result = json!({"role":role,"observations":observations,"notes":notes});
        println!("E2704b role {result}");
        evidence.push(result);
    }
    println!(
        "E2704b {}",
        json!({"version":String::from_utf8(version.stdout).unwrap().trim(),"evidence":evidence})
    );
}
