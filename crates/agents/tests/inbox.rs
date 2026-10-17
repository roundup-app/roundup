//! B50, H21: the team mailbox of Claude Code 2.1.300 as `tests/fixtures/inbox/2.1.300/` records it.

use std::path::{Path, PathBuf};

use agents::claude_code::mailbox::{self, Team};
use serde_json::{Value, json};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/inbox/2.1.300")
        .join(name)
}

fn json_of(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// The entries of `inbox` without the time they were written.
fn untimed(mut entries: Value) -> Value {
    for entry in entries.as_array_mut().unwrap() {
        entry.as_object_mut().unwrap().remove("timestamp");
    }
    entries
}

fn team() -> (tempfile::TempDir, Team) {
    let dir = tempfile::tempdir().unwrap();
    let team = Team::of(dir.path(), Path::new("/data"), "7");
    team.prepare(Path::new("/work")).unwrap();
    (dir, team)
}

#[test]
fn h21_the_recorded_lead_inbox_holds_one_request_read_as_a_permission_payload() {
    let requests = mailbox::requests(&fixture("lead-inbox.json")).unwrap();
    assert_eq!(requests.len(), 1, "the idle notifications are not requests");
    assert_eq!(requests[0].id, "perm-1792260062313-4sv9igf");
    assert_eq!(
        requests[0].payload,
        json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "tool_input": {"command": "mkdir made", "description": "Make"},
            "tool_use_id": "toolu_x1",
        })
    );
}

#[test]
fn h21_an_allow_reply_is_answered_in_the_recorded_shape() {
    let (_dir, team) = team();
    let request = &mailbox::requests(&fixture("lead-inbox.json")).unwrap()[0];
    let allow = r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#;
    assert!(team.answer(request, allow).unwrap());
    let written = json_of(&team.inbox_of_agent());
    assert_eq!(
        untimed(written),
        untimed(json_of(&fixture("permission-response.json")))
    );
}

#[test]
fn h21_a_deny_reply_fails_the_call_and_a_reply_that_decides_nothing_writes_nothing() {
    let (_dir, team) = team();
    let request = &mailbox::requests(&fixture("lead-inbox.json")).unwrap()[0];
    let deny = r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied in roundup"}}}"#;
    assert!(!team.answer(request, "").unwrap());
    assert_eq!(json_of(&team.inbox_of_agent()), json!([]));
    assert!(team.answer(request, deny).unwrap());
    let entries = json_of(&team.inbox_of_agent());
    let answer: Value = serde_json::from_str(entries[0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(answer["subtype"], "error");
    assert_eq!(answer["error"], "Denied in roundup");
    assert_eq!(answer["request_id"], "perm-1792260062313-4sv9igf");
}

#[test]
fn b50_a_note_entry_has_the_recorded_shape_and_follows_the_entries_before_it() {
    let (_dir, team) = team();
    team.deliver(mailbox::DAEMON, "earlier", None).unwrap();
    team.deliver(mailbox::DAEMON, "hello from the inbox", Some("hi"))
        .unwrap();
    let written = json_of(&team.inbox_of_agent());
    assert_eq!(written[0]["text"], "earlier");
    assert_eq!(
        untimed(json!([written[1]])),
        untimed(json_of(&fixture("note.json")))
    );
    assert!(
        written[1]["timestamp"].as_str().unwrap().ends_with('Z'),
        "an RFC 3339 time in UTC, as the recorded entries"
    );
}

#[test]
fn h21_a_team_is_started_as_the_leads_teammate_and_an_attempt_starts_with_empty_inboxes() {
    let (_dir, team) = team();
    let argv = team.argv();
    assert_eq!(
        [&argv[0], &argv[2], &argv[4]],
        ["--agent-id", "--agent-name", "--team-name"]
    );
    assert_eq!(argv[1], format!("{}@{}", argv[3], argv[5]));
    let config = json_of(
        &team
            .lead_inbox()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("config.json"),
    );
    assert_eq!(config["leadAgentId"], format!("team-lead@{}", argv[5]));
    team.deliver(mailbox::DAEMON, "left over", None).unwrap();
    team.prepare(Path::new("/work")).unwrap();
    assert_eq!(json_of(&team.inbox_of_agent()), json!([]));
    assert_eq!(json_of(&team.lead_inbox()), json!([]));
}
