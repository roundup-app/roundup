//! U468a: a child's `ask_user` question is answered once, in the App or by its Door.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;

use serde_json::{Value, json};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const BOUND: Duration = Duration::from_secs(30);

/// A `rup mcp` stdio session whose client advertises form elicitation.
struct Shim {
    _process: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

impl Shim {
    async fn start(project: &daemon::Project, id: &str) -> Self {
        let mut process = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(["mcp", id])
            .env("RUPD_SOCKET", project.socket())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let stdin = process.stdin.take().unwrap();
        let lines = BufReader::new(process.stdout.take().unwrap()).lines();
        let mut shim = Self {
            _process: process,
            stdin,
            lines,
        };
        shim.send(
            json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{
            "protocolVersion":"2025-06-18","capabilities":{"elicitation":{"form":{}}},
            "clientInfo":{"name":"t","version":"0"}}}),
        )
        .await;
        shim.next(BOUND)
            .await
            .expect("the shim answered initialize");
        shim.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .await;
        shim
    }

    async fn send(&mut self, message: Value) {
        self.stdin
            .write_all(format!("{message}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn call(&mut self, id: u64, name: &str, arguments: Value) {
        self.send(json!({"jsonrpc":"2.0","id":id,"method":"tools/call",
            "params":{"name":name,"arguments":arguments}}))
            .await;
    }

    /// The next message the shim writes, or `None` when it writes none within `wait`.
    async fn next(&mut self, wait: Duration) -> Option<Value> {
        let line = tokio::time::timeout(wait, self.lines.next_line())
            .await
            .ok()?
            .unwrap()
            .expect("the shim is open");
        Some(serde_json::from_str(&line).unwrap())
    }

    /// The text of the call's reply, which must have succeeded.
    async fn returned(&mut self) -> Value {
        let reply = self.next(BOUND).await.expect("the call returned");
        assert_ne!(reply["result"]["isError"], true, "{reply}");
        assert!(reply["error"].is_null(), "{reply}");
        serde_json::from_str(reply["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    }
}

async fn ask(shim: &mut Shim) {
    shim.call(
        1,
        "ask_user",
        json!({"question":"Cats or dogs?","answers":[
            {"label":"cats","description":"Purr"},{"label":"dogs","description":"Bark"}]}),
    )
    .await;
}

#[tokio::test]
async fn u468a_ask_user_sends_no_elicitation_request() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let child = project.spawn_agent(&client).await;
    let mut shim = Shim::start(&project, &child.id).await;
    ask(&mut shim).await;
    daemon::h21_decision(&client, &child.id, None).await;
    // Anything the shim writes while the call waits would be a request to the client.
    let written = shim.next(Duration::from_secs(2)).await;
    assert!(written.is_none(), "{written:?}");
}

#[tokio::test]
async fn u468a_an_app_answer_returns_from_ask_user() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let child = project.spawn_agent(&client).await;
    let mut shim = Shim::start(&project, &child.id).await;
    ask(&mut shim).await;
    let id = daemon::h21_decision(&client, &child.id, None).await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    daemon::h21_user_answers(&client, &id, "dogs")
        .await
        .unwrap();
    assert_eq!(shim.returned().await, json!({"answer":"dogs","note":""}));
    assert_eq!(
        client.request("decision.list", ()).await.unwrap(),
        json!([])
    );
}

/// A process below the Agent's own `claude`, which the Daemon trusts as that Agent: it tries
/// `decision.answer` on the first Decision and writes the reply to `argv[1]`.
const ANSWERER: &str = r#"
import json,os,socket,sys,time
s=socket.socket(socket.AF_UNIX);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('rb')
def call(i,m,p):
 s.sendall((json.dumps({'jsonrpc':'2.0','id':i,'method':m,'params':p})+'\n').encode());return json.loads(f.readline())
call(0,'daemon.identify',{'actor':{'kind':'agent','id':os.environ['ROUNDUP_AGENT'],'parent':None}})
for i in range(1,600):
 r=call(i,'decision.answer',{'id':'d1','answer':'dogs'})
 if r.get('error',{}).get('code')!=-32001:break
 time.sleep(0.05)
open(sys.argv[1],'w').write(json.dumps(r))
"#;

async fn reply_of(path: &std::path::Path) -> Value {
    tokio::time::timeout(BOUND, async {
        loop {
            if let Ok(text) = std::fs::read_to_string(path) {
                return serde_json::from_str(&text).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the answering process replied")
}

#[tokio::test]
async fn u468a_a_door_answer_still_resumes_ask_user() {
    let logs = tempfile::tempdir().unwrap();
    let reply = logs.path().join("reply");
    let process = json!(["python3", "-c", ANSWERER, reply]).to_string();
    let project = daemon::start(&[("FAKE_CLAUDE_DOOR_PROCESS", &process)]);
    let client = project.client().await;
    let door = doors::workstream(&client, "team").await;
    let child: contracts::agent::RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({"cwd":project.dir.path(),"parent":door}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let mut asking = Shim::start(&project, &child.id).await;
    ask(&mut asking).await;
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    assert!(reply_of(&reply).await["error"].is_null());
    assert_eq!(asking.returned().await, json!({"answer":"dogs","note":""}));
    let history = client
        .request("decision.answers", json!({"agent":child.id}))
        .await
        .unwrap();
    assert_eq!(history[0]["answered_by"]["id"], door);
}

#[tokio::test]
async fn u468a_ask_user_never_fails_while_its_card_is_open() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let child = project.spawn_agent(&client).await;
    let mut shim = Shim::start(&project, &child.id).await;
    ask(&mut shim).await;
    daemon::h21_decision(&client, &child.id, None).await;
    // An error reply would end the call while the Card stays open.
    assert!(shim.next(Duration::from_secs(2)).await.is_none());
    assert_eq!(
        client.request("decision.list", ()).await.unwrap()[0]["agent"],
        child.id
    );
}

#[tokio::test]
async fn u468_a_child_cannot_claim_user_to_answer_its_own_question() {
    let logs = tempfile::tempdir().unwrap();
    let reply = logs.path().join("reply");
    let process = json!(["python3", "-c", ANSWERER, reply]).to_string();
    let project = daemon::start(&[("FAKE_CLAUDE_CHILD_PROCESS", &process)]);
    let client = project.client().await;
    let child = project.spawn_agent(&client).await;
    let mut shim = Shim::start(&project, &child.id).await;
    ask(&mut shim).await;
    let refused = reply_of(&reply).await;
    assert_eq!(refused["error"]["code"], rpc::code::FORBIDDEN, "{refused}");
    assert_eq!(
        client.request("decision.list", ()).await.unwrap()[0]["agent"],
        child.id
    );
}
