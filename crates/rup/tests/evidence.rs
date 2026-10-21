//! Retained execution evidence through the real Daemon and public callers.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use serde_json::{Value, json};

// The real vendor child uses the public CLI to report; wire calls set up its publications and
// inspect refusal payloads. The delivered note is the bounded completion observer for this script.
const REPORTER: &str = r#"
import hashlib,json,os,socket,subprocess,sys,time
id=os.environ['ROUNDUP_AGENT']
s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('rb')
n=0
def wire(method,p):
 global n
 n+=1;s.sendall((json.dumps({'jsonrpc':'2.0','id':n,'method':method,'params':p})+'\n').encode())
 while True:
  r=json.loads(f.readline())
  if r.get('id')==n:return r
def call(method,p):
 r=wire(method,p);assert 'result' in r,r;return r['result']
call('daemon.identify',{'actor':{'kind':'agent','id':id,'parent':None}})
end=time.monotonic()+10
while True:
 ins=call('agent.instructions',{'id':id})
 ds=[d for d in ins['deliveries'] if d['state']=='submitted']
 if ds:break
 assert time.monotonic()<end,'no submitted instruction'
 time.sleep(.01)
project=ins['project'];delivery=ds[-1]['id'];text=b'login output V1'
open(os.path.join(project,'output.txt'),'wb').write(text)
pub=call('deliverable.publish',{'key':'login-v1','title':'Login output','target':{'kind':'file','path':'output.txt'}})
p={'project':project,'id':id,'key':'login-v1','delivery':delivery,'target':{'id':'login','revision':'v1'},'output':{'project':pub['project'],'id':pub['id']},'result':'Implementation retained; repair pending','next':'Repair login; then run final checks','state':'reported','check':{'kind':'publication','sha256':hashlib.sha256(text).hexdigest()}}
if sys.argv[3]=='late-report':call('agent.setOrder',{'id':id,'order':{'kind':'work','ask':'Fix another path','done':'Other path passes','limits':[]}})
if sys.argv[3]=='wrong-digest':p['check']['sha256']='0'*64
cmd=[sys.argv[1],'message','report',project,id,p['key'],delivery,p['result'],p['next'],'--target',json.dumps(p['target']),'--output',json.dumps(p['output']),'--state',json.dumps(p['state']),'--check',json.dumps(p['check']),'--json']
a=subprocess.run(cmd,capture_output=True,text=True);assert a.returncode==0,(cmd,a.stdout,a.stderr)
report=json.loads(a.stdout);replay=call('message.report',p);assert report==replay
bad=[]
for field,value in [('result','conflicting retry'),('project','/wrong-project'),('id','1'),('delivery','999999')]:
 q={**p,field:value};bad.append(wire('message.report',q))
# Neither identifying as the user nor supplying authority fields can forge acceptance/verifier facts.
call('daemon.identify',{'actor':{'kind':'user','id':'you','parent':None}})
bad.append(wire('message.acceptResult',{'project':project,'id':id,'report':report['report'],'evidence':'forged user'}))
bad.append(wire('message.verifyResult',{'project':project,'id':id,'report':report['report'],'verdict':'passed'}))
call('daemon.identify',{'actor':{'kind':'agent','id':id,'parent':None}})
bad.append(wire('message.progress',{'project':project,'id':'1'}))
# Three uncertain external effects use unsupported sources and cannot be resolved by a report.
effects=[]
for effect in ['deployment','payment','push']:
 with open(sys.argv[2]+'.effects','a') as calls:calls.write(effect+'\n')
 q={**p,'key':effect,'target':{'id':effect,'revision':'v1'},'state':'unknown-effect','check':{'kind':'unsupported','source':effect}}
 effects.append(call('message.report',q))
 if sys.argv[3]=='effect-claim':
  call('message.report',{**q,'key':effect+'-claim','state':'reported','check':p['check']})
bad.append(wire('message.resolveResult',{'project':project,'id':id,'report':effects[0]['report'],'source':'http://127.0.0.1:9/receipt'}))
a=subprocess.run([sys.argv[1],'message','resolve-result',project,id,effects[0]['report'],'http://127.0.0.1:9/receipt','--json'],capture_output=True,text=True)
assert a.returncode==1 and 'only the user' in a.stderr,(a.returncode,a.stdout,a.stderr)
if sys.argv[3]=='replace':
 q={**p,'key':'unchanged','target':{'id':'unchanged','revision':'v1'}}
 call('message.report',q)
 for key,revision,contents in [('replacement','v2',b'login output V2'),('equal-bytes','v1',text)]:
  open(os.path.join(project,'output.txt'),'wb').write(contents)
  output=call('deliverable.publish',{'key':key,'title':'Login output','target':{'kind':'file','path':'output.txt'}})
  q={**p,'key':key,'target':{'id':'login','revision':revision},'output':{'project':output['project'],'id':output['id']},'check':{'kind':'publication','sha256':hashlib.sha256(contents).hexdigest()}}
  call('message.report',q)
