//! Q11: a Workstream with a Door and children for plugin launch/resume probes.
use crate::daemon::{self};

use contracts::{EventData, Kind};
use serde_json::json;

pub async fn plugin_fixture(
    fixture: &str,
    env: &[(&str, &str)],
) -> (daemon::Project, rpc::Client, String) {
    let project = daemon::start_real(fixture, env);
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
    client
        .request(
            "message.send",
            json!({"to":door,"kind":"note","body":"Q11 start plugin inventory"}),
        )
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
        let status = project
            .next(&mut client, |event| match event {
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

    for (owner, title, name) in [
        (&door, "build the login page", "notes"),
        (&a.id, "refactor everything", "scratch"),
    ] {
        let actor = project.client().await;
        actor
            .request(
                "daemon.identify",
                contracts::IdentifyParams {
                    actor: contracts::Actor {
                        kind: contracts::ActorKind::Agent,
                        id: owner.clone(),
                        parent: None,
                    },
                },
            )
            .await
            .unwrap();
        actor
            .request(
                "todo.create",
                json!({"title": title, "body": format!("{title} body")}),
            )
            .await
            .unwrap();
        actor
            .request(
                "pad.create",
                json!({"name": name, "text": format!("{name} text")}),
            )
            .await
            .unwrap();
    }
    (project, client, door)
}
