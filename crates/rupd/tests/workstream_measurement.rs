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
import json, os, socket, subprocess, sys, tty
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
pending=b''
while True:
 data=os.read(0,1)
 if not data or data==b'\x03': break
 if data in [b'\x02', b'\x04']:
  event = 'UserPromptSubmit' if data == b'\x02' else 'Stop'
  for group in settings['hooks'][event]:
   for hook in group['hooks']:
    subprocess.run(hook['command'], shell=True, input=json.dumps({'hook_event_name':event,'prompt':'Fixture prompt'}), text=True, check=True)
  continue
 if data==b'\x01':
  agent=os.environ['ROUNDUP_AGENT']
  call=json.load(open('call-'+agent+'.json'))
  with socket.socket(socket.AF_UNIX) as peer:
   peer.connect(os.environ['RUPD_SOCKET'])
   stream=peer.makefile('rwb')
   stream.write((json.dumps({'jsonrpc':'2.0','id':0,'method':'daemon.identify','params':{'actor':{'kind':'agent','id':agent}}})+'\n').encode()); stream.flush()
   identified=json.loads(stream.readline())
   if 'error' in identified: raise RuntimeError(identified)
   stream.write((json.dumps({'jsonrpc':'2.0','id':1,**call})+'\n').encode()); stream.flush()
   reply=json.loads(stream.readline())
  with open('reply-'+agent+'.tmp','w') as out: json.dump(reply,out)
  os.rename('reply-'+agent+'.tmp','reply-'+agent+'.json')
  continue
 if data==b'\r':
  prompt=pending.decode(errors='replace'); pending=b''
  for event,fields in [('UserPromptSubmit',{'prompt':prompt}),('Stop',{})]:
   for group in settings['hooks'][event]:
    for hook in group['hooks']:
     subprocess.run(hook['command'],shell=True,input=json.dumps({'hook_event_name':event,**fields}),text=True,check=True)
 else: pending+=data
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
                assert!(
                    revision.parse::<u64>().unwrap()
                        <= first["revision"].as_str().unwrap().parse::<u64>().unwrap()
                );
                break;
            }
        }
    })
    .await
    .unwrap();
    let held = w.source().with_extension("held");
    std::fs::rename(w.source(), &held).unwrap();
    let failed = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["sources"][0]["cause"].is_string() {
                assert_eq!(read["contributions"], first["contributions"]);
                assert!(read["sources"][0]["last_good"].is_number());
                break read;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    std::fs::rename(&held, w.source()).unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["sources"][0]["cause"].is_null() {
                assert_ne!(read["revision"], failed["revision"]);
                assert_eq!(read["contributions"], first["contributions"]);
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("retry clears failure even when the source position is unchanged");
    w.reopen().await;
    let read = w.contributions(1).await;
    assert_eq!(read["contributions"], first["contributions"]);
}

#[tokio::test]
async fn u3016d_skipped_requests_remain_uncovered_after_success_and_reopen() {
    let mut w = World::start().await;
    let mut missing_identity = request("rejected", 99);
    missing_identity
        .as_object_mut()
        .unwrap()
        .remove("requestId");
    w.append(missing_identity);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if w.read().await["sources"][0]["cause"]
                .as_str()
                .is_some_and(|cause| cause.contains("request identity unavailable"))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    w.append(request("accepted", 20));
    let good = w.contributions(1).await;
    w.reopen().await;
    let reopened = w.contributions(1).await;
    assert_eq!(reopened["contributions"], good["contributions"]);
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
    for read in [&good, &reopened, &public] {
        assert!(read["sources"][0]["cause"].is_null());
        assert!(
            read["sources"][0]["coverage"]
                .as_array()
                .unwrap()
                .iter()
                .any(|gap| {
                    gap.as_str().is_some_and(|gap| {
                        gap.contains("skipped") && gap.contains("request identity unavailable")
                    })
                }),
            "skipped requests must remain disclosed: {read}"
        );
    }
}

#[tokio::test]
async fn u3016d_empty_collection_failures_notify_subscribers() {
    let w = World::start().await;
    w.append(json!({"type":"result"}));
    let good = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["sources"][0]["last_good"].is_number() {
                break read;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the empty source is successfully collected");
    let mut subscribed = Client::connect(&w.daemon.socket).await.unwrap();
    subscribed
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    std::fs::rename(w.source(), w.source().with_extension("held")).unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let event = subscribed.next_event().await.unwrap();
            if let contracts::EventData::MeasurementsChanged { revision } = event.data {
                let failed = w.read().await;
                if failed["sources"][0]["cause"].is_string() {
                    assert!(
                        revision.parse::<u64>().unwrap()
                            <= failed["revision"].as_str().unwrap().parse::<u64>().unwrap()
                    );
                    assert_ne!(failed["revision"], good["revision"]);
                    assert_eq!(failed["contributions"], json!([]));
                    assert_eq!(
                        failed["sources"][0]["last_good"],
                        good["sources"][0]["last_good"]
                    );
                    break;
                }
            }
        }
    })
    .await
    .expect("failure is published even before any consumption exists");
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