open(sys.argv[2],'w').write(json.dumps({'report':report,'request':p,'bad':bad,'effects':effects}))
call('message.send',{'to':'you','kind':'note','body':'evidence-ready'})
"#;

struct Evidence {
    project: daemon::Project,
    client: rpc::Client,
    report: Value,
    request: Value,
    bad: Value,
    effects: Value,
    logs: tempfile::TempDir,
    home: Value,
}

impl Evidence {
    async fn start() -> Self {
        Self::with("").await
    }

    async fn with(mode: &str) -> Self {
        let logs = tempfile::tempdir().unwrap();
        let child = json!([
            "python3",
            "-c",
            REPORTER,
            env!("CARGO_BIN_EXE_rup"),
            logs.path().join("report"),
            mode
        ])
        .to_string();
        let launches = logs.path().join("launches");
        let prompts = logs.path().join("prompts");
        let project = daemon::start(&[
            ("FAKE_CLAUDE_CHILD_PROCESS", &child),
            ("FAKE_CLAUDE_LAUNCH_LOG", launches.to_str().unwrap()),
            ("FAKE_CLAUDE_PROMPT_LOG", prompts.to_str().unwrap()),
        ]);
        let mut client = project.subscribed().await;
        let home = client
            .request("rail.createWorkstream", json!({"name":"Original"}))
            .await
            .unwrap()["id"]
            .clone();
        let node = client.request("agent.spawn",json!({"cwd":project.dir.path(),"parent":home,"name":"Login","order":{"kind":"work","ask":"Fix login","done":"Login passes","limits":["No deployment"]}})).await.unwrap();
        daemon::next(&mut client, |event| match event {
            contracts::EventData::MessageDelivered(m) if m.body == "evidence-ready" => Some(()),
            _ => None,
        })
        .await;
        let data: Value =
            serde_json::from_slice(&std::fs::read(logs.path().join("report")).unwrap()).unwrap();
        assert_eq!(data["report"]["attempt"], node["attempt"]);
        Self {
            project,
            client,
            report: data["report"].clone(),
            request: data["request"].clone(),
            bad: data["bad"].clone(),
            effects: data["effects"].clone(),
            logs,
            home,
        }
    }

