use super::*;
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::test]
async fn i5765_mcp_project_open_waits_for_the_registered_apps_final_result() {
    let project = start_daemon();
    let user = Client::connect(&project.socket).await.unwrap();
    let door = user
        .request("rail.createWorkstream", json!({"name":"builder"}))
        .await
        .unwrap();
    let mut app = Client::connect(&project.socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    let shim = spawn_shim(&project.socket, door["id"].as_str().unwrap()).await;
    let tools = shim.client.list_all_tools().await.unwrap();
    let open = tools
        .iter()
        .find(|tool| tool.name == "project_open")
        .unwrap();
    assert!(
        open.description
            .as_ref()
            .unwrap()
            .contains("returns the canonical opened path")
    );
    let target = tempfile::tempdir().unwrap();
    let call = shim.call("project_open", json!({"path":target.path()}));
    tokio::pin!(call);
    loop {
        tokio::select! {
            early = &mut call => panic!("open answered before App completion: {early:?}"),
            request = requests.recv() => {
                let request = request.unwrap();
                let result = if request["method"] == "action.list" { json!([]) } else {
                    assert_eq!(request["method"], "project.open");
                    assert_eq!(request["params"]["agent"]["id"], door["id"]);
                    json!({"path":target.path()})
                };
                app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":result})).await.unwrap();
                if request["method"] == "project.open" { break; }
            }
        }
    }
    let result = call.await;
    assert_eq!(result.is_error, Some(false));
    assert_eq!(
        result.content[0].as_text().unwrap().text,
        format!("opened Project {}", target.path().display())
    );
    project.daemon.abort();
}

#[tokio::test]
async fn i5765_mcp_open_failures_are_tool_errors_with_the_original_cause() {
    let project = start_daemon();
    let target = tempfile::tempdir().unwrap();
    let shim = spawn_shim(&project.socket, "").await;
    let absent = shim
        .call("project_open", json!({"path":target.path()}))
        .await;
    assert_eq!(absent.is_error, Some(true));
    assert!(
        absent.content[0]
            .as_text()
            .unwrap()
            .text
            .contains("open it and retry")
    );
    let mut app = Client::connect(&project.socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    for (code, cause) in [
        (-32002, "The user refused the target folder"),
        (-32001, "The target folder is unavailable"),
        (-32603, "The Project database could not be opened"),
        (-32004, "The App connection was lost"),
    ] {
        let call = shim.call("project_open", json!({"path":target.path()}));
        tokio::pin!(call);
        loop {
            tokio::select! {
                early = &mut call => panic!("open answered before App reply: {early:?}"),
                request = requests.recv() => {
                    let request = request.unwrap();
                    if request["method"] == "action.list" {
                        app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]})).await.unwrap();
                    } else {
                        assert_eq!(request["method"], "project.open");
                        app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":code,"message":cause}})).await.unwrap();
                        break;
                    }
                }
            }
        }
        let result = call.await;
        assert_eq!(result.is_error, Some(true));
        let body = &result.content[0].as_text().unwrap().text;
        assert!(body.contains(cause));
        assert!(body.contains(&code.to_string()));
        assert!(!body.contains("opened Project"));
    }
    project.daemon.abort();
}

