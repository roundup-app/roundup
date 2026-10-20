//! U3016: production collection, read and reopen; every vendor file is isolated.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;
use rpc::Client;
use serde_json::{Value, json};

const CONVERSATION: &str = "00000000-0000-4000-8000-000000003016";
const FAKE: &str = r#"#!/usr/bin/env python3
import json, os, subprocess, sys, tty
if sys.argv[1:3] == ['plugin', 'list']: print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']: print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
settings = json.load(open(sys.argv[sys.argv.index('--settings')+1]))
for group in settings['hooks']['SessionStart']:
 for hook in group['hooks']:
  subprocess.run(hook['command'], shell=True, input=json.dumps({'hook_event_name':'SessionStart','session_id':'00000000-0000-4000-8000-000000003016','source':'resume' if '--resume' in sys.argv else 'startup'}), text=True, check=True)
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
while True:
 data=os.read(0,1)
 if not data or data==b'\x03': break
"#;

struct World {
    daemon: rupd_harness::Rupd,
    project: tempfile::TempDir,
    _data: tempfile::TempDir,
    client: Client,
    agent: String,
    home: String,
}

impl World {
    fn launch(project: &Path, data: &Path) -> rupd_harness::Rupd {
        rupd_harness::start(Path::new(env!("CARGO_BIN_EXE_rupd")), project, true, |cmd| {
            cmd.env("ROUNDUP_DATA_DIR", data)
                .env("ROUNDUP_CLAUDE_BIN", project.join("claude"))
                .env("ROUNDUP_RUP_BIN", Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"))
                .env("CLAUDE_CONFIG_DIR", project.join("config"));
        })
    }

    async fn start() -> Self {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = project.path().join("claude");
        std::fs::write(&fake, FAKE).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let daemon = Self::launch(project.path(), data.path());
        let client = Client::connect(&daemon.socket).await.unwrap();
        let home = client.request("rail.createWorkstream", json!({"name":"same"})).await.unwrap()["id"].as_str().unwrap().to_owned();
        client.request("rail.startDoor", json!({"id":home})).await.unwrap();
        Self {daemon, project, _data: data, client, agent: home.clone(), home}
    }

    fn source(&self) -> std::path::PathBuf {
        let encoded: String = self.project.path().to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() {c} else {'-'}).collect();
        let path = self.project.path().join("config/projects").join(encoded).join(format!("{CONVERSATION}.jsonl"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        path
    }

    fn append(&self, record: Value) {
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(self.source()).unwrap();
        writeln!(file, "{record}").unwrap();
    }

    async fn read(&self) -> Value {
        self.client.request("project.measurements", Value::Null).await.unwrap()
    }

    async fn contributions(&self, count: usize) -> Value {
        tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                let snapshot = self.read().await;
                if snapshot["contributions"].as_array().is_some_and(|a| a.len() == count) {return snapshot;}
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.expect("the production collector accepts the complete local record")
    }
}

fn request(id: &str, output: u64) -> Value {
    json!({"type":"assistant", "sessionId":CONVERSATION,"requestId":id,"uuid":format!("{id}-{output}"),"timestamp":"2026-10-20T20:00:00.000Z","message":{"id":format!("msg-{id}"),"usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":400,"cache_creation_input_tokens":50}}})
}

#[tokio::test]
async fn u3016a_sources_are_scoped_and_counted_once() {
    let w = World::start().await;
    w.append(request("req-1",20));
    w.append(request("req-1",20));
    w.append(json!({"type":"result","modelUsage":{"any":{"inputTokens":99999}}}));
    let snapshot = w.contributions(1).await;
    let contribution = &snapshot["contributions"][0];
    assert_eq!(contribution["agent"], w.agent);
    assert_eq!(contribution["home"], w.home);
    assert_eq!(contribution["value"]["usage"], json!({"input":100,"output":20,"cache_read":400,"cache_write":50}));
    let cli = tokio::process::Command::new(Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"))
        .args(["--json","project","measurements"]).env("RUPD_SOCKET",&w.daemon.socket).output().await.unwrap();
    assert!(cli.status.success(), "{}", String::from_utf8_lossy(&cli.stderr));
    let public: Value = serde_json::from_slice(&cli.stdout).unwrap();
    assert_eq!(public["contributions"], snapshot["contributions"]);
}
