//! M5159b, M5159c: roundup keeps no Checkpoints; a Door's rewind goes to each provider's own feature.

use std::path::PathBuf;

use super::*;

const TURN: &str = "11111111-2222-4333-8444-555555555555";
/// The conversation the fake `claude` names in its first SessionStart.
const SESSION: &str = "00000000-0000-4000-8000-000000000146";

fn lines(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

struct Rewinding {
    fx: common::NamedRail,
    door: Shim,
    log: PathBuf,
    typed: PathBuf,
    _dir: tempfile::TempDir,
}

async fn rewinding(fails: bool) -> Rewinding {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("rewind.log");
    let typed = dir.path().join("typed.log");
    let (log_env, typed_env) = (log.to_str().unwrap(), typed.to_str().unwrap());
    let mut env = vec![
        ("FAKE_CLAUDE_REWIND_LOG", log_env),
        ("FAKE_CLAUDE_PROMPT_LOG", typed_env),
    ];
    if fails {
        env.push(("FAKE_CLAUDE_REWIND_FAILS", "1"));
    }
    let fx = common::NamedRail::start_with(&env).await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    Rewinding {
        fx,
        door,
        log,
        typed,
        _dir: dir,
    }
}

#[tokio::test]
async fn m5159b_rewind_selection_is_the_doors_children() {
    let r = rewinding(false).await;
    let child = &r.fx.child;
    for (turns, why) in [
        (json!([]), "no child"),
        (
            json!([{"agent": r.fx.door, "turn": TURN}]),
            "the Door itself",
        ),
        (
            json!([{"agent": "a99", "turn": TURN}]),
            "an Agent that is gone",
        ),
        (
            json!([{"agent": child, "turn": TURN}, {"agent": child, "turn": TURN}]),
            "a child named twice",
        ),
        (
            json!([{"agent": child, "turn": TURN}, {"agent": r.fx.door, "turn": TURN}]),
            "one valid child beside an invalid one",
        ),
    ] {
        let result = r
            .door
            .call("workstream_rewind", json!({"turns": turns}))
            .await;
        assert_eq!(result.is_error, Some(true), "{why}: {result:?}");
    }
    assert!(
        lines(&r.log).is_empty(),
        "a refused selection rewinds nothing"
    );
}

#[tokio::test]
async fn m5159b_rewind_reaches_the_providers_native_rewind() {
    let r = rewinding(false).await;
    let typed_before = lines(&r.typed);
    let result = r
        .door
        .call(
            "workstream_rewind",
            json!({"turns": [{"agent": r.fx.child, "turn": TURN}]}),
        )
        .await;
    assert_eq!(result.is_error, Some(false), "{result:?}");
    let told = text(&result);
    assert_eq!(told["agents"][0]["state"], "rewound", "{told}");
    let received = lines(&r.log);
    assert_eq!(received.len(), 1, "{received:?}");
    assert_eq!(
        received[0]["argv"],
        json!(["--resume", SESSION, "--rewind-files", TURN])
    );
    assert_eq!(received[0]["checkpointing"], "1");
    assert_eq!(
        lines(&r.typed),
        typed_before,
        "the Terminal received no input"
    );
}

#[tokio::test]
async fn m5159b_the_door_is_told_each_outcome() {
    let r = rewinding(true).await;
    let result = r
        .door
        .call(
            "workstream_rewind",
            json!({"turns": [
                {"agent": r.fx.child, "turn": TURN},
                {"agent": r.fx.peer, "turn": TURN},
            ]}),
        )
        .await;
    assert_eq!(result.is_error, Some(false), "{result:?}");
    let agents = text(&result)["agents"].as_array().unwrap().clone();
    assert_eq!(agents.len(), 2);
    for (told, name) in agents.iter().zip(["Writer", "Reviewer"]) {
        assert_eq!(told["name"], name);
        assert_eq!(told["state"], "failed");
        assert_eq!(told["reason"], "No file checkpoint found for that message");
    }
}

#[tokio::test]
async fn m5159c_no_checkpoint_surface_remains() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("none.sock");
    let _server = m17_daemon(&socket, Value::Null);
    let shim = spawn_shim(&socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();
    let methods: Vec<_> = contracts::methods::METHODS.iter().map(|m| m.name).collect();
    for gone in [
        "checkpoint_write",
        "checkpoint_list",
        "workstream_rewindPlan",
    ] {
        assert!(tools.iter().all(|tool| tool.name != gone), "{gone}");
    }
    for gone in [
        "checkpoint.write",
        "checkpoint.list",
        "workstream.rewindPlan",
    ] {
        assert!(!methods.contains(&gone), "{gone}");
    }
}