    fn query(&self) -> Value {
        json!({"project":self.project.dir.path(),"id":self.report["request"]["id"]})
    }
    fn result_id(&self) -> Value {
        let mut q = self.query();
        q["report"] = self.report["report"].clone();
        q
    }
    async fn progress(&self) -> Value {
        self.client
            .request("message.progress", self.query())
            .await
            .unwrap()
    }
    async fn accept(&self) -> Value {
        let mut q = self.result_id();
        q["evidence"] = json!("User checked V1; keep repair pending");
        self.client
            .request("message.acceptResult", q)
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn u3078b_delivery_report_acceptance_and_verification_are_distinct() {
    let e = Evidence::start().await;
    let reported = e.progress().await;
    let r = &reported["results"][0];
    assert_eq!(r["report"], e.report);
    assert_eq!(r["report"]["instruction"]["order"]["done"], "Login passes");
    assert_eq!(r["report"]["instruction"]["workstream"], e.home);
    assert_eq!(r["acceptances"], json!([]));
    assert_eq!(r["observations"], json!([]));
    let accepted = e.accept().await;
    let progress = e.progress().await;
    assert_eq!(progress["results"][0]["acceptances"], json!([accepted]));
    assert_eq!(progress["results"][0]["observations"], json!([]));
    let verified = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    assert_eq!(verified["verdict"], "passed");
    assert_eq!(
        verified["revision"],
        "622e44dcf9a79b1243b22f75897645840444764efd9793a71e243458313d9ad4"
    );
    // Repeat verification is the same source fact; it neither accepts nor reports again.
    assert_eq!(
        e.client
            .request("message.verifyResult", e.result_id())
            .await
            .unwrap(),
        verified
    );
    let progress = e.progress().await;
    assert_eq!(progress["results"][0]["observations"], json!([verified]));
    assert_eq!(progress["results"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn u3078b_public_reports_cannot_forge_authority() {
    let e = Evidence::start().await;
    for refusal in e.bad.as_array().unwrap() {
        assert!(refusal["error"]["code"].is_number(), "{refusal}");
    }
    let before = e.progress().await;
    // An unowned process cannot become the reporting Agent by setting --agent or daemon.identify.
    e.client
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":e.report["author"]["id"],"parent":null}}),
        )
        .await
        .unwrap();
    assert_eq!(
        e.client
            .request("message.report", e.request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    e.client
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"user","id":"you","parent":null}}),
        )
        .await
        .unwrap();
    assert_eq!(e.progress().await, before);
    assert_eq!(before["results"][0]["acceptances"], json!([]));
    assert_eq!(before["results"][0]["observations"], json!([]));
}

#[tokio::test]
async fn u3078a_reopen_retains_exact_progress_without_starting() {
    let mut e = Evidence::start().await;
    e.accept().await;
    e.client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    let moved = e
        .client
        .request("rail.createWorkstream", json!({"name":"Moved"}))
        .await
        .unwrap()["id"]
        .clone();
    e.client
        .request(
            "rail.move",
            json!({"id":e.report["author"]["id"],"parent":moved,"index":0}),
        )
        .await
        .unwrap();
    e.client
        .request("agent.stop", json!({"id":e.report["author"]["id"]}))
        .await
        .unwrap();
    let before = e.progress().await;
    assert_eq!(before["instructions"]["home"], moved);
    assert_eq!(
        before["results"][0]["report"]["instruction"]["workstream"],
        e.home
    );
    let launches = std::fs::read(e.logs.path().join("launches")).unwrap();
    let prompts = std::fs::read(e.logs.path().join("prompts")).unwrap();
    let messages = e.client.request("message.list", json!({})).await.unwrap();
    e.project.restart(&[
        (
            "FAKE_CLAUDE_LAUNCH_LOG",
            e.logs.path().join("launches").to_str().unwrap(),
        ),
        (
            "FAKE_CLAUDE_PROMPT_LOG",
            e.logs.path().join("prompts").to_str().unwrap(),
        ),
    ]);
    e.client = e.project.client().await;
    assert_eq!(e.progress().await, before);
    assert_eq!(
        e.client.request("message.list", json!({})).await.unwrap(),
        messages
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("launches")).unwrap(),
        launches
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("prompts")).unwrap(),
        prompts
    );
    assert_eq!(
        e.client
            .request("terminal.list", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u3078c_changed_revisions_and_unavailable_evidence_do_not_inherit_completion() {
    let e = Evidence::start().await;
    let accepted = e.accept().await;
    assert_eq!(e.progress().await["results"][0]["current"], true);
    let original = e.report["instruction"]["order"].clone();
    for (field, value) in [
        ("ask", json!("Fix another path")),
        ("done", json!("New checks pass")),
        ("limits", json!(["New limits"])),
    ] {
        let mut changed = original.clone();
        changed[field] = value;
        e.client
            .request(
                "agent.setOrder",
                json!({"id":e.report["author"]["id"],"order":changed}),
            )
            .await
            .unwrap();
        let progress = e.progress().await;
        assert_eq!(progress["results"][0]["current"], false);
        assert_eq!(progress["results"][0]["acceptances"], json!([accepted]));
    }
    e.client
        .request(
            "agent.setOrder",
            json!({"id":e.report["author"]["id"],"order":original}),
        )
        .await
        .unwrap();
    assert_eq!(e.progress().await["results"][0]["current"], false);
    // A mutable current file cannot replace a published output; removal stays effective.
    std::fs::write(e.project.dir.path().join("output.txt"), "replacement bytes").unwrap();
    let progress = e.progress().await;
    let path = progress["results"][0]["availability"]["path"]
        .as_str()
        .unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"login output V1");
    e.client
        .request("deliverable.remove", e.report["request"]["output"].clone())
        .await
        .unwrap();
    let progress = e.progress().await;
    assert_eq!(
        progress["results"][0]["availability"]["kind"],
        "unavailable"
    );
    assert_eq!(progress["results"][0]["acceptances"], json!([accepted]));
    let unknown = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    assert_eq!(unknown["verdict"], "unknown");
    assert!(!unknown["cause"].as_str().unwrap().is_empty());
    assert!(!unknown["action"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn u3078c_message_replacements_keep_acceptance_historical() {
    let mut e = Evidence::start().await;
    let accepted = e.accept().await;
    let verified = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    let before = e.progress().await;
    assert_eq!(before["results"][0]["current"], true);

    // Another Agent's accepted result has independent instruction history.
    let other = e
        .client
        .request(
            "agent.spawn",
            json!({
                "cwd": e.project.dir.path(), "parent": e.home, "name": "Unrelated",
                "order": e.report["instruction"]["order"]
            }),
        )
        .await
        .unwrap();
    daemon::next(&mut e.client, |event| match event {
        contracts::EventData::MessageDelivered(m) if m.body == "evidence-ready" => Some(()),
        _ => None,
    })
    .await;
    let data: Value =
        serde_json::from_slice(&std::fs::read(e.logs.path().join("report")).unwrap()).unwrap();
    let other_query = json!({"project": e.project.dir.path(), "id": other["id"]});
    e.client
        .request(
            "message.acceptResult",
            json!({
                "project": e.project.dir.path(), "id": other["id"],
                "report": data["report"]["report"], "evidence": "Unrelated V1 accepted"
            }),
        )
        .await
        .unwrap();
    let unrelated = e
        .client
        .request("message.progress", other_query.clone())
        .await
        .unwrap();

    let original = before["instructions"]["deliveries"][0]["text"]
        .as_str()
        .unwrap();
    for body in [
        "Replace the implementation; done when the new checks pass",
        original,
    ] {
        let message = e
            .client
            .request(
                "message.send",
                json!({
                    "to": e.report["author"]["id"], "kind": "note", "body": body
                }),
            )
            .await
            .unwrap();
        daemon::next(&mut e.client, |event| match event {
            contracts::EventData::MessageDelivered(m) if json!(m.id) == message["id"] => Some(()),
            _ => None,
        })
        .await;
        let progress = e.progress().await;
        assert_eq!(
            progress["instructions"]["current"],
            before["instructions"]["current"]
        );
        assert_eq!(
            progress["instructions"]["revisions"]
                .as_array()
                .unwrap()
                .last()
                .unwrap()["message"],
            message["id"]
        );
        let result = &progress["results"][0];
        assert_eq!(result["current"], false);
        assert_eq!(result["report"], e.report);
        assert_eq!(result["acceptances"], json!([accepted]));
        assert_eq!(result["observations"], json!([verified]));
        assert_eq!(
            e.client
                .request("message.progress", other_query.clone())
                .await
                .unwrap(),
            unrelated
        );
    }
}

#[tokio::test]
async fn u3078h_unknown_external_effects_require_authoritative_resolution() {
    let e = Evidence::start().await;
    let calls = std::fs::read(e.logs.path().join("report.effects")).unwrap();
    assert_eq!(calls, b"deployment\npayment\npush\n");
    let prompts = std::fs::read(e.logs.path().join("prompts")).unwrap();
    let messages = e.client.request("message.list", json!({})).await.unwrap();
    for report in e.effects.as_array().unwrap() {
        let mut q = e.query();
        q["report"] = report["report"].clone();
        let unknown = e
            .client
            .request("message.verifyResult", q.clone())
            .await
            .unwrap();
        assert_eq!(unknown["verdict"], "unknown");
        assert!(unknown["cause"].as_str().unwrap().contains("unsupported"));
        assert!(!unknown["action"].as_str().unwrap().is_empty());
        assert_eq!(
            e.client.request("message.verifyResult", q).await.unwrap(),
            unknown
        );
    }
    assert_eq!(
        std::fs::read(e.logs.path().join("report.effects")).unwrap(),
        calls
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("prompts")).unwrap(),
        prompts
    );
    assert_eq!(
        e.client.request("message.list", json!({})).await.unwrap(),
        messages
    );
    let progress = e.progress().await;
    for r in &progress["results"].as_array().unwrap()[1..] {
        assert_eq!(r["report"]["request"]["state"], "unknown-effect");
        assert_eq!(r["observations"].as_array().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn u3078c_target_and_output_replacements_preserve_only_exact_version_acceptance() {
    let e = Evidence::with("replace").await;
    let accepted = e.accept().await;
    let mut q = e.result_id();
    q["report"] = e.progress().await["results"][4]["report"]["report"].clone();
    q["evidence"] = json!("Unchanged result accepted");
    let unrelated = e.client.request("message.acceptResult", q).await.unwrap();
    let progress = e.progress().await;
    let results = progress["results"].as_array().unwrap();
    assert_eq!(results[0]["current"], false);
    assert_eq!(results[0]["acceptances"], json!([accepted]));
    assert_eq!(results[4]["current"], true);
    assert_eq!(results[4]["acceptances"], json!([unrelated]));
    assert_eq!(results[5]["current"], false);
    assert_eq!(results[6]["current"], true);
    assert_ne!(
        results[6]["report"]["publication"]["id"],
        e.report["publication"]["id"]
    );
    assert_eq!(
        results[6]["report"]["publication"]["target"]["sha256"],
        e.report["publication"]["target"]["sha256"]
    );
    assert_eq!(results[6]["acceptances"], json!([]));
    assert_eq!(results[6]["observations"], json!([]));
}

#[tokio::test]
async fn u3078b_wrong_version_source_cannot_verify_a_report() {
    let e = Evidence::with("wrong-digest").await;
    let observed = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    assert_eq!(observed["verdict"], "unknown");
    assert!(observed["cause"].as_str().unwrap().contains("digest"));
    assert!(!observed["action"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn u3078b_public_reports_cannot_claim_an_earlier_attempt() {
    let mut e = Evidence::start().await;
    let original = e.progress().await["results"].clone();
    let script = r#"
import json,os,socket,sys
p=json.load(open(sys.argv[1]))['request'];s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('rb')
def call(id,method,p):
 s.sendall((json.dumps({'jsonrpc':'2.0','id':id,'method':method,'params':p})+'\n').encode());return json.loads(f.readline())
call(1,'daemon.identify',{'actor':{'kind':'agent','id':os.environ['ROUNDUP_AGENT'],'parent':None}})
r=call(2,'message.report',p);open(sys.argv[2],'w').write(json.dumps(r))
call(3,'message.send',{'to':'you','kind':'note','body':'old-attempt-refused'})
"#;
    let child = json!([
        "python3",
        "-c",
        script,
        e.logs.path().join("report"),
        e.logs.path().join("old-attempt")
    ])
    .to_string();
    e.project.restart(&[
        ("FAKE_CLAUDE_CHILD_PROCESS", &child),
        (
            "FAKE_CLAUDE_LAUNCH_LOG",
            e.logs.path().join("launches").to_str().unwrap(),
        ),
    ]);
    e.client = e.project.subscribed().await;
    let resumed = e
        .client
        .request("agent.resume", json!({"id":e.report["author"]["id"]}))
        .await
        .unwrap();
    assert_ne!(resumed["attempt"], e.report["attempt"]);
    daemon::next(&mut e.client, |event| match event {
        contracts::EventData::MessageDelivered(m) if m.body == "old-attempt-refused" => Some(()),
        _ => None,
    })
    .await;
    let reply: Value =
        serde_json::from_slice(&std::fs::read(e.logs.path().join("old-attempt")).unwrap()).unwrap();
    assert_eq!(reply["error"]["code"], rpc::code::CONFLICT);
    assert_eq!(e.progress().await["results"], original);
}

#[tokio::test]
async fn u3078c_a_late_report_cannot_borrow_the_current_instruction_revision() {
    let e = Evidence::with("late-report").await;
    let progress = e.progress().await;
    assert_ne!(
        progress["instructions"]["current"],
        e.report["instruction"]["revision"]
    );
    assert_eq!(progress["results"][0]["current"], false);
    assert_eq!(
        e.report["order_revision"],
        e.report["instruction"]["revision"]
    );
}

#[tokio::test]
async fn u3078h_later_claims_cannot_supersede_unresolved_effects() {
    let e = Evidence::with("effect-claim").await;
    let progress = e.progress().await;
    for effect in e.effects.as_array().unwrap() {
        let rows = progress["results"].as_array().unwrap();
        let original = rows
            .iter()
            .find(|r| r["report"]["report"] == effect["report"])
            .unwrap();
        assert_eq!(original["current"], true);
        let claim = rows
            .iter()
            .find(|r| {
                r["report"]["request"]["key"]
                    == format!(
                        "{}-claim",
                        effect["request"]["target"]["id"].as_str().unwrap()
                    )
            })
            .unwrap();
        assert_eq!(claim["current"], false);
        let mut q = e.query();
        q["report"] = claim["report"]["report"].clone();
        q["evidence"] = json!("Looks complete");
        e.client
            .request("message.acceptResult", q.clone())
            .await
            .unwrap();
        q.as_object_mut().unwrap().remove("evidence");
        let observed = e.client.request("message.verifyResult", q).await.unwrap();
        assert_eq!(observed["verdict"], "unknown");
        assert!(
            observed["cause"]
                .as_str()
                .unwrap()
                .contains("external effect")
        );
    }
}

struct Source {
    url: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Source {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Source {
    async fn new(body: Value, status: u16) -> Self {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/receipt", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 4096];
                let size = stream.read(&mut request).await.unwrap();
                assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /receipt "));
                let body = body.to_string();
                stream.write_all(format!("HTTP/1.1 {status} Receipt\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            }
        });
        Self { url, task }
    }
}

fn receipt(report: &Value, outcome: Value) -> Value {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    json!({"target":report["request"]["target"],"revision":"receipt-37","observed_at":now,"outcome":outcome})
}

#[tokio::test]
async fn u3078h_exact_external_resolution_survives_reopen() {
    let mut e = Evidence::with("effect-claim").await;
    let calls = std::fs::read(e.logs.path().join("report.effects")).unwrap();
    let prompts = std::fs::read(e.logs.path().join("prompts")).unwrap();
    let messages = e.client.request("message.list", json!({})).await.unwrap();
    for (index, report) in e.effects.as_array().unwrap().iter().enumerate() {
        let outcome = if index == 1 {
            "not-performed"
        } else {
            "completed"
        };
        {
            let evidence = receipt(report, json!({"kind":outcome}));
            let source = Source::new(evidence.clone(), 200).await;
            let mut q = e.query();
            q["report"] = report["report"].clone();
            q["source"] = json!(source.url);
            let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
                .args([
                    "message",
                    "resolve-result",
                    q["project"].as_str().unwrap(),
                    q["id"].as_str().unwrap(),
                    q["report"].as_str().unwrap(),
                    &source.url,
                    "--json",
                ])
                .env("RUPD_SOCKET", e.project.socket())
                .env_remove("ROUNDUP_AGENT")
                .kill_on_drop(true)
                .output()
                .await
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let observed: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(observed["verdict"], "resolved");
            assert_eq!(observed["evidence"], evidence);
            assert_eq!(observed["source"], source.url);
            assert_eq!(observed["authorizer"]["kind"], "user");
            drop(source);
            q.as_object_mut().unwrap().remove("source");
            assert_eq!(
                e.client.request("message.verifyResult", q).await.unwrap(),
                observed
            );
            let progress = e.progress().await;
            assert_eq!(progress["results"][1 + index * 2]["current"], false);
            assert_eq!(progress["results"][2 + index * 2]["current"], true);
            assert_eq!(
                progress["results"][1 + index * 2]["observations"]
                    .as_array()
                    .unwrap()
                    .last()
                    .unwrap(),
                &observed
            );
        }
    }
    let before = e.progress().await;
    e.project.restart(&[]);
    e.client = e.project.client().await;
    let after = e.progress().await;
    assert_eq!(after["results"], before["results"]);
    assert_eq!(
        e.client.request("message.list", json!({})).await.unwrap(),
        messages
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("report.effects")).unwrap(),
        calls
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("prompts")).unwrap(),
        prompts
    );
}

#[tokio::test]
async fn u3078h_unusable_external_evidence_leaves_the_effect_unknown() {
    let e = Evidence::with("effect-claim").await;
    let report = &e.effects[0];
    let valid = receipt(report, json!({"kind":"completed"}));
    let mut gaps = vec![(json!({}), 200), (valid.clone(), 503)];
    for (field, value) in [
        ("target", json!({"id":"deployment","revision":"v2"})),
        ("target", json!({"id":"another-payment","revision":"v1"})),
        ("revision", json!("")),
        ("observed_at", json!(0)),
        (
            "outcome",
            json!({"kind":"inconclusive","cause":"provider still reconciling"}),
        ),
    ] {
        let mut gap = valid.clone();
        gap[field] = value;
        gaps.push((gap, 200));
    }
    for (body, status) in gaps {
        let source = Source::new(body, status).await;
        let mut q = e.query();
        q["report"] = report["report"].clone();
        q["source"] = json!(source.url);
        let observed = e.client.request("message.resolveResult", q).await.unwrap();
        assert_eq!(observed["verdict"], "unknown");
        assert!(!observed["cause"].as_str().unwrap().is_empty());
        assert!(!observed["action"].as_str().unwrap().is_empty());
        let progress = e.progress().await;
        assert_eq!(progress["results"][1]["current"], true);
        assert_eq!(progress["results"][2]["current"], false);
        assert_eq!(
            progress["results"][1]["observations"]
                .as_array()
                .unwrap()
                .last()
                .unwrap(),
            &observed
        );
    }
}
