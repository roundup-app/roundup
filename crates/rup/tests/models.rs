//! A36, A37: the user picks each Agent's Model and Effort. The real Daemon, with the fake `claude`
//! recording each launch's arguments and environment to a file the test reads.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use contracts::agent::RailNode;
use contracts::{Actor, ActorKind, IdentifyParams, Kind};
use daemon::{Project, rail_tree, start};
use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(30);

struct Run {
    project: Project,
    log: PathBuf,
    input: PathBuf,
}

fn run_with(daemon_env: &[(&str, &str)]) -> Run {
    let scratch = tempfile::tempdir().unwrap().keep();
    let (log, input) = (scratch.join("launches"), scratch.join("typed"));
    let mut env = vec![
        ("FAKE_CLAUDE_LAUNCH_LOG", log.to_str().unwrap()),
        ("FAKE_CLAUDE_INPUT_LOG", input.to_str().unwrap()),
    ];
    env.extend_from_slice(daemon_env);
    Run {
        project: start(&env),
        log,
        input,
    }
}

fn run() -> Run {
    run_with(&[])
}

impl Run {
    /// Every launch the fake `claude` recorded, oldest first.
    fn launches(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// Wait until `count` launches are recorded and return them.
    fn launches_after(&self, count: usize) -> Vec<Value> {
        let deadline = Instant::now() + BOUND;
        while Instant::now() < deadline {
            let launches = self.launches();
            if launches.len() >= count {
                return launches;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("fewer than {count} launches: {:?}", self.launches());
    }

    fn typed(&self) -> Vec<String> {
        std::fs::read_to_string(&self.input)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn cwd(&self) -> String {
        self.project.dir.path().to_string_lossy().into_owned()
    }

    async fn spawn(&self, client: &Client, extra: Value) -> RailNode {
        let mut params = json!({ "cwd": self.cwd() });
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(client.request("agent.spawn", params).await.unwrap()).unwrap()
    }

    /// A Workstream and its Door, started with `extra` beside the id.
    async fn door(&self, client: &Client, extra: Value) -> RailNode {
        let workstream: RailNode = serde_json::from_value(
            client
                .request(
                    "rail.createWorkstream",
                    json!({ "name": "w", "parent": null }),
                )
                .await
                .unwrap(),
        )
        .unwrap();
        let mut params = json!({ "id": workstream.id });
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(client.request("rail.startDoor", params).await.unwrap()).unwrap()
    }

    /// Wait until `id` is Idle, which is after its SessionStart saved the conversation (A21).
    async fn idle(&self, client: &Client, id: &str) -> RailNode {
        let deadline = Instant::now() + BOUND;
        while Instant::now() < deadline {
            let node = rail_tree(client)
                .await
                .into_iter()
                .find(|node| node.id == id)
                .unwrap();
            if node.status.as_ref().is_some_and(|s| s.kind == Kind::Idle) {
                return node;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("{id} never went idle");
    }
}

async fn set_models(client: &Client, roles: Value) -> Result<Value, rpc::RpcError> {
    client
        .request("project.setModels", json!({ "roles": roles }))
        .await
}

fn role(role: &str, model: Option<&str>, effort: Option<&str>) -> Value {
    json!({ "role": role, "model": model, "effort": effort })
}

async fn project_models(client: &Client) -> Value {
    client.request("project.get", Value::Null).await.unwrap()["models"].clone()
}

fn argv_has(launch: &Value, flag: &str, value: &str) -> bool {
    let argv = launch["argv"].as_array().unwrap();
    argv.windows(2)
        .any(|pair| pair[0] == flag && pair[1] == value)
}

fn argv_lacks(launch: &Value, flag: &str) -> bool {
    !launch["argv"]
        .as_array()
        .unwrap()
        .iter()
        .any(|arg| arg == flag)
}

fn as_agent(node: &RailNode) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: node.id.clone(),
        parent: None,
    }
}

#[tokio::test]
async fn a36_models_list_comes_from_the_adapter() {
    let run = run();
    let client = run.project.client().await;

    let listed = client.request("models.list", Value::Null).await.unwrap();

    for field in ["models", "efforts"] {
        let choices = listed[field].as_array().unwrap();
        assert!(!choices.is_empty(), "{listed}");
        assert!(
            choices
                .iter()
                .all(|c| c["id"].is_string() && c["label"].is_string())
        );
    }
}

#[tokio::test]
async fn a36_set_models_round_trips_and_survives_a_restart() {
    let mut run = run();
    let client = run.project.client().await;
    let roles = json!([
        role("door", Some("opus"), Some("high")),
        role("subagent", Some("haiku"), None),
    ]);
    assert_eq!(
        set_models(&client, roles.clone()).await.unwrap(),
        Value::Null
    );
    let expected = json!({ "roles": roles });
    assert_eq!(project_models(&client).await, expected);

    run.project
        .restart(&[("FAKE_CLAUDE_LAUNCH_LOG", run.log.to_str().unwrap())]);

    assert_eq!(project_models(&run.project.client().await).await, expected);
}

#[tokio::test]
async fn a36_every_listed_role_is_in_project_get() {
    let run = run();
    let client = run.project.client().await;

    let models = project_models(&client).await;

    let roles: Vec<&str> = models["roles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["role"].as_str().unwrap())
        .collect();
    assert_eq!(roles, ["door", "subagent"]);
    for entry in models["roles"].as_array().unwrap() {
        assert_eq!(
            (&entry["model"], &entry["effort"]),
            (&Value::Null, &Value::Null)
        );
    }
    assert!(models.get("allowed").is_none());
}

#[tokio::test]
async fn a36_an_unlisted_id_is_invalid_params_and_changes_nothing() {
    let run = run();
    let client = run.project.client().await;
    set_models(&client, json!([role("door", Some("opus"), None)]))
        .await
        .unwrap();
    let before = project_models(&client).await;

    for roles in [
        json!([role("door", Some("no-such-model"), None)]),
        json!([role("door", None, Some("no-such-effort"))]),
        json!([role("no-such-role", None, None)]),
    ] {
        let refused = set_models(&client, roles).await.unwrap_err();
        assert_eq!(refused.code, rpc::code::INVALID_PARAMS);
        assert!(refused.message.contains("no-such"), "{}", refused.message);
    }
    assert_eq!(project_models(&client).await, before);

    let refused = client
        .request(
            "agent.spawn",
            json!({ "cwd": run.cwd(), "model": "no-such-model" }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::INVALID_PARAMS);
    assert!(rail_tree(&client).await.is_empty());
    assert!(run.launches().is_empty());
}

#[tokio::test]
async fn a36_each_role_runs_on_its_project_pair() {
    let run = run();
    let client = run.project.client().await;
    set_models(
        &client,
        json!([
            role("door", Some("opus"), Some("high")),
            role("subagent", Some("haiku"), Some("low")),
        ]),
    )
    .await
    .unwrap();

    let door = run.door(&client, json!({})).await;
    let agent = run.spawn(&client, json!({})).await;

    let launches = run.launches_after(2);
    let door_launch = launches
        .iter()
        .find(|l| l["argv"].to_string().contains("--tools"))
        .unwrap();
    assert!(argv_has(door_launch, "--model", "opus") && argv_has(door_launch, "--effort", "high"));
    let rest: Vec<&Value> = launches
        .iter()
        .filter(|l| !l["argv"].to_string().contains("--tools"))
        .collect();
    assert!(
        rest.iter()
            .any(|l| argv_has(l, "--model", "haiku") && argv_has(l, "--effort", "low"))
    );
    let tree = rail_tree(&client).await;
    let held = |id: &str| {
        let node = tree.iter().find(|n| n.id == id).unwrap();
        (node.model.clone(), node.effort.clone())
    };
    assert_eq!(held(&door.id), (Some("opus".into()), Some("high".into())));
    assert_eq!(held(&agent.id), (Some("haiku".into()), Some("low".into())));
}

#[tokio::test]
async fn a36_unset_passes_neither_flag_nor_variable() {
    let run = run();
    let client = run.project.client().await;

    let agent = run.spawn(&client, json!({})).await;

    let launch = run.launches_after(1).remove(0);
    assert!(argv_lacks(&launch, "--model") && argv_lacks(&launch, "--effort"));
    assert_eq!(launch["env"], json!({}));
    let tree = rail_tree(&client).await;
    let node = tree.iter().find(|n| n.id == agent.id).unwrap();
    assert_eq!((&node.model, &node.effort), (&None, &None));
}

#[tokio::test]
async fn a36_a_calls_pair_beats_the_projects() {
    let run = run();
    let client = run.project.client().await;
    set_models(
        &client,
        json!([role("subagent", Some("haiku"), Some("low"))]),
    )
    .await
    .unwrap();

    // Chosen apart: a call that sets only a Model takes the Project's Effort.
    run.spawn(&client, json!({ "model": "opus" })).await;

    let launch = run.launches_after(1).remove(0);
    assert!(argv_has(&launch, "--model", "opus"), "{launch}");
    assert!(argv_has(&launch, "--effort", "low"), "{launch}");
    assert_eq!(
        launch["env"],
        json!({ "ANTHROPIC_MODEL": "opus", "CLAUDE_CODE_EFFORT_LEVEL": "low" })
    );
}

#[tokio::test]
async fn a36_a_set_effort_beats_the_daemons_variable() {
    let run = run_with(&[
        ("CLAUDE_CODE_EFFORT_LEVEL", "low"),
        ("ANTHROPIC_MODEL", "other"),
    ]);
    let client = run.project.client().await;

    run.spawn(&client, json!({ "model": "sonnet", "effort": "max" }))
        .await;

    let launch = run.launches_after(1).remove(0);
    assert_eq!(
        launch["env"],
        json!({ "ANTHROPIC_MODEL": "sonnet", "CLAUDE_CODE_EFFORT_LEVEL": "max" })
    );
}

#[tokio::test]
async fn a36_an_unset_value_leaves_the_daemons_variable() {
    let run = run_with(&[
        ("CLAUDE_CODE_EFFORT_LEVEL", "low"),
        ("ANTHROPIC_MODEL", "other"),
    ]);
    let client = run.project.client().await;

    run.spawn(&client, json!({ "model": "sonnet" })).await;

    let launch = run.launches_after(1).remove(0);
    assert!(argv_lacks(&launch, "--effort"));
    assert_eq!(
        launch["env"],
        json!({ "ANTHROPIC_MODEL": "sonnet", "CLAUDE_CODE_EFFORT_LEVEL": "low" })
    );
}

/// A Door's `rail.startDoor` carries its own pair.
#[tokio::test]
async fn a36_a_door_start_carries_its_own_pair() {
    let run = run();
    let client = run.project.client().await;

    let door = run
        .door(&client, json!({ "model": "opus", "effort": "xhigh" }))
        .await;

    let launch = run.launches_after(1).remove(0);
    assert!(argv_has(&launch, "--model", "opus") && argv_has(&launch, "--effort", "xhigh"));
    assert_eq!(door.model.as_deref(), Some("opus"));
}

/// M12's rule, enforced by the Daemon: an Agent's call takes any listed Model and no Effort.
#[tokio::test]
async fn a36_an_agents_spawn_takes_any_listed_model_and_no_effort() {
    let run = run();
    let user = run.project.client().await;
    let parent = run.spawn(&user, json!({})).await;
    let agent = {
        let client = run.project.client().await;
        client
            .request(
                "daemon.identify",
                IdentifyParams {
                    actor: as_agent(&parent),
                },
            )
            .await
            .unwrap();
        client
    };

    let effort = agent
        .request("agent.spawn", json!({ "cwd": run.cwd(), "effort": "low" }))
        .await
        .unwrap_err();
    assert_eq!(effort.code, rpc::code::INVALID_PARAMS);
    let child = agent
        .request("agent.spawn", json!({ "cwd": run.cwd(), "model": "haiku" }))
        .await
        .unwrap();
    assert_eq!(child["model"], "haiku");
    assert_eq!(rail_tree(&user).await.len(), 2);
}

/// `agent.setModel`; a live Agent whose SessionStart has not saved its conversation yet is
/// `CONFLICT`, so that one answer is asked again until the conversation is there.
async fn set_model(
    client: &Client,
    id: &str,
    model: Option<&str>,
    confirmed: bool,
) -> Result<RailNode, rpc::RpcError> {
    let deadline = Instant::now() + BOUND;
    loop {
        let answer = client
            .request(
                "agent.setModel",
                json!({ "id": id, "model": model, "effort": null, "confirmed": confirmed }),
            )
            .await;
        match answer {
            Err(err) if err.code == rpc::code::CONFLICT && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            other => return other.map(|node| serde_json::from_value(node).unwrap()),
        }
    }
}

#[tokio::test]
async fn a37_without_confirmed_nothing_changes() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({ "model": "haiku" })).await;
    run.idle(&client, &agent.id).await;

    let refused = set_model(&client, &agent.id, Some("opus"), false)
        .await
        .unwrap_err();

    assert_eq!(refused.code, rpc::code::INVALID_PARAMS);
    assert!(refused.message.contains("confirmed"), "{}", refused.message);
    assert_eq!(run.launches_after(1).len(), 1);
    let tree = rail_tree(&client).await;
    assert_eq!(tree[0].model.as_deref(), Some("haiku"));
}

#[tokio::test]
async fn a37_the_same_pair_starts_nothing() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({ "model": "haiku" })).await;
    run.idle(&client, &agent.id).await;

    let node = set_model(&client, &agent.id, Some("haiku"), true)
        .await
        .unwrap();

    assert_eq!(node.model.as_deref(), Some("haiku"));
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(run.launches().len(), 1);
}

#[tokio::test]
async fn a37_an_unlisted_id_is_invalid_params() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({})).await;
    run.idle(&client, &agent.id).await;

