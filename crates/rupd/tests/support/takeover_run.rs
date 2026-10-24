//! B6 Takeover tests: a real Daemon, a fake Claude and its recorded Terminal input.
#![allow(dead_code)] // each includer uses its own part of the handle
use super::rupd_harness;

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::{Client, RpcError};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub const BOUND: Duration = Duration::from_secs(15);

pub struct Run {
    pub daemon: rupd_harness::Rupd,
    pub dir: tempfile::TempDir,
    pub data: tempfile::TempDir,
    pub user: Arc<Client>,
    pub child: String,
    pub door: Option<String>,
    pub terminal: Value,
    pub attempt: Value,
}

impl Run {
    pub async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, r#"#!/usr/bin/env python3
import json, os, socket, subprocess, sys, threading, time, tty
if sys.argv[1:2] == ['--version']:
    print('2.1.300 (Claude Code)'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'list']:
    print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
settings = json.load(open(sys.argv[sys.argv.index('--settings') + 1]))
def hook(event, fields):
    fields['hook_event_name'] = event
    for group in settings['hooks'][event]:
        for item in group['hooks']:
            subprocess.run(item['command'], shell=True, input=json.dumps(fields), text=True, check=True, stdout=subprocess.DEVNULL)
hook('SessionStart', {'session_id':'00000000-0000-4000-8000-000000000006','source':'resume' if '--resume' in sys.argv else 'startup'})
# B50: Claude Code listens on its messaging socket, lists its session with a token, records each
# message it takes up in its transcript and takes a turn on it.
def flag(name): return sys.argv[sys.argv.index(name) + 1]
agent = settings['hooks']['Stop'][0]['hooks'][0]['command'].split()[-1].strip("'")
sessions = os.path.join(os.environ.get('CLAUDE_CONFIG_DIR', os.getcwd() + '/config'), 'sessions')
transcript = os.path.join(os.getcwd(), 'transcript-' + agent + '.jsonl')
token = 'peer-token-' + str(os.getpid())
os.makedirs(sessions, exist_ok=True)
server = socket.socket(socket.AF_UNIX)
server.bind(flag('--messaging-socket-path'))
server.listen()
json.dump({'pid': os.getpid(), 'messagingSocketPath': flag('--messaging-socket-path'), 'peerProtocol': 1}, open(sessions + '/%d.json' % os.getpid(), 'w'))
json.dump({'peerToken': token}, open(sessions + '/%d.abc.key' % os.getpid(), 'w'))
# Claude Code drops a msg_id it took up on any connection, so the set outlives one.
seen = set()
def take(conn):
  try:
    lines = conn.makefile()
    if json.loads(lines.readline()).get('token') != token: return
    for line in lines:
        msg = json.loads(line)
        # A msg_id taken up before is dropped, as Claude Code drops it.
        if msg['msg_id'] in seen: continue
        # The fixture's Claude never records a Decision note: it stays sent, not delivered.
        if os.path.isfile('decision-notice-fixture') and '[decision ' in msg['message']['content']: continue
        seen.add(msg['msg_id'])
        with open('received-' + agent + '.jsonl', 'a') as out: out.write(line)
        with open(transcript, 'a') as out: out.write(json.dumps({'type': 'user', 'origin': {'kind': 'peer', 'from': msg['from'], 'msg_id': msg['msg_id']}}) + '\n')
        hook('PostToolUse', {'transcript_path': transcript})
        hook('Stop', {'transcript_path': transcript})
  except BaseException: pass
def watch():
  try:
    while True:
        conn, _ = server.accept()
        threading.Thread(target=take, args=(conn,), daemon=True).start()
  except BaseException: pass
threading.Thread(target=watch, daemon=True).start()
hook('Stop', {})
print('READY', flush=True)
pending = b''
while True:
    data = os.read(0, 1)
    if not data: break
    if data == b'\x03': os._exit(0)  # Claude Code's exit key
    if data == b'\x01':
        call = json.load(open('door-call.json'))
        conn = socket.socket(socket.AF_UNIX)
        conn.connect(os.environ['RUPD_SOCKET'])
        conn.sendall((json.dumps({'jsonrpc':'2.0','id':1, **call}) + '\n').encode())
        reply = json.loads(conn.makefile('r').readline())
        conn.close()
        with open('door-reply.tmp', 'w') as out: json.dump(reply, out)
        os.rename('door-reply.tmp', 'door-reply.json')
        continue
    if data == b'\x02':
        def call():
            with socket.socket(socket.AF_UNIX) as client:
                client.connect('rupd.sock')
                stream = client.makefile('rwb')
                request = json.load(open('peer-request'))
                if isinstance(request, list):
                    for frame in request: stream.write(json.dumps(frame).encode() + b'\n')
                    stream.flush()
                    replies = []
                    for frame in request:
                        reply = json.loads(stream.readline())
                        replies.append(reply)
                        if reply.get('id') == 111: open('peer-barrier', 'w').write('scheduled')
                    with open('peer-result', 'w') as result: json.dump(replies, result)
                else:
                    stream.write(json.dumps(request).encode() + b'\n')
                    stream.flush()
                    with open('peer-result', 'w') as result: result.write(stream.readline().decode())
        threading.Thread(target=call, daemon=True).start()
        continue
    print('BARRIER' if data == b'\x00' else 'BYTE:' + data.hex(), flush=True)
    if data != b'\x00': pending += data
    if data == b'\r' and (os.path.isfile('order-submit') or os.path.isfile('decision-notice-fixture')):
        text = pending.decode().replace('\x1b[200~','').replace('\x1b[201~','').removeprefix('Follow this instruction: ').strip()
        pending = b''
        if os.path.isfile('decision-notice-fixture') and '[decision ' in text:
            continue
        deadline = time.monotonic() + 10
        while 'occupying steer' in text and os.path.isfile('background-gate'):
            if time.monotonic() >= deadline: raise RuntimeError('background Steer was not released')
            time.sleep(0.005)
        hook('UserPromptSubmit', {'prompt':text})
        hook('Stop', {})
        print('SUBMITTED', flush=True)
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
            door: None,
            terminal: Value::Null,
            attempt: Value::Null,
        };
        run.spawn().await;
        run
    }

    pub async fn spawn(&mut self) {
        assert!(self.data.path().is_dir());
        let node = self
            .user
            .request(
                "agent.spawn",
                json!({"name":"child","cwd":self.dir.path(),"parent":self.door}),
            )
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

    pub async fn screen(&self) -> String {
        self.user
            .request("terminal.read", json!({"id":self.terminal,"after":0}))
            .await
            .unwrap()["text"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    pub async fn open(
        &self,
        kind: &str,
    ) -> (Value, tokio::task::JoinHandle<Result<Value, RpcError>>) {
        self.open_prompt(kind, "Same prompt?").await
    }

    pub async fn open_prompt(
        &self,
        kind: &str,
        prompt: &str,
    ) -> (Value, tokio::task::JoinHandle<Result<Value, RpcError>>) {
        let before = self.user.request("decision.list", ()).await.unwrap();
        let before = before.as_array().unwrap().first().map(|d| d["id"].clone());
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
        let prompt = prompt.to_owned();
        let task = tokio::spawn(async move {
            if kind == "ask_user" {
                caller.request("agent.ask", json!({"question":prompt,"answers":[{"label":"Yes","description":"Proceed"}]})).await
            } else {
                let mut payload = if kind == "unreadable" {
                    json!({})
                } else if kind == "native" {
                    json!({"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Same prompt?","options":[{"label":"Yes"}]}]}})
                } else {
                    json!({"tool_name":"Bash","tool_input":{"command":prompt}})
                };
                payload["hook_event_name"] = json!("PermissionRequest");
                caller
                    .request("agent.permission", json!({"id":child,"payload":payload}))
                    .await
            }
        });
        let decision = tokio::time::timeout(BOUND, async {
            loop {
                let listed = self.user.request("decision.list", ()).await.unwrap();
                if let Some(decision) = listed.as_array().unwrap().first()
                    && Some(&decision["id"]) != before.as_ref()
                {
                    return decision.clone();
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        (decision, task)
    }

    pub async fn capture(&self, decision: &Value) -> Value {
        self.user
            .request("decision.capture", json!({"id":decision["id"]}))
            .await
            .unwrap()
    }

    pub async fn clear(&self) {
        self.user.request("agent.signal", json!({"id":self.child,"attempt":self.attempt,"payload":{"hook_event_name":"PostToolUse"}})).await.unwrap();
    }

    pub async fn write(&self, identity: Value, bytes: &[u8]) -> Result<Value, RpcError> {
        self.user
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":STANDARD.encode(bytes),"identity":identity}),
            )
            .await
    }

    pub async fn user_answer(&self, decision: &Value, kind: &str) {
        if kind == "native" {
            self.user
                .request(
                    "terminal.write",
                    json!({"id":self.terminal,"data":STANDARD.encode(b"u")}),
                )
                .await
                .unwrap();
            self.clear().await;
        } else {
            self.user.request("decision.answer", json!({"id":decision["id"],"answer":if kind == "permission" {"allow"} else {"Yes"},"proof":"0".repeat(64)})).await.unwrap();
        }
    }

    pub async fn guarded_answer(
        &self,
        decision: &Value,
        identity: Value,
        kind: &str,
    ) -> Result<Value, RpcError> {
        self.user.request("decision.answer", json!({"id":decision["id"],"identity":identity,"answer":if kind == "permission" {"allow"} else {"Yes"},"proof":"0".repeat(64)})).await
    }

    pub async fn resumed(&mut self) {
        let node = self
            .user
            .request("agent.resume", json!({"id":self.child}))
            .await
            .unwrap();
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

    pub async fn paused(&self) {
        let arrival = self.dir.path().join("effect-gate.arrived");
        tokio::time::timeout(BOUND, async {
            loop {
                if arrival.is_file() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    pub fn pause(&self) {
        let arrival = self.dir.path().join("effect-gate.arrived");
        if arrival.exists() {
            std::fs::remove_file(arrival).unwrap();
        }
        std::fs::write(self.dir.path().join("effect-gate"), "before").unwrap();
    }

    pub fn release(&self) {
        std::fs::remove_file(self.dir.path().join("effect-gate")).unwrap();
    }

    pub async fn recorded_input(&self) -> String {
        // A NUL is a recording-handler barrier, not a prompt answer. Its receipt proves
        // the input thread and fake Claude consumed everything preceding the refusal.
        let before = self.screen().await.matches("BARRIER").count();
        let observer = Client::connect(&self.daemon.socket).await.unwrap();
        observer
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"ext","id":"b6-observer"}}),
            )
            .await
            .unwrap();
        observer
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":STANDARD.encode(b"\0")}),
            )
            .await
            .unwrap();
        tokio::time::timeout(BOUND, async {
            loop {
                let recorded = self.screen().await;
                if recorded.matches("BARRIER").count() == before + 1 {
                    return recorded;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap()
    }

    pub async fn finish(self) {
        self.user
            .request("agent.stop", json!({"id":self.child}))
            .await
            .unwrap();
    }
}

pub fn launch(project: &Path, data: &Path) -> rupd_harness::Rupd {
    let rup = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project,
        true,
        |command| {
            command
                .env("TOKIO_WORKER_THREADS", "16")
                .env("RUPD_PROMPT_EFFECT_GATE", project.join("effect-gate"))
                .env("RUPD_ORDER_EFFECT_GATE", project.join("order-effect-gate"))
                .env("RUPD_TERMINAL_INPUT_GATE", project.join("input-gate"))
                .env("ROUNDUP_DATA_DIR", data)
                .env("ROUNDUP_CLAUDE_BIN", project.join("claude"))
                .env("ROUNDUP_RUP_BIN", rup)
                .env("CLAUDE_CONFIG_DIR", project.join("config"))
                .stderr(std::process::Stdio::null());
        },
    )
}
