//! ST2: a resume writes the same file the first launch did, whoever resumes.

use serde_json::{Value, json};

use super::CONVERSATION;
use crate::common::Fixture;

fn file_of(f: &Fixture, id: &str) -> Value {
    let path = agents::claude_code::settings_marker(f.dir.path(), id).unwrap();
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

/// The file with the Attempt of its hook commands taken out.
fn without_attempt(file: Value) -> Value {
    let text = file.to_string();
    let mut out = String::new();
    let mut rest = text.as_str();
    while let Some(at) = rest.find("ROUNDUP_ATTEMPT=") {
        let end = at + "ROUNDUP_ATTEMPT=".len();
        out.push_str(&rest[..end]);
        rest = rest[end..].trim_start_matches(|c: char| c.is_ascii_digit());
    }
    out.push_str(rest);
    serde_json::from_str(&out).unwrap()
}

async fn started(f: &Fixture, settings: Option<Value>) -> String {
    let cwd = f.dir.path().to_string_lossy().into_owned();
    let mut params = json!({"cwd": cwd});
    if let Some(settings) = settings {
        params["settings"] = settings;
    }
    let node: contracts::agent::RailNode =
        serde_json::from_value(f.call("agent.spawn", params).await.unwrap()).unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    node.id.clone()
}

async fn stop_and_resume(f: &Fixture, id: &str, params: Value) -> Result<Value, rpc::RpcError> {
    f.call("agent.stop", json!({"id": id})).await.unwrap();
    let resuming = f.call("agent.resume", params);
    let old = f.attempt(id).await;
    let pending = async {
        f.until_attempt_changed(id, &old).await;
        f.session_start(id, CONVERSATION, "resume").await.unwrap();
    };
    let (resumed, ()) = tokio::join!(resuming, pending);
    resumed
}

fn theirs() -> Value {
    json!({
        "env": {"ONE": "1"},
        "permissions": {"deny": ["Bash(rm:*)"]},
        "enabledPlugins": {"p@m": true},
        "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]},
    })
}

#[tokio::test]
async fn st2_a_resume_writes_the_same_file_whoever_resumes() {
    let f = Fixture::running("sleep 30");
    let id = started(&f, Some(theirs())).await;
    let first = file_of(&f, &id);
    assert_eq!(first["env"]["ONE"], "1");
    stop_and_resume(&f, &id, json!({"id": id})).await.unwrap();
    let again = file_of(&f, &id);
    assert_ne!(first, again, "the Attempt in the hook command moved on");
    assert_eq!(without_attempt(first), without_attempt(again));
}

#[tokio::test]
async fn st2_the_settings_survive_a_daemon_restart() {
    let f = Fixture::running("sleep 30");
    let id = started(&f, Some(theirs())).await;
    let first = file_of(&f, &id);
    f.call("agent.stop", json!({"id": id})).await.unwrap();
    let f = f.reopen();
    let old = f.attempt(&id).await;
    let resuming = f.call("agent.resume", json!({"id": id}));
    let pending = async {
        f.until_attempt_changed(&id, &old).await;
        f.session_start(&id, CONVERSATION, "resume").await.unwrap();
    };
    let (resumed, ()) = tokio::join!(resuming, pending);
    resumed.unwrap();
    assert_eq!(without_attempt(first), without_attempt(file_of(&f, &id)));
}

#[tokio::test]
async fn st2_a_resume_takes_and_changes_no_settings() {
    let f = Fixture::running("sleep 30");
    let kept = started(&f, Some(theirs())).await;
    let first = file_of(&f, &kept);
    let other = json!({"env": {"TWO": "2"}});
    stop_and_resume(&f, &kept, json!({"id": kept, "settings": other}))
        .await
        .unwrap();
    let again = file_of(&f, &kept);
    assert!(again["env"].get("TWO").is_none());
    assert_eq!(without_attempt(first), without_attempt(again));

    let none = started(&f, None).await;
    stop_and_resume(&f, &none, json!({"id": none}))
        .await
        .unwrap();
    let file = file_of(&f, &none);
    assert!(file["env"].get("ONE").is_none());
    assert!(file["permissions"].get("deny").is_none());
}
