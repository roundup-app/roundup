//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::{Client, RpcError};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

const BOUND: Duration = Duration::from_secs(15);

struct Run {
    daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    data: tempfile::TempDir,
    user: Arc<Client>,
    child: String,
    terminal: Value,
    attempt: Value,
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, r#"#!/usr/bin/env python3
import json, os, subprocess, sys, tty
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
settings = json.load(open(sys.argv[sys.argv.index('--settings') + 1]))
for group in settings['hooks']['SessionStart']:
    for hook in group['hooks']:
        subprocess.run(hook['command'], shell=True, input=json.dumps({'hook_event_name':'SessionStart','session_id':'00000000-0000-4000-8000-000000000006','source':'startup'}), text=True, check=True)
print('READY', flush=True)
while True:
    data = os.read(0, 1)
    if not data: break
    print('BYTE:' + data.hex(), flush=True)
"#).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let daemon = launch(dir.path(), data.path());
        let user = Arc::new(Client::connect(&daemon.socket).await.unwrap());
        let mut run = Self {
            daemon,
            dir,
            data,
            user,
            child: String::new(),
            terminal: Value::Null,
            attempt: Value::Null,
        };
        run.spawn().await;
        run
    }

    async fn spawn(&mut self) {
        assert!(self.data.path().is_dir());
        let node = self
            .user
            .request("agent.spawn", json!({"name":"child","cwd":self.dir.path()}))
            .await
            .unwrap();
        self.child = node["id"].as_str().unwrap().to_owned();
        self.terminal = node["terminal_id"].clone();
        self.attempt = node["attempt"].clone();
        tokio::time::timeout(BOUND, async {
            loop {
                if self.screen().await.contains("READY") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn screen(&self) -> String {
        self.user
            .request("terminal.read", json!({"id":self.terminal,"after":0}))
            .await
            .unwrap()["text"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    async fn open(&self, kind: &str) -> (Value, tokio::task::JoinHandle<Result<Value, RpcError>>) {
        let caller = Arc::new(Client::connect(&self.daemon.socket).await.unwrap());
        if kind == "ask_user" {
            caller
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":self.child}}),
                )
                .await
                .unwrap();
        }
        let child = self.child.clone();
        let kind = kind.to_owned();
        let task = tokio::spawn(async move {
            if kind == "ask_user" {
                caller.request("agent.ask", json!({"question":"Same prompt?","answers":[{"label":"Yes","description":"Proceed"}]})).await
            } else {
                let payload = if kind == "native" {
                    json!({"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Same prompt?","options":[{"label":"Yes"}]}]}})
                } else {
                    json!({"tool_name":"Bash","tool_input":{"command":"Same prompt?"}})
                };
                caller
                    .request("agent.permission", json!({"id":child,"payload":payload}))
                    .await
            }
        });
        let decision = tokio::time::timeout(BOUND, async {
            loop {
                let listed = self.user.request("decision.list", ()).await.unwrap();
                if let Some(decision) = listed.as_array().unwrap().first() {
                    return decision.clone();
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        (decision, task)
    }

    async fn capture(&self, decision: &Value) -> Value {
        self.user
            .request("decision.capture", json!({"id":decision["id"]}))
            .await
            .unwrap()
    }

    async fn clear(&self) {
        self.user.request("agent.signal", json!({"id":self.child,"attempt":self.attempt,"payload":{"hook_event_name":"PostToolUse"}})).await.unwrap();
    }

    async fn write(&self, identity: Value, bytes: &[u8]) -> Result<Value, RpcError> {
        self.user
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":STANDARD.encode(bytes),"identity":identity}),
            )
            .await
    }

    async fn finish(self) {
        self.user
            .request("agent.stop", json!({"id":self.child}))
            .await
            .unwrap();
    }
}

fn launch(project: &Path, data: &Path) -> rupd_harness::Rupd {
    let rup = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project,
        true,
        |command| {
            command
                .env("ROUNDUP_DATA_DIR", data)
                .env("ROUNDUP_CLAUDE_BIN", project.join("claude"))
                .env("ROUNDUP_RUP_BIN", rup)
                .env("CLAUDE_CONFIG_DIR", project.join("config"))
                .stderr(std::process::Stdio::null());
        },
    )
}

#[tokio::test]
async fn b6_original_prompt_identity_refuses_identical_replacements() {
    let run = Run::start().await;
    for kind in ["permission", "ask_user", "native"] {
        let (original, waiting) = run.open(kind).await;
        let identity = run.capture(&original).await;
        run.clear().await;
        let _ = waiting.await.unwrap();
        let (replacement, waiting) = run.open(kind).await;
        assert_eq!(original["args"], replacement["args"]);
        let err = run.write(identity, b"old\r").await.unwrap_err();
        assert_eq!(err.code, rpc::code::CONFLICT);
        assert!(err.message.contains("original prompt"), "{err:?}");
        assert!(!run.screen().await.contains("BYTE:"));
        run.clear().await;
        let _ = waiting.await.unwrap();
    }
    run.finish().await;
}
