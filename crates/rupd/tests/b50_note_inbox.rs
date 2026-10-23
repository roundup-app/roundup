//! B50, B51, B52: a `note` goes through Claude Code's messaging socket and never to the Terminal.
//! A real Daemon, the fake `claude` (it listens on the socket it is launched with, lists its
//! session as Claude Code does, and records every byte written to its Terminal) and the fake
//! transcript the test appends to.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(15);

const FAKE: &str = r#"#!/usr/bin/env python3
import json, os, re, socket, subprocess, sys, threading, tty
here = os.path.dirname(os.path.abspath(__file__))
if sys.argv[1:3] == ['plugin', 'list']:
    print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
def flag(name):
    return sys.argv[sys.argv.index(name) + 1]
def session_mode():
    if '--permission-mode' in sys.argv:
        return flag('--permission-mode')
    for f in (os.getcwd() + '/.claude/settings.local.json', os.getcwd() + '/.claude/settings.json', os.environ['CLAUDE_CONFIG_DIR'] + '/settings.json'):
        try:
            mode = json.load(open(f)).get('permissions', {}).get('defaultMode')
        except (OSError, ValueError):
            continue
        if mode: return mode if mode in ('default', 'acceptEdits', 'plan', 'auto') else 'default'
    return 'default'
# A session lists itself with its token, and listens; a line is kept only when it is the one
# Claude Code takes up: past `auth`, and from a sender whose mode is this session's.
path, token = flag('--messaging-socket-path'), 'peer-token-' + str(os.getpid())
sessions = os.environ['CLAUDE_CONFIG_DIR'] + '/sessions'
os.makedirs(sessions, exist_ok=True)
server = socket.socket(socket.AF_UNIX)
server.bind(path)
server.listen()
json.dump({'pid': os.getpid(), 'messagingSocketPath': path, 'peerProtocol': int(open(here + '/protocol').read())}, open(sessions + '/%d.json' % os.getpid(), 'w'))
json.dump({'peerToken': token}, open(sessions + '/%d.abc.key' % os.getpid(), 'w'))
# A resumed conversation remembers UUID uptake; sender/content refusal resets per Attempt.
taken_path = here + '/taken.jsonl'
if '--resume' not in sys.argv:
    open(taken_path, 'w').close()
seen_ids = {json.loads(line)['msg_id'] for line in open(taken_path)}
last_entry, peer_lock = None, threading.Lock()
def take(conn):
    global last_entry
    lines = conn.makefile()
    if json.loads(lines.readline()).get('token') != token:
        return
    for line in lines:
        entry = json.loads(line)
        content = entry['message']['content']
        mode = re.search(r'from-mode="([^"]*)"', content).group(1)
        if mode == session_mode():
            with peer_lock:
                with open(here + '/received.jsonl', 'a') as out: out.write(line)
                if entry['msg_id'] in seen_ids or content == last_entry:
                    continue
                seen_ids.add(entry['msg_id'])
                last_entry = content
                with open(taken_path, 'a') as out: out.write(line)
def serve():
    while True:
        conn, _ = server.accept()
        threading.Thread(target=take, args=(conn,), daemon=True).start()
open(here + '/received.jsonl', 'w').close()
threading.Thread(target=serve, daemon=True).start()
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
settings = json.load(open(sys.argv[sys.argv.index('--settings') + 1]))
def hook(event, fields):
    fields['hook_event_name'] = event
    for group in settings['hooks'][event]:
        for item in group['hooks']:
            subprocess.run(item['command'], shell=True, input=json.dumps(fields), text=True, stdout=subprocess.PIPE, check=True)
hook('SessionStart', {'session_id': '00000000-0000-4000-8000-000000000050', 'source': 'resume' if '--resume' in sys.argv else 'startup', 'transcript_path': here + '/transcript.jsonl'})
hook('Stop', {})
print('READY', flush=True)
line = b''
while True:
    data = os.read(0, 1)
    if not data or data == b'\x03': break
    # The Terminal read caps at 200 lines; the bytes typed are counted from this file instead.
    with open(here + '/typed.bin', 'ab') as typed: typed.write(data)
    if data == b'\r':
        # A submitted prompt is signalled as Claude Code's `UserPromptSubmit`, then its turn ends.
        text = line.replace(b'\x1b[200~', b'').replace(b'\x1b[201~', b'').decode(errors='replace').strip()
        line = b''
        hook('UserPromptSubmit', {'prompt': text, 'transcript_path': here + '/transcript.jsonl'})
        hook('Stop', {'transcript_path': here + '/transcript.jsonl'})
    else:
        line += data
"#;

struct Run {
    daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    data: tempfile::TempDir,
    user: Client,
    watcher: Client,
    sender: Client,
    child: String,
    scout: bool,
    kind: &'static str,
    terminal: Value,
    attempt: Value,
    /// The bytes the Daemon typed itself at the start (its context), before any note.
    started_with: AtomicUsize,
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
                .stderr(
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(project.join("rupd.err"))
                        .unwrap(),
                );
        },
    )
}

