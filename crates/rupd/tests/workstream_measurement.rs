//! U3016: production collection, read and reopen; every vendor file is isolated.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

const FAKE: &str = r#"#!/usr/bin/env python3
import json, os, socket, subprocess, sys, time, tty
if sys.argv[1:3] == ['plugin', 'list']: print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']: print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
settings = json.load(open(sys.argv[sys.argv.index('--settings')+1]))
conversation='00000000-0000-4000-8000-%012d' % int(os.environ['ROUNDUP_AGENT'])
open(os.path.join(os.getcwd(),'endpoint-'+os.environ['ROUNDUP_AGENT']),'w').write(os.environ.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',''))
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
# The public idle Status bounds the title observation before SessionStart.
if '--resume' not in sys.argv:
 with socket.socket(socket.AF_UNIX) as peer:
  peer.settimeout(5)
  peer.connect(os.environ['RUPD_SOCKET'])
  stream=peer.makefile('rwb')
  def request(method, params):
   stream.write((json.dumps({'jsonrpc':'2.0','id':0,'method':method,'params':params})+'\n').encode()); stream.flush()
   reply=json.loads(stream.readline())
   if 'error' in reply: raise RuntimeError(reply)
   return reply['result']
  request('daemon.identify', {'actor':{'kind':'agent','id':os.environ['ROUNDUP_AGENT']}})
  deadline=time.monotonic()+5
  while not any(node['id']==os.environ['ROUNDUP_AGENT'] and (node.get('status') or {}).get('kind')=='idle' for node in request('rail.tree', None)):
   if time.monotonic()>deadline: raise RuntimeError('ready title was not observed')
   time.sleep(.01)
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
                    let read = self
                        .client
                        .request("project.measurements", Value::Null)
                        .await
                        .unwrap();
                    if read["time_evidence"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|fact| {
                            fact["agent"] == agent
                                && fact["value"]["activity"]["kind"] == "startup"
                                && fact["value"]["state"]["kind"] == "ended"
                        })
                    {
                        break;
                    }
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

async fn endpoint(w: &World) -> String {
    let endpoint = w.project.join(format!("endpoint-{}", w.agent));
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(url) = std::fs::read_to_string(&endpoint)
                && url.starts_with("http://")
            {
                break url;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

async fn public_read(w: &World) -> Value {
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
    serde_json::from_slice(&cli.stdout).unwrap()
}

#[tokio::test]
async fn u3016a_sources_are_scoped_and_counted_once() {
    let w = World::start().await;
    let url = endpoint(&w).await;
    assert_eq!(post(&url, intervals(&w.source_id())).await, 200);
    let snapshot = w.contributions(2).await;
    assert!(
        snapshot["contributions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["agent"] == w.agent && c["home"] == w.home && c["attempt"] == "1")
    );
    let other = World::start().await;
    let other_url = endpoint(&other).await;
    assert_eq!(post(&other_url, intervals(&other.source_id())).await, 200);
    let isolated = other.contributions(2).await;
    assert_ne!(isolated["project"], snapshot["project"]);
    assert_eq!(
        public_read(&w).await["contributions"],
        snapshot["contributions"]
    );
    let claimant = w
        .client
        .request("agent.spawn", json!({"name":"claimant","cwd":w.project}))
        .await
        .unwrap();
    w.idle(claimant["id"].as_str().unwrap()).await;
    w.client.request("agent.signal",json!({"id":claimant["id"],"attempt":claimant["attempt"],"payload":{"hook_event_name":"SessionStart","session_id":w.source_id(),"source":"startup"}})).await.unwrap();
    assert_eq!(
        post(&url, intervals_of(&w.source_id(), "trace-ambiguous")).await,
        422
    );
    let read = w.read().await;
    assert!(
        read["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["cause"].as_str().is_some_and(|c| c.contains("ambiguous")))
    );
    assert_eq!(read["contributions"], snapshot["contributions"]);
}

#[tokio::test]
async fn u3016a_moves_and_removal_keep_recorded_attribution() {
    let mut w = World::start().await;
    w.spawn_agent().await;
    let url = endpoint(&w).await;
    assert_eq!(
        post(&url, intervals_of(&w.source_id(), "before")).await,
        200
    );
    let first = w.contributions(2).await;
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
    assert_eq!(post(&url, intervals_of(&w.source_id(), "after")).await, 200);
    let moved = w.contributions(4).await;
    let all = moved["contributions"].as_array().unwrap();
    let before: Vec<_> = all
        .iter()
        .filter(|c| c["identity"].as_str().unwrap().contains(":before:"))
        .collect();
    let after: Vec<_> = all
        .iter()
        .filter(|c| c["identity"].as_str().unwrap().contains(":after:"))
        .collect();
    assert_eq!(before.len(), 2);
    assert_eq!(after.len(), 2);
    for fact in &before {
        assert!(first["contributions"].as_array().unwrap().contains(fact));
    }
    for fact in &after {
        assert_eq!(fact["home"], other);
        assert_eq!(fact["maker"], "renamed");
    }
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
        w.contributions(4).await["contributions"],
        moved["contributions"]
    );
    w.client
        .request("rail.remove", json!({"id":w.home}))
        .await
        .unwrap();
    w.reopen().await;
    let read = w.contributions(2).await;
    assert!(
        read["contributions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["home"] == other)
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
    let url = endpoint(&w).await;
    assert_eq!(post(&url, intervals(&w.source_id())).await, 200);
    let first = w.contributions(2).await;
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
    w.reopen().await;
    let read = w.contributions(2).await;
    assert_eq!(read["contributions"], first["contributions"]);
}

#[tokio::test]
async fn u3016d_empty_collection_failures_notify_subscribers() {
    let w = World::start().await;
    let url = endpoint(&w).await;
    let good = w.read().await;
    let mut subscribed = Client::connect(&w.daemon.socket).await.unwrap();
    subscribed
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let mut invalid = intervals(&w.source_id());
    invalid["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["endTimeUnixNano"] = json!(7);
    assert_eq!(post(&url, invalid).await, 422);
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
                    break;
                }
            }
        }
    })
    .await
    .expect("failure is published even before any interval exists");
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
    intervals_of(source, "trace-source")
}

fn intervals_of(source: &str, trace: &str) -> Value {
    let span = |name: &str, id: &str| json!({"name":name,"traceId":trace,"spanId":id,"startTimeUnixNano":"1000000000","endTimeUnixNano":"2000000000","attributes":[{"key":"session.id","value":{"stringValue":source}}]});
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
async fn u3016l_vendor_usage_and_cost_fields_are_dropped_at_the_adapter() {
    let w = World::start().await;
    let url = endpoint(&w).await;
    let mut export = intervals(&w.source_id());
    let spans = export["resourceSpans"][0]["scopeSpans"][0]["spans"]
        .as_array_mut()
        .unwrap();
    for span in spans {
        for (key, value) in [
            ("input_tokens", "9"),
            ("output_tokens", "9"),
            ("cost_usd", "0.5"),
            ("request_id", "req-1"),
        ] {
            span["attributes"]
                .as_array_mut()
                .unwrap()
                .push(json!({"key":key,"value":{"stringValue":value}}));
        }
    }
    assert_eq!(post(&url, export).await, 200);
    let read = w.contributions(2).await;
    for fact in read["contributions"].as_array().unwrap() {
        let mut keys: Vec<_> = fact["value"].as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["category", "clock", "end_unix_ns", "kind", "start_unix_ns"]
        );
    }
    assert!(!read.to_string().contains("req-1"));
}

#[tokio::test]
async fn u3016d_rejected_exports_retain_failure_until_successful_retry() {
    let w = World::start().await;
    let url = std::fs::read_to_string(w.project.join(format!("endpoint-{}", w.agent))).unwrap();
    let valid = intervals(&w.source_id());
    assert_eq!(post(&url, valid.clone()).await, 200);
    let mut good = w.contributions(2).await;
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