    let refused = set_model(&client, &agent.id, Some("no-such-model"), true)
        .await
        .unwrap_err();

    assert_eq!(refused.code, rpc::code::INVALID_PARAMS);
    assert_eq!(run.launches().len(), 1);
}

#[tokio::test]
async fn a37_a_call_by_an_agent_is_forbidden() {
    let run = run();
    let user = run.project.client().await;
    let agent = run.spawn(&user, json!({})).await;
    run.idle(&user, &agent.id).await;
    let as_it = run.project.client().await;
    as_it
        .request(
            "daemon.identify",
            IdentifyParams {
                actor: as_agent(&agent),
            },
        )
        .await
        .unwrap();

    let refused = set_model(&as_it, &agent.id, Some("opus"), true)
        .await
        .unwrap_err();

    assert_eq!(refused.code, rpc::code::FORBIDDEN);
}

#[tokio::test]
async fn a37_a_confirmed_change_makes_one_launch_with_resume_and_the_new_model() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({ "model": "haiku" })).await;
    run.idle(&client, &agent.id).await;

    let node = set_model(&client, &agent.id, Some("opus"), true)
        .await
        .unwrap();

    assert_eq!(node.model.as_deref(), Some("opus"));
    let launches = run.launches_after(2);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let launches_later = run.launches();
    assert_eq!(launches_later.len(), 2, "{launches_later:?}");
    let resumed = &launches[1];
    assert!(argv_has(
        resumed,
        "--resume",
        "00000000-0000-4000-8000-000000000036"
    ));
    assert!(argv_has(resumed, "--model", "opus"));
    assert_eq!(resumed["env"]["ANTHROPIC_MODEL"], "opus");
}