async fn until<T>(what: &str, mut probe: impl AsyncFnMut() -> Option<T>) -> T {
    tokio::time::timeout(BOUND, async {
        loop {
            if let Some(found) = probe().await {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what}"))
}

impl Run {
    /// A Daemon with one idle Agent.
    async fn start() -> Self {
        Self::start_on(1).await
    }

    /// A Daemon whose Claude Code lists `peerProtocol` `protocol` in its session file.
    async fn start_on(protocol: u64) -> Self {
        Self::start_case(protocol, false).await
    }

    async fn start_case(protocol: u64, scout: bool) -> Self {
        let mut run = Self::open(protocol, scout).await;
        run.spawn().await;
        run
    }

    async fn open(protocol: u64, scout: bool) -> Self {
        Self::open_with(protocol, scout, None).await
    }

    /// `user_settings` is the user's own `settings.json` in Claude Code's config folder.
    async fn open_with(protocol: u64, scout: bool, user_settings: Option<&str>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        if let Some(body) = user_settings {
            std::fs::create_dir_all(dir.path().join("config")).unwrap();
            std::fs::write(dir.path().join("config/settings.json"), body).unwrap();
        }
        let data = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, FAKE).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(dir.path().join("protocol"), protocol.to_string()).unwrap();
        let daemon = launch(dir.path(), data.path());
        let user = Client::connect(&daemon.socket).await.unwrap();
        let mut watcher = Client::connect(&daemon.socket).await.unwrap();
        watcher
            .request("events.subscribe", Value::Null)
            .await
            .unwrap();
        let _ = &mut watcher;
        let sender = Client::connect(&daemon.socket).await.unwrap();
        sender
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"ext","id":"b50"}}),
            )
            .await
            .unwrap();
        Self {
            daemon,
            dir,
            data,
            user,
            watcher,
            sender,
            child: String::new(),
            scout,
            kind: "note",
            terminal: Value::Null,
            attempt: Value::Null,
            started_with: AtomicUsize::new(0),
        }
    }

    async fn spawn(&mut self) {
        let caller = Client::connect(&self.daemon.socket).await.unwrap();
        if self.scout {
            let parent = self
                .user
                .request(
                    "agent.spawn",
                    json!({"name":"parent","cwd":self.dir.path()}),
                )
                .await
                .unwrap();
            self.user
                .request("agent.stop", json!({"id":parent["id"]}))
                .await
                .unwrap();
            caller
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":parent["id"]}}),
                )
                .await
                .unwrap();
        }
        let node = caller
            .request(
                "agent.spawn",
                json!({"name":"child","cwd":self.dir.path(),"scout":self.scout}),
            )
            .await
            .unwrap();
        self.child = node["id"].as_str().unwrap().to_owned();
        self.terminal = node["terminal_id"].clone();
        self.attempt = node["attempt"].clone();
        self.ready().await;
    }

    async fn ready(&self) {
        until("the fake claude is ready", async || {
            self.screen().await.contains("READY").then_some(())
        })
        .await;
        // The Daemon types its own start-up context first; count from where that ends.
        let mut last = usize::MAX;
        while last != self.screen_bytes().await {
            last = self.screen_bytes().await;
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        self.started_with.store(last, Ordering::SeqCst);
    }

    async fn screen_bytes(&self) -> usize {
        std::fs::metadata(self.dir.path().join("typed.bin")).map_or(0, |m| m.len() as usize)
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

    /// The bytes written to the Terminal since the Agent started, as the fake `claude` read them.
    async fn typed(&self) -> usize {
        self.screen_bytes().await - self.started_with.load(Ordering::SeqCst)
    }

    fn sessions(&self) -> PathBuf {
        self.dir.path().join("config/sessions")
    }

    /// Takes the session off the list, as when Claude Code is not listening; the files, to put back.
    /// It waits for the start-up check of the inbox first: a check already past the listing would
    /// find the session gone only after it released a note held meanwhile.
    async fn unlist_session(&self) -> Vec<(PathBuf, Vec<u8>)> {
        until("the start-up inbox check", async || {
            self.rail_inbox().await.map(|_| ())
        })
        .await;
        let files: Vec<_> = std::fs::read_dir(self.sessions())
            .unwrap()
            .map(|file| {
                let path = file.unwrap().path();
                let bytes = std::fs::read(&path).unwrap();
                (path, bytes)
            })
            .collect();
        for (path, _) in &files {
            std::fs::remove_file(path).unwrap();
        }
        files
    }

    fn relist_session(&self, files: &[(PathBuf, Vec<u8>)]) {
        for (path, bytes) in files {
            std::fs::write(path, bytes).unwrap();
        }
    }

    /// Socket entries in this Attempt, including permitted same-id retries after restart.
    /// Only authenticated entries in the receiving permission mode count.
    fn entries(&self) -> Vec<String> {
        self.entry_ids("received.jsonl")
    }

    fn taken(&self) -> Vec<String> {
        self.entry_ids("taken.jsonl")
    }

    fn entry_ids(&self, file: &str) -> Vec<String> {
        let text = std::fs::read_to_string(self.dir.path().join(file)).unwrap_or_default();
        text.lines()
            .map(|line| {
                let msg_id = serde_json::from_str::<Value>(line).unwrap()["msg_id"]
                    .as_str()
                    .unwrap()
                    .to_owned();
                let id = u64::from_str_radix(msg_id.rsplit('-').next().unwrap(), 16).unwrap();
                format!("rup-{id}")
            })
            .collect()
    }

    /// The authenticated socket entries, whole.
    fn received(&self) -> Vec<Value> {
        let text =
            std::fs::read_to_string(self.dir.path().join("received.jsonl")).unwrap_or_default();
        text.lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    async fn identify_sender(&self, kind: &str) {
        let (kind, id) = match kind {
            "daemon" => ("ext", "rupd"),
            "user" => ("user", "you"),
            kind => (kind, "b50"),
        };
        self.sender
            .request("daemon.identify", json!({"actor":{"kind":kind,"id":id}}))
            .await
            .unwrap();
    }

    async fn note(&self, body: &str) -> u32 {
        self.try_note(body).await.unwrap()
    }

    /// The sender's `message.send` of a note to the Agent, as the MCP tool and `rup` make it.
    async fn try_note(&self, body: &str) -> Result<u32, rpc::RpcError> {
        let sent = self
            .sender
            .request(
                "message.send",
                json!({"to":self.child,"kind":self.kind,"body":body}),
            )
            .await?;
        Ok(sent["id"].as_u64().unwrap() as u32)
    }

    /// A note the Agent's inbox cannot take: the sender hears `INBOX_UNAVAILABLE`, and the record
    /// is the note, held. Returns the sender's error and the note's id.
    async fn refused_note(&self, body: &str) -> (rpc::RpcError, u32) {
        let err = self.try_note(body).await.unwrap_err();
        let listed = self
            .user
            .request("message.list", json!({"to":self.child}))
            .await
            .unwrap();
        let id = listed.as_array().unwrap().last().unwrap()["id"]
            .as_u64()
            .unwrap() as u32;
        (err, id)
    }

    /// The Agent works, then is idle again: one `idle` edge.
    async fn idle_edge(&self) {
        for event in ["PreToolUse", "Stop"] {
            self.signal(json!({"hook_event_name":event,"tool_name":"Bash"}))
                .await;
        }
    }

    async fn signal(&self, mut payload: Value) {
        payload["transcript_path"] = json!(self.dir.path().join("transcript.jsonl"));
        self.user
            .request(
                "agent.signal",
                json!({"id":self.child,"attempt":self.attempt,"payload":payload}),
            )
            .await
            .unwrap();
    }

    /// The transcript records the entries of `ids` the way Claude Code does, then the Agent signals.
    async fn record(&self, ids: &[u32]) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.path().join("transcript.jsonl"))
            .unwrap();
        for id in ids {
            writeln!(
                file,
                "{}",
                json!({"type":"user","origin":{"kind":"peer","from":"uds:/rup/rupd","msg_id":format!("00000000-0000-4000-8000-{id:012x}")}})
            )
            .unwrap();
        }
        self.signal(json!({"hook_event_name":"PostToolUse","tool_name":"Bash"}))
            .await;
    }

    async fn message(&self, id: u32) -> Value {
        self.user
            .request("message.get", json!({"id":id}))
            .await
            .unwrap()
    }

    async fn status(&self, id: u32) -> (String, Option<String>) {
        let message = self.message(id).await;
        (
            message["status"].as_str().unwrap().to_owned(),
            message["reason"].as_str().map(str::to_owned),
        )
    }

    async fn rail_inbox(&self) -> Option<String> {
        let tree = self.user.request("rail.tree", Value::Null).await.unwrap();
        let node = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == self.child.as_str());
        node.unwrap()["inbox"].as_str().map(str::to_owned)
    }

    /// The `message.held` and `message.delivered` ids seen so far, in order.
    async fn seen(&mut self) -> (Vec<u32>, Vec<u32>) {
        let (mut held, mut delivered) = (Vec::new(), Vec::new());
        while let Ok(Some(event)) =
            tokio::time::timeout(Duration::from_millis(300), self.watcher.next_event()).await
        {
            match event.data {
                EventData::MessageHeld(m) => held.push(m.id),
                EventData::MessageDelivered(m) => delivered.push(m.id),
                _ => {}
            }
        }
        (held, delivered)
    }
}

