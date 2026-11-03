//! A5765: public CLI, real source/target Daemons and a registered fake App.
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
    let target = daemon::start(&[
        ("FAKE_CLAUDE_PROMPT_LOG", input.to_str().unwrap()),
        ("FAKE_CLAUDE_LAUNCH_LOG", launch.to_str().unwrap()),
        ("FAKE_CLAUDE_EXACT_PROMPTS", "1"),
        ("ANTHROPIC_MODEL", "target-vendor-default"),
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
    let mut app = Client::connect(&socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    let target_client = target.client().await;
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
        let prompt = format!("exact {source_mode} {kind} {index} first prompt");
        let normal = permission
            .map(|mode| json!({"permissionMode":mode}))
            .unwrap_or_else(|| json!({}));
        let params = json!({"path":target.dir.path(),"kind":kind,"name":format!("target-{kind}"),"prompt":prompt});
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
        let made = if kind == "agent" {
            target_client.request("agent.spawn",{
                let mut params = json!({"cwd":target.dir.path(),"name":format!("target-{kind}"),"prompt":prompt,"start_attribution":attribution});
                params.as_object_mut().unwrap().extend(normal.as_object().unwrap().clone());
                params
            }).await.unwrap()
        } else {
            let made = target_client
                .request(
                    "rail.createWorkstream",
                    json!({"name":format!("target-{kind}"),"start_attribution":attribution}),
                )
                .await
                .unwrap();
            if kind == "mode" {
                target_client
                    .request(
                        "workstream.setOpeningPrompt",
                        json!({"id":made["id"],"prompt":prompt}),
                    )
                    .await
                    .unwrap();
            }
            target_client
                .request("rail.startDoor", {
                    let mut params = json!({"id":made["id"],"prompt":prompt});
                    params
                        .as_object_mut()
                        .unwrap()
                        .extend(normal.as_object().unwrap().clone());
                    params
                })
                .await
                .unwrap()
        };
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
                            serde_json::from_str::<Value>(line).unwrap()["prompt"] == prompt
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
    let user = Client::connect(&socket).await.unwrap();
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
