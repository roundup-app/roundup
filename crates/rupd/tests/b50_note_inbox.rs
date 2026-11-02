//! B50, B51, B52: a `note` goes through Claude Code's messaging socket and never to the Terminal.
//! A real Daemon and fake `claude` with a live messaging socket, session listing, recorded
//! Terminal input and a transcript the test appends to. Saved identities need no SDK storage.
#[path = "support/rename_delivery.rs"]
mod rename_delivery;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

#[path = "support/b5168f_quiet_digest.rs"]
mod b5168f_quiet_digest;

#[path = "support/u166b_native_answer.rs"]
mod u166b_native_answer;

#[path = "support/naming_controls.rs"]
mod naming_controls;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(15);

const FAKE: &str = include_str!("support/fake_claude.txt");

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
                .env("ROUNDUP_SIDECAR_DIR", project.join("unused-sidecar"))
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
    /// find the session gone only after it sent a note queued meanwhile.
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

    /// Claude Code lists the protocol this build speaks again.
    fn repair_protocol(&self) {
        for file in std::fs::read_dir(self.sessions()).unwrap() {
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
    }

    /// The user's own unsubmitted bytes in the Agent's input.
    async fn draft(&self, text: &str) {
        use base64::{Engine, engine::general_purpose::STANDARD};
        let before = self.typed().await;
        self.user
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":STANDARD.encode(text)}),
            )
            .await
            .unwrap();
        until("the draft reached the Terminal", async || {
            (self.typed().await == before + text.len()).then_some(())
        })
        .await;
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
    /// is the note, still pending. Returns the sender's error and the note's id.
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

    async fn rail_node(&self) -> Value {
        let tree = self.user.request("rail.tree", Value::Null).await.unwrap();
        let id = self.child.as_str();
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()
            .clone()
    }

    async fn rail_status(&self) -> String {
        let node = self.rail_node().await;
        node["status"]["kind"].as_str().unwrap().to_owned()
    }

    async fn rail_inbox(&self) -> Option<String> {
        self.rail_node().await["inbox"].as_str().map(str::to_owned)
    }

    /// The `message.delivered` ids seen so far, in order.
    async fn seen(&mut self) -> Vec<u32> {
        let mut delivered = Vec::new();
        while let Ok(Some(event)) =
            tokio::time::timeout(Duration::from_millis(300), self.watcher.next_event()).await
        {
            if let EventData::MessageDelivered(m) = event.data {
                delivered.push(m.id);
            }
        }
        delivered
    }
}

#[tokio::test]
async fn b50_a_note_goes_over_the_socket_labelled_with_its_sender() {
    let run = Run::start().await;
    let id = run.note("look at the build").await;
    // The fake counts a line only when its `from-mode` is the mode the Agent was launched in.
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
        let delivered = run.seen().await;
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
        assert_eq!(run.seen().await, [id]);
    }
}

#[tokio::test]
async fn b3563c_all_senders_use_the_inbox_while_terminal_input_is_unsent() {
    for sender in ["user", "agent", "ext", "daemon"] {
        let mut run = Run::start().await;
        run.identify_sender(sender).await;
        run.draft("wip").await;
        let drafted = run.typed().await;
        let mut sent = Vec::new();
        for kind in ["note", "question"] {
            run.kind = kind;
            let body = format!("{sender} {kind}");
            let id = run.note(&body).await;
            until("the inbox entry", async || {
                (run.entries().len() == sent.len() + 1).then_some(())
            })
            .await;
            let entry = run.received().pop().unwrap();
            let content = entry["message"]["content"].as_str().unwrap();
            assert!(content.contains(&body), "{content}");
            assert_eq!(
                entry["msg_id"],
                format!("00000000-0000-4000-8000-{id:012x}")
            );
            let stored = run.message(id).await;
            assert_eq!(
                (stored["kind"].as_str(), stored["body"].as_str()),
                (Some(kind), Some(body.as_str()))
            );
            assert_eq!(stored["status"], "pending");
            assert_eq!(
                stored["from"]["kind"],
                if sender == "agent" {
                    "agent"
                } else {
                    stored["from"]["kind"].as_str().unwrap()
                }
            );
            assert_eq!(
                run.typed().await,
                drafted,
                "{sender} {kind}: Message bytes were typed"
            );
            run.record(&[id]).await;
            until("receipt", async || {
                (run.status(id).await.0 == "delivered").then_some(())
            })
            .await;
            run.signal(json!({"hook_event_name":"Stop"})).await;
            sent.push(id);
        }
        // Queued while busy, they go in id order at the next idle edge, still without a byte typed.
        run.signal(json!({"hook_event_name":"PreToolUse","tool_name":"Bash"}))
            .await;
        let (first, second) = (run.note("queued one").await, run.note("queued two").await);
        assert_eq!(run.entries().len(), sent.len());
        run.signal(json!({"hook_event_name":"Stop"})).await;
        sent.extend([first, second]);
        until("both queued entries", async || {
            (run.entries()
                == sent
                    .iter()
                    .map(|id| format!("rup-{id}"))
                    .collect::<Vec<_>>())
            .then_some(())
        })
        .await;
        assert_eq!(
            run.typed().await,
            drafted,
            "{sender}: queued Messages were typed"
        );
        run.record(&[first, second]).await;
        assert_eq!(run.seen().await, sent, "{sender}");
    }
}