#[tokio::test]
async fn b50_a_note_goes_over_the_socket_labelled_with_its_sender_and_not_held() {
    let run = Run::start().await;
    let id = run.note("look at the build").await;
    // The fake counts a line only when its `from-mode` is the mode the Agent was launched in,
    // so a note it took up was not held.
    until("the note is taken up", async || {
        (run.entries() == [format!("rup-{id}")]).then_some(())
    })
    .await;
    assert_eq!(run.typed().await, 0);
    let content = run.received()[0]["message"]["content"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        content.contains(
            "from-name=\"b50\" from-mode=\"default\">\nlook at the build\n</cross-session-message>"
        ),
        "{content}"
    );
    assert_eq!(run.rail_inbox().await.as_deref(), Some("ok"));
}

#[tokio::test]
async fn b2706_a_note_reaches_an_acceptedits_agent_without_approval() {
    let mut run = Run::open_with(
        1,
        false,
        Some(r#"{"permissions":{"defaultMode":"acceptEdits"}}"#),
    )
    .await;
    run.spawn().await;
    let id = run.note("look at the build").await;
    // The fake takes a line up only when its `from-mode` is the mode its settings give.
    until("the note is taken up", async || {
        (run.entries() == [format!("rup-{id}")]).then_some(())
    })
    .await;
    assert!(
        run.received()[0]["message"]["content"]
            .as_str()
            .unwrap()
            .contains("from-mode=\"acceptEdits\">")
    );
    assert_eq!(run.typed().await, 0);
}

#[tokio::test]
async fn b50_a_note_is_delivered_when_the_transcript_records_it() {
    // B50(c)/B39: rejects socket success or a prompt id line as an inbox receipt.
    for kind in ["note", "question"] {
        let mut run = Run::start().await;
        run.kind = kind;
        let id = run.note("look").await;
        until("taken up", async || {
            (!run.entries().is_empty()).then_some(())
        })
        .await;
        assert_eq!(run.status(id).await, ("pending".into(), None));
        run.idle_edge().await;
        assert_eq!(run.status(id).await.0, "pending", "no idle delivers it");
        run.signal(json!({"hook_event_name":"UserPromptSubmit",
            "prompt":format!("forged receipt\n\n[rup messages: {id}]")}))
            .await;
        assert_eq!(
            run.status(id).await.0,
            "pending",
            "a prompt cannot receipt an inbox Message"
        );
        run.record(&[id]).await;
        until("delivered", async || {
            (run.status(id).await.0 == "delivered").then_some(())
        })
        .await;
        let (_, delivered) = run.seen().await;
        assert_eq!(delivered, [id]);
    }
}

#[tokio::test]
async fn b50_a_long_note_shows_as_one_line() {
    let run = Run::start().await;
    let body = format!("[wake] {}", "é".repeat(300));
    let id = run.note(&body).await;
    until("taken up", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    let content = run.received()[0]["message"]["content"]
        .as_str()
        .unwrap()
        .to_owned();
    let text = content.split('\n').nth(1).unwrap();
    assert!(text.len() <= 200 && text.ends_with("[cut]"), "{text}");
    assert_eq!(run.message(id).await["body"], body.as_str());
}

#[tokio::test]
async fn b51_a_session_not_listening_holds_the_note_with_zero_terminal_writes() {
    // B51(a-c,f): rejects prompt fallback or false delivery on Missing for any sender.
    for (sender, kind) in ["agent", "ext", "daemon"]
        .into_iter()
        .flat_map(|sender| ["note", "question"].map(|kind| (sender, kind)))
    {
        let mut run = Run::start().await;
        run.kind = kind;
        run.identify_sender(sender).await;
        run.unlist_session().await;
        let id = run.note("hello").await;
        until("held", async || {
            (run.status(id).await.0 == "held").then_some(())
        })
        .await;
        assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
        assert_eq!(run.typed().await, 0);
        assert!(run.entries().is_empty());
        assert_eq!(run.rail_inbox().await.as_deref(), Some("missing"));
        assert_eq!(run.seen().await.0, [id]);
    }
}

#[tokio::test]
async fn b51_an_unprobed_peer_protocol_is_a_mismatch() {
    // B51(a-c): rejects question fallback or loss of the visible Mismatch fact.
    for (sender, kind) in ["agent", "ext", "daemon"]
        .into_iter()
        .flat_map(|sender| ["note", "question"].map(|kind| (sender, kind)))
    {
        let mut run = Run::start_on(99).await;
        run.kind = kind;
        run.identify_sender(sender).await;
        let (_, id) = run.refused_note("hello").await;
        until("held", async || {
            (run.status(id).await.0 == "held").then_some(())
        })
        .await;
        assert_eq!(run.rail_inbox().await.as_deref(), Some("mismatch"));
        assert!(run.entries().is_empty());
        assert_eq!(run.typed().await, 0);
        // The transition is loud, once: the Rail is read again at each check, the log line is not.
        let log = std::fs::read_to_string(run.dir.path().join("rupd.err")).unwrap();
        let lines: Vec<_> = log
            .lines()
            .filter(|line| line.contains("messaging protocol this build does not"))
            .collect();
        assert_eq!(lines.len(), 1, "{log}");
    }
}

#[tokio::test]
async fn b51_a_held_inbox_note_is_released_when_the_session_listens_again() {
    // B51(d): rejects reordered recovery or delivery before the corresponding receipt.
    for kind in ["note", "question"] {
        let mut run = Run::start().await;
        run.kind = kind;
        let listed = run.unlist_session().await;
        let first = run.note("one").await;
        let second = run.note("two").await;
        until("held", async || {
            (run.status(second).await.0 == "held" && run.status(first).await.0 == "held")
                .then_some(())
        })
        .await;
        assert_eq!(run.rail_inbox().await.as_deref(), Some("missing"));
        run.relist_session(&listed);
        run.idle_edge().await;
        until("taken up", async || {
            (run.entries() == [format!("rup-{first}"), format!("rup-{second}")]).then_some(())
        })
        .await;
        assert_eq!(run.rail_inbox().await.as_deref(), Some("ok"));
        assert_eq!(run.typed().await, 0);
        assert_eq!(run.status(first).await.0, "pending");
        assert_eq!(run.status(second).await.0, "pending");
        assert!(run.seen().await.1.is_empty());
        run.record(&[first, second]).await;
        until("both recovered receipts", async || {
            (run.status(first).await.0 == "delivered" && run.status(second).await.0 == "delivered")
                .then_some(())
        })
        .await;
        assert_eq!(run.seen().await.1, [first, second]);
    }
}

#[tokio::test]
async fn b51_deliver_by_hand_sends_nothing_and_errors() {
    // B51(e): rejects manual-delivery fallback or success on an unavailable inbox.
    for (protocol, kind) in [1, 99]
        .into_iter()
        .flat_map(|protocol| ["note", "question"].map(|kind| (protocol, kind)))
    {
        let mut run = Run::start_on(protocol).await;
        run.kind = kind;
        let id = if protocol == 1 {
            run.unlist_session().await;
            run.note("hello").await
        } else {
            run.refused_note("hello").await.1
        };
        until("held", async || {
            (run.status(id).await.0 == "held").then_some(())
        })
        .await;
        let err = run
            .user
            .request("message.deliver", json!({"id":id}))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::INBOX_UNAVAILABLE);
        assert_eq!(run.status(id).await.0, "held");
        assert_eq!(run.typed().await, 0);
    }
}

#[tokio::test]
async fn b51_the_user_message_is_typed_whatever_the_inbox() {
    // B51(e): rejects routing user input to an unavailable inbox.
    for (protocol, kind) in [1, 99]
        .into_iter()
        .flat_map(|protocol| ["note", "question"].map(|kind| (protocol, kind)))
    {
        let mut run = Run::start_on(protocol).await;
        run.kind = kind;
        if protocol == 1 {
            run.unlist_session().await;
        }
        run.user
            .request(
                "message.send",
                json!({"to":run.child,"kind":kind,"body":"from me"}),
            )
            .await
            .unwrap();
        until("typed", async || (run.typed().await > 0).then_some(())).await;
    }
}

#[tokio::test]
async fn b52_thirty_idle_edges_send_a_note_once_and_type_nothing() {
    // B52(a): rejects clearing in-flight identity on idle and duplicate socket sends.
    for kind in ["note", "question"] {
        let mut run = Run::start().await;
        run.kind = kind;
        let id = run.note("once").await;
        until("taken up", async || {
            (!run.entries().is_empty()).then_some(())
        })
        .await;
        for _ in 0..30 {
            run.idle_edge().await;
            assert_eq!(run.typed().await, 0);
            assert_eq!(
                run.entries().len(),
                if run.rail_inbox().await.as_deref() == Some("ok") {
                    1
                } else {
                    0
                }
            );
        }
        assert_eq!(run.entries(), [format!("rup-{id}")]);
        assert_eq!(run.typed().await, 0);
        run.record(&[id]).await;
        until("delivered", async || {
            (run.status(id).await.0 == "delivered").then_some(())
        })
        .await;
        assert_eq!(run.seen().await.1, [id]);
    }
}

#[tokio::test]
async fn b52_thirty_idle_edges_with_a_session_not_listening_hold_once_and_type_nothing() {
    // B52(a): rejects repeated hold events or fallback while the inbox is Missing.
    for kind in ["note", "question"] {
        let mut run = Run::start().await;
        run.kind = kind;
        run.unlist_session().await;
        let id = run.note("once").await;
        for _ in 0..30 {
            run.idle_edge().await;
            assert_eq!(run.typed().await, 0);
            assert_eq!(
                run.entries().len(),
                if run.rail_inbox().await.as_deref() == Some("ok") {
                    1
                } else {
                    0
                }
            );
        }
        assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
        assert_eq!(run.typed().await, 0);
        assert_eq!(run.seen().await.0, [id]);
    }
}

#[tokio::test]
async fn b52_a_restart_with_a_held_inbox_note_keeps_it_held() {
    // B52(b): rejects releasing an unavailable hold or retaining its old Attempt on recovery.
    for kind in ["note", "question"] {
        let mut run = Run::start_on(99).await;
        run.kind = kind;
        let (_, id) = run.refused_note("keep").await;
        until("held", async || {
            (run.status(id).await.0 == "held").then_some(())
        })
        .await;
        run.restart().await;
        assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
        assert_eq!(run.typed().await, 0);
        for file in std::fs::read_dir(run.sessions()).unwrap() {
            let path = file.unwrap().path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                let mut listing: Value =
                    serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                listing["peerProtocol"] = json!(1);
                std::fs::write(&path, serde_json::to_vec(&listing).unwrap()).unwrap();
            }
        }
        run.idle_edge().await;
        until(
            "held Message recovered in the resumed Attempt",
            async || (run.entries() == [format!("rup-{id}")]).then_some(()),
        )
        .await;
        assert_eq!(run.status(id).await.0, "pending");
        run.record(&[id]).await;
        until("recovered receipt", async || {
            (run.status(id).await.0 == "delivered").then_some(())
        })
        .await;
        assert_eq!(run.seen().await.1, [id]);
        assert_eq!(run.typed().await, 0);
    }
}

