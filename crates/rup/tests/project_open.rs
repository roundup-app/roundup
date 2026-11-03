//! A5765 and I5765 open-only observers through the public CLI and real source Daemon.
use contracts::{Actor, ActorKind, IdentifyParams};
use rpc::Client;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::mpsc;

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
        let daemon = Arc::new(rupd::Daemon::open(&dir.path().join(".roundup")).unwrap());
        let server = tokio::spawn(rupd::serve(
            tokio::net::UnixListener::bind(&socket).unwrap(),
            daemon,
        ));
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
    let target_daemon = rupd::Daemon::open(&target.path().join(".roundup")).unwrap();
    let target_socket = target.path().join("target.sock");
    let serving = tokio::spawn(rupd::serve(
        tokio::net::UnixListener::bind(&target_socket).unwrap(),
        Arc::new(target_daemon),
    ));
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
async fn i5765_project_open_refusal_prints_no_success_and_exits_one() {
    let mut world = World::new().await;
    let target = tempfile::tempdir().unwrap();
    let cli = world.cli(target.path(), false);
    let request = world.next().await;
    let message = format!("The user refused to open {}", target.path().display());
    world
        .app
        .reply(
            &json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32002,"message":message}}),
        )
        .await
        .unwrap();
    let output = cli.wait_with_output().await.unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains(&message));
}

#[tokio::test]
async fn i5765_invalid_usage_calls_nothing() {
    let world = World::new().await;
    let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["project", "open", "/tmp", "--yolo"])
        .env("RUPD_SOCKET", &world.socket)
        .env("ROUNDUP_AGENT", &world.id)
        .output()
        .await
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
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
