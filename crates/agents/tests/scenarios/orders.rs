//! O1 to O5: the order every Agent and Door holds. The fake `claude` records every byte typed to
//! its Terminal (as `steer.rs` does) and the test plays its hooks with `agent.signal`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use agents::worktree::Git;
use contracts::agent::{Order, RailNode};
use contracts::{Actor, ActorKind, Verb};
use provenance::Touches;
use rpc::{Ctx, Module, RpcError, code};
use serde_json::{Value, json};

use crate::common::{Fixture, GATED, star, until_file};

const RECORD: &str = GATED;

fn paste(text: &str) -> String {
    format!("{}\x1b[200~{text}\x1b[201~\r", agents::claude_code::LEAD_IN)
}

fn recording() -> Fixture {
    let mut f = Fixture::running(RECORD);
    f.agents = f.agents.with_clock(|| 0);
    f
}

fn typed(f: &Fixture) -> String {
    let bytes = std::fs::read(f.dir.path().join("typed")).unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
}

async fn until_typed(f: &Fixture, len: usize) -> String {
    for _ in 0..500 {
        let text = typed(f);
        if text.len() >= len {
            return text;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("{len} bytes were never typed: {:?}", typed(f));
}

async fn signal(f: &Fixture, id: &str, event: &str) {
    let attempt = f.attempt(id).await;
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": attempt, "payload": {"hook_event_name": event}}),
    )
    .await
    .unwrap();
}

async fn spawn(f: &Fixture, extra: Value) -> Result<RailNode, RpcError> {
    let mut params = json!({"cwd": f.dir.path(), "parent": null});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let node = f.call("agent.spawn", params).await?;
    Ok(serde_json::from_value(node).unwrap())
}

fn work(ask: &str, limits: &[&str]) -> Order {
    Order::Work {
        title: None,
        ask: ask.into(),
        done: None,
        limits: limits.iter().map(|limit| (*limit).into()).collect(),
    }
}

fn order_of(tree: &[RailNode], id: &str) -> Option<Order> {
    tree.iter()
        .find(|n| n.id == id)
        .and_then(|n| n.work.clone())
}

fn from(actor: ActorKind, id: &str, f: &Fixture, touches: &Arc<Touches>) -> Ctx {
    Ctx {
        actor: Actor {
            kind: actor,
            id: id.into(),
            parent: None,
        },
        touches: Arc::clone(touches),
        ..f.ctx()
    }
}

#[tokio::test]
async fn o1_o2_a_spawn_holds_the_order_it_was_given_or_the_one_its_prompt_or_nothing_makes() {
    let f = Fixture::new();
    let given = work("fix the build", &["touch CI"]);
    let by_order = spawn(&f, json!({"order": given})).await.unwrap();
    let by_prompt = spawn(&f, json!({"prompt": "fix it"})).await.unwrap();
    let by_nothing = spawn(&f, json!({})).await.unwrap();
    let asking = Order::Clarification {
        question: "Which test?".into(),
    };
    let by_question = spawn(&f, json!({"order": asking})).await.unwrap();

    let tree = f.tree().await;
    assert_eq!(order_of(&tree, &by_order.id), Some(given));
    assert_eq!(order_of(&tree, &by_prompt.id), Some(work("fix it", &[])));
    assert_eq!(order_of(&tree, &by_nothing.id), None);
    assert_eq!(order_of(&tree, &by_question.id), Some(asking));
}

#[tokio::test]
async fn o1_a_workstream_has_an_order() {
    let f = Fixture::new();
    let workstream = f.workstream("team", None).await;

    let tree = f.tree().await;
    for node in &tree {
        assert!(node.work.is_some(), "{} has no order", node.id);
    }
    assert_eq!(
        order_of(&tree, &workstream),
        Some(Order::clarification("What is this Workstream for?"))
    );
}

#[tokio::test]
async fn o2_a_prompt_with_an_order_or_a_malformed_order_is_invalid_and_changes_nothing() {
    let f = Fixture::new();
    let bad = [
        json!({"prompt": "go", "order": work("go", &[])}),
        json!({"order": work("  ", &[])}),
        json!({"order": work("go", &[" "])}),
        json!({"order": {"kind": "clarification", "question": ""}}),
        json!({"order": {"kind": "other"}}),
    ];
    for extra in bad {
        let err = spawn(&f, extra.clone()).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{extra}");
    }
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn o2_the_first_steer_of_a_work_order_is_the_ask_then_its_limits() {
    let f = recording();
    let node = spawn(
        &f,
        json!({"order": work("fix the build", &["touch CI", "push"])}),
    )
    .await
    .unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &node.id, "SessionStart").await;

    let text = paste("fix the build\n\nLimits:\n- touch CI\n- push");
    assert_eq!(until_typed(&f, text.len()).await, text);
}

#[tokio::test]
async fn o2_the_first_steer_of_a_clarification_order_asks_to_find_elicit_and_record() {
    let f = recording();
    let order = Order::clarification("Which test fails?");
    let node = spawn(&f, json!({"order": order})).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &node.id, "SessionStart").await;

    let steer = until_typed(&f, 100).await;
    assert!(steer.contains("Which test fails?"), "{steer}");
    assert!(steer.contains("agent_context"), "{steer}");
    assert!(steer.contains("agent_set_order"), "{steer}");
}