#[tokio::test]
async fn b52_a_restart_with_a_sent_note_delivers_it_once() {
    // B52(b): rejects losing the unacknowledged id on restart or falsely delivering its write.
    for kind in ["note", "question"] {
        let mut run = Run::start().await;
        run.kind = kind;
        let id = run.note("once").await;
        until("taken up", async || {
            (!run.entries().is_empty()).then_some(())
        })
        .await;
        assert_eq!(run.taken(), [format!("rup-{id}")]);
        run.restart().await;
        run.idle_edge().await;
        // The resumed session is a new process with its own socket; it takes the note up once.
        until("taken up again", async || {
            (run.entries() == [format!("rup-{id}")]).then_some(())
        })
        .await;
        run.record(&[id]).await;
        until("delivered", async || {
            (run.status(id).await.0 == "delivered").then_some(())
        })
        .await;
        assert_eq!(run.entries(), [format!("rup-{id}")]);
        assert_eq!(
            run.taken(),
            [format!("rup-{id}")],
            "a retry is not another peer uptake"
        );
        assert_eq!(run.typed().await, 0);
        assert_eq!(run.seen().await.1, [id]);
    }
}

impl Run {
    /// A Daemon kill (D6), then a new Daemon on the same Project, and the Agent resumed.
    async fn restart(&mut self) {
        let socket = self.daemon.socket.clone();
        let _ = self.daemon.child.kill();
        let _ = self.daemon.child.wait();
        let _ = std::fs::remove_file(&socket);
        self.daemon = launch(self.dir.path(), self.data.path());
        self.user = Client::connect(&self.daemon.socket).await.unwrap();
        self.watcher = Client::connect(&self.daemon.socket).await.unwrap();
        self.watcher
            .request("events.subscribe", Value::Null)
            .await
            .unwrap();
        self.sender = Client::connect(&self.daemon.socket).await.unwrap();
        self.sender
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"ext","id":"b50"}}),
            )
            .await
            .unwrap();
        let node = self
            .user
            .request("agent.resume", json!({"id":self.child}))
            .await
            .unwrap();
        self.terminal = node["terminal_id"].clone();
        self.attempt = node["attempt"].clone();
        self.ready().await;
    }
}

