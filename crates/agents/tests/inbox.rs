//! B50, B51: the adapter's side of Claude Code's messaging socket, against the recorded fixtures
//! of `fixtures/inbox/<version>/`, one per Claude Code version recorded from the real program. A
//! new version needs a fixture only when its session file or transcript differs; the real round
//! trip is proved by the e2e tests that run the pinned `claude`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};

use agents::claude_code::Launcher;
use agents::claude_code::inbox::{Entry, recorded};
use contracts::agent::Inbox;
use serde_json::Value;

/// The Claude Code versions a fixture was recorded from.
const VERSIONS: [&str; 2] = ["2.1.300", "2.1.302"];

fn fixtures(version: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/inbox")
        .join(version)
}

/// A Launcher and the config folder it looks for sessions in.
fn launcher() -> (Launcher, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("claude");
    std::fs::write(&bin, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    let launcher = Launcher::new(
        bin.to_string_lossy(),
        dir.path().join("claude.json"),
        PathBuf::from("rup"),
        None,
    );
    (launcher, dir)
}

/// What Claude Code does for Agent `a` at launch: listens on its socket and lists the session
/// with its token, as the recorded `session.json` and `session.key` do.
fn session(launcher: &Launcher, config: &Path, version: &str) -> UnixListener {
    listed(launcher, config, version, std::process::id(), |json| json)
}

/// `session` of `version`, listed under `pid` with its session file passed through `edit`.
fn listed(
    launcher: &Launcher,
    config: &Path,
    version: &str,
    pid: u32,
    edit: impl FnOnce(String) -> String,
) -> UnixListener {
    listed_for("a", launcher, config, version, pid, edit)
}

fn listed_for(
    agent: &str,
    launcher: &Launcher,
    config: &Path,
    version: &str,
    pid: u32,
    edit: impl FnOnce(String) -> String,
) -> UnixListener {
    let socket = launcher.socket_path(agent).unwrap();
    let listener = UnixListener::bind(&socket).unwrap();
    let sessions = config.join("sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    let json = std::fs::read_to_string(fixtures(version).join("session.json")).unwrap();
    std::fs::write(
        sessions.join("69890.json"),
        edit(
            json.replace("SOCKET", &socket.to_string_lossy())
                .replace("PID", &pid.to_string()),
        ),
    )
    .unwrap();
    std::fs::copy(
        fixtures(version).join("session.key"),
        sessions.join("69890.78f995701ed0.key"),
    )
    .unwrap();
    listener
}

fn note(id: u32, text: &str, one_line: bool) -> Entry {
    Entry {
        id,
        kind: contracts::message::MessageKind::Note,
        from: "rupd".into(),
        text: text.into(),
        one_line,
    }
}

/// The lines one connection sends, as JSON.
fn lines(listener: &UnixListener) -> Vec<Value> {
    let (stream, _) = listener.accept().unwrap();
    BufReader::new(stream)
        .lines()
        .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
        .collect()
}

#[test]
fn b51_a_killed_session_left_listed_is_missing() {
    let (launcher, dir) = launcher();
    let mut gone = std::process::Command::new("true").spawn().unwrap();
    let pid = gone.id();
    gone.wait().unwrap();
    let _listener = listed(&launcher, dir.path(), "2.1.302", pid, |json| json);
    assert_eq!(launcher.inbox_check("a"), Inbox::Missing);
}

#[test]
fn b51_a_session_listing_the_recorded_protocol_is_ok_on_every_recorded_version() {
    for version in VERSIONS {
        let (launcher, dir) = launcher();
        let _listener = session(&launcher, dir.path(), version);
        assert_eq!(launcher.inbox_check("a"), Inbox::Ok, "{version}");
    }
}

#[test]
fn b51_a_session_listing_another_protocol_or_none_is_a_mismatch() {
    for edit in [
        (|json: String| json.replace("\"peerProtocol\":1", "\"peerProtocol\":2"))
            as fn(String) -> String,
        |json| json.replace("\"peerProtocol\":1,", ""),
    ] {
        let (launcher, dir) = launcher();
        let _listener = listed(&launcher, dir.path(), "2.1.302", std::process::id(), edit);
        assert_eq!(launcher.inbox_check("a"), Inbox::Mismatch);
    }
}

#[tokio::test]
async fn b50_a_note_is_an_auth_line_then_one_labelled_line_in_the_launch_permission_mode() {
    for version in VERSIONS {
        let (launcher, dir) = launcher();
        let listener = session(&launcher, dir.path(), version);
        launcher
            .inbox_write(
                "a",
                &[note(7, "look", false), note(8, "again", false)],
                false,
            )
            .unwrap();
        let sent = lines(&listener);
        let key: Value =
            serde_json::from_slice(&std::fs::read(fixtures(version).join("session.key")).unwrap())
                .unwrap();
        assert_eq!(sent[0]["type"], "auth");
        assert_eq!(sent[0]["token"], key["peerToken"], "{version}");
        assert_eq!(sent.len(), 3, "one line per note");
        assert_eq!(sent[1]["msg_id"], "00000000-0000-4000-8000-000000000007");
        assert_eq!(sent[2]["msg_id"], "00000000-0000-4000-8000-000000000008");
        let content = sent[1]["message"]["content"].as_str().unwrap();
        assert!(
            content.starts_with("<cross-session-message from=\"uds:")
                && content.contains(
                    "from-name=\"rupd\" from-mode=\"default\">\nlook\n</cross-session-message>"
                ),
            "{content}"
        );
        assert_eq!(
            (&sent[1]["type"], &sent[1]["priority"]),
            (&"user".into(), &"next".into())
        );
    }
}

#[tokio::test]
async fn b50_a_long_note_shows_as_one_line() {
    let (launcher, dir) = launcher();
    let listener = session(&launcher, dir.path(), "2.1.302");
    let long = format!("[digest] {}", "é".repeat(300));
    launcher
        .inbox_write("a", &[note(1, &long, true), note(2, &long, false)], false)
        .unwrap();
    let sent = lines(&listener);
    let body = |line: &Value| {
        let content = line["message"]["content"].as_str().unwrap();
        content.split('\n').nth(1).unwrap().to_owned()
    };
    let (cut, whole) = (body(&sent[1]), body(&sent[2]));
    assert!(cut.len() <= 200 && cut.ends_with("[cut]"), "{cut}");
    assert_eq!(whole, long, "only a [wake] or [digest] note is cut");
}

#[test]
fn b50_the_transcript_records_a_note_as_a_peer_message_under_its_msg_id() {
    // A note carries the msg_id it was sent under, as a user entry between turns (7) and as a
    // queued attachment mid-turn (11); the 2.1.300 fixture also holds the user's own prompt, which
    // carries no origin.
    for version in VERSIONS {
        let transcript = fixtures(version).join("transcript.jsonl");
        assert_eq!(recorded(&transcript, 0).0, [7, 11], "{version}");
    }
    let transcript = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(transcript.path(), concat!(
        "{\"origin\":{},\"attachment\":{\"origin\":{\"kind\":\"peer\",\"msg_id\":\"00000000-0000-4000-8000-000000000007\"}}}\n",
        "{\"origin\":null,\"attachment\":{\"origin\":{\"kind\":\"peer\",\"msg_id\":\"00000000-0000-4000-8000-00000000000b\"}}}\n"
    )).unwrap();
    assert_eq!(recorded(transcript.path(), 0).0, [11]);
}

#[test]
fn b50_a_transcript_is_read_from_where_it_was_left() {
    let transcript = tempfile::NamedTempFile::new().unwrap();
    let line = |id: u32| {
        format!(
            "{{\"origin\":{{\"kind\":\"peer\",\"msg_id\":\"00000000-0000-4000-8000-{id:012x}\"}}}}\n"
        )
    };
    std::fs::write(
        transcript.path(),
        format!("{}{}", line(1), line(2).trim_end()),
    )
    .unwrap();
    let (ids, offset) = recorded(transcript.path(), 0);
    assert_eq!(ids, [1], "a line not yet complete waits");
    std::fs::write(
        transcript.path(),
        format!("{}{}{}", line(1), line(2), line(3)),
    )
    .unwrap();
    let (ids, end) = recorded(transcript.path(), offset);
    assert_eq!(ids, [2, 3]);
    assert_eq!(recorded(transcript.path(), end), (vec![], end));
    assert_eq!(recorded(transcript.path(), 0).0, [1, 2, 3]);
}

// B50(b,d): rejects losing question/reply identity or applying the digest display cut.
#[test]
fn b50_a_question_carries_kind_and_reply_id_in_the_peer_entry() {
    for version in VERSIONS {
        let (launcher, dir) = launcher();
        let listener = session(&launcher, dir.path(), version);
        let text = format!("[digest] {}", "é".repeat(300));
        let mut question = note(17, &text, true);
        question.kind = contracts::message::MessageKind::Question;
        launcher.inbox_write("a", &[question], false).unwrap();
        let sent = lines(&listener);
        let content = sent[1]["message"]["content"].as_str().unwrap();
        assert!(
            content.contains(&format!("[question, replyTo: 17] {text}\n")),
            "{content}"
        );
        assert_eq!(sent[1]["msg_id"], "00000000-0000-4000-8000-000000000011");
    }
}

#[tokio::test]
async fn b2706_note_mode_is_the_users_default_mode() {
    let user = |mode: &str| format!(r#"{{"permissions":{{"defaultMode":"{mode}"}}}}"#);
    // (user layer, project layer, local layer, the mode a note names)
    type Row = (Option<String>, Option<String>, Option<String>, &'static str);
    let table: [Row; 8] = [
        (Some(user("acceptEdits")), None, None, "acceptEdits"),
        (Some(user("plan")), None, None, "plan"),
        (Some(user("auto")), None, None, "auto"),
        (Some(user("default")), None, None, "default"),
        (Some(user("bypassPermissions")), None, None, "default"),
        (None, None, None, "default"),
        (
            Some(user("plan")),
            Some(user("acceptEdits")),
            None,
            "acceptEdits",
        ),
        (
            Some(user("plan")),
            Some(user("acceptEdits")),
            Some(user("auto")),
            "auto",
        ),
    ];
    use contracts::agent::PermissionMode;
    for (user_layer, project_layer, local_layer, inherited) in table {
        for (selected, want) in [
            (None, inherited),
            (Some(PermissionMode::Default), "default"),
            (Some(PermissionMode::AcceptEdits), "acceptEdits"),
            (Some(PermissionMode::Plan), "plan"),
            (Some(PermissionMode::Auto), "auto"),
        ] {
            let (_, dir) = launcher();
            let launcher = Launcher::new(
                "claude",
                dir.path().join("claude.json"),
                dir.path().join("rup"),
                None,
            );
            std::fs::write(dir.path().join("rup"), "").unwrap();
            let project = dir.path().join("proj");
            let data = project.join(".roundup");
            std::fs::create_dir_all(project.join(".claude")).unwrap();
            std::fs::create_dir_all(&data).unwrap();
            for (file, body) in [
                (dir.path().join("settings.json"), user_layer.clone()),
                (project.join(".claude/settings.json"), project_layer.clone()),
                (
                    project.join(".claude/settings.local.json"),
                    local_layer.clone(),
                ),
            ] {
                if let Some(body) = body {
                    std::fs::write(file, body).unwrap();
                }
            }
            let folders = agents::claude_code::Folders {
                project: &project,
                data: &data,
            };
            launcher
                .prepare_on(&agents::claude_code::Request {
                    folders,
                    id: "7",
                    attempt: "1",
                    cwd: &project,
                    resume: None,
                    role: agents::claude_code::Role::Agent,
                    facts: &agents::claude_code::LaunchFacts {
                        permission: selected.into(),
                        ..Default::default()
                    },
                })
                .unwrap();
            let listener = listed_for(
                "7",
                &launcher,
                dir.path(),
                "2.1.302",
                std::process::id(),
                |j| j,
            );
            launcher
                .inbox_write("7", &[note(7, "look", false)], false)
                .unwrap();
            let content = lines(&listener)[1]["message"]["content"].clone();
            assert!(
                content
                    .as_str()
                    .unwrap()
                    .contains(&format!("from-mode=\"{want}\">")),
                "{want}: {content}"
            );
        }
    }
}

#[test]
fn b5763a_rendered_content_preserves_peer_comparison_identity() {
    let sender = "uds:/tmp/rup-fixture/rupd";
    let first = note(41, "same", false);
    let second = note(42, "same", false);
    assert_eq!(
        first.content(sender, "default"),
        second.content(sender, "default")
    );
    assert_eq!(
        first.content(sender, "default"),
        "<cross-session-message from=\"uds:/tmp/rup-fixture/rupd\" from-name=\"rupd\" from-mode=\"default\">\nsame\n</cross-session-message>"
    );
    assert_ne!(
        first.content(sender, "default"),
        first.content(sender, "plan")
    );
    let mut renamed = note(43, "same", false);
    renamed.from = "different".into();
    assert_ne!(
        first.content(sender, "default"),
        renamed.content(sender, "default")
    );
    let long = format!("[digest] {}", "é".repeat(150));
    assert_eq!(
        note(44, &(long.clone() + "a"), true).content(sender, "default"),
        note(45, &(long + "b"), true).content(sender, "default")
    );
    let mut question = note(46, "same", false);
    question.kind = contracts::message::MessageKind::Question;
    let before = question.content(sender, "default");
    question.id = 47;
    assert_ne!(before, question.content(sender, "default"));
}

struct RecordedRail;

#[async_trait::async_trait]
impl rpc::Module for RecordedRail {
    fn namespaces(&self) -> &'static [&'static str] {
        &["rail"]
    }
    async fn call(&self, _: &rpc::Ctx, method: &str, _: Value) -> Result<Value, rpc::RpcError> {
        assert_eq!(method, "rail.tree");
        Ok(serde_json::json!([{
            "id":"receiver", "kind":"agent", "name":"receiver", "parent":null,
            "order":0, "status":{"kind":"idle","label":"","since":0,"finished":"0"},
            "attempt":"1", "status_revision":"1", "terminal_id":"test-terminal",
            "worktree":null,"can_resume":false,"channel":null,"work":null,
            "stray":[],"model":null,"effort":null
        }]))
    }
}

struct RecordedInbox {
    envelopes: Vec<Value>,
    written: std::sync::Mutex<Vec<u32>>,
}

#[async_trait::async_trait]
impl messages::NoteInbox for RecordedInbox {
    async fn check(&self, _: &str) -> Inbox {
        Inbox::Ok
    }
    fn session(&self, _: &str) -> Option<String> {
        Some("recorded-session".into())
    }
    fn content(&self, _: &str, entry: &Entry) -> Result<String, Inbox> {
        let envelope = &self.envelopes[entry.id as usize - 1];
        let recorded = envelope["message"]["content"].as_str().unwrap();
        let name = recorded
            .split("from-name=\"")
            .nth(1)
            .unwrap()
            .split('"')
            .next()
            .unwrap();
        let rendered = Entry {
            id: entry.id,
            kind: entry.kind,
            from: name.into(),
            text: entry.text.clone(),
            one_line: entry.one_line,
        }
        .content(envelope["from"].as_str().unwrap(), "default");
        assert_eq!(rendered, recorded);
        Ok(rendered)
    }
    fn write(&self, _: &str, entries: &[Entry]) -> Result<(), Inbox> {
        self.written
            .lock()
            .unwrap()
            .extend(entries.iter().map(|e| e.id));
        Ok(())
    }
}

#[tokio::test(start_paused = true)]
async fn b5763a_recorded_peer_repeats_match_the_inbox_rule() {
    use rpc::Module;
    use std::sync::Arc;
    for version in ["2.1.302", "2.1.316"] {
        let fixture: Value = serde_json::from_str(
            &std::fs::read_to_string(fixtures(version).join("repeats.json")).unwrap(),
        )
        .unwrap();
        let envelopes: Vec<Value> = fixture["operations"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|op| op.get("envelope").cloned())
            .filter(|e| e["from"] == "uds:/tmp/rup-fixture/rupd")
            .collect();
        let expected: Vec<u32> = envelopes
            .iter()
            .enumerate()
            .filter(|(_, envelope)| {
                fixture["admittedIds"]
                    .as_array()
                    .unwrap()
                    .contains(&envelope["msg_id"])
            })
            .map(|(i, _)| u32::try_from(i + 1).unwrap())
            .collect();
        let inbox = Arc::new(RecordedInbox {
            envelopes,
            written: Default::default(),
        });
        let dir = tempfile::tempdir().unwrap();
        let bus = rpc::Bus::new();
        let messages =
            messages::Messages::open(dir.path(), bus.clone(), Arc::new(RecordedRail)).unwrap();
        messages.set_inbox(inbox.clone());
        let ctx = rpc::Ctx {
            actor: contracts::Actor::user(),
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            bus,
        };
        for (index, envelope) in inbox.envelopes.iter().enumerate() {
            let content = envelope["message"]["content"].as_str().unwrap();
            let text = content
                .split_once('\n')
                .unwrap()
                .1
                .rsplit_once('\n')
                .unwrap()
                .0;
            let result = messages
                .call(
                    &ctx,
                    "message.send",
                    serde_json::json!({"to":"receiver","kind":"note","body":text}),
                )
                .await
                .unwrap();
            let id = u32::try_from(index + 1).unwrap();
            assert_eq!(result["id"], id);
            let message = messages
                .call(&ctx, "message.get", serde_json::json!({"id":id}))
                .await
                .unwrap();
            assert_eq!(message["body"], text);
            if expected.contains(&id) {
                assert_eq!(message["status"], "pending");
                assert!(message["reason"].is_null());
            } else {
                assert_eq!(message["status"], "delivered");
                assert_eq!(message["reason"], "repeat of last inbox entry");
            }
            let prefix: Vec<u32> = expected
                .iter()
                .copied()
                .filter(|sent| *sent <= id)
                .collect();
            assert_eq!(
                *inbox.written.lock().unwrap(),
                prefix,
                "{version}, entry {id}"
            );
        }
    }
}

// Rejects receipt-only or Message-id ordering as the source of legacy peer history.
#[test]
fn b5763c_legacy_history_uses_the_last_admitted_rupd_entry_in_its_session() {
    let path = fixtures("2.1.302").join("transcript.jsonl");
    let session = "77e8d837-17fb-4103-9626-145fd3dec0c4";
    let last = agents::claude_code::inbox::previous(&path, session, "uds:/tmp/rup-x/rupd")
        .unwrap()
        .unwrap();
    assert!(last.contains("say only BRAVO"));
    assert!(!last.contains("slow"));
    assert_eq!(
        agents::claude_code::inbox::previous(&path, "another-session", "uds:/tmp/rup-x/rupd")
            .unwrap(),
        None
    );
    assert_eq!(
        agents::claude_code::inbox::previous(&path, session, "uds:/another-peer").unwrap(),
        None
    );
}