#[tokio::test]
async fn u3016d_rejected_exports_retain_failure_until_successful_retry() {
    let w = World::start().await;
    w.append(request("retained", 20));
    w.contributions(1).await;
    let url = std::fs::read_to_string(w.project.join(format!("endpoint-{}", w.agent))).unwrap();
    let valid = intervals(&w.source_id());
    assert_eq!(post(&url, valid.clone()).await, 200);
    let mut good = w.contributions(3).await;
    assert!(good["sources"][0]["cause"].is_null());
    let mut missing_end = valid.clone();
    missing_end["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
        .as_object_mut()
        .unwrap()
        .remove("endTimeUnixNano");
    let mut wrong_type = valid.clone();
    wrong_type["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["endTimeUnixNano"] = json!(7);
    for invalid in [missing_end, wrong_type] {
        assert_eq!(post(&url, invalid).await, 422);
        let failed = w.read().await;
        assert!(failed["sources"][0]["cause"].is_string());
        assert_ne!(failed["revision"], good["revision"]);
        assert_eq!(failed["contributions"], good["contributions"]);
        assert_eq!(
            failed["sources"][0]["last_good"],
            good["sources"][0]["last_good"]
        );
        assert_eq!(post(&url, valid.clone()).await, 200);
        good = w.read().await;
        assert!(good["sources"][0]["cause"].is_null());
        assert_ne!(good["revision"], failed["revision"]);
        assert_eq!(good["contributions"], failed["contributions"]);
    }
}

#[tokio::test]
async fn u3016f_real_time_acquisition_to_cli_survives_reopen() {
    let mut w = World::start().await;
    let door = w.agent.clone();
    w.spawn_agent().await;
    let sender = w.agent.clone();
    w.spawn_agent().await;
    let receiver = w.agent.clone();
    let tree = w.client.request("rail.tree", Value::Null).await.unwrap();
    let terminal = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == sender)
        .unwrap()["terminal_id"]
        .clone();
    let trigger = |method: &str, params: Value| {
        std::fs::write(
            w.project.join(format!("call-{sender}.json")),
            json!({"method":method,"params":params}).to_string(),
        )
        .unwrap();
        let reply = w.project.join(format!("reply-{sender}.json"));
        if reply.exists() {
            std::fs::remove_file(reply).unwrap();
        }
    };
    let mut subscribed = Client::connect(&w.daemon.socket).await.unwrap();
    subscribed
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let started = std::time::Instant::now();
    trigger(
        "agent.ask",
        json!({"question":"Continue timing observation?","answers":[{"label":"Yes","description":"Continue"}]}),
    );
    w.client
        .request("terminal.write", json!({"id":terminal,"data":"AQ=="}))
        .await
        .unwrap();
    let decision = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = subscribed.next_event().await.unwrap();
            if let contracts::EventData::DecisionOpened(event) = event.data {
                break event;
            }
        }
    })
    .await;
    if decision.is_err() {
        eprintln!(
            "fake reply: {:?}; terminal: {}",
            std::fs::read_to_string(w.project.join(format!("reply-{sender}.json"))),
            w.client
                .request("terminal.read", json!({"id":terminal,"after":0}))
                .await
                .unwrap()
        );
    }
    let decision = decision.unwrap();
    // DecisionOpened precedes retaining its blocking-wait evidence; read the collector's fact.
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let active = w.read().await;
            if active["time_evidence"].as_array().unwrap().iter().any(|f| {
                f["agent"] == sender
                    && f["value"]["activity"]["decision"] == decision.id
                    && f["value"]["state"]["kind"] == "active"
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the opened Decision retains its active wait");
    let decision_delay = started.elapsed();
    w.client
        .request(
            "decision.answer",
            json!({"id":decision.id,"answer":"Yes","proof":"0".repeat(64)}),
        )
        .await
        .unwrap();
    let reply_path = w.project.join(format!("reply-{sender}.json"));
    let reply = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(text) = std::fs::read_to_string(&reply_path) {
                break serde_json::from_str::<Value>(&text).unwrap();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(reply.get("result").is_some(), "{reply}");
    let started = std::time::Instant::now();
    trigger(
        "message.send",
        json!({"to":receiver,"kind":"question","body":"Coordinate timing observation"}),
    );
    w.client
        .request("terminal.write", json!({"id":terminal,"data":"AQ=="}))
        .await
        .unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(text) = std::fs::read_to_string(&reply_path) {
                break serde_json::from_str::<Value>(&text).unwrap();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let message = reply
        .get("result")
        .unwrap_or_else(|| panic!("{reply}"))
        .clone();
    assert_eq!(
        message["from"]["id"], sender,
        "the fake vendor's own PID supplies Agent authority"
    );
    let retained = w
        .client
        .request("message.get", json!({"id":message["id"]}))
        .await
        .unwrap();
    assert_eq!(retained["body"], "Coordinate timing observation");
    for id in [&sender, &receiver, &door] {
        w.client
            .request("agent.stop", json!({"id":id}))
            .await
            .unwrap();
    }
    let before = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = w.read().await;
            let facts = snapshot["time_evidence"].as_array().unwrap();
            if facts
                .iter()
                .filter(|f| {
                    matches!(
                        f["value"]["activity"]["kind"].as_str(),
                        Some("attempt" | "decision")
                    )
                })
                .count()
                == 4
                && facts
                    .iter()
                    .all(|fact| fact["value"]["state"]["kind"] == "ended")
            {
                break snapshot;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("three stopped Attempts and their Decision wait reconcile as ended");
    let coordination_delay = started.elapsed();
    let answers = w
        .client
        .request("decision.answers", json!({"agent":sender}))
        .await
        .unwrap();
    println!(
        "sanitized acquisition: {}",
        json!({"decision_opened":decision,"answers":answers,"message":retained})
    );
    let facts = before["time_evidence"].as_array().unwrap();
    // B50/B51: a missing inbox holds without a prompt wait. The positive blocking-wait
    // proof remains u3016c_time_categories_use_observed_intervals_sources, gating the inbox.
    assert_eq!(retained["status"], "held");
    assert_eq!(retained["reason"], "inbox");
    assert!(
        !facts
            .iter()
            .any(|f| f["value"]["activity"]["kind"] == "coordination"),
        "a nonblocking inbox hold must not invent coordination time"
    );
    let cli =
        tokio::process::Command::new(Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"))
            .args(["--json", "project", "measurements", "--agent", &sender])
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
    assert_eq!(public["time_evidence"], before["time_evidence"]);
    w.reopen().await;
    assert_eq!(w.read().await["time_evidence"], before["time_evidence"]);
    println!(
        "time observer: decision acquisition {:?}; nonblocking inbox send {:?}; raw Decision {} and Message {} reconcile to {} retained facts; CLI and reopened facts equal",
        decision_delay,
        coordination_delay,
        decision.id,
        message["id"],
        facts.len()
    );
    println!("sanitized time evidence: {}", before["time_evidence"]);
}

#[tokio::test]
async fn u3016f_real_other_time_acquisition_to_cli_survives_reopen() {
    let mut w = World::start().await;
    let first = w.read().await;
    let phases = |read: &Value, kind: &str| -> Vec<Value> {
        read["time_evidence"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["value"]["activity"]["kind"] == kind)
            .cloned()
            .collect()
    };
    let startup = phases(&first, "startup");
    assert_eq!(startup.len(), 1);
    assert_eq!(startup[0]["value"]["state"]["kind"], "ended");
    assert!(!startup[0]["value"]["start"].is_null());
    let opening_idle = phases(&first, "idle");
    assert_eq!(opening_idle.len(), 1);
    let mut events = Client::connect(&w.daemon.socket).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let terminal = w
        .client
        .request("rail.tree", Value::Null)
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == w.agent)
        .unwrap()["terminal_id"]
        .clone();
    let mut transitions = vec![];
    let mut delays = vec![];
    for (data, kind) in [
        ("Ag==", contracts::Kind::Working),
        ("BA==", contracts::Kind::Idle),
    ] {
        let started = std::time::Instant::now();
        w.client
            .request("terminal.write", json!({"id":terminal,"data":data}))
            .await
            .unwrap();
        let event = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let event = events.next_event().await.unwrap();
                if let contracts::EventData::AgentStatus(event) = event.data
                    && event.id == w.agent
                    && event.status.kind == kind
                    && event.status_revision.parse::<u64>().unwrap()
                        > opening_idle[0]["value"]["activity"]["status_revision"]
                            .as_str()
                            .unwrap()
                            .parse::<u64>()
                            .unwrap()
                {
                    break event;
                }
            }
        })
        .await
        .expect("fake vendor hook produces the actual Adapter Status");
        let read = w.read().await;
        assert_eq!(
            phases(&read, "idle").len(),
            if kind == contracts::Kind::Idle { 2 } else { 1 }
        );
        assert!(
            read["contributions"].as_array().unwrap().is_empty(),
            "working is no model execution evidence"
        );
        delays.push(started.elapsed().as_millis());
        transitions.push(serde_json::to_value(event).unwrap());
    }
    w.client
        .request("agent.stop", json!({"id":w.agent}))
        .await
        .unwrap();
    let before = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let read = w.read().await;
            if read["time_evidence"]
                .as_array()
                .unwrap()
                .iter()
                .all(|f| f["value"]["state"]["kind"] == "ended")
            {
                break read;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(phases(&before, "startup"), startup);
    let idle = phases(&before, "idle");
    for (index, fact) in idle.iter().enumerate() {
        assert_eq!(fact["home"], w.home);
        assert_eq!(fact["agent"], w.agent);
        assert_eq!(fact["attempt"], startup[0]["attempt"]);
        assert_eq!(
            fact["value"]["clock_lifetime"],
            startup[0]["value"]["clock_lifetime"]
        );
        assert_eq!(
            fact["value"]["activity"]["status_revision"],
            if index == 0 {
                opening_idle[0]["value"]["activity"]["status_revision"].clone()
            } else {
                transitions[1]["status_revision"].clone()
            }
        );
    }
    let endpoint =
        std::fs::read_to_string(w.project.join(format!("endpoint-{}", w.agent))).unwrap();
    let mut late = intervals(&w.source_id());
    let segment = &idle[0]["value"]["segments"][0];
    let start = i128::from(segment["start"]["unix_ms"].as_i64().unwrap()) * 1_000_000;
    let end = i128::from(segment["end"]["unix_ms"].as_i64().unwrap()) * 1_000_000;
    assert!(end > start, "the real idle interval has positive duration");
    for span in late["resourceSpans"][0]["scopeSpans"][0]["spans"]
        .as_array_mut()
        .unwrap()
    {
        span["startTimeUnixNano"] = start.to_string().into();
        span["endTimeUnixNano"] = end.to_string().into();
    }
    assert_eq!(post(&endpoint, late).await, 200);
    let with_execution = w.contributions(2).await;
    assert_eq!(
        with_execution["time_evidence"], before["time_evidence"],
        "late model/tool evidence overlaps idle without discarding either source or inventing a partition"
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
    assert_eq!(public["time_evidence"], before["time_evidence"]);
    w.reopen().await;
    assert_eq!(w.read().await["time_evidence"], before["time_evidence"]);
    println!(
        "other-time observer: {}",
        json!({"project":before["project"],"status_events":transitions,"acquisition_delay_ms":delays,"time_evidence":before["time_evidence"],"clock_meanings":"unix_ms aligns local observations; monotonic_ns durations compare only within clock_lifetime and each segment; gaps remain uncovered"})
    );
}

#[tokio::test]
async fn u3016b_cost_basis_and_missing_coverage_are_explicit() {
    let w = World::start().await;
    let mut row = request("mixed-cost", 20);
    row["message"]["model"] = json!("claude-opus-5-5");
    row["message"]["usage"]["cache_creation"] =
        json!({"ephemeral_5m_input_tokens":30,"ephemeral_1h_input_tokens":20});
    w.append(row);
    let snapshot = w.contributions(1).await;
    let cost = &snapshot["contributions"][0]["value"]["cost"];
    assert_eq!(cost["model"], "claude-opus-5-5");
    assert_eq!(cost["cache_write"], json!({"five_minute":30,"one_hour":20}));
    assert_eq!(cost["reference"]["currency"], "USD");
    assert_eq!(cost["reference"]["input"], "4");
    assert_eq!(cost["reference"]["output"], "20");
    assert_eq!(cost["reference"]["cache_read"], "0.20");
    assert_eq!(cost["reference"]["cache_write_five_minute"], "5");
    assert_eq!(cost["reference"]["cache_write_one_hour"], "8");
    assert_eq!(cost["reference"]["per_tokens"], 1_000_000);
    assert_eq!(cost["reference"]["date"], "2026-10-21");
    assert!(cost["reported"].is_null());
    assert!(
        cost["unavailable"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("money"))
    );
}

#[tokio::test]
async fn u3016b_reported_money_is_inclusive_exact_and_separate() {
    let w = World::start().await;
    w.append(request("constituent", 20));
    // Decimal spelling must survive the source parser, journal and public CLI unchanged.
    let line = format!(
        r#"{{"type":"cost-state","sessionId":"{}","totalCostUSD":0.001190000000000000001,"hasUnknownModelCost":false}}"#,
        w.source_id()
    );
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(w.source())
        .unwrap();
    writeln!(file, "{line}\n{line}").unwrap();
    let child = w
        .source()
        .with_extension("")
        .join("subagents/summary.jsonl");
    std::fs::create_dir_all(child.parent().unwrap()).unwrap();
    std::fs::write(child, format!("{}\n",json!({"type":"cost-state","sessionId":w.source_id(),"totalCostUSD":99,"hasUnknownModelCost":false}))).unwrap();
    let snapshot = w.contributions(2).await;
    let money = snapshot["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["value"]["kind"] == "money")
        .unwrap();
    assert_eq!(
        money["value"]["reported"]["amount"],
        "0.001190000000000000001"
    );
    assert_eq!(money["value"]["reported"]["currency"], "USD");
    assert_eq!(money["value"]["reported"]["scope"], "conversation");
    assert!(
        money["value"]["reported"]["source"]
            .as_str()
            .unwrap()
            .contains("totalCostUSD")
    );
    assert!(money["value"].get("usage").is_none());
    let cli =
        tokio::process::Command::new(Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"))
            .args(["--json", "project", "measurements", "--agent", &w.agent])
            .env("RUPD_SOCKET", &w.daemon.socket)
            .output()
            .await
            .unwrap();
    assert!(cli.status.success());
    let public: Value = serde_json::from_slice(&cli.stdout).unwrap();
    assert_eq!(public["contributions"], snapshot["contributions"]);
}

#[tokio::test]
async fn u3016b_cost_metadata_revisions_notify_without_moving_history() {
    let mut w = World::start().await;
    w.spawn_agent().await;
    let mut row = request("metadata", 20);
    row["message"]["model"] = json!("unknown-model");
    let original = row.clone();
    w.append(row.clone());
    let first = w.contributions(1).await;
    let mut subscribed = Client::connect(&w.daemon.socket).await.unwrap();
    subscribed
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let other = w
        .client
        .request("rail.createWorkstream", json!({"name":"later"}))
        .await
        .unwrap()["id"]
        .clone();
    w.client
        .request("rail.move", json!({"id":w.agent,"parent":other,"index":0}))
        .await
        .unwrap();
    row["message"]["model"] = json!("claude-opus-5-5");
    w.append(row.clone());
    let corrected = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["contributions"][0]["value"]["cost"]["model"] == "claude-opus-5-5" {
                break read;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let before = &first["contributions"][0];
    let after = &corrected["contributions"][0];
    assert_ne!(after["source_revision"], before["source_revision"]);
    assert_eq!(after["value"]["usage"], before["value"]["usage"]);
    for field in ["agent", "home", "maker", "attempt", "identity", "source"] {
        assert_eq!(after[field], before[field]);
    }
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let event = subscribed.next_event().await.unwrap();
            if let contracts::EventData::MeasurementsChanged { revision } = event.data
                && revision.parse::<u64>().unwrap()
                    >= corrected["revision"]
                        .as_str()
                        .unwrap()
                        .parse::<u64>()
                        .unwrap()
            {
                break;
            }
        }
    })
    .await
    .expect("metadata-only correction emits the existing measurement-change Event");
    row["message"]["usage"]["cache_creation"] =
        json!({"ephemeral_5m_input_tokens":30,"ephemeral_1h_input_tokens":20});
    w.append(row.clone());
    let model_corrected = corrected;
    let corrected = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let read = w.read().await;
            if read["contributions"][0]["value"]["cost"]["cache_write"]["one_hour"] == 20 {
                break read;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let after = &corrected["contributions"][0];
    assert_ne!(
        after["source_revision"],
        model_corrected["contributions"][0]["source_revision"]
    );
    assert_eq!(after["value"]["usage"], before["value"]["usage"]);
    w.reopen().await;
    assert_eq!(
        w.contributions(1).await["contributions"],
        corrected["contributions"]
    );
    // Force source replay, including the superseded version; retained revisions cannot regress.
    std::fs::remove_file(w.source()).unwrap();
    w.append(original);
    w.append(row);
    w.append(request("replay-boundary", 0));
    let replayed = w.contributions(2).await;
    let retained = replayed["contributions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["identity"] == "request:metadata")
        .unwrap();
    assert_eq!(retained, after);
}

#[tokio::test]
async fn u3016b_unknown_evidence_preserves_partial_coverage_and_zero() {
    let w = World::start().await;
    // Supported zero, unknown Model/rate, missing/inconsistent classes, and unknown money
    // currencies are distinct source facts; none authorizes guessing a bill or conversion.
    for (id, model, classes, usage) in [
        (
            "zero",
            Some("claude-opus-5-5"),
            json!({"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}),
            json!({"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}),
        ),
        (
            "unknown",
            Some("claude-opus-5-5-future"),
            Value::Null,
            json!({"input_tokens":100,"cache_creation_input_tokens":50}),
        ),
        (
            "missing",
            None,
            Value::Null,
            json!({"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":400,"cache_creation_input_tokens":50}),
        ),
        (
            "inconsistent",
            Some("claude-opus-5-5"),
            json!({"ephemeral_5m_input_tokens":30,"ephemeral_1h_input_tokens":30}),
            json!({"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":400,"cache_creation_input_tokens":50}),
        ),
    ] {
        let mut row = request(id, 0);
        row["message"]["model"] = json!(model);
        row["message"]["usage"] = usage;
        row["message"]["usage"]["cache_creation"] = classes;
        w.append(row);
    }
    for currency in ["EUR", "JPY", ""] {
        w.append(json!({"type":"cost-state","sessionId":w.source_id(),"amount":12.345,"currency":currency}));
    }
    w.append(json!({"type":"cost-state","sessionId":w.source_id(),"totalCostUSD":0,"hasUnknownModelCost":false}));
    let read = w.contributions(5).await;
    for c in read["contributions"].as_array().unwrap() {
        match c["identity"].as_str().unwrap() {
            "request:zero" => {
                assert_eq!(
                    c["value"]["usage"],
                    json!({"input":0,"output":0,"cache_read":0,"cache_write":0})
                );
                assert_eq!(
                    c["value"]["cost"]["cache_write"],
                    json!({"five_minute":0,"one_hour":0})
                );
                assert!(c["value"]["cost"]["reference"].is_object());
            }
            "request:unknown" | "request:missing" => {
                assert!(c["value"]["cost"]["reference"].is_null());
                assert_eq!(c["value"]["usage"]["input"], 100);
                assert!(c["value"]["cost"]["cache_write"]["five_minute"].is_null());
                if c["identity"] == "request:unknown" {
                    assert!(c["value"]["usage"]["output"].is_null());
                }
            }
            "request:inconsistent" => {
                assert_eq!(c["value"]["usage"]["cache_write"], 50);
                assert_eq!(
                    c["value"]["cost"]["cache_write"],
                    json!({"five_minute":null,"one_hour":null})
                );
                assert!(
                    c["value"]["cost"]["unavailable"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|v| v.as_str().unwrap().contains("disagree"))
                );
            }
            _ => {
                assert_eq!(c["value"]["reported"]["amount"], "0");
                assert_eq!(c["value"]["reported"]["currency"], "USD");
            }
        }
    }
    assert!(read["sources"].as_array().unwrap().iter().any(|s| {
        s["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v.as_str().unwrap().contains("currency"))
    }));
}