#[tokio::test]
async fn b51_the_sender_of_a_note_to_a_mismatched_inbox_hears_it_and_the_note_is_held() {
    // B51(f): rejects a successful send response on Mismatch or failure to retain the Message.
    for (sender, kind) in ["agent", "ext", "daemon"]
        .into_iter()
        .flat_map(|sender| ["note", "question"].map(|kind| (sender, kind)))
    {
        let mut run = Run::start_on(99).await;
        run.kind = kind;
        run.identify_sender(sender).await;
        let (err, id) = run.refused_note("hello").await;
        assert_eq!(err.code, rpc::code::INBOX_UNAVAILABLE);
        assert_eq!(
            err.message,
            "Messages held: Claude Code changed its message format"
        );
        assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
        assert_eq!(run.seen().await.1, Vec::<u32>::new());
    }
}

#[tokio::test]
async fn b51_a_note_repeating_the_last_one_is_refused_and_made_no_record() {
    // B51(g): rejects kind-scoped refusal across all authenticated non-user senders.
    for sender in ["agent", "ext", "daemon"] {
        for first_kind in ["note", "question"] {
            for next_kind in ["note", "question"] {
                let mut run = Run::start().await;
                run.identify_sender(sender).await;
                run.kind = first_kind;
                let first = run.note("same").await;
                until("taken up", async || {
                    (run.entries() == [format!("rup-{first}")]).then_some(())
                })
                .await;
                run.kind = next_kind;
                let err = run.try_note("same").await.unwrap_err();
                assert_eq!(err.code, rpc::code::CONFLICT);
                assert_eq!(
                    err.message,
                    "same text as your last Message; Claude Code drops repeats"
                );
                let listed = run
                    .user
                    .request("message.list", json!({"to":run.child}))
                    .await
                    .unwrap();
                assert_eq!(listed.as_array().unwrap().len(), 1, "no second record");
                // Another text, and the same text once another note came between, are taken up.
                let other = run.note("other").await;
                let again = run.note("same").await;
                until("taken up", async || {
                    (run.entries().len() == 3).then_some(())
                })
                .await;
                assert_eq!(
                    run.entries(),
                    [first, other, again].map(|id| format!("rup-{id}"))
                );
            }
        }
    }
}