struct World {
    _dir: tempfile::TempDir,
    socket: PathBuf,
    id: String,
    app: Arc<Client>,
    asked: mpsc::UnboundedReceiver<Value>,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
}
impl Drop for World {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl World {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("source.sock");
        let server = common::serve(dir.path(), &socket);
        let user = Client::connect(&socket).await.unwrap();
        let node = user
            .request("rail.createWorkstream", json!({"name":"builder"}))
            .await
            .unwrap();
        let id = node["id"].as_str().unwrap().to_owned();
        let mut app = Client::connect(&socket).await.unwrap();
        let asked = app.take_requests().unwrap();
        app.request("action.serve", Value::Null).await.unwrap();
        Self {
            _dir: dir,
            socket,
            id,
            app: Arc::new(app),
            asked,
            server,
        }
    }
    fn cli(&self, path: &Path, json: bool) -> tokio::process::Child {
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"));
        command
            .args(["project", "open"])
            .arg(path)
            .env("RUPD_SOCKET", &self.socket)
            .env("ROUNDUP_AGENT", &self.id)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if json {
            command.arg("--json");
        }
        command.spawn().unwrap()
    }
    async fn next(&mut self) -> Value {
        loop {
            let request = self.asked.recv().await.unwrap();
            if request["method"] == "action.list" {
                self.app
                    .reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]}))
                    .await
                    .unwrap();
            } else {
                return request;
            }
        }
    }
    async fn answer(&self, request: &Value, result: Value) {
        self.app
            .reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a5765b_open_only_has_no_effect_until_open() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    let mut cli = world.cli(target.path(), true);
    let request = world.next().await;
    assert_eq!(request["method"], "project.open");
    assert_eq!(
        request["params"]["agent"],
        json!({"id":world.id,"name":"builder"})
    );
    assert!(cli.try_wait().unwrap().is_none());
    assert!(!target.path().join(".roundup").exists());
    // The fake App's Open choice establishes a real target Daemon only now.
    let target_socket = target.path().join("target.sock");
    let serving = common::serve(target.path(), &target_socket);
    let target_client = Client::connect(&target_socket).await.unwrap();
    assert_eq!(
        target_client
            .request("rail.tree", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
    world.answer(&request, json!({"path":target.path()})).await;
    let output = cli.wait_with_output().await.unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        json!({"path":target.path()})
    );
    assert_eq!(
        target_client
            .request("rail.tree", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
    serving.abort();
}

#[tokio::test]
async fn a5765c_open_b_is_already_complete() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    let alias = target.path().join("alias");
    std::os::unix::fs::symlink(target.path(), &alias).unwrap();
    // B is already open in the fake App. Neither request asks it to create another Daemon.
    for path in [target.path(), alias.as_path()] {
        let cli = world.cli(path, false);
        let request = world.next().await;
        assert_eq!(request["params"]["path"], json!(target.path()));
        world.answer(&request, json!({"path":target.path()})).await;
        let output = cli.wait_with_output().await.unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap().trim(),
            format!("opened Project {}", target.path().display())
        );
    }
}

#[tokio::test]
async fn i5765_project_open_failures_print_no_success_and_exit_one() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    for (code, cause) in [
        (-32002, "The user refused to open"),
        (-32001, "Folder unavailable"),
        (-32603, "Project could not be opened"),
    ] {
        let cli = world.cli(target.path(), false);
        let request = world.next().await;
        let message = format!("{cause}: {}", target.path().display());
        world.app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":code,"message":message}})).await.unwrap();
        let output = cli.wait_with_output().await.unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains(&message));
    }
}

#[tokio::test]
async fn i5765_invalid_usage_calls_nothing() {
    let world = World::new().await;
    for args in [
        vec!["project", "open", "/tmp", "--yolo"],
        vec![
            "project", "start", "/tmp", "--kind", "bad", "--name", "worker", "--prompt", "work",
        ],
        vec![
            "project", "start", "/tmp", "--kind", "agent", "--name", "worker",
        ],
        vec![
            "project", "start", "/tmp", "--kind", "agent", "--name", "worker", "--prompt", "work",
            "--yolo",
        ],
    ] {
        let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(args)
            .env("RUPD_SOCKET", &world.socket)
            .env("ROUNDUP_AGENT", &world.id)
            .output()
            .await
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "{output:?}");
        assert!(output.stdout.is_empty());
    }
    // The identified connection still answers normally after invalid CLI usage.
    let caller = Client::connect(&world.socket).await.unwrap();
    caller
        .request(
            "daemon.identify",
            IdentifyParams {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: world.id.clone(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(
        caller
            .request("rail.tree", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn a5765f_closed_app_and_old_registration_cannot_complete_a_new_open() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    let first = world.cli(target.path(), true);
    let old = world.next().await;
    let mut replacement = Client::connect(&world.socket).await.unwrap();
    let mut requests = replacement.take_requests().unwrap();
    replacement
        .request("action.serve", Value::Null)
        .await
        .unwrap();
    let output = first.wait_with_output().await.unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("connection was lost"));
    loop {
        let invalidation = world.asked.recv().await.unwrap();
        if invalidation["method"] == "action.closed" {
            break;
        }
    }
    let mut second = world.cli(target.path(), true);
    let current = loop {
        let request = requests.recv().await.unwrap();
        if request["method"] == "project.open" {
            break request;
        }
        replacement
            .reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]}))
            .await
            .unwrap();
    };
    // Even a forged current id from the old connection cannot answer the replacement's request.
    world.answer(&old, json!({"path":target.path()})).await;
    world.answer(&current, json!({"path":target.path()})).await;
    world.app.request("rail.tree", Value::Null).await.unwrap();
    assert!(second.try_wait().unwrap().is_none());
    drop(replacement);
    let output = second.wait_with_output().await.unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("connection was lost"));
    assert!(!target.path().join(".roundup").exists());
    // The prior UNKNOWN_OUTCOME is an acknowledgement that the registration has ended.
    let output = world
        .cli(target.path(), false)
        .wait_with_output()
        .await
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("open it and retry"));
}

