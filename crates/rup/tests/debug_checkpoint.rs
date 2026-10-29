//! A4691: real debug packaging, Door MCP, and durable Checkpoint Marks, without an override.
#[path = "../../rupd/tests/support/rupd_harness.rs"]
mod rupd_harness;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rmcp::{ServiceExt, model::CallToolRequestParams};
use serde_json::{Value, json};

const SESSION: &str = "00000000-0000-4000-8000-000000000036";
const RECORDS: &str =
    "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"saved debug work\"}}\n";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn prepared() -> PathBuf {
    Path::new(env!("CARGO_BIN_EXE_rup")).with_file_name("rupd")
}

struct Fix {
    daemon: rupd_harness::Rupd,
    client: rpc::Client,
    door: String,
    conversation: PathBuf,
    data: PathBuf,
    _dir: tempfile::TempDir,
}

impl Drop for Fix {
    fn drop(&mut self) {
        // Attached EOF lets the Daemon stop and reap its fake vendor before storage disappears.
        drop(self.daemon.stdin.take());
        self.daemon.child.wait().unwrap();
    }
}

async fn start(exe: &Path) -> Fix {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    std::fs::create_dir(&project).unwrap();
    for args in [
        vec!["init", "-q"],
        vec![
            "-c",
            "user.name=test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-qm",
            "base",
        ],
    ] {
        assert!(
            Command::new("git")
                .current_dir(&project)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    let config = dir.path().join("vendor");
    // Ask the real, prepared SDK for the fixture destination too; the observer never guesses vendor paths.
    let sidecar = prepared().with_file_name("sidecar");
    let mut sdk = Command::new(sidecar.join("node"))
        .arg(sidecar.join("list.mjs"))
        .env("CLAUDE_CONFIG_DIR", &config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("run pnpm install and just build-debug first");
    writeln!(
        sdk.stdin.take().unwrap(),
        "{}",
        json!({"op":"destination", "sessionId":SESSION, "dir":project})
    )
    .unwrap();
    let output = sdk.wait_with_output().unwrap();
    assert!(output.status.success());
    let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
    let conversation = PathBuf::from(reply["path"].as_str().expect("SDK fixture destination"));
    // The fake vendor saves the records before its SessionStart hook announces this identity.
    let run = json!([[
        "python3",
        "-c",
        "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.argv[2])",
        conversation,
        RECORDS
    ]])
    .to_string();
    let data_root = dir.path().join("data");
    let mut daemon = rupd_harness::start(exe, &project, true, |command| {
        command
            .current_dir(&project)
            .env_remove("ROUNDUP_SIDECAR_DIR")
            .env("ROUNDUP_DATA_DIR", &data_root)
            .env("CLAUDE_CONFIG_DIR", &config)
            .env("HOME", dir.path().join("home"))
            .env("ROUNDUP_RUP_BIN", env!("CARGO_BIN_EXE_rup"))
            .env(
                "ROUNDUP_CLAUDE_BIN",
                root().join("crates/rup/tests/e2e/fake_claude.py"),
            )
            .env("FAKE_CLAUDE_RUN", run)
            .env("FAKE_CLAUDE_RUN_REPORT", dir.path().join("saved.json"))
            .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launch.json"));
    });
    let mut stderr = daemon.stderr.take().unwrap();
    std::thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::stderr()));
    let mut events = rpc::Client::connect(&daemon.socket).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let door = events
        .request(
            "rail.createWorkstream",
            json!({"name":"debug", "parent":null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    events
        .request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        while let Some(event) = events.next_event().await {
            if let contracts::EventData::AgentStatus(status) = event.data
                && status.id == door
                && status.status.kind == contracts::Kind::Idle
            {
                return;
            }
        }
        panic!("Daemon closed before Door became idle");
    })
    .await
    .expect("Door SessionStart and idle");
    let data = rupd::data::project_data(&data_root, &project).unwrap();
    Fix {
        daemon,
        client: events,
        door,
        conversation,
        data,
        _dir: dir,
    }
}

async fn write(fx: &Fix) -> rmcp::model::CallToolResult {
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["mcp", &fx.door])
        .env("RUPD_SOCKET", &fx.daemon.socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let service =
        ().serve((child.stdout.take().unwrap(), child.stdin.take().unwrap()))
            .await
            .unwrap();
    let request = CallToolRequestParams::new("checkpoint_write").with_arguments(
        json!({"title":"debug saved", "blocks":[{"kind":"text", "text":"ready"}]})
            .as_object()
            .unwrap()
            .clone(),
    );
    let result = tokio::time::timeout(Duration::from_secs(30), service.call_tool(request))
        .await
        .unwrap()
        .unwrap();
    service.cancel().await.unwrap();
    child.wait().await.unwrap();
    result
}

async fn assert_mark(fx: &Fix, result: rmcp::model::CallToolResult) {
    assert_ne!(result.is_error, Some(true), "{result:?}");
    let checkpoint: Value =
        serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
    let listed = fx
        .client
        .request("checkpoint.list", json!({"workstream":fx.door}))
        .await
        .unwrap();
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["id"] == checkpoint["id"] && c["rewindable"] == true)
    );
    let store = checkpoints::Checkpoints::open(&fx.data).unwrap();
    let marks = store
        .marks(
            &fx.door,
            u32::try_from(checkpoint["id"].as_u64().unwrap()).unwrap(),
        )
        .unwrap();
    assert_eq!(marks.agents.len(), 1);
    assert_eq!(marks.agents[0].agent, fx.door);
    assert_eq!(marks.agents[0].conversation, RECORDS.as_bytes());
    assert_eq!(std::fs::read(&fx.conversation).unwrap(), RECORDS.as_bytes());
}