impl Run {
    async fn rename(&self, name: &str) -> u32 {
        self.user
            .request("rail.rename", json!({"id":self.child,"name":name}))
            .await
            .unwrap();
        let body = format!("you are now called \"{name}\" on the Rail");
        until("rename note queued", async || {
            let messages = self
                .user
                .request("message.list", json!({"to":self.child}))
                .await
                .unwrap();
            messages
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .find(|m| m["body"] == body)
                .map(|m| m["id"].as_u64().unwrap() as u32)
        })
        .await
    }

    async fn assert_rename_delivery(&mut self, ids: &[u32], names: &[&str]) {
        let expected: Vec<_> = ids.iter().map(|id| format!("rup-{id}")).collect();
        until("ordered rename entries", async || {
            (self.entries() == expected).then_some(())
        })
        .await;
        for ((entry, id), name) in self.received().iter().zip(ids).zip(names) {
            assert_eq!(
                entry["msg_id"],
                format!("00000000-0000-4000-8000-{id:012x}")
            );
            let content = entry["message"]["content"].as_str().unwrap();
            assert!(content.contains("from-name=\"rupd\""), "{content}");
            assert!(
                content.contains(&format!("you are now called \"{name}\" on the Rail")),
                "{content}"
            );
            let message = self.message(*id).await;
            assert_eq!(message["from"]["id"], "rupd");
            assert_eq!(message["kind"], "note");
            assert_eq!(message["status"], "pending");
        }
        assert_eq!(self.typed().await, 0);
        self.record(ids).await;
        until("rename acknowledgements", async || {
            let mut delivered = true;
            for id in ids {
                delivered &= self.status(*id).await.0 == "delivered";
            }
            delivered.then_some(())
        })
        .await;
        self.idle_edge().await;
        let (_, delivered) = self.seen().await;
        for id in ids {
            assert_eq!(delivered.iter().filter(|seen| *seen == id).count(), 1);
        }
        assert_eq!(self.entries(), expected);
        assert_eq!(self.typed().await, 0);
    }
}