#[tokio::test]
async fn a37_the_agent_keeps_its_identity_and_the_project_keeps_its_setting() {
    let run = run();
    let client = run.project.client().await;
    set_models(&client, json!([role("subagent", Some("sonnet"), None)]))
        .await
        .unwrap();
    let parent = run.spawn(&client, json!({ "name": "boss" })).await;
    let before = run.idle(&client, &parent.id).await;

    let after = set_model(&client, &parent.id, Some("opus"), true)
        .await
        .unwrap();

    assert_eq!(
        (&after.id, &after.name, &after.parent, after.order),
        (&before.id, &before.name, &before.parent, before.order)
    );
    assert_eq!(
        project_models(&client).await["roles"][1],
        role("subagent", Some("sonnet"), None)
    );
}

#[tokio::test]
async fn a37_a_later_resume_uses_the_changed_pair() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({ "model": "haiku" })).await;
    run.idle(&client, &agent.id).await;
    set_model(&client, &agent.id, Some("opus"), true)
        .await
        .unwrap();
    run.launches_after(2);
    run.idle(&client, &agent.id).await;
    client
        .request("agent.stop", json!({ "id": agent.id }))
        .await
        .unwrap();

    client
        .request("agent.resume", json!({ "id": agent.id }))
        .await
        .unwrap();

    let launches = run.launches_after(3);
    assert!(
        argv_has(&launches[2], "--model", "opus"),
        "{:?}",
        launches[2]
    );
}