#[tokio::test]
async fn o3_a_workstream_gives_its_door_the_order_and_stopping_the_door_keeps_it() {
    let f = recording();
    let given = work("coordinate the release", &["merge"]);
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name": "release", "parent": null, "order": given}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap().to_owned();
    assert_eq!(order_of(&f.tree().await, &id), Some(given.clone()));

    f.call("rail.startDoor", json!({"id": id})).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &id, "SessionStart").await;
    let text = paste("coordinate the release\n\nLimits:\n- merge");
    assert_eq!(until_typed(&f, text.len()).await, text);

    f.call("agent.stop", json!({"id": id})).await.unwrap();
    assert_eq!(order_of(&f.tree().await, &id), Some(given));

    let err = f
        .call(
            "rail.createWorkstream",
            json!({"name": "x", "parent": null, "order": work("", &[])}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
}

/// A child the Door `workstream` started through `agent.spawn` as an Actor of kind Agent (O8).
async fn spawned_by(f: &Fixture, touches: &Arc<Touches>, door: &str) -> String {
    let actor = from(ActorKind::Agent, door, f, touches);
    let node = f
        .agents
        .call(
            &actor,
            "agent.spawn",
            json!({"cwd": f.dir.path(), "order": work("child", &[]), "prompt": "details"}),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

async fn set_by(f: &Fixture, actor: Ctx, id: &str, order: Order) -> Result<Value, RpcError> {
    f.agents
        .call(&actor, "agent.setOrder", json!({"id": id, "order": order}))
        .await
}

#[tokio::test]
async fn o4_the_agent_its_door_or_the_user_may_set_an_order_and_it_is_a_touch() {
    let f = Fixture::new();
    let touches = Arc::new(Touches::in_memory().unwrap());
    let workstream = f.workstream("team", None).await;
    let agent = spawned_by(&f, &touches, &workstream).await;
    let stranger = spawn(&f, json!({})).await.unwrap().id;
    f.call("agent.stop", json!({"id":agent})).await.unwrap();

    for (n, actor) in [
        from(ActorKind::Agent, &agent, &f, &touches),
        from(ActorKind::Agent, &workstream, &f, &touches),
        from(ActorKind::User, "you", &f, &touches),
    ]
    .into_iter()
    .enumerate()
    {
        let order = work(&format!("ask {n}"), &["a limit"]);
        let result = set_by(&f, actor, &agent, order.clone()).await;
        if n == 1 {
            // This fixture has no running Terminal. The Door still stores its Order,
            // but B6 requires that it also hears that the Steer did not complete.
            let err = result.unwrap_err();
            assert_eq!(err.code, code::NOT_FOUND);
            assert!(err.message.contains("Order stored"));
        } else {
            let node: RailNode = serde_json::from_value(result.unwrap()).unwrap();
            assert_eq!(node.work, Some(order.clone()));
        }
        assert_eq!(order_of(&f.tree().await, &agent), Some(order));
    }

    let by: Vec<_> = touches
        .history(&format!("agent:{agent}"))
        .unwrap()
        .into_iter()
        .map(|touch| (touch.actor.id, touch.verb))
        .collect();
    assert_eq!(
        by,
        [
            (agent.clone(), Verb::Wrote),
            (workstream.clone(), Verb::Wrote),
            ("you".into(), Verb::Wrote)
        ]
    );

    let err = set_by(
        &f,
        from(ActorKind::Agent, &stranger, &f, &touches),
        &agent,
        work("x", &[]),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, code::FORBIDDEN);
}

#[tokio::test]
async fn o13_a_door_sets_the_order_of_an_agent_it_spawned() {
    let f = Fixture::new();
    let touches = Arc::new(Touches::in_memory().unwrap());
    let workstream = f.workstream("team", None).await;
    let child = spawned_by(&f, &touches, &workstream).await;
    let grandchild = spawned_by(&f, &touches, &child).await;
    let door = || from(ActorKind::Agent, &workstream, &f, &touches);
    f.call("agent.stop", json!({"id":grandchild}))
        .await
        .unwrap();
    f.call("agent.stop", json!({"id":child})).await.unwrap();

    for id in [&child, &grandchild] {
        let order = work(&format!("for {id}"), &[]);
        let err = set_by(&f, door(), id, order.clone()).await.unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND);
        assert!(err.message.contains("Order stored"));
        assert_eq!(order_of(&f.tree().await, id), Some(order));
    }
}

#[tokio::test]
async fn o13_a_door_cannot_set_the_order_of_a_users_agent() {
    let f = Fixture::new();
    let touches = Arc::new(Touches::in_memory().unwrap());
    let workstream = f.workstream("team", None).await;
    let theirs = spawn(
        &f,
        json!({"parent": workstream, "order": work("mine", &[])}),
    )
    .await
    .unwrap()
    .id;
    let err = set_by(
        &f,
        from(ActorKind::Agent, &workstream, &f, &touches),
        &theirs,
        work("yours now", &[]),
    )
    .await
    .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    assert_eq!(order_of(&f.tree().await, &theirs), Some(work("mine", &[])));
}

#[tokio::test]
async fn o4_unknown_and_malformed_are_refused_and_change_nothing() {
    let f = Fixture::new();
    let agent = spawn(&f, json!({"order": work("keep", &[])}))
        .await
        .unwrap()
        .id;

    let cases = [
        (
            json!({"id": "999", "order": work("x", &[])}),
            code::NOT_FOUND,
        ),
        (
            json!({"id": agent, "order": work(" ", &[])}),
            code::INVALID_PARAMS,
        ),
        (
            json!({"id": agent, "order": {"kind": "x"}}),
            code::INVALID_PARAMS,
        ),
    ];
    for (params, expected) in cases {
        let err = f.call("agent.setOrder", params.clone()).await.unwrap_err();
        assert_eq!(err.code, expected, "{params}");
    }
    assert_eq!(order_of(&f.tree().await, &agent), Some(work("keep", &[])));
}

#[tokio::test]
async fn o4_another_callers_order_is_steered_unless_the_agent_set_it() {
    let f = recording();
    let agent = spawn(&f, json!({"prompt": "first"})).await.unwrap().id;
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &agent, "SessionStart").await;
    let first = paste("first");
    until_typed(&f, first.len()).await;
    signal(&f, &agent, "UserPromptSubmit").await;
    signal(&f, &agent, "Stop").await;
    f.until(|tree| {
        tree.iter().any(|n| {
            n.id == agent
                && n.status
                    .as_ref()
                    .is_some_and(|s| s.kind == contracts::Kind::Idle)
        })
    })
    .await;

    // The Agent's own change is not sent back to it.
    let touches = Arc::new(Touches::in_memory().unwrap());
    let own = from(ActorKind::Agent, &agent, &f, &touches);
    f.agents
        .call(
            &own,
            "agent.setOrder",
            json!({"id": agent, "order": work("mine", &[])}),
        )
        .await
        .unwrap();
    assert_eq!(typed(&f), first);

    f.call(
        "agent.setOrder",
        json!({"id": agent, "order": work("sent", &["x"])}),
    )
    .await
    .unwrap();
    // The barrier for both checks above: a Steer of `mine` or `parked` would type before
    // `sent` or leave it Busy, so only these exact bytes show neither was sent.
    let all = format!("{first}{}", paste("sent\n\nLimits:\n- x"));
    assert_eq!(until_typed(&f, all.len()).await, all);
}

#[tokio::test]
async fn o5_an_order_survives_a_reopen_and_a_move_and_leaves_with_its_node() {
    let f = Fixture::new();
    let given = work("keep me", &["leave"]);
    let workstream = f.workstream("team", None).await;
    let agent = spawn(&f, json!({"order": given})).await.unwrap().id;

    f.call(
        "rail.move",
        json!({"id": agent, "parent": workstream, "index": 0}),
    )
    .await
    .unwrap();
    assert_eq!(order_of(&f.tree().await, &agent), Some(given.clone()));

    let f = f.reopen();
    assert_eq!(order_of(&f.tree().await, &agent), Some(given));
    assert_eq!(
        order_of(&f.tree().await, &workstream),
        Some(Order::clarification("What is this Workstream for?"))
    );

    f.call("rail.remove", json!({"id": agent})).await.unwrap();
    assert_eq!(order_of(&f.tree().await, &agent), None);
}

#[tokio::test]
async fn a25_the_default_door_question_names_the_workstream() {
    let f = Fixture::new();
    let id = f.workstream("w", None).await;
    assert_eq!(
        order_of(&f.tree().await, &id),
        Some(Order::clarification("What is this Workstream for?"))
    );
}

#[tokio::test]
async fn a25_a_stored_order_keeps_its_text() {
    let f = Fixture::new();
    let id = f.workstream("w", None).await;
    let stored = Order::clarification("What is this Room for?");
    rusqlite::Connection::open(f.dir.path().join("agents.db"))
        .unwrap()
        .execute(
            "UPDATE nodes SET kind = 'room', work = ? WHERE id = ?",
            rusqlite::params![serde_json::to_string(&stored).unwrap(), id],
        )
        .unwrap();
    let tree = f.reopen().tree().await;
    assert_eq!(order_of(&tree, &id), Some(stored));
}

#[tokio::test]
async fn h20_spawn_order_with_limits_is_one_write() {
    let f = recording();
    let node = spawn(&f, json!({"order": work("reply ready", &["edit no file"])}))
        .await
        .unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &node.id, "SessionStart").await;

    let text = paste("reply ready\n\nLimits:\n- edit no file");
    let typed = until_typed(&f, text.len()).await;
    assert_eq!(typed, text);
    assert!(typed.starts_with("Follow this instruction: \x1b[200~"));
    assert_eq!(typed.matches('\r').count(), 1);
}

