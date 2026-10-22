//! Shared fixture for the retained-evidence and resume tests: a real Daemon, a real vendor child
//! that reports through the public CLI, and a loopback receipt source.
#[path = "../e2e/daemon.rs"]
#[allow(dead_code)]
pub mod daemon;
#[allow(unused_imports)]
use serde_json::{Value, json};

// The real vendor child uses the public CLI to report; wire calls set up its publications and
// inspect refusal payloads. The delivered note is the bounded completion observer for this script.
pub const REPORTER: &str = r#"
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
if sys.argv[3] in ('complete','document'):p['next']=''
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
if sys.argv[3]=='document':
 for t,nx in [('outline',''),('document',''),('diagram','Prepare the diagram'),('export','')]:
  b=(t+' r1').encode();open(os.path.join(project,'output.txt'),'wb').write(b)
  o=call('deliverable.publish',{'key':t,'title':t,'target':{'kind':'file','path':'output.txt'}})
  call('message.report',{**p,'key':t,'target':{'id':t,'revision':'r1'},'output':{'project':o['project'],'id':o['id']},'next':nx,'check':{'kind':'publication','sha256':hashlib.sha256(b).hexdigest()}})
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

pub struct Evidence {
    pub project: daemon::Project,
    pub client: rpc::Client,
    pub report: Value,
    pub request: Value,
    pub bad: Value,
    pub effects: Value,
    pub logs: tempfile::TempDir,
    pub home: Value,
}

impl Evidence {
    pub async fn start() -> Self {
        Self::with("").await
    }

    pub async fn with(mode: &str) -> Self {
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

    pub fn query(&self) -> Value {
        json!({"project":self.project.dir.path(),"id":self.report["request"]["id"]})
    }
    pub fn result_id(&self) -> Value {
        let mut q = self.query();
        q["report"] = self.report["report"].clone();
        q
    }
    pub async fn progress(&self) -> Value {
        self.client
            .request("message.progress", self.query())
            .await
            .unwrap()
    }
    pub async fn accept(&self) -> Value {
        let mut q = self.result_id();
        q["evidence"] = json!("User checked V1; keep repair pending");
        self.client
            .request("message.acceptResult", q)
            .await
            .unwrap()
    }
}

pub struct Source {
    pub url: String,
    pub listener: tokio::task::JoinHandle<()>,
}
impl Drop for Source {
    fn drop(&mut self) {
        self.listener.abort();
    }
}
impl Source {
    pub async fn new(body: Value, status: u16) -> Self {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/receipt", listener.local_addr().unwrap());
        let listener = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 4096];
                let size = stream.read(&mut request).await.unwrap();
                assert!(String::from_utf8_lossy(&request[..size]).starts_with("GET /receipt "));
                let body = body.to_string();
                stream.write_all(format!("HTTP/1.1 {status} Receipt\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            }
        });
        Self { url, listener }
    }
}

pub fn receipt(report: &Value, outcome: Value) -> Value {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    json!({"target":report["request"]["target"],"revision":"receipt-37","observed_at":now,"outcome":outcome})
}

impl Evidence {
    pub async fn reconcile(&self) -> Value {
        self.client
            .request("message.reconcileWork", self.query())
            .await
            .unwrap()
    }
    pub async fn resume(&self, request: &str) -> Result<Value, rpc::RpcError> {
        let mut q = self.query();
        q["request"] = json!(request);
        self.client.request("message.resumeWork", q).await
    }
    pub async fn messages(&self) -> Vec<Value> {
        self.client
            .request("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }
    pub fn log(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.logs.path().join(name)).unwrap_or_default()
    }
    pub fn fake_env(&self) -> Vec<(&'static str, String)> {
        ["launches", "prompts"]
            .map(|n| {
                (
                    if n == "launches" {
                        "FAKE_CLAUDE_LAUNCH_LOG"
                    } else {
                        "FAKE_CLAUDE_PROMPT_LOG"
                    },
                    self.logs.path().join(n).to_str().unwrap().to_string(),
                )
            })
            .into()
    }
    pub fn reopen(&mut self) {
        let env = self.fake_env();
        let env: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();
        self.project.restart(&env);
    }
}

pub fn successor<'a>(messages: &'a [Value], decision: &Value) -> &'a Value {
    messages
        .iter()
        .find(|m| m["id"] == decision["decision"]["message"])
        .expect("the decision's Message exists")
}