#[tokio::test]
async fn a37_an_exited_agent_only_stores_the_pair() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({ "model": "haiku" })).await;
    run.idle(&client, &agent.id).await;
    client
        .request("agent.stop", json!({ "id": agent.id }))
        .await
        .unwrap();

    let node = set_model(&client, &agent.id, Some("opus"), true)
        .await
        .unwrap();

    assert_eq!(node.model.as_deref(), Some("opus"));
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(run.launches().len(), 1);
}

#[tokio::test]
async fn a37_project_set_models_does_not_touch_a_running_agent() {
    let run = run();
    let client = run.project.client().await;
    let agent = run.spawn(&client, json!({})).await;
    run.idle(&client, &agent.id).await;
    let files = || -> Vec<(PathBuf, Vec<u8>)> {
        let mut found = Vec::new();
        collect(&run.project.data_dir().join("agents"), &mut found);
        found.sort();
        found
    };
    fn collect(dir: &Path, into: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect(&path, into);
            } else if path
                .extension()
                .is_none_or(|ext| ext != "db" && ext != "wal" && ext != "shm")
            {
                into.push((path.clone(), std::fs::read(&path).unwrap_or_default()));
            }
        }
    }
    let before = files();
    assert!(!before.is_empty());

    set_models(
        &client,
        json!([role("subagent", Some("opus"), Some("max"))]),
    )
    .await
    .unwrap();

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(files(), before);
    assert_eq!(run.launches().len(), 1);
}