#[tokio::test]
async fn b2704a_rename_updates_context_and_queues_one_note() {
    for (scout, agent_caller) in [(false, false), (true, false), (false, true)] {
        let mut run = Run::start_case(1, scout).await;
        let caller = Client::connect(&run.daemon.socket).await.unwrap();
        if agent_caller {
            caller
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":run.child}}),
                )
                .await
                .unwrap();
        }
        caller
            .request("rail.rename", json!({"id":run.child,"name":"sad-2"}))
            .await
            .unwrap();
        let id = until("rename note queued", async || {
            let messages = run
                .user
                .request("message.list", json!({"to":run.child}))
                .await
                .unwrap();
            messages
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["body"] == "you are now called \"sad-2\" on the Rail")
                .map(|m| m["id"].as_u64().unwrap() as u32)
        })
        .await;
        let context = run
            .user
            .request("agent.context", json!({"id":run.child}))
            .await
            .unwrap();
        assert_eq!(context["self"]["name"], "sad-2");
        run.assert_rename_delivery(&[id], &["sad-2"]).await;
    }
}

#[tokio::test]
async fn b2704a_busy_renames_arrive_once_in_order() {
    let mut run = Run::start().await;
    run.signal(json!({"hook_event_name":"PreToolUse","tool_name":"Bash"}))
        .await;
    let first = run.rename("sad-2").await;
    let second = run.rename("sad-3").await;
    assert!(run.entries().is_empty());
    run.signal(json!({"hook_event_name":"Stop"})).await;
    run.assert_rename_delivery(&[first, second], &["sad-2", "sad-3"])
        .await;
}

#[tokio::test]
async fn b2704a_takeover_holds_rename_notes() {
    let mut run = Run::start().await;
    run.signal(json!({"hook_event_name":"PreToolUse","tool_name":"Bash"}))
        .await;
    let pending = run.rename("sad-1").await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let first = run.rename("sad-2").await;
    let second = run.rename("sad-3").await;
    run.signal(json!({"hook_event_name":"Stop"})).await;
    for id in [pending, first, second] {
        until("rename held for Takeover", async || {
            (run.status(id).await == ("held".into(), Some("takeover".into()))).then_some(())
        })
        .await;
    }
    assert!(run.entries().is_empty());
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    run.assert_rename_delivery(&[pending, first, second], &["sad-1", "sad-2", "sad-3"])
        .await;
}

#[tokio::test]
async fn b2704a_workstream_rename_notifies_its_door() {
    let mut run = Run::open(1, false).await;
    let workstream = run
        .user
        .request("rail.createWorkstream", json!({"name":"sad","parent":null}))
        .await
        .unwrap();
    let door = run
        .user
        .request("rail.startDoor", json!({"id":workstream["id"]}))
        .await
        .unwrap();
    run.child = door["id"].as_str().unwrap().into();
    run.terminal = door["terminal_id"].clone();
    run.attempt = door["attempt"].clone();
    run.ready().await;
    let id = run.rename("sad-2").await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["self"]["name"], "sad-2");
    assert_eq!(run.message(id).await["to"], run.child);
    run.assert_rename_delivery(&[id], &["sad-2"]).await;
}

#[tokio::test]
async fn b2704a_unchanged_names_produce_no_note() {
    let run = Run::start().await;
    run.user
        .request("rail.rename", json!({"id":run.child,"name":"child"}))
        .await
        .unwrap();
    assert!(
        run.user
            .request("rail.rename", json!({"id":"7013","name":"rejected"}))
            .await
            .is_err()
    );
    // Explicitly named Agents keep their name on the first prompt and on later prompts.
    for prompt in ["", "first words", "later words"] {
        run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":prompt}))
            .await;
    }
    run.user
        .request("rail.move", json!({"id":run.child,"parent":null,"index":0}))
        .await
        .unwrap();
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert!(messages.as_array().unwrap().is_empty(), "{messages}");
    assert!(run.entries().is_empty());
}

#[tokio::test]
async fn b2704a_first_prompt_rename_notifies() {
    let mut run = Run::open(1, false).await;
    let node = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().into();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    run.ready().await;
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"sad"}))
        .await;
    let id = until("first prompt rename note", async || {
        let messages = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        messages
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["body"] == "you are now called \"sad\" on the Rail")
            .map(|m| m["id"].as_u64().unwrap() as u32)
    })
    .await;
    run.signal(json!({"hook_event_name":"Stop"})).await;
    run.assert_rename_delivery(&[id], &["sad"]).await;
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"later name"}))
        .await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["self"]["name"], "sad");
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    // The other first-prompt branch consumes the name guard without emitting a rename.
    // Reuse the Daemon; only a new unnamed child is needed to exercise that branch.
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let node = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().into();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    run.ready().await;
    for prompt in ["   ", "later words"] {
        run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":prompt}))
            .await;
    }
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert!(messages.as_array().unwrap().is_empty(), "{messages}");
    assert!(run.entries().is_empty());
}

// B50(a,e): the Note-only gate routes the question rows into Agents::prompt/PTY instead.
// The companion Messages observer counts the prompt callback; this observer uses the real
// Agents::prompt implementation and counts bytes at its actual receiving Terminal.
#[tokio::test]
async fn b50_sender_and_kind_choose_transport_through_delivery() {
    for sender in ["user", "agent", "ext", "daemon"] {
        let run = Run::start().await;
        run.identify_sender(sender).await;
        for (index, kind) in ["note", "question"].iter().enumerate() {
            let sent = run
                .sender
                .request(
                    "message.send",
                    json!({"to":run.child,"kind":kind,"body":format!("route {kind}")}),
                )
                .await
                .unwrap();
            let id = u32::try_from(sent["id"].as_u64().unwrap()).unwrap();
            if sender == "user" {
                until("prompt receipt", async || {
                    (run.status(id).await.0 == "delivered").then_some(())
                })
                .await;
                assert!(run.entries().is_empty());
                assert!(run.typed().await > 0);
            } else {
                until(
                    &format!("{sender}/{kind} inbox entry: {sent}"),
                    async || (run.entries().len() == index + 1).then_some(()),
                )
                .await;
                assert_eq!(run.entries()[index], format!("rup-{id}"));
                assert_eq!(run.typed().await, 0);
                assert_eq!(run.status(id).await.0, "pending");
                run.record(&[id]).await;
                until("receipt", async || {
                    (run.status(id).await.0 == "delivered").then_some(())
                })
                .await;
                assert_eq!(run.typed().await, 0);
                run.idle_edge().await;
            }
        }
    }
}

