//! M6, M7: a Workstream an Agent creates, and the Reach that limits where an Agent's calls act.
//! The module sees the caller as `ctx.actor`.

use std::sync::Arc;

use contracts::{Actor, ActorKind, Touch, Verb};
use provenance::Touches;
use rpc::{Ctx, Module, RpcError, code};
use serde_json::{Value, json};

use crate::common::Fixture;

struct World {
    f: Fixture,
    touches: Arc<Touches>,
    door: String,
    child: String,
    sibling: String,
    other: String,
}

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.to_owned(),
        parent: None,
    }
}

impl World {
    /// Workstream `door` with `child` and `sibling`, and another Workstream's `other`.
    async fn new() -> Self {
        let f = Fixture::running("sleep 30");
        let door = f.workstream("door", None).await;
        let child = f.spawn(Some(&door), None).await.unwrap().id;
        let sibling = f.spawn(Some(&door), None).await.unwrap().id;
        let elsewhere = f.workstream("elsewhere", None).await;
        let other = f.spawn(Some(&elsewhere), None).await.unwrap().id;
        Self {
            f,
            touches: Arc::new(Touches::in_memory().unwrap()),
            door,
            child,
            sibling,
            other,
        }
    }

    async fn call(&self, actor: Actor, method: &str, params: Value) -> Result<Value, RpcError> {
        let ctx = Ctx {
            actor,
            bus: self.f.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        self.f.agents.call(&ctx, method, params).await
    }

    fn touches_of(&self, item: &str) -> Vec<Touch> {
        self.touches.history(item).unwrap()
    }

    async fn tree_ids(&self) -> Vec<String> {
        self.f.tree().await.into_iter().map(|n| n.id).collect()
    }
}

fn code_of(result: Result<Value, RpcError>) -> i64 {
    result.unwrap_err().code
}

#[tokio::test]
async fn m7_a_door_stops_its_subagent() {
    let w = World::new().await;

    w.call(agent(&w.door), "agent.stop", json!({"id": w.child}))
        .await
        .unwrap();

    let touches = w.touches_of(&format!("rail:{}", w.child));
    assert_eq!(touches.len(), 1);
    assert_eq!(touches[0].verb, Verb::Wrote);
    assert_eq!(touches[0].actor, agent(&w.door));
}

#[tokio::test]
async fn m7_a_door_cannot_stop_another_workstreams_agent() {
    let w = World::new().await;

    let result = w
        .call(agent(&w.door), "agent.stop", json!({"id": w.other}))
        .await;

    assert_eq!(code_of(result), code::FORBIDDEN);
}

#[tokio::test]
async fn m7_an_agent_cannot_stop_or_remove_itself() {
    let w = World::new().await;

    for method in ["agent.stop", "rail.remove"] {
        let result = w
            .call(agent(&w.child), method, json!({"id": w.child}))
            .await;
        assert_eq!(code_of(result), code::FORBIDDEN, "{method}");
    }
    // It may rename itself.
    w.call(
        agent(&w.child),
        "rail.rename",
        json!({"id": w.child, "name": "me"}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn m7_a_workstream_an_agent_created_is_in_its_reach() {
    let w = World::new().await;
    let made = w
        .call(
            agent(&w.child),
            "rail.createWorkstream",
            json!({"name": "mine", "parent": null}),
        )
        .await
        .unwrap();
    let id = made["id"].as_str().unwrap().to_owned();

    w.call(
        agent(&w.child),
        "rail.rename",
        json!({"id": id, "name": "renamed"}),
    )
    .await
    .unwrap();
    let under = w.f.spawn(Some(&id), None).await.unwrap().id;
    w.call(agent(&w.child), "agent.stop", json!({"id": under}))
        .await
        .unwrap();
    // Another Agent's Reach does not hold it.
    let result = w
        .call(agent(&w.sibling), "rail.remove", json!({"id": id}))
        .await;
    assert_eq!(code_of(result), code::FORBIDDEN);
    w.call(agent(&w.child), "rail.remove", json!({"id": id}))
        .await
        .unwrap();
    assert!(!w.tree_ids().await.contains(&id));
}

#[tokio::test]
async fn m7_a_sibling_subagent_is_outside_reach() {
    let w = World::new().await;

    let result = w
        .call(agent(&w.child), "agent.stop", json!({"id": w.sibling}))
        .await;

    assert_eq!(code_of(result), code::FORBIDDEN);
}

#[tokio::test]
async fn m7_the_user_has_no_reach_limit() {
    let w = World::new().await;

    w.call(Actor::user(), "agent.stop", json!({"id": w.other}))
        .await
        .unwrap();
    w.call(Actor::user(), "rail.remove", json!({"id": w.sibling}))
        .await
        .unwrap();
}

#[tokio::test]
async fn m7_a_forbidden_call_changes_nothing_and_logs_no_touch() {
    let w = World::new().await;
    let before = w.tree_ids().await;

    let result = w
        .call(agent(&w.child), "rail.remove", json!({"id": w.other}))
        .await;

    assert_eq!(code_of(result), code::FORBIDDEN);
    assert_eq!(w.tree_ids().await, before);
    assert!(w.touches_of(&format!("rail:{}", w.other)).is_empty());
    let unknown = w
        .call(agent(&w.child), "agent.stop", json!({"id": "9999"}))
        .await;
    assert_eq!(code_of(unknown), code::NOT_FOUND);
}

#[tokio::test]
async fn m7_the_creator_survives_a_restart() {
    let w = World::new().await;
    let made = w
        .call(
            agent(&w.child),
            "rail.createWorkstream",
            json!({"name": "mine", "parent": null}),
        )
        .await
        .unwrap();
    let id = made["id"].as_str().unwrap().to_owned();
    let child = w.child.clone();

    let w = World {
        f: w.f.reopen(),
        ..w
    };

    w.call(
        agent(&child),
        "rail.rename",
        json!({"id": id, "name": "again"}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn m6_an_agents_create_workstream_shows_in_the_tree_and_is_its_touch() {
    let w = World::new().await;
    let last_root =
        w.f.tree()
            .await
            .into_iter()
            .filter(|n| n.parent.is_none())
            .map(|n| n.order)
            .max()
            .unwrap();

    let made = w
        .call(
            agent(&w.child),
            "rail.createWorkstream",
            json!({"name": "x", "parent": null}),
        )
        .await
        .unwrap();

    assert_eq!(made["kind"], "workstream");
    assert_eq!(made["order"], last_root + 1);
    let id = made["id"].as_str().unwrap();
    let tree = w.f.tree().await;
    assert!(tree.iter().any(|n| n.id == id && n.parent.is_none()));
    assert!(tree.iter().all(|n| n.parent.as_deref() != Some(id)));
    let touches = w.touches_of(&format!("rail:{id}"));
    assert_eq!(touches.len(), 1);
    assert_eq!(touches[0].actor, agent(&w.child));
    // The user's own call logs the same Touch with the user as actor.
    let own = w
        .call(
            Actor::user(),
            "rail.createWorkstream",
            json!({"name": "y", "parent": null}),
        )
        .await
        .unwrap();
    let touches = w.touches_of(&format!("rail:{}", own["id"].as_str().unwrap()));
    assert_eq!(touches[0].actor, Actor::user());
}

#[tokio::test]
async fn m6_start_door_starts_it_once() {
    let w = World::new().await;
    let made = w
        .call(
            agent(&w.child),
            "rail.createWorkstream",
            json!({"name": "x", "parent": null}),
        )
        .await
        .unwrap();
    let id = made["id"].as_str().unwrap().to_owned();

    w.call(agent(&w.child), "rail.startDoor", json!({"id": id}))
        .await
        .unwrap();
    let again = w
        .call(agent(&w.child), "rail.startDoor", json!({"id": id}))
        .await;

    assert_eq!(code_of(again), code::CONFLICT);
    // A Workstream outside its Reach is not its to start.
    let elsewhere = w
        .call(agent(&w.child), "rail.startDoor", json!({"id": w.door}))
        .await;
    assert_eq!(code_of(elsewhere), code::FORBIDDEN);
}

#[tokio::test]
async fn m6_a_parent_but_null_is_conflict_and_changes_nothing() {
    let w = World::new().await;
    let before = w.tree_ids().await;

    for parent in [json!(w.door), json!(w.child)] {
        let result = w
            .call(
                agent(&w.child),
                "rail.createWorkstream",
                json!({"name": "x", "parent": parent}),
            )
            .await;
        assert_eq!(code_of(result), code::CONFLICT, "{parent}");
    }

    assert_eq!(w.tree_ids().await, before);
}

#[tokio::test]
async fn m7_a_run_outside_reach_starts_nothing() {
    let w = World::new().await;
    for caller in [&w.door, &w.sibling] {
        let target = if caller == &w.door {
            &w.other
        } else {
            &w.child
        };
        let before = serde_json::to_value(w.f.terminals.list().await).unwrap();
        let mut events = w.f.bus.subscribe();
        let err = w
            .call(
                agent(caller),
                "agent.run",
                json!({"id": target, "command": ["/bin/sh", "-c", "echo ran > forbidden-run"],
                   "cwd": w.f.dir.path()}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::FORBIDDEN);
        let target_name =
            w.f.tree()
                .await
                .into_iter()
                .find(|node| &node.id == target)
                .unwrap()
                .name;
        assert!(err.message.contains(&target_name) && !err.message.contains(target));
        assert_eq!(
            serde_json::to_value(w.f.terminals.list().await).unwrap(),
            before
        );
        assert!(w.touches_of(&format!("agent:{target}")).is_empty());
        assert!(events.try_recv().is_err());
        assert!(!w.f.dir.path().join("forbidden-run").exists());
    }
}

#[tokio::test]
async fn m7_a_run_is_allowed_for_self_descendants_and_the_user() {
    let w = World::new().await;
    for caller in [agent(&w.child), agent(&w.door), Actor::user()] {
        let opened = w
            .call(
                caller.clone(),
                "agent.run",
                json!({"id": w.child, "command": ["/bin/sh", "-c", "sleep 30"]}),
            )
            .await
            .unwrap();
        assert!(
            w.f.terminals
                .list()
                .await
                .iter()
                .any(|t| t.id == opened["terminal_id"].as_str().unwrap()
                    && t.owner.as_deref() == Some(w.child.as_str())
                    && t.running)
        );
        assert_eq!(
            w.touches_of(&format!("agent:{}", w.child))
                .last()
                .unwrap()
                .actor,
            caller
        );
    }
}

#[tokio::test]
async fn m7_run_validation_keeps_x11_errors_for_an_agent() {
    let w = World::new().await;
    for (id, command, expected) in [
        ("9999", json!(["/bin/true"]), code::NOT_FOUND),
        (w.door.as_str(), json!(["/bin/true"]), code::INVALID_PARAMS),
        (w.child.as_str(), json!([]), code::INVALID_PARAMS),
    ] {
        let err = w
            .call(
                agent(&w.child),
                "agent.run",
                json!({"id": id, "command": command}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, expected);
    }
}

impl World {
    async fn prompt_child(&self) -> String {
        let node = self.call(agent(&self.door), "agent.spawn", json!({
            "cwd": self.f.dir.path(),
            "prompt": "  private instructions\nfor this Workstream only\n",
            "order": {"kind": "work", "ask": "read the instructions", "done": "instructions read", "limits": []}
        })).await.unwrap();
        node["id"].as_str().unwrap().to_owned()
    }
}

#[tokio::test]
async fn m7_a_spawn_prompt_outside_reach_is_refused_without_effects() {
    let w = World::new().await;
    let target = w.prompt_child().await;
    let foreign = w.f.workstream("foreign", None).await;
    for caller in [&foreign, &w.other, &w.sibling] {
        let before = w.touches.sequence().unwrap();
        let mut events = w.f.bus.subscribe();
        let err = w
            .call(agent(caller), "agent.spawnPrompt", json!({"id": target}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN);
        let target_name =
            w.f.tree()
                .await
                .into_iter()
                .find(|node| node.id == target)
                .unwrap()
                .name;
        assert!(err.message.contains(&target_name) && !err.message.contains(&target));
        assert_eq!(w.touches.sequence().unwrap(), before);
        assert!(events.try_recv().is_err());
    }
}

#[tokio::test]
async fn m7_a_spawn_prompt_is_readable_by_self_reach_user_or_extension() {
    let w = World::new().await;
    let target = w.prompt_child().await;
    for caller in [
        agent(&target),
        agent(&w.door),
        Actor::user(),
        Actor {
            kind: ActorKind::Ext,
            id: "extension".into(),
            parent: None,
        },
    ] {
        let prompt = w
            .call(caller, "agent.spawnPrompt", json!({"id": target}))
            .await
            .unwrap();
        assert_eq!(
            prompt,
            json!({"prompt": "  private instructions\nfor this Workstream only\n"})
        );
    }
}

#[tokio::test]
async fn m7_an_unknown_spawn_prompt_is_not_found() {
    let w = World::new().await;
    let err = w
        .call(agent(&w.child), "agent.spawnPrompt", json!({"id": "9999"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
}

#[tokio::test]
async fn m7_an_authorized_absent_spawn_prompt_is_null() {
    let w = World::new().await;
    let prompt = w
        .call(agent(&w.door), "agent.spawnPrompt", json!({"id": w.child}))
        .await
        .unwrap();
    assert_eq!(prompt, json!({"prompt": null}));
}