#[tokio::test]
async fn a37_no_slash_command_is_ever_typed() {
    let run = run();
    let client = run.project.client().await;
    let agent = run
        .spawn(&client, json!({ "model": "haiku", "effort": "low" }))
        .await;
    run.idle(&client, &agent.id).await;
    set_model(&client, &agent.id, Some("opus"), true)
        .await
        .unwrap();
    run.launches_after(2);
    run.idle(&client, &agent.id).await;
    let door = run.door(&client, json!({ "model": "opus" })).await;
    run.idle(&client, &door.id).await;

    assert!(
        run.typed().iter().all(|line| !line.starts_with('/')),
        "{:?}",
        run.typed()
    );
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for dir in ["crates/agents/src", "crates/rupd/src"] {
        let mut sources = vec![root.join(dir)];
        while let Some(path) = sources.pop() {
            if path.is_dir() {
                sources.extend(
                    std::fs::read_dir(&path)
                        .unwrap()
                        .flatten()
                        .map(|e| e.path()),
                );
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                for literal in ["\"/model", "\"/effort"] {
                    assert!(
                        !text.contains(literal),
                        "{} holds {literal}",
                        path.display()
                    );
                }
            }
        }
    }
}

#[tokio::test]
async fn p14_scribe_role_is_gone() {
    let mut run = run();
    let client = run.project.client().await;
    let refused = set_models(&client, json!([role("scribe", None, None)]))
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::INVALID_PARAMS);
    run.project.crash();
    let db = rusqlite::Connection::open(run.project.data_dir().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO role_models (role, model, effort) VALUES ('scribe', 'sonnet', 'low')",
        [],
    )
    .unwrap();
    drop(db);

    run.project.restart(&[]);

    let models = project_models(&run.project.client().await).await;
    let roles: Vec<&str> = models["roles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["role"].as_str().unwrap())
        .collect();
    assert_eq!(roles, ["door", "subagent"]);
}
