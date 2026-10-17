//! B50, B51: the adapter's side of Claude Code's inbox, against the recorded fixtures of
//! `fixtures/inbox/<version>/`. Re-record them from the real Claude Code when its version changes.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use agents::claude_code::Launcher;
use agents::claude_code::inbox::{Entry, recorded};
use contracts::agent::Inbox;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/inbox/2.1.296");

/// A Launcher whose `claude` prints `version`, and the config folder it keeps its inbox in.
fn launcher(version: &str) -> (Launcher, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("claude");
    std::fs::write(&bin, format!("#!/bin/sh\necho '{version} (Claude Code)'\n")).unwrap();
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    let launcher = Launcher::new(
        bin.to_string_lossy(),
        dir.path().join("claude.json"),
        PathBuf::from("rup"),
        None,
    );
    (launcher, dir)
}

fn inbox_file(config: &Path, agent: &str) -> PathBuf {
    config
        .join("teams/roundup/inboxes")
        .join(format!("{agent}.json"))
}

fn install(config: &Path, fixture: &str) -> PathBuf {
    let path = inbox_file(config, "a");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::copy(Path::new(FIXTURES).join(fixture), &path).unwrap();
    path
}

fn note(id: u32, text: &str, one_line: bool) -> Entry {
    Entry {
        id,
        from: "rupd".into(),
        text: text.into(),
        one_line,
    }
}

fn texts(path: &Path) -> Vec<(String, String)> {
    let entries: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    entries
        .iter()
        .map(|e| {
            (
                e["id"].as_str().unwrap().into(),
                e["text"].as_str().unwrap().into(),
            )
        })
        .collect()
}

#[tokio::test]
async fn b51_an_inbox_in_the_recorded_format_passes() {
    let (launcher, dir) = launcher("2.1.296");
    install(dir.path(), "ok.json");
    assert_eq!(launcher.inbox_check("a").await, Inbox::Ok);
}

#[tokio::test]
async fn b51_a_missing_inbox_is_missing_and_nothing_is_written() {
    let (launcher, dir) = launcher("2.1.296");
    // `teams` is a file, so the inbox can neither be found nor created.
    std::fs::write(dir.path().join("teams"), "x").unwrap();
    assert_eq!(launcher.inbox_check("a").await, Inbox::Missing);
    assert_eq!(
        launcher.inbox_write("a", &[note(1, "hi", false)]),
        Err(Inbox::Missing)
    );
}

#[tokio::test]
async fn b51_a_mismatched_format_is_a_mismatch_and_the_file_is_untouched() {
    for fixture in ["no-read-field.json", "unparsable.json", "not-an-array.json"] {
        let (launcher, dir) = launcher("2.1.296");
        let path = install(dir.path(), fixture);
        let before = std::fs::read(&path).unwrap();
        assert_eq!(
            launcher.inbox_check("a").await,
            Inbox::Mismatch,
            "{fixture}"
        );
        assert_eq!(
            launcher.inbox_write("a", &[note(1, "hi", false)]),
            Err(Inbox::Mismatch),
            "{fixture}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before, "{fixture}");
    }
}

#[tokio::test]
async fn b51_an_unknown_claude_version_is_a_mismatch() {
    let (launcher, dir) = launcher("9.9.9");
    install(dir.path(), "ok.json");
    assert_eq!(launcher.inbox_check("a").await, Inbox::Mismatch);
}

#[tokio::test]
async fn b50_a_note_is_one_entry_per_id_however_often_it_is_written() {
    let (launcher, dir) = launcher("2.1.296");
    let path = install(dir.path(), "ok.json");
    for _ in 0..3 {
        launcher
            .inbox_write("a", &[note(7, "look", false)])
            .unwrap();
    }
    assert_eq!(
        texts(&path),
        [
            ("seed-1".into(), "hello".into()),
            ("rup-7".into(), "look".into())
        ]
    );
}

#[tokio::test]
async fn b50_a_long_note_shows_as_one_line() {
    let (launcher, dir) = launcher("2.1.296");
    let path = install(dir.path(), "ok.json");
    let long = format!("[digest] {}", "é".repeat(300));
    launcher
        .inbox_write("a", &[note(1, &long, true), note(2, &long, false)])
        .unwrap();
    let written = texts(&path);
    assert!(
        written[1].1.len() <= 200 && written[1].1.ends_with("[cut]"),
        "{}",
        written[1].1
    );
    assert_eq!(written[2].1, long, "only a [wake] or [digest] note is cut");
}

#[test]
fn b50_the_transcript_records_a_note_as_another_sessions_message() {
    let transcript = Path::new(FIXTURES).join("transcript.jsonl");
    // The user's prompt is a `user` entry and carries no id; the note is its own entry type.
    assert_eq!(recorded(&transcript, 0).0, [7]);
}

#[test]
fn b50_a_transcript_is_read_from_where_it_was_left() {
    let transcript = tempfile::NamedTempFile::new().unwrap();
    let line = |id: u32| format!("{{\"type\":\"teammate_message\",\"id\":\"rup-{id}\"}}\n");
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
    assert_eq!(recorded(transcript.path(), offset).0, [2, 3]);
}