#[tokio::test]
async fn h20_a_note_queued_for_a_door_waits_behind_its_order() {
    let f = recording();
    let given = work("coordinate the release", &[]);
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name": "release", "parent": null, "order": given}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap().to_owned();

    // The note is queued before the Door starts and again while its Steer waits for the star.
    let early = f.agents.prompt(&id, "[from rupd, note] early").await;
    assert!(early.is_err());
    f.call("rail.startDoor", json!({"id": id})).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    signal(&f, &id, "SessionStart").await;
    let waiting = f.agents.prompt(&id, "[from rupd, note] waiting").await;
    assert!(matches!(waiting, Err(agents::PromptError::Busy { .. })));

    star(f.dir.path());
    let text = paste("coordinate the release");
    assert_eq!(until_typed(&f, text.len()).await, text);
    signal(&f, &id, "UserPromptSubmit").await;
    signal(&f, &id, "Stop").await;
    f.until(|tree| crate::common::status_of(tree, &id).kind == contracts::Kind::Idle)
        .await;
}

fn full_order() -> Order {
    Order::Work {
        title: Some("port the parser".into()),
        ask: "port the parser".into(),
        done: Some("the parser tests pass".into()),
        limits: vec!["touch no CI file".into(), "do not push".into()],
    }
}