#[tokio::test]
async fn a4691a_debug_checkpoint_uses_the_adjacent_sidecar() {
    let fx = start(&prepared()).await;
    assert_mark(&fx, write(&fx).await).await;
}

#[tokio::test]
async fn a4691b_missing_debug_runtime_is_repairable() {
    for missing in ["node", "list.mjs"] {
        let package = tempfile::tempdir().unwrap();
        let exe = package.path().join("rupd");
        std::fs::copy(prepared(), &exe).unwrap();
        let sidecar = package.path().join("sidecar");
        std::fs::create_dir(&sidecar).unwrap();
        for entry in ["node", "list.mjs"]
            .into_iter()
            .filter(|entry| *entry != missing)
        {
            std::os::unix::fs::symlink(
                prepared().with_file_name("sidecar").join(entry),
                sidecar.join(entry),
            )
            .unwrap();
        }
        let fx = start(&exe).await;
        let failure = write(&fx).await;
        assert_eq!(failure.is_error, Some(true), "{failure:?}");
        let message = &failure.content[0].as_text().unwrap().text;
        assert!(
            message.contains(sidecar.join(missing).to_str().unwrap()),
            "{message}"
        );
        assert!(message.contains("pnpm install"), "{message}");
        assert!(message.contains("ROUNDUP_SIDECAR_DIR"), "{message}");
        let repair = format!(
            "tools/sidecar/bundle.sh '{}' --local-node",
            sidecar.display()
        );
        assert!(message.contains(&repair), "{message}");
        assert_eq!(std::fs::read(&fx.conversation).unwrap(), RECORDS.as_bytes());
        assert!(
            Command::new("pnpm")
                .arg("install")
                .env("CI", "true")
                .current_dir(root())
                .status()
                .unwrap()
                .success()
        );
        assert!(
            Command::new("bash")
                .arg("-c")
                .arg(&repair)
                .current_dir(root())
                .status()
                .unwrap()
                .success()
        );
        assert_mark(&fx, write(&fx).await).await;
    }
}
