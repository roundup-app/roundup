//! A5765: public CLI, real source/target Daemons and a registered fake App.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "common/served.rs"]
mod common;

// The shared real-Daemon harness exposes helpers for other integration targets too.
#[allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;
// This observer uses only the bounded file and idle probes from the shared harness.
#[allow(dead_code)]
#[path = "common/waiting.rs"]
mod waiting;
use contracts::{Actor, ActorKind, IdentifyParams};
use rpc::Client;
use serde_json::{Value, json};

#[tokio::test]
async fn a5765c_start_validation_and_refusal_create_nothing() {
    let source = tempfile::tempdir().unwrap();
    let socket = source.path().join("source.sock");
    let server = common::serve(source.path(), &socket);
    let caller = Client::connect(&socket).await.unwrap();
    let node = caller
        .request("rail.createWorkstream", json!({"name":"builder"}))
        .await
        .unwrap();
    caller
        .request(
            "daemon.identify",
            serde_json::to_value(&IdentifyParams {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: node["id"].as_str().unwrap().into(),
                    parent: None,
                },
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let mut app = Client::connect(&socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    let target = tempfile::tempdir().unwrap();
    for extra in [
        json!({"permissionMode":"auto"}),
        json!({"agent":"spoof"}),
        json!({"yolo":true}),
        json!({"model":"override"}),
        json!({"effort":"override"}),
        json!({"socket":"/other.sock"}),
        json!({"kind":"bad"}),
        json!({"name":" "}),
        json!({"prompt":" "}),
        json!({"path":"relative"}),
    ] {
        let mut params =
            json!({"path":target.path(),"kind":"agent","name":"worker","prompt":"work"});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert_eq!(
            caller
                .request("project.start", params)
                .await
                .unwrap_err()
                .code,
            -32602
        );
    }
    let params =
        json!({"path":target.path(),"kind":"mode","name":"worker","prompt":" exact prompt\n "});
    let call = caller.request("project.start", params);
    tokio::pin!(call);
    let request = loop {
        tokio::select! {
            result = &mut call => panic!("start completed before consent: {result:?}"),
            request = requests.recv() => {
                let request = request.unwrap();
                if request["method"] == "action.list" { app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]})).await.unwrap(); }
                else { break request; }
            }
        }
    };
    assert_eq!(request["method"], "project.start");
    assert_eq!(
        request["params"]["agent"],
        json!({"id":node["id"],"name":"builder"})
    );
    assert!(!target.path().join(".roundup").exists());
    app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32002,"message":format!("The user refused {}",target.path().display())}})).await.unwrap();
    let error = call.await.unwrap_err();
    assert_eq!(error.code, -32002);
    assert!(error.message.contains(target.path().to_str().unwrap()));
    assert!(!target.path().join(".roundup").exists());
    server.abort();
}

