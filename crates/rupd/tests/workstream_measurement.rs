//! U3016: production collection, read and reopen; every vendor file is isolated.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::{Value, json};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

const CONVERSATION: &str = "00000000-0000-4000-8000-000000000001";
const FAKE: &str = r#"#!/usr/bin/env python3
import json, os, subprocess, sys, tty
if sys.argv[1:3] == ['plugin', 'list']: print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']: print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
settings = json.load(open(sys.argv[sys.argv.index('--settings')+1]))
conversation='00000000-0000-4000-8000-%012d' % int(os.environ['ROUNDUP_AGENT'])
open(os.path.join(os.getcwd(),'endpoint-'+os.environ['ROUNDUP_AGENT']),'w').write(os.environ.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',''))
for group in settings['hooks']['SessionStart']:
 for hook in group['hooks']:
  subprocess.run(hook['command'], shell=True, input=json.dumps({'hook_event_name':'SessionStart','session_id':conversation,'source':'resume' if '--resume' in sys.argv else 'startup'}), text=True, check=True)
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
while True:
 data=os.read(0,1)
 if not data or data==b'\x03': break
"#;

struct World {
    daemon: rupd_harness::Rupd,
    project: std::path::PathBuf,
    _root: tempfile::TempDir,
    data: tempfile::TempDir,
    client: Client,
    agent: String,
    home: String,
}

impl World {
    fn launch(project: &Path, data: &Path) -> rupd_harness::Rupd {
        rupd_harness::start(
            Path::new(env!("CARGO_BIN_EXE_rupd")),
            project,
            true,
            |cmd| {
                cmd.env("ROUNDUP_DATA_DIR", data)
                    .env("ROUNDUP_CLAUDE_BIN", project.join("claude"))
                    .env(
                        "ROUNDUP_RUP_BIN",
                        Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"),
                    )
                    .env("CLAUDE_CONFIG_DIR", project.join("config"));
            },
        )
    }

    async fn start() -> Self {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("same");
        std::fs::create_dir(&project).unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = project.as_path().join("claude");
        std::fs::write(&fake, FAKE).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let daemon = Self::launch(project.as_path(), data.path());
        let client = Client::connect(&daemon.socket).await.unwrap();
        let home = client
            .request("rail.createWorkstream", json!({"name":"same"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        client
            .request("rail.startDoor", json!({"id":home}))
            .await
            .unwrap();
        let world = Self {
            daemon,
            project,
            _root: root,
            data,
            client,
            agent: home.clone(),
            home,
        };
        world.idle(&world.agent).await;
        world
    }

    async fn idle(&self, agent: &str) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let tree = self.client.request("rail.tree", Value::Null).await.unwrap();
                if tree
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|node| node["id"] == agent && node["status"]["kind"] == "idle")
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the fixture acknowledges its actual launch");
    }

    fn source_id(&self) -> String {
        format!(
            "00000000-0000-4000-8000-{:012}",
            self.agent.parse::<u64>().unwrap()
        )
    }

    async fn spawn_agent(&mut self) {
        let node = self
            .client
            .request(
                "agent.spawn",
                json!({"name":"maker","parent":self.home,"cwd":self.project.as_path()}),
            )
            .await
            .unwrap();
        self.agent = node["id"].as_str().unwrap().to_owned();
        self.idle(&self.agent).await;
    }

    async fn reopen(&mut self) {
        self.daemon.child.kill().unwrap();
        self.daemon.child.wait().unwrap();
        self.daemon = Self::launch(self.project.as_path(), self.data.path());
        self.client = Client::connect(&self.daemon.socket).await.unwrap();
    }

    fn source(&self) -> std::path::PathBuf {
        let encoded: String = self
            .project
            .as_path()
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let path = self
            .project
            .as_path()
            .join("config/projects")
            .join(encoded)
            .join(format!("{}.jsonl", self.source_id()));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        path
    }

    fn append(&self, mut record: Value) {
        if record.get("sessionId").is_some() {
            record["sessionId"] = self.source_id().into();
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.source())
            .unwrap();
        writeln!(file, "{record}").unwrap();
    }

    async fn read(&self) -> Value {
        self.client
            .request("project.measurements", Value::Null)
            .await
            .unwrap()
    }

    async fn contributions(&self, count: usize) -> Value {
        tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                let snapshot = self.read().await;
                if snapshot["contributions"]
                    .as_array()
                    .is_some_and(|a| a.len() == count)
                {
                    return snapshot;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the production collector accepts the complete local record")
    }
}

fn request(id: &str, output: u64) -> Value {
    json!({"type":"assistant", "sessionId":CONVERSATION,"requestId":id,"uuid":format!("{id}-{output}"),"timestamp":"2026-10-20T20:00:00.000Z","message":{"id":format!("msg-{id}"),"usage":{"input_tokens":100,"output_tokens":output,"cache_read_input_tokens":400,"cache_creation_input_tokens":50}}})
}

#[tokio::test]
async fn u3016a_sources_are_scoped_and_counted_once() {
    let w = World::start().await;
    w.append(request("req-1", 20));
    w.append(request("req-1", 20));
    w.append(json!({"type":"result","modelUsage":{"any":{"inputTokens":99999}}}));
    let child = w
        .source()
        .with_extension("")
        .join("subagents/agent-native.jsonl");
    std::fs::create_dir_all(child.parent().unwrap()).unwrap();
    let mut native = request("native", 30);
    native["sessionId"] = w.source_id().into();
    native["message"]["usage"] = json!({"input_tokens":200,"output_tokens":30,"cache_read_input_tokens":0,"cache_creation_input_tokens":0});
    std::fs::write(&child, format!("{native}\n{}\n", request("req-1", 20))).unwrap();
    w.append(json!({"type":"assistant","sessionId":w.source_id(),"requestId":"partial","message":{"usage":{"input_tokens":15}}}));
    w.append(json!({"type":"assistant","message":{"usage":{"input_tokens":999}}}));
    let snapshot = w.contributions(3).await;
    let contribution = snapshot["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["identity"] == "request:req-1")
        .unwrap();
    let partial = snapshot["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["identity"] == "request:partial")
        .unwrap();
    assert_eq!(partial["value"]["usage"]["output"], Value::Null);
    assert_eq!(contribution["attempt"], Value::Null);
    assert!(snapshot["sources"][0]["cause"].is_string());
    let other = World::start().await;
    other.append(request("req-1", 7));
    let isolated = other.contributions(1).await;
    assert_ne!(isolated["project"], snapshot["project"]);
    assert_eq!(isolated["contributions"][0]["value"]["usage"]["output"], 7);

    assert_eq!(contribution["agent"], w.agent);
    assert_eq!(contribution["home"], w.home);
    assert_eq!(
        contribution["value"]["usage"],
        json!({"input":100,"output":20,"cache_read":400,"cache_write":50})
    );
    let cli =
        tokio::process::Command::new(Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"))
            .args(["--json", "project", "measurements", "--agent", &w.agent])
            .env("RUPD_SOCKET", &w.daemon.socket)
            .output()
            .await
            .unwrap();
    assert!(
        cli.status.success(),
        "{}",
        String::from_utf8_lossy(&cli.stderr)
    );
    let public: Value = serde_json::from_slice(&cli.stdout).unwrap();
    assert_eq!(public["contributions"], snapshot["contributions"]);
    let claimant = w
        .client
        .request("agent.spawn", json!({"name":"claimant","cwd":w.project}))
        .await
        .unwrap();
    w.idle(claimant["id"].as_str().unwrap()).await;
    w.client.request("agent.signal",json!({"id":claimant["id"],"attempt":claimant["attempt"],"payload":{"hook_event_name":"SessionStart","session_id":w.source_id(),"source":"startup"}})).await.unwrap();
    w.append(request("ambiguous", 99));
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["sources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["cause"].as_str().is_some_and(|c| c.contains("ambiguous")))
            {
                assert_eq!(read["contributions"], snapshot["contributions"]);
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn u3016b_token_totals_reconcile_by_source() {
    let mut w = World::start().await;
    w.append(request("revision", 20));
    let first = w.contributions(1).await;
    w.append(request("revision", 30));
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["contributions"][0]["value"]["usage"]["output"] == 30 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    w.append(request("revision", 20));
    w.append(json!({"type":"result","usage":{"output_tokens":0}}));
    w.append(json!({"type":"metrics","counter":1000}));
    w.append(json!({"type":"metrics","counter":0}));
    w.reopen().await;
    let read = w.contributions(1).await;
    assert_eq!(read["contributions"][0]["value"]["usage"]["output"], 30);
    assert_eq!(
        read["contributions"][0]["home"],
        first["contributions"][0]["home"]
    );
    w.client
        .request("rail.startDoor", json!({"id":w.home}))
        .await
        .unwrap();
    w.append(request("revision", 30));
    assert_eq!(
        w.contributions(1).await["contributions"],
        read["contributions"]
    );
}

#[tokio::test]
async fn u3016a_moves_and_removal_keep_recorded_attribution() {
    let mut w = World::start().await;
    w.spawn_agent().await;
    w.append(request("before", 20));
    let first = w.contributions(1).await;
    let other = w
        .client
        .request("rail.createWorkstream", json!({"name":"other"}))
        .await
        .unwrap()["id"]
        .clone();
    w.client
        .request("rail.rename", json!({"id":w.agent,"name":"renamed"}))
        .await
        .unwrap();
    w.client
        .request("rail.move", json!({"id":w.agent,"parent":other,"index":0}))
        .await
        .unwrap();
    w.append(request("after", 30));
    let moved = w.contributions(2).await;
    let before = moved["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["identity"] == "request:before")
        .unwrap();
    let after = moved["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["identity"] == "request:after")
        .unwrap();
    assert_eq!(before, &first["contributions"][0]);
    assert_eq!(after["home"], other);
    assert_eq!(after["maker"], "renamed");
    w.client
        .request("agent.stop", json!({"id":w.agent}))
        .await
        .unwrap();
    w.client
        .request("rail.remove", json!({"id":w.agent}))
        .await
        .unwrap();
    w.reopen().await;
    assert_eq!(
        w.contributions(2).await["contributions"],
        moved["contributions"]
    );
    w.append(request("late", 40));
    let late = w.contributions(3).await;
    let arrival = late["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["identity"] == "request:late")
        .unwrap();
    assert_eq!(arrival["home"], other);
    assert_eq!(arrival["maker"], "renamed");
    w.client
        .request("rail.remove", json!({"id":w.home}))
        .await
        .unwrap();
    std::fs::remove_file(w.source()).unwrap();
    w.append(request("before", 20));
    w.append(request("after", 30));
    w.reopen().await;
    let read = w.contributions(2).await;
    assert!(
        read["contributions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["identity"] != "request:before")
    );
    w.client
        .request("rail.remove", json!({"id":other}))
        .await
        .unwrap();
    w.reopen().await;
    assert!(
        w.contributions(0).await["contributions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn u3016d_reconnect_reconciles_without_double_counting() {
    let mut w = World::start().await;
    let mut subscribed = Client::connect(&w.daemon.socket).await.unwrap();
    subscribed
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    w.append(request("retained", 20));
    let first = w.contributions(1).await;
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let event = subscribed.next_event().await.unwrap();
            if let contracts::EventData::MeasurementsChanged { revision } = event.data {
                assert_eq!(revision, first["revision"]);
                break;
            }
        }
    })
    .await
    .unwrap();
    std::fs::remove_file(w.source()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["sources"][0]["cause"].is_string() {
                assert_eq!(read["contributions"], first["contributions"]);
                assert!(read["sources"][0]["last_good"].is_number());
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    w.append(request("retained", 20));
    w.reopen().await;
    let read = w.contributions(1).await;
    assert_eq!(read["contributions"], first["contributions"]);
}

async fn post(url: &str, body: Value) -> u16 {
    let script = "import sys,urllib.request,urllib.error\ntry:\n r=urllib.request.urlopen(urllib.request.Request(sys.argv[1],sys.argv[2].encode(),{'Content-Type':'application/json'})); print(r.status)\nexcept urllib.error.HTTPError as e: print(e.code)";
    let out = tokio::process::Command::new("python3")
        .args(["-c", script, url, &body.to_string()])
        .output()
        .await
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout)
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

fn intervals(source: &str) -> Value {
    let span = |name: &str, id: &str| json!({"name":name,"traceId":"trace-source","spanId":id,"startTimeUnixNano":"1000000000","endTimeUnixNano":"2000000000","attributes":[{"key":"session.id","value":{"stringValue":source}}]});
    json!({"resourceSpans":[{"scopeSpans":[{"spans":[span("claude_code.llm_request","request"),span("claude_code.tool.execution","tool"),span("claude_code.tool.blocked_on_user","permission")]}]}]})
}

#[tokio::test]
async fn u3016a_intervals_use_the_launch_owner_and_source_clock() {
    let mut w = World::start().await;
    let endpoint = w.project.join(format!("endpoint-{}", w.agent));
    let url = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(url) = std::fs::read_to_string(&endpoint)
                && url.starts_with("http://")
            {
                break url;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let unknown = url.replace(url.split('/').nth(3).unwrap(), "unowned");
    assert_eq!(post(&unknown, intervals(&w.source_id())).await, 404);
    assert_eq!(post(&url, intervals("unowned-conversation")).await, 422);
    assert_eq!(post(&url, intervals(&w.source_id())).await, 200);
    assert_eq!(post(&url, intervals(&w.source_id())).await, 200);
    let read = w.contributions(2).await;
    let values = read["contributions"].as_array().unwrap();
    assert!(values.iter().all(|v| v["agent"] == w.agent
        && v["attempt"] == "1"
        && v["value"]["start_unix_ns"] == "1000000000"
        && v["value"]["end_unix_ns"] == "2000000000"));
    assert!(values.iter().any(|v| v["value"]["category"] == "tool"));
    assert!(values.iter().any(|v| v["value"]["category"] == "agent"));
    w.reopen().await;
    assert_eq!(
        w.contributions(2).await["contributions"],
        read["contributions"]
    );
}