#[tokio::test]
async fn i5765_stdin_preserves_the_prompt_and_cli_start_returns_the_identity() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    let prompt = " exact é\n  first prompt\n";
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["project", "start"])
        .arg(target.path())
        .args([
            "--kind",
            "mode",
            "--name",
            "target-worker",
            "--prompt",
            "-",
            "--json",
        ])
        .env("RUPD_SOCKET", &world.socket)
        .env("ROUNDUP_AGENT", &world.id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(prompt.as_bytes())
        .await
        .unwrap();
    let request = world.next().await;
    assert_eq!(request["method"], "project.start");
    assert_eq!(request["params"]["prompt"], prompt);
    assert_eq!(request["params"]["kind"], "mode");
    let result = json!({"path":target.path(),"kind":"mode","id":"42"});
    world.answer(&request, result.clone()).await;
    let output = child.wait_with_output().await.unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        result
    );
}

#[tokio::test]
async fn i5765_cli_and_mcp_share_the_project_contract() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    let shim = spawn_shim(&world.socket, &world.id).await;
    let tools = shim.client.list_all_tools().await.unwrap();
    assert!(tools.iter().any(|tool| tool.name == "project_start"));
    let params = json!({"path":target.path(),"kind":"agent","name":"worker","prompt":"exact work"});
    let call = shim.call("project_start", params.clone());
    tokio::pin!(call);
    let request = tokio::select! {
        result = &mut call => panic!("MCP answered before the App: {result:?}"),
        request = world.next() => request,
    };
    assert_eq!(request["method"], "project.start");
    for key in ["path", "kind", "name", "prompt"] {
        assert_eq!(request["params"][key], params[key]);
    }
    let result = json!({"path":target.path(),"kind":"agent","id":"43"});
    world.answer(&request, result.clone()).await;
    let output = call.await;
    assert_eq!(output.is_error, Some(false));
    assert_eq!(text(&output), result);
}

#[tokio::test]
async fn i5765_start_results_and_failures_keep_the_final_outcome() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    for kind in ["agent", "workstream", "mode"] {
        for error in [
            None,
            Some((-32002, "The user refused the folder")),
            Some((-32011, "Open roundup and retry")),
            Some((
                -32603,
                "Target launch failed; inspect row 42 before retrying",
            )),
            Some((
                -32004,
                "Unknown outcome; inspect the target before retrying",
            )),
        ] {
            let child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
                .args(["project", "start"])
                .arg(target.path())
                .args(["--kind", kind, "--name", "worker", "--prompt", "work"])
                .env("RUPD_SOCKET", &world.socket)
                .env("ROUNDUP_AGENT", &world.id)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let request = world.next().await;
            assert_eq!(request["method"], "project.start");
            if let Some((code, cause)) = error {
                world.app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":code,"message":cause}})).await.unwrap();
            } else {
                world
                    .answer(
                        &request,
                        json!({"path":target.path(),"kind":kind,"id":"42"}),
                    )
                    .await;
            }
            let output = child.wait_with_output().await.unwrap();
            if let Some((_, cause)) = error {
                assert_eq!(output.status.code(), Some(1));
                assert!(output.stdout.is_empty());
                assert!(String::from_utf8_lossy(&output.stderr).contains(cause));
            } else {
                assert!(output.status.success(), "{output:?}");
                let stdout = String::from_utf8_lossy(&output.stdout);
                for value in [target.path().to_str().unwrap(), kind, "42"] {
                    assert!(stdout.contains(value), "{stdout}");
                }
            }
        }
    }
}
