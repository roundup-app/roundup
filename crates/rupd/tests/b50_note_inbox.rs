//! B50, B51, B52: a `note` goes through Claude Code's inbox and never to the Terminal. A real
//! Daemon, the fake `claude` (it records every byte written to its Terminal) and the fake
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
import json, os, subprocess, sys, tty
here = os.path.dirname(os.path.abspath(__file__))
if sys.argv[1:2] == ['--version']:
    print(open(here + '/version').read().strip() if os.path.isfile(here + '/version') else '2.1.296 (Claude Code)'); sys.exit(0)
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
            subprocess.run(item['command'], shell=True, input=json.dumps(fields), text=True, check=True)
hook('SessionStart', {'session_id': '00000000-0000-4000-8000-000000000050', 'source': 'resume' if '--resume' in sys.argv else 'startup', 'transcript_path': here + '/transcript.jsonl'})
hook('Stop', {})
print('READY', flush=True)
line = b''
while True:
    data = os.read(0, 1)
    if not data: break
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
                .stderr(std::process::Stdio::null());
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
        Self::start_on("2.1.296 (Claude Code)").await
    }

    /// A Daemon whose `claude --version` prints `version`.
    async fn start_on(version: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, FAKE).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(dir.path().join("version"), version).unwrap();
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
        let mut run = Self {
            daemon,
            dir,
            data,
            user,
            watcher,
            sender,
            child: String::new(),
            terminal: Value::Null,
            attempt: Value::Null,
            started_with: AtomicUsize::new(0),
        };
        run.spawn().await;
        run
    }

    async fn spawn(&mut self) {
        let node = self
            .user
            .request("agent.spawn", json!({"name":"child","cwd":self.dir.path()}))
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

    fn inbox_path(&self) -> PathBuf {
        self.dir
            .path()
            .join("config/teams/roundup/inboxes")
            .join(format!("{}.json", self.child))
    }

    /// Makes the inbox directory usable, with the entries of `file` (a fixture) in it.
    fn inbox_from(&self, file: &str) {
        std::fs::create_dir_all(self.inbox_path().parent().unwrap()).unwrap();
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../agents/tests/fixtures/inbox/2.1.296");
        std::fs::copy(fixture.join(file), self.inbox_path()).unwrap();
    }

    /// The inbox entries' ids.
    fn entries(&self) -> Vec<String> {
        let text = std::fs::read_to_string(self.inbox_path()).unwrap_or_else(|_| "[]".into());
        serde_json::from_str::<Vec<Value>>(&text)
            .unwrap()
            .iter()
            .map(|entry| entry["id"].as_str().unwrap_or_default().to_owned())
            .filter(|id| id.starts_with("rup-"))
            .collect()
    }

    async fn note(&self, body: &str) -> u32 {
        let sent = self
            .sender
            .request(
                "message.send",
                json!({"to":self.child,"kind":"note","body":body}),
            )
            .await
            .unwrap();
        sent["id"].as_u64().unwrap() as u32
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
                json!({"type":"teammate_message","id":format!("rup-{id}")})
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
async fn b50_a_note_is_written_to_the_inbox_and_nothing_to_the_terminal() {
    let run = Run::start().await;
    run.inbox_from("ok.json");
    let id = run.note("look at the build").await;
    until("the note is in the inbox", async || {
        (run.entries() == [format!("rup-{id}")]).then_some(())
    })
    .await;
    assert_eq!(run.typed().await, 0);
    let entry: Vec<Value> =
        serde_json::from_slice(&std::fs::read(run.inbox_path()).unwrap()).unwrap();
    let written = entry.last().unwrap();
    assert_eq!(written["from"], "b50");
    assert_eq!(written["text"], "look at the build");
    assert_eq!(written["read"], false);
    assert_eq!(run.rail_inbox().await.as_deref(), Some("ok"));
}

#[tokio::test]
async fn b50_a_note_is_delivered_when_the_transcript_records_it() {
    let mut run = Run::start().await;
    run.inbox_from("ok.json");
    let id = run.note("look").await;
    until("written", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    assert_eq!(run.status(id).await, ("pending".into(), None));
    run.idle_edge().await;
    assert_eq!(run.status(id).await.0, "pending", "no idle delivers it");
    run.record(&[id]).await;
    until("delivered", async || {
        (run.status(id).await.0 == "delivered").then_some(())
    })
    .await;
    let (_, delivered) = run.seen().await;
    assert_eq!(delivered, [id]);
}

#[tokio::test]
async fn b50_a_long_note_shows_as_one_line() {
    let run = Run::start().await;
    run.inbox_from("ok.json");
    let body = format!("[wake] {}", "é".repeat(300));
    let id = run.note(&body).await;
    until("written", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    let entries: Vec<Value> =
        serde_json::from_slice(&std::fs::read(run.inbox_path()).unwrap()).unwrap();
    let text = entries.last().unwrap()["text"].as_str().unwrap();
    assert!(text.len() <= 200 && text.ends_with("[cut]"), "{text}");
    assert_eq!(run.message(id).await["body"], body.as_str());
}

#[tokio::test]
async fn b51_a_missing_inbox_holds_the_note_with_zero_terminal_writes() {
    let mut run = Run::start().await;
    // `teams` is a file, so the inbox can neither be found nor created.
    let teams = run.dir.path().join("config/teams");
    let _ = std::fs::remove_dir_all(&teams);
    std::fs::create_dir_all(teams.parent().unwrap()).unwrap();
    std::fs::write(&teams, "x").unwrap();
    let id = run.note("hello").await;
    until("held", async || {
        (run.status(id).await.0 == "held").then_some(())
    })
    .await;
    assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
    assert_eq!(run.typed().await, 0);
    assert_eq!(run.rail_inbox().await.as_deref(), Some("missing"));
    assert_eq!(run.seen().await.0, [id]);
}

#[tokio::test]
async fn b51_a_mismatched_format_holds_the_note_with_zero_terminal_writes() {
    let mut run = Run::start().await;
    run.inbox_from("no-read-field.json");
    let before = std::fs::read(run.inbox_path()).unwrap();
    let id = run.note("hello").await;
    until("held", async || {
        (run.status(id).await.0 == "held").then_some(())
    })
    .await;
    assert_eq!(run.status(id).await.1.as_deref(), Some("inbox"));
    assert_eq!(run.typed().await, 0);
    assert_eq!(std::fs::read(run.inbox_path()).unwrap(), before);
    assert_eq!(run.rail_inbox().await.as_deref(), Some("mismatch"));
    assert_eq!(run.seen().await.0, [id]);
}

#[tokio::test]
async fn b51_an_unknown_claude_version_is_a_mismatch() {
    let run = Run::start_on("9.9.9 (Claude Code)").await;
    run.inbox_from("ok.json");
    let id = run.note("hello").await;
    until("held", async || {
        (run.status(id).await.0 == "held").then_some(())
    })
    .await;
    assert_eq!(run.rail_inbox().await.as_deref(), Some("mismatch"));
    assert!(run.entries().is_empty());
    assert_eq!(run.typed().await, 0);
}

#[tokio::test]
async fn b51_a_held_inbox_note_is_released_when_the_inbox_is_ok_again() {
    let mut run = Run::start().await;
    run.inbox_from("no-read-field.json");
    let first = run.note("one").await;
    let second = run.note("two").await;
    until("held", async || {
        (run.status(second).await.0 == "held" && run.status(first).await.0 == "held").then_some(())
    })
    .await;
    assert_eq!(run.rail_inbox().await.as_deref(), Some("mismatch"));
    run.inbox_from("ok.json");
    run.idle_edge().await;
    until("written", async || {
        (run.entries() == [format!("rup-{first}"), format!("rup-{second}")]).then_some(())
    })
    .await;
    assert_eq!(run.rail_inbox().await.as_deref(), Some("ok"));
    assert_eq!(run.typed().await, 0);
    let _ = run.seen().await;
}

#[tokio::test]
async fn b51_deliver_by_hand_writes_nothing_and_errors() {
    let run = Run::start().await;
    run.inbox_from("no-read-field.json");
    let id = run.note("hello").await;
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

#[tokio::test]
async fn b51_the_user_message_is_typed_whatever_the_inbox() {
    let run = Run::start().await;
    run.inbox_from("no-read-field.json");
    run.user
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"from me"}),
        )
        .await
        .unwrap();
    until("typed", async || (run.typed().await > 0).then_some(())).await;
}

#[tokio::test]
async fn b52_thirty_idle_edges_write_a_note_once_and_type_nothing() {
    let mut run = Run::start().await;
    run.inbox_from("ok.json");
    let id = run.note("once").await;
    until("written", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    for _ in 0..30 {
        run.idle_edge().await;
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

#[tokio::test]
async fn b52_thirty_idle_edges_with_a_missing_inbox_hold_once_and_type_nothing() {
    let mut run = Run::start().await;
    run.inbox_from("no-read-field.json");
    let id = run.note("once").await;
    for _ in 0..30 {
        run.idle_edge().await;
    }
    assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
    assert_eq!(run.typed().await, 0);
    assert_eq!(run.seen().await.0, [id]);
}

#[tokio::test]
async fn b52_a_restart_with_a_held_inbox_note_keeps_it_held() {
    let mut run = Run::start().await;
    run.inbox_from("no-read-field.json");
    let id = run.note("keep").await;
    until("held", async || {
        (run.status(id).await.0 == "held").then_some(())
    })
    .await;
    run.restart().await;
    assert_eq!(run.status(id).await, ("held".into(), Some("inbox".into())));
    assert_eq!(run.typed().await, 0);
}

#[tokio::test]
async fn b52_a_restart_with_a_written_note_delivers_it_once() {
    let mut run = Run::start().await;
    run.inbox_from("ok.json");
    let id = run.note("once").await;
    until("written", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    run.restart().await;
    run.idle_edge().await;
    assert_eq!(run.entries(), [format!("rup-{id}")]);
    run.record(&[id]).await;
    until("delivered", async || {
        (run.status(id).await.0 == "delivered").then_some(())
    })
    .await;
    assert_eq!(run.entries(), [format!("rup-{id}")]);
    assert_eq!(run.typed().await, 0);
    let _ = run.seen().await;
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