// B50(b,d): rejects rewriting durable question identity or cutting its full multibyte body.
#[tokio::test]
async fn b50_an_inbox_question_preserves_its_message_and_reply_identity() {
    let mut run = Run::start().await;
    run.kind = "question";
    let body = format!("[digest] {}", "é".repeat(300));
    let earlier = run
        .sender
        .request(
            "message.send",
            json!({"to":"you", "kind":"note", "body":"context"}),
        )
        .await
        .unwrap();
    let _ = run.seen().await;
    let sent = run
        .sender
        .request(
            "message.send",
            json!({"to":run.child,"kind":"question","body":body,"replyTo":earlier["id"]}),
        )
        .await
        .unwrap();
    let id = u32::try_from(sent["id"].as_u64().unwrap()).unwrap();
    until("question entry", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    let before = run.message(id).await;
    let received = run.received();
    let content = received[0]["message"]["content"].as_str().unwrap();
    assert!(
        content.contains(&format!("[question, replyTo: {id}] {body}\n")),
        "{content}"
    );
    assert!(content.contains("from-name=\"b50\""));
    assert_eq!(before["kind"], "question");
    assert_eq!(before["body"], body);
    assert_eq!(before["replyTo"], earlier["id"]);
    assert_eq!(before["passedFrom"], Value::Null);
    assert_eq!(before["status"], "pending");
    run.record(&[id]).await;
    until("receipt", async || {
        (run.status(id).await.0 == "delivered").then_some(())
    })
    .await;
    let mut after = run.message(id).await;
    after["status"] = json!("pending");
    assert_eq!(before, after);
    let answerer = Client::connect(&run.daemon.socket).await.unwrap();
    answerer
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let answer = answerer
        .request(
            "message.send",
            json!({"to":"you","kind":"note","body":"answer","replyTo":id}),
        )
        .await
        .unwrap();
    assert_eq!(answer["replyTo"], id);
    assert_eq!(run.typed().await, 0);
    assert_eq!(
        run.seen().await.1,
        [id, u32::try_from(answer["id"].as_u64().unwrap()).unwrap()]
    );
}

// B51(g): rejects global/sender-independent refusal or merging the identities of accepted questions.
#[tokio::test]
async fn b51_other_senders_and_a_new_attempt_keep_distinct_messages() {
    let mut run = Run::start().await;
    run.kind = "question";
    let first = run.note("same").await;
    until("first", async || (run.entries().len() == 1).then_some(())).await;
    run.identify_sender("daemon").await;
    let second = run.note("same").await;
    until("different sender", async || {
        (run.entries().len() == 2).then_some(())
    })
    .await;
    assert_ne!(first, second);
    assert_eq!(run.message(first).await["from"]["kind"], "ext");
    assert_eq!(run.message(second).await["from"]["id"], "rupd");
    run.record(&[first, second]).await;
    until("receipts", async || {
        (run.status(first).await.0 == "delivered" && run.status(second).await.0 == "delivered")
            .then_some(())
    })
    .await;
    run.restart().await;
    run.identify_sender("daemon").await;
    let third = run.note("same").await;
    until("new Attempt", async || {
        (run.entries().len() == 1).then_some(())
    })
    .await;
    assert_eq!(run.entries(), [format!("rup-{third}")]);
    assert!(third > second);
    assert_eq!(run.message(third).await["kind"], "question");
    assert_eq!(run.typed().await, 0);
}

// B52(b), B8/B40: rejects sending an acknowledged id again or reviving a pre-write ending.
#[tokio::test]
async fn b52_restart_preserves_prewrite_and_acknowledged_outcomes() {
    for kind in ["note", "question"] {
        for acknowledged in [false, true] {
            let mut run = Run::start().await;
            run.kind = kind;
            if !acknowledged {
                run.signal(json!({"hook_event_name":"PreToolUse","tool_name":"Bash"}))
                    .await;
            }
            let id = run.note("restart state").await;
            if acknowledged {
                until("entry", async || (!run.entries().is_empty()).then_some(())).await;
                run.record(&[id]).await;
                until("receipt", async || {
                    (run.status(id).await.0 == "delivered").then_some(())
                })
                .await;
                assert_eq!(run.seen().await.1, [id]);
            } else {
                assert!(run.entries().is_empty());
                assert_eq!(run.status(id).await.0, "pending");
            }
            run.restart().await;
            run.idle_edge().await;
            let expected = if acknowledged { "delivered" } else { "dropped" };
            assert_eq!(run.status(id).await.0, expected);
            assert!(run.entries().is_empty());
            assert_eq!(run.typed().await, 0);
            assert!(run.seen().await.1.is_empty());
        }
    }
}