/// `agent.spawn` as the Agent `by`, whose child sits under it.
async fn spawn_by(f: &Fixture, by: &str, extra: Value) -> Result<RailNode, RpcError> {
    let touches = Arc::new(Touches::in_memory().unwrap());
    let mut params = json!({"cwd": f.dir.path(), "parent": null});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let ctx = from(ActorKind::Agent, by, f, &touches);
    let node = f.agents.call(&ctx, "agent.spawn", params).await?;
    Ok(serde_json::from_value(node).unwrap())
}

async fn spawn_prompt(f: &Fixture, id: &str) -> Result<Value, RpcError> {
    f.call("agent.spawnPrompt", json!({"id": id})).await
}

#[tokio::test]
async fn o7_done_is_optional_and_stored() {
    let f = Fixture::new();
    let with = spawn(&f, json!({"order": full_order()})).await.unwrap();
    let without = spawn(&f, json!({"order": work("plain", &[])}))
        .await
        .unwrap();
    let tree = f.tree().await;
    assert_eq!(order_of(&tree, &with.id), Some(full_order()));
    assert_eq!(order_of(&tree, &without.id), Some(work("plain", &[])));

    let old: Order =
        serde_json::from_value(json!({"kind": "work", "ask": "a", "limits": []})).unwrap();
    assert_eq!(old, work("a", &[]));
    let sent = serde_json::to_value(&old).unwrap();
    assert!(sent.get("done").is_none(), "{sent}");
}