#[tokio::test]
async fn a5765a_an_agent_starts_each_kind_in_open_b_and_gets_its_id() {
    let logs = tempfile::tempdir().unwrap();
    let input = logs.path().join("input.jsonl");
    let launch = logs.path().join("launch.jsonl");
    let mut target = daemon::start(&[
        ("FAKE_CLAUDE_PROMPT_LOG", input.to_str().unwrap()),
        ("FAKE_CLAUDE_LAUNCH_LOG", launch.to_str().unwrap()),
        ("FAKE_CLAUDE_EXACT_PROMPTS", "1"),
        ("ANTHROPIC_MODEL", "target-vendor-default"),
        ("ROUNDUP_CHANNEL_DEADLINE_MS", "100"),
    ]);
    let source_launch = logs.path().join("source-launch.jsonl");
    let source_input = logs.path().join("source-input.jsonl");
    let source = daemon::start(&[
        ("ANTHROPIC_MODEL", "source-vendor-default"),
        ("FAKE_CLAUDE_LAUNCH_LOG", source_launch.to_str().unwrap()),
        ("FAKE_CLAUDE_PROMPT_LOG", source_input.to_str().unwrap()),
    ]);
    let user = source.client().await;
    let node = user.request("agent.spawn", json!({"cwd":source.dir.path(),"name":"builder","permissionMode":"auto","prompt":"source work"})).await.unwrap();
    waiting::idle(
        std::time::Duration::from_secs(15),
        &user,
        node["id"].as_str().unwrap(),
    )
    .await;
    let caller = source.client().await;
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":node["id"],"parent":null}}),
        )
        .await
        .unwrap();
    let socket = source.socket();
    let mut app = Client::connect(socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    let target_client = target.client().await;
    let alias = target.dir.path().join("alias");
    std::os::unix::fs::symlink(target.dir.path(), &alias).unwrap();
    let cases = ["auto", "yolo"].into_iter().flat_map(|source_mode| {
        [Some("acceptEdits"), None]
            .into_iter()
            .flat_map(move |permission| {
                ["agent", "workstream", "mode"]
                    .into_iter()
                    .map(move |kind| (source_mode, permission, kind))
            })
    });
    for (index, (source_mode, permission, kind)) in cases.enumerate() {
        if index == 6 {
            let resumed = user
                .request("agent.resume", json!({"id":node["id"],"mode":"yolo"}))
                .await
                .unwrap();
            assert_eq!(resumed["yolo"], true);
        }
        let prompt = format!(" exact {source_mode} {kind} {index} first prompt\n é\n ");
        let params =
            json!({"path":alias,"kind":kind,"name":format!("target-{kind}"),"prompt":prompt});
        let call = caller.request("project.start", params);
        tokio::pin!(call);
        let request = loop {
            tokio::select! {
                result = &mut call => panic!("start completed before target creation: {result:?}"),
                request = requests.recv() => {
                    let request = request.unwrap();
                    if request["method"] == "action.list" { app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]})).await.unwrap(); }
                    else { break request; }
                }
            }
        };
        assert_eq!(request["method"], "project.start");
        let attribution = json!({"project":source.dir.path(),"project_name":"source","agent":node["id"],"agent_name":"builder"});
        let made = start_target(&target_client, target.dir.path(), &request, permission).await;
        app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":{"path":target.dir.path(),"kind":kind,"id":made["id"]}})).await.unwrap();
        let result = call.await.unwrap();
        assert_eq!(result["id"], made["id"]);
        assert_eq!(result["path"], json!(target.dir.path()));
        assert_eq!(result["kind"], kind);
        waiting::until(
            std::time::Duration::from_secs(15),
            "exact first prompt",
            || {
                std::fs::read_to_string(&input)
                    .ok()
                    .is_some_and(|text| {
                        text.lines().any(|line| {
                            serde_json::from_str::<Value>(line).unwrap()["prompt"]
                                .as_str()
                                .unwrap()
                                .split("\n\n<roundup-context>\n")
                                .next()
                                == Some(prompt.as_str())
                        })
                    })
                    .then_some(())
            },
        )
        .await;
        let rows = target_client
            .request("rail.tree", Value::Null)
            .await
            .unwrap();
        assert_eq!(rows.as_array().unwrap().len(), index + 1);
        let row = rows
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == made["id"])
            .unwrap();
        assert_eq!(row["parent"], Value::Null);
        assert_eq!(
            row["kind"],
            if kind == "agent" {
                "agent"
            } else {
                "workstream"
            }
        );
        assert_eq!(row["start_attribution"], attribution);
        let history = target_client
            .request(
                "provenance.history",
                json!({"item":format!("rail:{}",made["id"].as_str().unwrap())}),
            )
            .await
            .unwrap();
        let qualified = serde_json::to_string(&[
            source.dir.path().to_str().unwrap(),
            node["id"].as_str().unwrap(),
        ])
        .unwrap();
        assert!(
            history
                .as_array()
                .unwrap()
                .iter()
                .any(|touch| touch["actor"]["id"] == qualified)
        );
        assert_eq!(
            row["opening_prompt"],
            if kind == "mode" {
                json!(prompt)
            } else {
                Value::Null
            }
        );
    }
    let before = target_client
        .request("rail.tree", Value::Null)
        .await
        .unwrap();
    user.request("agent.stop", json!({"id":node["id"]}))
        .await
        .unwrap();
    target.close().await;
    target.restart(&[]);
    let reopened = target.client().await;
    let after = reopened.request("rail.tree", Value::Null).await.unwrap();
    for row in before.as_array().unwrap() {
        let loaded = after
            .as_array()
            .unwrap()
            .iter()
            .find(|loaded| loaded["id"] == row["id"])
            .unwrap();
        assert_eq!(loaded["start_attribution"], row["start_attribution"]);
        assert_eq!(loaded["opening_prompt"], row["opening_prompt"]);
    }
    let launches = std::fs::read_to_string(launch).unwrap();
    assert_eq!(launches.lines().count(), 12);
    for (index, line) in launches.lines().enumerate() {
        let record: Value = serde_json::from_str(line).unwrap();
        let args = record["argv"].as_array().unwrap();
        if index % 6 < 3 {
            assert!(
                args.windows(2)
                    .any(|pair| pair == [json!("--permission-mode"), json!("acceptEdits")])
            );
        } else {
            assert!(!args.contains(&json!("--permission-mode")));
        }
        assert_eq!(record["env"]["ANTHROPIC_MODEL"], "target-vendor-default");
        assert!(!args.contains(&json!("--dangerously-skip-permissions")));
    }
    let user = Client::connect(socket).await.unwrap();
    assert_eq!(
        user.request("rail.tree", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn a5765f_agent_launch_failure_reports_the_retained_identity() {
    let project = tempfile::tempdir().unwrap();
    for args in [
        vec!["init", "-b", "main"],
        vec![
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "base",
        ],
        vec!["worktree", "add", "--detach", "prepared", "HEAD"],
    ] {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(project.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }
    let socket = project.path().join("target.sock");
    let server = common::serve(project.path(), &socket);
    let user = Client::connect(&socket).await.unwrap();
    user.request("project.setWorktrees", json!({"on":true,"check":null}))
        .await
        .unwrap();
    user.request("project.setPrepared", json!({"enrolled":[project.path().join("prepared")],"readiness":"printf retained > user-work; exit 1","timeout_ms":1000,"setup":null})).await.unwrap();
    let error = user.request("agent.spawn", json!({"cwd":project.path(),"name":"worker","prompt":"work","start_attribution":{"project":"/source","project_name":"Source","agent":"1","agent_name":"builder"}})).await.unwrap_err();
    let rows = user.request("rail.tree", Value::Null).await.unwrap();
    let rows = rows.as_array().unwrap();
    assert_eq!(
        rows.len(),
        1,
        "failed cleanup must retain the dirty Worktree's row"
    );
    let id = rows[0]["id"].as_str().unwrap();
    assert!(
        matches!(&error.data, Some(contracts::RpcErrorData::StartFailed { id: retained, .. }) if retained == id),
        "missing retained row {id}: {error}"
    );
    assert!(
        error.message.contains(project.path().to_str().unwrap()),
        "missing target path: {error}"
    );
    assert!(
        error.message.contains("start failed"),
        "missing failed stage: {error}"
    );
    assert_eq!(
        std::fs::read_to_string(project.path().join("prepared/user-work")).unwrap(),
        "retained"
    );
    server.abort();
}

async fn start_target(
    client: &Client,
    path: &std::path::Path,
    request: &Value,
    permission: Option<&str>,
) -> Value {
    let params = &request["params"];
    let attribution = json!({"project":params["source"],"project_name":"source","agent":params["agent"]["id"],"agent_name":params["agent"]["name"]});
    let mut launch = json!({"prompt":params["prompt"]});
    if let Some(mode) = permission {
        launch["permissionMode"] = json!(mode);
    }
    if params["kind"] == "agent" {
        launch["cwd"] = json!(path);
        launch["name"] = params["name"].clone();
        launch["start_attribution"] = attribution;
        client.request("agent.spawn", launch).await.unwrap()
    } else {
        let node = client
            .request(
                "rail.createWorkstream",
                json!({"name":params["name"],"start_attribution":attribution}),
            )
            .await
            .unwrap();
        if params["kind"] == "mode" {
            client
                .request(
                    "workstream.setOpeningPrompt",
                    json!({"id":node["id"],"prompt":params["prompt"]}),
                )
                .await
                .unwrap();
        }
        launch["id"] = node["id"].clone();
        client.request("rail.startDoor", launch).await.unwrap()
    }
}

#[tokio::test]
async fn a5765b_unopened_c_has_no_effect_until_open() {
    let source = tempfile::tempdir().unwrap();
    let socket = source.path().join("source.sock");
    let server = common::serve(source.path(), &socket);
    let caller = Client::connect(&socket).await.unwrap();
    let node = caller
        .request("rail.createWorkstream", json!({"name":"builder"}))
        .await
        .unwrap();
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":node["id"],"parent":null}}),
        )
        .await
        .unwrap();
    let mut app = Client::connect(&socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    for kind in ["agent", "workstream", "mode"] {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().to_owned();
        let log = tempfile::tempdir().unwrap();
        let input = log.path().join("input");
        let prompt = format!("start {kind} after Open");
        let call = caller.request(
            "project.start",
            json!({"path":path,"kind":kind,"name":"worker","prompt":prompt}),
        );
        tokio::pin!(call);
        let request = loop {
            tokio::select! {
                result = &mut call => panic!("completed before Open: {result:?}"),
                request = requests.recv() => {
                    let request = request.unwrap();
                    if request["method"] == "action.list" { app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]})).await.unwrap(); }
                    else { break request; }
                }
            }
        };
        assert!(!path.join(".roundup").exists());
        assert!(!input.exists());
        // Choosing Open is the only point that constructs C's real Daemon.
        let mut target = daemon::start_in(
            folder,
            tempfile::tempdir().unwrap(),
            &[
                ("FAKE_CLAUDE_PROMPT_LOG", input.to_str().unwrap()),
                ("ROUNDUP_CHANNEL_DEADLINE_MS", "100"),
            ],
        );
        let client = target.client().await;
        let made = start_target(&client, &path, &request, None).await;
        app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":{"path":path,"kind":kind,"id":made["id"]}})).await.unwrap();
        assert_eq!(
            call.await.unwrap(),
            json!({"path":path,"kind":kind,"id":made["id"]})
        );
        waiting::until(
            std::time::Duration::from_secs(15),
            "first prompt after Open",
            || {
                std::fs::read_to_string(&input).ok().filter(|text| {
                    text.lines().any(|line| {
                        serde_json::from_str::<Value>(line).unwrap()["prompt"]
                            .as_str()
                            .unwrap()
                            .split("\n\n<roundup-context>\n")
                            .next()
                            == Some(prompt.as_str())
                    })
                })
            },
        )
        .await;
        assert_eq!(
            client
                .request("rail.tree", Value::Null)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        target.close().await;
    }
    server.abort();
}