#[tokio::test]
async fn b3563c_receipt_and_restart_preserve_each_message_once() {
    for (sender, kind) in [("user", "note"), ("ext", "question"), ("agent", "note")] {
        let mut run = Run::start().await;
        run.identify_sender(sender).await;
        run.kind = kind;
        let id = run.note("once").await;
        until("the inbox entry", async || {
            (run.entries() == [format!("rup-{id}")]).then_some(())
        })
        .await;
        for _ in 0..30 {
            run.idle_edge().await;
        }
        assert_eq!(run.entries(), [format!("rup-{id}")], "{sender} {kind}");
        assert_eq!(run.status(id).await, ("pending".into(), None));
        // The receipt alone delivers, and a repeated receipt is not a second delivery.
        run.record(&[id]).await;
        run.record(&[id]).await;
        until("delivered", async || {
            (run.status(id).await.0 == "delivered").then_some(())
        })
        .await;
        run.restart().await;
        run.idle_edge().await;
        assert_eq!(run.status(id).await.0, "delivered");
        assert!(
            run.entries().is_empty(),
            "an acknowledged Message was sent again"
        );
        let all = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        assert_eq!(all.as_array().unwrap().len(), 1, "no other Message");
        assert_eq!(run.typed().await, 0);
        assert!(run.seen().await.is_empty());
    }
}

#[tokio::test]
async fn b3563c_unavailable_inbox_keeps_pending_identity_and_reports_the_cause() {
    // (sender, kind, inbox failure, whether the Daemon restarts before the inbox recovers)
    for (sender, kind, mismatch, restart) in [
        ("user", "note", false, false),
        ("agent", "question", false, true),
        ("ext", "note", true, false),
        ("daemon", "question", true, true),
        ("user", "question", true, false),
        ("agent", "note", false, false),
        ("ext", "question", false, true),
        ("daemon", "note", true, true),
    ] {
        let case = format!("{sender} {kind} mismatch={mismatch} restart={restart}");
        let mut run = Run::start_on(if mismatch { 99 } else { 1 }).await;
        run.kind = kind;
        run.identify_sender(sender).await;
        let listed = if mismatch {
            Vec::new()
        } else {
            run.unlist_session().await
        };
        let ids = if mismatch {
            let (err, first) = run.refused_note("one").await;
            assert_eq!(err.code, rpc::code::INBOX_UNAVAILABLE, "{case}");
            assert_eq!(
                err.message, "Message pending: Claude Code changed its message format",
                "{case}"
            );
            let (_, second) = run.refused_note("two").await;
            vec![first, second]
        } else {
            vec![run.note("one").await, run.note("two").await]
        };
        assert!(ids[0] < ids[1], "{case}");
        let cause = if mismatch { "mismatch" } else { "missing" };
        until("the cause on the Rail", async || {
            (run.rail_inbox().await.as_deref() == Some(cause)).then_some(())
        })
        .await;
        for _ in 0..3 {
            run.idle_edge().await;
        }
        for id in &ids {
            assert_eq!(run.status(*id).await, ("pending".into(), None), "{case}");
        }
        assert!(
            run.entries().is_empty(),
            "{case}: written to an unavailable inbox"
        );
        assert_eq!(run.typed().await, 0, "{case}: fell back to the Terminal");
        assert!(run.seen().await.is_empty(), "{case}");
        if mismatch {
            // The transition is loud, once: the Rail is read again at each check, the log line is not.
            let log = std::fs::read_to_string(run.dir.path().join("rupd.err")).unwrap();
            let lines = log
                .lines()
                .filter(|line| line.contains("messaging protocol this build does not"))
                .count();
            assert_eq!(lines, 1, "{case}: {log}");
        }
        // B8, B46: a Daemon note waits for the resumed Agent; any other Message with no inbox
        // write made goes with the Attempt that does not survive.
        let waits = sender == "daemon" && kind == "note";
        if restart {
            run.restart().await;
        }
        if restart && !waits {
            for id in &ids {
                assert_eq!(
                    run.status(*id).await,
                    ("dropped".into(), Some("receiver gone".into())),
                    "{case}"
                );
            }
            assert!(run.entries().is_empty(), "{case}");
            assert_eq!(run.typed().await, 0, "{case}");
            continue;
        }
        if mismatch {
            run.repair_protocol();
        } else if !restart {
            run.relist_session(&listed);
        }
        run.idle_edge().await;
        until("both Messages in id order", async || {
            (run.entries() == ids.iter().map(|id| format!("rup-{id}")).collect::<Vec<_>>())
                .then_some(())
        })
        .await;
        assert_eq!(run.rail_inbox().await.as_deref(), Some("ok"), "{case}");
        assert_eq!(run.typed().await, 0, "{case}");
        for id in &ids {
            assert_eq!(run.status(*id).await.0, "pending", "{case}: receipt first");
        }
        assert!(run.seen().await.is_empty(), "{case}");
        run.record(&ids).await;
        until("both receipts", async || {
            (run.status(ids[0]).await.0 == "delivered" && run.status(ids[1]).await.0 == "delivered")
                .then_some(())
        })
        .await;
        assert_eq!(run.seen().await, ids, "{case}");
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
        run.seen().await,
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
                assert_eq!(run.seen().await, [id]);
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
            assert!(run.seen().await.is_empty());
        }
    }
}

#[path = "support/native_questions.rs"]
mod native_questions;