#[tokio::test]
async fn o7_an_empty_done_is_invalid_params() {
    let f = Fixture::new();
    let order = json!({"kind": "work", "ask": "a", "done": "  ", "limits": []});
    let err = spawn(&f, json!({"order": order})).await.unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn o7_an_ask_over_the_cap_is_invalid_params_and_names_it() {
    let f = Fixture::new();
    let id = spawn(&f, json!({})).await.unwrap().id;
    let mut kept = None;
    for (len, fits) in [(200, true), (201, false)] {
        let order = work(&"é".repeat(len), &[]);
        let before = f.tree().await.len();
        let results = [
            spawn(&f, json!({"order": order})).await.map(drop),
            f.call(
                "rail.createWorkstream",
                json!({"name": format!("w{len}"), "parent": null, "order": order}),
            )
            .await
            .map(drop),
            f.call("agent.setOrder", json!({"id": id, "order": order}))
                .await
                .map(drop),
        ];
        for result in results {
            match (fits, result) {
                (true, Ok(())) => {}
                (false, Err(err)) => {
                    assert_eq!(err.code, code::INVALID_PARAMS);
                    assert!(err.message.contains("order ask is over 200 characters"));
                }
                (fits, result) => panic!("{len} characters: fits {fits}, got {result:?}"),
            }
        }
        let tree = f.tree().await;
        if fits {
            kept = order_of(&tree, &id);
            assert_eq!(kept, Some(order));
        } else {
            assert_eq!(tree.len(), before, "a refusal added a node");
            assert_eq!(order_of(&tree, &id), kept, "a refusal changed the order");
        }
    }
}

#[tokio::test]
async fn o14_title_is_optional_and_stored() {
    let f = Fixture::new();
    let with = spawn(&f, json!({"order": full_order()})).await.unwrap();
    let without = spawn(&f, json!({"order": work("plain", &[])}))
        .await
        .unwrap();
    let tree = f.tree().await;
    assert_eq!(order_of(&tree, &with.id), Some(full_order()));
    assert_eq!(order_of(&tree, &without.id), Some(work("plain", &[])));
    let sent = serde_json::to_value(work("plain", &[])).unwrap();
    assert!(sent.get("title").is_none(), "{sent}");
    let titled = serde_json::to_value(full_order()).unwrap();
    assert_eq!(titled["title"], "port the parser");
}

#[tokio::test]
async fn o14_an_empty_title_is_invalid_params() {
    let f = Fixture::new();
    let order = json!({"kind": "work", "title": " ", "ask": "a", "limits": []});
    let err = spawn(&f, json!({"order": order})).await.unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn o14_a_title_over_six_words_is_invalid_params_and_names_it() {
    let f = Fixture::new();
    let id = spawn(&f, json!({})).await.unwrap().id;
    for (title, fits) in [
        ("one two three four five six", true),
        ("one two three four five six seven", false),
    ] {
        let order = json!({"kind": "work", "title": title, "ask": "a", "limits": []});
        let results = [
            spawn(&f, json!({"order": order})).await.map(drop),
            f.call(
                "rail.createWorkstream",
                json!({"name": format!("w{}", title.len()), "parent": null, "order": order}),
            )
            .await
            .map(drop),
            f.call("agent.setOrder", json!({"id": id, "order": order}))
                .await
                .map(drop),
        ];
        for result in results {
            match (fits, result) {
                (true, Ok(())) => {}
                (false, Err(err)) => {
                    assert_eq!(err.code, code::INVALID_PARAMS);
                    assert!(err.message.contains("order title is over 6 words"));
                }
                (fits, result) => panic!("{title}: fits {fits}, got {result:?}"),
            }
        }
    }
}

#[test]
fn o14_the_brief_and_the_tool_description_name_title() {
    let brief = include_str!("../../src/claude_code/brief.rs");
    let mcp = include_str!("../../../rup/src/mcp/agent_tools.rs");
    assert!(brief.contains("`title` of at most six words"));
    assert!(mcp.contains("`title` of at most six words"));
}

#[tokio::test]
async fn o7_the_prompt_only_path_is_not_capped() {
    let f = Fixture::new();
    let prompt = "x".repeat(2400);
    let node = spawn(&f, json!({"prompt": prompt})).await.unwrap();
    assert_eq!(
        order_of(&f.tree().await, &node.id),
        Some(work(&prompt, &[]))
    );
}

#[tokio::test]
async fn o8_an_agents_spawn_stores_order_and_prompt() {
    let f = Fixture::new();
    let parent = spawn(&f, json!({})).await.unwrap().id;
    let prompt = "  Details\n\n1. read it\n";
    let both = spawn_by(
        &f,
        &parent,
        json!({"order": full_order(), "prompt": prompt}),
    )
    .await
    .unwrap();
    let order_only = spawn_by(&f, &parent, json!({"order": full_order()}))
        .await
        .unwrap();
    assert_eq!(both.parent.as_deref(), Some(parent.as_str()));
    assert_eq!(order_of(&f.tree().await, &both.id), Some(full_order()));
    assert_eq!(
        spawn_prompt(&f, &both.id).await.unwrap(),
        json!({"prompt": prompt})
    );
    assert_eq!(
        spawn_prompt(&f, &order_only.id).await.unwrap(),
        json!({"prompt": null})
    );
}

#[tokio::test]
async fn o8_an_agents_spawn_with_only_a_prompt_is_refused() {
    let f = Fixture::new();
    let parent = spawn(&f, json!({})).await.unwrap().id;
    let err = spawn_by(&f, &parent, json!({"prompt": "do it"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("order"), "{}", err.message);
    assert_eq!(f.tree().await.len(), 1);
}

#[tokio::test]
async fn o8_a_users_prompt_only_spawn_is_unchanged() {
    let f = Fixture::new();
    let node = spawn(&f, json!({"prompt": "fix it"})).await.unwrap();
    assert_eq!(
        order_of(&f.tree().await, &node.id),
        Some(work("fix it", &[]))
    );
    assert_eq!(
        spawn_prompt(&f, &node.id).await.unwrap(),
        json!({"prompt": null})
    );
    let err = spawn(&f, json!({"prompt": "a", "order": work("a", &[])}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn o8_the_prompt_survives_a_reopen_and_a_resume() {
    let f = Fixture::running("sleep 30");
    let parent = spawn(&f, json!({})).await.unwrap().id;
    let child = spawn_by(
        &f,
        &parent,
        json!({"order": full_order(), "prompt": "the detail"}),
    )
    .await
    .unwrap()
    .id;
    let attempt = f.attempt(&child).await;
    f.call(
        "agent.signal",
        json!({"id": child, "attempt": attempt, "payload": {
            "hook_event_name": "SessionStart",
            "session_id": "11111111-1111-1111-1111-111111111111",
            "source": "startup",
        }}),
    )
    .await
    .unwrap();
    f.call("agent.stop", json!({"id": child})).await.unwrap();
    let mut f = f.reopen();
    // Refuse only after start returned a real Terminal and resume claimed it. This
    // exercises launch and completed cleanup without waiting for the ack deadline.
    f.agents = f.agents.with_resume_effect(|phase, _| {
        if phase == "claimed" {
            Err(RpcError::conflict("O8: launched resume refused"))
        } else {
            Ok(())
        }
    });
    assert_eq!(
        spawn_prompt(&f, &child).await.unwrap(),
        json!({"prompt": "the detail"})
    );
    let error = f
        .call("agent.resume", json!({"id": child}))
        .await
        .unwrap_err();
    assert!(
        error.message.contains("O8: launched resume refused"),
        "{error}"
    );
    assert!(f.terminals.list().iter().all(|terminal| !terminal.running));
    assert_eq!(
        spawn_prompt(&f, &child).await.unwrap(),
        json!({"prompt": "the detail"})
    );

    let team = f.workstream("team", None).await;
    f.call(
        "rail.move",
        json!({"id": child, "parent": team, "index": 0}),
    )
    .await
    .unwrap();
    assert_eq!(
        spawn_prompt(&f, &child).await.unwrap(),
        json!({"prompt": "the detail"})
    );

    f.call("rail.remove", json!({"id": child})).await.unwrap();
    assert_eq!(
        spawn_prompt(&f, &child).await.unwrap_err().code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn o8_discard_drops_the_prompt_with_the_node() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let parent = spawn(&f, json!({})).await.unwrap().id;
    let child = spawn_by(
        &f,
        &parent,
        json!({"order": full_order(), "prompt": "the detail"}),
    )
    .await
    .unwrap()
    .id;
    f.call("agent.discard", json!({"id": child})).await.unwrap();
    assert_eq!(
        spawn_prompt(&f, &child).await.unwrap_err().code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn o8_an_unknown_id_is_not_found() {
    let f = Fixture::new();
    assert_eq!(
        spawn_prompt(&f, "999").await.unwrap_err().code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn o9_the_first_steer_carries_the_ask_done_limits_and_prompt() {
    let f = recording();
    let parent = f.workstream("team", None).await;
    let child = spawn_by(
        &f,
        &parent,
        json!({"order": full_order(), "prompt": "1. read the file\n2. port it"}),
    )
    .await
    .unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &child.id, "SessionStart").await;

    let text = paste(
        "port the parser\n\nDone when: the parser tests pass\n\nLimits:\n- touch no CI file\n- do not push\n\nDetails:\n1. read the file\n2. port it",
    );
    assert!(until_typed(&f, text.len()).await.contains(&text));
}

#[tokio::test]
async fn o9_a_steer_without_a_prompt_is_o2s() {
    let f = recording();
    let node = spawn(&f, json!({"order": full_order()})).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &node.id, "SessionStart").await;

    let text = paste(
        "port the parser\n\nDone when: the parser tests pass\n\nLimits:\n- touch no CI file\n- do not push",
    );
    assert_eq!(until_typed(&f, text.len()).await, text);
}
