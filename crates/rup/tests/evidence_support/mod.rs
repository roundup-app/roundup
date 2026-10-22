//! Shared fixture for the retained-evidence and resume tests: a real Daemon, a real vendor child
//! that reports through the public CLI, and a loopback receipt source.
#[path = "../e2e/daemon.rs"]
#[allow(dead_code)]
pub mod daemon;
#[allow(unused_imports)]
use serde_json::{Value, json};

// The real vendor child uses the public CLI to report; wire calls set up its publications and
// inspect refusal payloads. The delivered note is the bounded completion observer for this script.
pub const REPORTER: &str = include_str!("reporter.py");

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
