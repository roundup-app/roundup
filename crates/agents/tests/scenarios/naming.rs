//! A9 a first prompt names its Agent.

use contracts::agent::RailNode;
use serde_json::json;

use crate::common::{Fixture, hold_starts, release};

impl Fixture {
    async fn submit(&self, id: &str, prompt: &str) {
        let payload = json!({"hook_event_name": "UserPromptSubmit", "prompt": prompt});
        self.call(
            "agent.signal",
            json!({"id": id, "attempt": self.attempt(id).await, "payload": payload}),
        )
        .await
        .unwrap();
    }

    async fn name_of(&self, id: &str) -> String {
        let tree: Vec<RailNode> = self.tree().await;
        tree.into_iter().find(|n| n.id == id).unwrap().name
    }
}

#[tokio::test]
async fn a4452b_first_user_message_is_the_users_words() {
    let mut f = Fixture::running("sleep 30");
    let node = f
        .spawn(None, Some("roundup coordination must not name this agent"))
        .await
        .unwrap();
    assert_eq!(node.name, "new-agent");
    f.changed();

    f.submit(&node.id, "Fix the refresh race in token.ts").await;

    assert_eq!(f.name_of(&node.id).await, "fix-refresh-race");
    assert_eq!(f.changed(), 1);
}

#[tokio::test]
async fn a9_later_prompts_never_rename_the_agent() {
    let mut f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    f.submit(&node.id, "fix the build").await;
    f.changed();

    f.submit(&node.id, "now write the docs").await;

    assert_eq!(f.name_of(&node.id).await, "fix-build");
    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn a9_a_prompt_with_no_words_left_keeps_the_name_and_still_counts_as_the_first() {
    let mut f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    f.changed();

    f.submit(&node.id, "please, the...").await;
    f.submit(&node.id, "fix the build").await;

    assert_eq!(f.name_of(&node.id).await, "new-agent");
    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn a9_a_rename_before_the_first_prompt_wins() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    f.call("rail.rename", json!({"id": node.id, "name": "mine"}))
        .await
        .unwrap();

    f.submit(&node.id, "fix the build").await;

    assert_eq!(f.name_of(&node.id).await, "mine");
}

#[tokio::test]
async fn a9_a_door_keeps_its_workstreams_name() {
    let f = Fixture::running("sleep 30");
    let team = f.workstream("team", None).await;
    f.call("rail.startDoor", json!({"id": team})).await.unwrap();

    f.submit(&team, "fix the build").await;

    assert_eq!(f.name_of(&team).await, "team");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a9_a_rename_while_the_agent_is_still_starting_wins_over_the_first_prompt() {
    let f = std::sync::Arc::new(Fixture::running("sleep 30"));
    let config = hold_starts(&f);
    let spawning = {
        let f = std::sync::Arc::clone(&f);
        tokio::spawn(async move { f.spawn(None, None).await })
    };
    let tree = f.until(|t| !t.is_empty()).await;
    let id = tree[0].id.clone();
    f.call("rail.rename", json!({"id": id, "name": "mine"}))
        .await
        .unwrap();
    release(config).await;
    spawning.await.unwrap().unwrap();

    f.submit(&id, "fix the build").await;

    assert_eq!(f.name_of(&id).await, "mine");
}

#[tokio::test]
async fn u176_agents_with_one_prompt_are_numbered_among_their_siblings() {
    let f = Fixture::running("sleep 30");
    let mut names = Vec::new();
    for _ in 0..3 {
        let node = f.spawn(None, None).await.unwrap();
        f.submit(&node.id, "what should this do").await;
        names.push(f.name_of(&node.id).await);
    }
    assert_eq!(
        names,
        [
            "what-should-this",
            "what-should-this-2",
            "what-should-this-3"
        ]
    );
}

impl Fixture {
    async fn spawn_named(
        &self,
        name: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<RailNode, rpc::RpcError> {
        let cwd = self.dir.path().to_string_lossy().into_owned();
        let params = json!({"cwd": cwd, "prompt": prompt, "name": name});
        let node = self.call("agent.spawn", params).await?;
        Ok(serde_json::from_value(node).unwrap())
    }
}

#[tokio::test]
async fn a27_three_same_tag_siblings_are_named_by_their_text() {
    let f = Fixture::running("sleep 30");
    let mut ids = Vec::new();
    for text in ["Fix the login bug", "Write the docs", "Tune the cache"] {
        let node = f.spawn(None, None).await.unwrap();
        f.submit(
            &node.id,
            &format!(r#"<pasted_content id="x">{text}</pasted_content>"#),
        )
        .await;
        ids.push(node.id);
    }
    let mut names = Vec::new();
    for id in &ids {
        names.push(f.name_of(id).await);
    }
    assert_eq!(names, ["fix-login-bug", "write-docs", "tune-cache"]);
}

#[tokio::test]
async fn a28_a_given_name_is_the_rail_name() {
    let f = Fixture::running("sleep 30");
    let node = f
        .spawn_named(Some("  fix refresh race "), None)
        .await
        .unwrap();
    assert_eq!(node.name, "fix refresh race");
    assert_eq!(f.name_of(&node.id).await, "fix refresh race");
}

#[tokio::test]
async fn a28_a_given_name_survives_the_first_prompt() {
    let f = Fixture::running("sleep 30");
    let node = f
        .spawn_named(Some("mine"), Some("fix the build"))
        .await
        .unwrap();
    f.submit(&node.id, "fix the build").await;
    assert_eq!(f.name_of(&node.id).await, "mine");
}

#[tokio::test]
async fn a28_a_taken_name_gets_a_suffix() {
    let f = Fixture::running("sleep 30");
    let first = f.spawn_named(Some("docs"), None).await.unwrap();
    let second = f.spawn_named(Some("docs"), None).await.unwrap();
    let third = f.spawn_named(Some("docs"), None).await.unwrap();
    assert_eq!(first.name, "docs");
    assert_eq!(second.name, "docs-2");
    assert_eq!(third.name, "docs-3");
}

#[tokio::test]
async fn a28_a_bad_name_is_invalid_params() {
    let f = Fixture::running("sleep 30");
    for bad in ["", "   ", &"a".repeat(33), "two\nlines"] {
        let err = f.spawn_named(Some(bad), None).await.unwrap_err();
        assert_eq!(err.code, rpc::code::INVALID_PARAMS, "{bad:?}");
    }
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn a28_a_spawn_without_a_name_is_named_by_a9() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn_named(None, None).await.unwrap();
    assert_eq!(node.name, "new-agent");
    f.submit(&node.id, "fix the build").await;
    assert_eq!(f.name_of(&node.id).await, "fix-build");
}

#[tokio::test]
async fn a44_a_clarification_steer_names_no_agent() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();

    f.submit(
        &node.id,
        "What should this Agent do?\n\nFind the intent and elicit what is missing, asking whom \
         `agent_context` names under `ask`. Then record a Work order with `agent_set_order`.",
    )
    .await;
    assert_eq!(f.name_of(&node.id).await, "new-agent");

    f.submit(&node.id, "fix the build").await;
    assert_eq!(f.name_of(&node.id).await, "fix-build");
}

#[tokio::test]
async fn a2741a_first_prompt_and_rpc_share_the_committed_name_seam() {
    let f = Fixture::running("exec sleep 30");
    f.spawn_named(Some("fix-build"), None).await.unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let mut events = f.bus.subscribe();
    f.submit(&node.id, "fix the build").await;
    f.call("rail.rename", json!({"id":node.id,"name":"mine"}))
        .await
        .unwrap();
    assert_eq!(
        crate::common::renames(&mut events),
        [
            (node.id.clone(), "fix-build-2".into()),
            (node.id.clone(), "mine".into())
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a2741a_unchanged_prompt_names_produce_no_change() {
    for case in [
        "no words",
        "same name",
        "later prompt",
        "explicit spawn",
        "explicit rename",
        "starting rename",
        "Door",
        "Clarification",
    ] {
        let f = std::sync::Arc::new(Fixture::running("exec sleep 30"));
        let barrier = f.workstream("barrier", None).await;
        let id = match case {
            "explicit spawn" => f.spawn_named(Some("mine"), None).await.unwrap().id,
            "starting rename" => {
                let config = hold_starts(&f);
                let spawning = {
                    let f = std::sync::Arc::clone(&f);
                    tokio::spawn(async move { f.spawn(None, None).await })
                };
                let tree = f
                    .until(|tree| {
                        tree.iter()
                            .any(|n| n.kind == contracts::agent::NodeKind::Agent)
                    })
                    .await;
                let id = tree
                    .iter()
                    .find(|n| n.kind == contracts::agent::NodeKind::Agent)
                    .unwrap()
                    .id
                    .clone();
                f.call("rail.rename", json!({"id":id,"name":"mine"}))
                    .await
                    .unwrap();
                release(config).await;
                spawning.await.unwrap().unwrap();
                id
            }
            "Door" => {
                f.call("rail.startDoor", json!({"id":barrier}))
                    .await
                    .unwrap();
                barrier.clone()
            }
            _ => f.spawn(None, None).await.unwrap().id,
        };
        match case {
            "later prompt" => f.submit(&id, "first name").await,
            "explicit rename" => {
                f.call("rail.rename", json!({"id":id,"name":"mine"}))
                    .await
                    .unwrap();
            }
            _ => {}
        }
        let name_before = f.name_of(&id).await;
        // Attach after setup naming; only the guarded prompt belongs to this window.
        let mut events = f.bus.subscribe();
        let mut rail_events = f.bus.subscribe();
        let prompt = match case {
            "no words" => "please, the...",
            "same name" => "new agent",
            "Clarification" => {
                "What should this Agent do?\n\nFind the intent and elicit what is missing, asking whom `agent_context` names under `ask`. Then record a Work order with `agent_set_order`."
            }
            _ => "fix the build",
        };
        f.submit(&id, prompt).await;
        assert_eq!(f.name_of(&id).await, name_before, "{case}");
        assert!(crate::common::renames(&mut events).is_empty(), "{case}");
        while let Ok(event) = rail_events.try_recv() {
            assert!(
                !matches!(event.data, contracts::EventData::RailChanged),
                "{case}: an unchanged prompt must not announce a Rail change"
            );
        }
        let mut expected = Vec::new();
        if matches!(case, "no words" | "Clarification") {
            f.submit(&id, "fix the build").await;
            let name_after = if case == "Clarification" {
                expected.push((id.clone(), "fix-build".into()));
                "fix-build"
            } else {
                &name_before
            };
            assert_eq!(f.name_of(&id).await, name_after, "{case}");
        }
        f.call(
            "rail.rename",
            json!({"id":barrier,"name":"observation-end"}),
        )
        .await
        .unwrap();
        expected.push((barrier, "observation-end".into()));
        assert_eq!(crate::common::renames(&mut events), expected, "{case}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a4688a_a_parked_prompt_while_off_consumes_its_naming_opportunity() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let enabled = Arc::new(AtomicBool::new(false));
    let switch = Arc::clone(&enabled);
    let mut fixture = Fixture::running("sleep 30");
    fixture.agents = fixture
        .agents
        .with_automatic_renaming(move || Ok(switch.load(Ordering::SeqCst)));
    let f = Arc::new(fixture);
    let config = hold_starts(&f);
    let spawning = {
        let f = Arc::clone(&f);
        tokio::spawn(async move { f.spawn(None, None).await })
    };
    let tree = f.until(|tree| !tree.is_empty()).await;
    let id = tree[0].id.clone();
    let before = tree[0].name.clone();
    f.submit(&id, "Fix the refresh race").await;
    let mut events = f.bus.subscribe();
    release(config).await;
    spawning.await.unwrap().unwrap();
    enabled.store(true, Ordering::SeqCst);
    f.submit(&id, "now write the docs").await;
    assert_eq!(f.name_of(&id).await, before);
    while let Ok(event) = events.try_recv() {
        assert!(!matches!(
            event.data,
            contracts::EventData::RailRenamed { .. }
        ));
    }
    f.call("agent.stop", json!({"id":id})).await.unwrap();
}
