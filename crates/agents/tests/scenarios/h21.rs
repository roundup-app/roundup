//! H21: an Agent answers the Decisions of the Agents in its Reach, never its own. The module sees
//! the caller as `ctx.actor`; the Daemon takes that from the caller's process (rupd's tests).

use std::sync::Arc;
use std::time::Duration;

use contracts::decision::Decision;
use contracts::{Actor, ActorKind, EventData, Kind, Verb};
use provenance::Touches;
use rpc::{Ctx, Module, RpcError, code};
use serde_json::{Value, json};
use tokio::task::JoinHandle;

use crate::common::{Fixture, status_of};

const PROOF: &str = "app-proof";

type Waiting = JoinHandle<Result<Value, RpcError>>;

struct World {
    f: Arc<Fixture>,
    touches: Arc<Touches>,
    door: String,
    child: String,
    grandchild: String,
    sibling: String,
    other: String,
    /// The Agents under a Takeover.
    taken: Arc<std::sync::Mutex<Vec<String>>>,
}

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.to_owned(),
        parent: None,
    }
}

impl World {
    /// Workstream `door` with `child` (which has `grandchild`) and `sibling`, and another
    /// Workstream's `other`.
    async fn new() -> Self {
        let mut f = Fixture::running("sleep 30").with_proof(PROOF);
        let taken = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let probe = Arc::clone(&taken);
        f.agents = f
            .agents
            .with_takeover(move |id| probe.lock().unwrap().iter().any(|t| t == id));
        let f = Arc::new(f);
        let door = f.workstream("door", None).await;
        let child = f.spawn(Some(&door), None).await.unwrap().id;
        let grandchild = f.spawn_as_agent(&child).await;
        let sibling = f.spawn(Some(&door), None).await.unwrap().id;
        f.call("rail.startDoor", json!({"id": door})).await.unwrap();
        let elsewhere = f.workstream("elsewhere", None).await;
        let other = f.spawn(Some(&elsewhere), None).await.unwrap().id;
        Self {
            f,
            touches: Arc::new(Touches::in_memory().unwrap()),
            door,
            child,
            grandchild,
            sibling,
            other,
            taken,
        }
    }

    fn ctx(&self, actor: Actor) -> Ctx {
        Ctx {
            actor,
            bus: self.f.bus.clone(),
            touches: Arc::clone(&self.touches),
        }
    }

    async fn call(&self, actor: Actor, method: &str, params: Value) -> Result<Value, RpcError> {
        self.f.agents.call(&self.ctx(actor), method, params).await
    }

    async fn answer(&self, actor: Actor, id: &str, word: &str) -> Result<Value, RpcError> {
        // Whatever an Agent sends as `proof` is ignored.
        self.call(
            actor,
            "decision.answer",
            json!({"id": id, "answer": word, "proof": "x"}),
        )
        .await
    }

    async fn user_answer(&self, id: &str, word: &str) -> Result<Value, RpcError> {
        self.call(
            Actor::user(),
            "decision.answer",
            json!({"id": id, "answer": word, "proof": PROOF}),
        )
        .await
    }

    /// `agent`'s `rup permission`, left waiting, and the id of the Decision it opens.
    async fn asks(&self, agent: &str) -> (Waiting, String) {
        let before = self.listed(Actor::user()).await.len();
        let (f, id) = (Arc::clone(&self.f), agent.to_owned());
        let waiting = tokio::spawn(async move {
            f.call(
                "agent.permission",
                json!({"id": id, "payload": {"hook_event_name": "PermissionRequest",
                    "tool_name": "Bash", "tool_input": {"command": "ls"}}}),
            )
            .await
        });
        let id = self.opened(agent, before).await;
        (waiting, id)
    }

    async fn opened(&self, agent: &str, before: usize) -> String {
        for _ in 0..500 {
            let open = self.listed(Actor::user()).await;
            if open.len() > before
                && let Some(d) = open.iter().find(|d| d.agent == agent)
            {
                return d.id.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("no Decision of {agent}");
    }

    async fn listed(&self, actor: Actor) -> Vec<Decision> {
        serde_json::from_value(
            self.call(actor, "decision.list", Value::Null)
                .await
                .unwrap(),
        )
        .unwrap()
    }

    fn touches_of(&self, id: &str) -> Vec<contracts::Touch> {
        self.touches.history(&format!("decision:{id}")).unwrap()
    }
}

const ALLOW: &str = r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#;

#[tokio::test]
async fn h21_a_door_allows_its_childs_permission_request() {
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;

    w.answer(agent(&w.door), &id, "allow").await.unwrap();

    assert_eq!(hook.await.unwrap().unwrap(), json!({"output": ALLOW}));
    assert!(w.listed(Actor::user()).await.is_empty());
    let tree = w.f.tree().await;
    assert_eq!(status_of(&tree, &w.child).kind, Kind::Working);
    // A Subagent answers those of its own Subagents.
    let (_hook, id) = w.asks(&w.grandchild).await;
    w.answer(agent(&w.child), &id, "deny").await.unwrap();
}

#[tokio::test]
async fn h21_a_door_answers_a_childs_ask_user_with_a_label_and_a_note() {
    let w = World::new().await;
    let f = Arc::clone(&w.f);
    let (touches, bus, child) = (Arc::clone(&w.touches), w.f.bus.clone(), w.child.clone());
    let asking = tokio::spawn(async move {
        let ctx = Ctx {
            actor: agent(&child),
            bus,
            touches,
        };
        f.agents
            .call(
                &ctx,
                "agent.ask",
                json!({"question": "which?", "answers": [
                    {"label": "red", "description": "warm"},
                    {"label": "blue", "description": "cool"},
                ]}),
            )
            .await
    });
    let id = w.opened(&w.child, 0).await;

    let wrong = w.answer(agent(&w.door), &id, "green").await.unwrap_err();
    w.call(
        agent(&w.door),
        "decision.answer",
        json!({"id": id, "answer": "blue", "note": "calm"}),
    )
    .await
    .unwrap();

    assert_eq!(wrong.code, code::INVALID_PARAMS);
    assert_eq!(
        asking.await.unwrap().unwrap(),
        json!({"answer": "blue", "note": "calm"})
    );
}

#[tokio::test]
async fn h21_an_agent_cannot_answer_its_own_decision() {
    let w = World::new().await;
    w.f.call("rail.rename", json!({"id":w.child,"name":"sad"}))
        .await
        .unwrap();
    let (_hook, id) = w.asks(&w.child).await;

    let err = w.answer(agent(&w.child), &id, "allow").await.unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    assert!(
        err.message.contains("sad") && !err.message.contains(&w.child),
        "{}",
        err.message
    );
    assert_eq!(w.listed(Actor::user()).await.len(), 1);
}

#[tokio::test]
async fn h21_an_ancestor_sibling_or_other_workstreams_agent_is_forbidden() {
    let w = World::new().await;
    let (_hook, id) = w.asks(&w.child).await;
    for caller in [&w.grandchild, &w.sibling, &w.other] {
        let err = w.answer(agent(caller), &id, "allow").await.unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN, "{caller}");
    }
    let (_hook, door_own) = w.asks(&w.door).await;
    let err = w.answer(agent(&w.child), &door_own, "allow").await;
    assert_eq!(err.unwrap_err().code, code::FORBIDDEN);
    assert_eq!(w.listed(Actor::user()).await.len(), 2);
}

#[tokio::test]
async fn h21_unknown_id_is_not_found_before_forbidden() {
    let w = World::new().await;

    let err = w.answer(agent(&w.other), "d99", "allow").await.unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
}

#[tokio::test]
async fn h21_a_refusal_changes_nothing_and_logs_no_touch() {
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;
    let mut events = w.f.bus.subscribe();

    w.answer(agent(&w.sibling), &id, "allow").await.unwrap_err();
    w.answer(agent(&w.child), &id, "allow").await.unwrap_err();

    assert!(events.try_recv().is_err(), "no event");
    assert!(w.touches_of(&id).is_empty());
    assert_eq!(w.listed(Actor::user()).await.len(), 1);
    assert!(!hook.is_finished());
}

#[tokio::test]
async fn h21_the_user_answering_first_wins_and_a_later_answer_is_not_found() {
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;

    w.user_answer(&id, "deny").await.unwrap();
    let late = w.answer(agent(&w.door), &id, "allow").await.unwrap_err();

    assert_eq!(late.code, code::NOT_FOUND);
    assert!(
        hook.await.unwrap().unwrap()["output"]
            .as_str()
            .unwrap()
            .contains("deny")
    );
}

#[tokio::test]
async fn h21_an_agents_answer_logs_a_touch_naming_it() {
    let w = World::new().await;
    let (_hook, by_door) = w.asks(&w.child).await;
    w.answer(agent(&w.door), &by_door, "allow").await.unwrap();
    let (_hook, by_user) = w.asks(&w.child).await;
    w.user_answer(&by_user, "allow").await.unwrap();

    let touch = &w.touches_of(&by_door)[0];
    assert_eq!(touch.verb, Verb::Wrote);
    assert_eq!(touch.actor, agent(&w.door));
    assert_eq!(w.touches_of(&by_user)[0].actor, Actor::user());
}

#[tokio::test]
async fn h21_a_decision_under_takeover_is_conflict_for_an_agent() {
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;
    w.taken.lock().unwrap().push(w.child.clone());

    let conflict = w.answer(agent(&w.door), &id, "allow").await.unwrap_err();
    let outside = w.answer(agent(&w.other), &id, "allow").await.unwrap_err();
    w.user_answer(&id, "allow").await.unwrap();

    assert_eq!(conflict.code, code::CONFLICT);
    assert_eq!(outside.code, code::FORBIDDEN, "FORBIDDEN beats CONFLICT");
    assert!(hook.await.unwrap().is_ok());
}

#[tokio::test]
async fn h21_decision_list_holds_only_the_reach() {
    let w = World::new().await;
    let (_a, child) = w.asks(&w.child).await;
    let (_b, grand) = w.asks(&w.grandchild).await;
    let (_c, sibling) = w.asks(&w.sibling).await;
    let (_d, other) = w.asks(&w.other).await;
    let (_e, door) = w.asks(&w.door).await;
    let ids = |list: Vec<Decision>| {
        let mut ids: Vec<_> = list.into_iter().map(|d| d.id).collect();
        ids.sort();
        ids
    };

    let mut want = vec![child.clone(), grand.clone(), sibling.clone()];
    want.sort();
    assert_eq!(ids(w.listed(agent(&w.door)).await), want);
    assert_eq!(ids(w.listed(agent(&w.child)).await), vec![grand]);
    assert!(w.listed(agent(&w.sibling)).await.is_empty());
    assert_eq!(w.listed(Actor::user()).await.len(), 5);
    let _ = (other, door);
}

#[tokio::test]
async fn h21_an_agents_proof_is_ignored() {
    let w = World::new().await;
    let (_hook, id) = w.asks(&w.child).await;

    let outside = w
        .call(
            agent(&w.other),
            "decision.answer",
            json!({"id": id, "answer": "allow", "proof": PROOF}),
        )
        .await
        .unwrap_err();
    let inside = w
        .call(
            agent(&w.door),
            "decision.answer",
            json!({"id": id, "answer": "allow"}),
        )
        .await;

    assert_eq!(outside.code, code::FORBIDDEN);
    assert!(inside.is_ok());
}

#[tokio::test]
async fn h21_a_wrong_answer_word_or_an_unanswerable_decision_is_invalid_params() {
    let w = World::new().await;
    let (_hook, id) = w.asks(&w.child).await;
    let wrong = w.answer(agent(&w.door), &id, "ask").await.unwrap_err();
    assert_eq!(wrong.code, code::INVALID_PARAMS);
    let f = Arc::clone(&w.f);
    let sibling = w.sibling.clone();
    f.call(
        "agent.permission",
        json!({"id": sibling, "payload": {"hook_event_name": "PermissionRequest",
            "tool_name": "AskUserQuestion", "tool_input": {"questions": []}}}),
    )
    .await
    .unwrap();
    let unanswerable = w.listed(Actor::user()).await;
    let id = unanswerable.iter().find(|d| d.agent == w.sibling).unwrap();

    let err = w.answer(agent(&w.door), &id.id, "allow").await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn h21_the_user_answers_under_a_takeover() {
    // The user's path skips Reach and Takeover; see the Takeover test above for the Agent's.
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;

    w.user_answer(&id, "allow").await.unwrap();

    assert!(hook.await.unwrap().is_ok());
}

#[tokio::test]
async fn h21_a_non_agent_lists_every_decision_and_answers_only_with_proof() {
    let w = World::new().await;
    let (_a, child) = w.asks(&w.child).await;
    let (_b, other) = w.asks(&w.other).await;

    let listed = w.listed(Actor::user()).await;
    let ext = Actor {
        kind: ActorKind::Ext,
        id: "x".into(),
        parent: None,
    };
    let refused = w
        .call(
            ext,
            "decision.answer",
            json!({"id": child, "answer": "allow"}),
        )
        .await
        .unwrap_err();

    assert_eq!(listed.len(), 2);
    assert_eq!(refused.code, code::FORBIDDEN);
    w.user_answer(&other, "allow").await.unwrap();
}

#[tokio::test]
async fn h21_the_answer_is_an_event_of_the_agent_that_answered() {
    let w = World::new().await;
    let (_hook, id) = w.asks(&w.child).await;
    let mut events = w.f.bus.subscribe();

    w.answer(agent(&w.door), &id, "allow").await.unwrap();

    let cleared = std::iter::from_fn(|| events.try_recv().ok())
        .any(|e| matches!(e.data, EventData::DecisionCleared(c) if c.id == id));
    assert!(cleared);
}

#[tokio::test]
async fn h21_a_forbidden_beats_a_conflict_for_an_outside_agent() {
    let w = World::new().await;
    let (_hook, id) = w.asks(&w.child).await;
    w.taken.lock().unwrap().push(w.child.clone());

    let outside = w.answer(agent(&w.other), &id, "allow").await.unwrap_err();
    let own = w.answer(agent(&w.child), &id, "allow").await.unwrap_err();

    assert_eq!(outside.code, code::FORBIDDEN);
    assert_eq!(own.code, code::FORBIDDEN);
}

#[tokio::test]
async fn h21_a_terminal_process_claiming_the_door_stays_forbidden() {
    // The Daemon takes the caller from its process; a claimed actor of kind `agent` is not
    // believed by `agent_of_peer`, and the module judges only what the Daemon passes it. A
    // process that is no Agent's descendant is a non-Agent: it needs the proof.
    let w = World::new().await;
    let (_hook, id) = w.asks(&w.child).await;
    let claimed = Actor {
        kind: ActorKind::Ext,
        id: w.door.clone(),
        parent: None,
    };

    let err = w
        .call(
            claimed,
            "decision.answer",
            json!({"id": id, "answer": "allow"}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    assert!(w.touches_of(&id).is_empty());
}

#[tokio::test]
async fn h21_a_peer_below_a_reused_pid_of_an_exited_agent_is_forbidden() {
    let w = World::new().await;
    let terminal = status_terminal(&w, &w.child).await;
    let pid = w.f.terminals.program_pid(&terminal).unwrap();
    assert_eq!(
        w.f.agents.agent_of_peer(pid).as_deref(),
        Some(w.child.as_str())
    );

    w.f.call("agent.stop", json!({"id": w.child}))
        .await
        .unwrap();

    // The pid counts only while that `claude` runs: once it has exited, the number names nothing.
    assert_eq!(w.f.agents.agent_of_peer(pid), None);
}

async fn status_terminal(w: &World, agent: &str) -> String {
    let tree = w.f.tree().await;
    tree.iter()
        .find(|n| n.id == agent)
        .and_then(|n| n.terminal_id.clone())
        .unwrap()
}

#[tokio::test]
async fn b6_prompt_identity_keeps_reach_proof_and_takeover_authority() {
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;
    w.taken.lock().unwrap().push(w.child.clone());
    let identity = w
        .call(agent(&w.door), "decision.capture", json!({"id":id}))
        .await
        .unwrap();
    for caller in [&w.child, &w.sibling, &w.other] {
        assert_eq!(
            w.call(agent(caller), "decision.capture", json!({"id":id}))
                .await
                .unwrap_err()
                .code,
            code::FORBIDDEN
        );
    }
    let guarded = json!({"id":id,"identity":identity,"answer":"allow","proof":"wrong"});
    assert_eq!(
        w.call(agent(&w.door), "decision.answer", guarded.clone())
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    assert_eq!(
        w.call(Actor::user(), "decision.answer", guarded.clone())
            .await
            .unwrap_err()
            .code,
        code::FORBIDDEN
    );
    w.taken.lock().unwrap().clear();
    w.call(agent(&w.door), "decision.answer", guarded)
        .await
        .unwrap();
    assert_eq!(hook.await.unwrap().unwrap(), json!({"output":ALLOW}));
}

/// Backend lifecycle observation only; #1497 owns the rendered App observer.
#[tokio::test]
async fn u468_backend_failure_stays_with_its_original_request() {
    let w = World::new().await;
    let (old_hook, id) = w.asks(&w.child).await;
    w.answer(agent(&w.door), &id, "invalid-choice")
        .await
        .unwrap_err();
    assert!(w.listed(Actor::user()).await[0].failure.is_some());
    let identity = w
        .call(agent(&w.door), "decision.capture", json!({"id": id}))
        .await
        .unwrap();
    let mut events = w.f.bus.subscribe();
    let (f, child) = (Arc::clone(&w.f), w.child.clone());
    let replacement_hook = tokio::spawn(async move {
        f.call(
            "agent.permission",
            json!({"id": child, "payload": {
                "hook_event_name": "PermissionRequest", "tool_name": "Bash",
                "tool_input": {"command": "ls"}
            }}),
        )
        .await
    });
    let replacement = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let event = events.recv().await.unwrap();
            if let EventData::DecisionOpened(decision) = event.data {
                break decision;
            }
        }
    })
    .await
    .unwrap();
    assert_ne!(replacement.id, id);
    assert_eq!(old_hook.await.unwrap().unwrap_err().code, code::CONFLICT);
    assert!(replacement.failure.is_none());
    // Neither a stale id nor a stale captured identity can annotate its successor.
    assert_eq!(
        w.answer(agent(&w.door), &id, "invalid-choice")
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
    assert_eq!(
        w.call(
            agent(&w.door),
            "decision.answer",
            json!({
                "id": replacement.id, "identity": identity, "answer": "invalid-choice"
            })
        )
        .await
        .unwrap_err()
        .code,
        code::CONFLICT
    );
    assert!(w.listed(Actor::user()).await[0].failure.is_none());
    w.user_answer(&replacement.id, "allow").await.unwrap();
    replacement_hook.await.unwrap().unwrap();
    let (later_hook, later_id) = w.asks(&w.child).await;
    assert_ne!(later_id, replacement.id);
    assert!(w.listed(Actor::user()).await[0].failure.is_none());
    w.user_answer(&later_id, "allow").await.unwrap();
    later_hook.await.unwrap().unwrap();
}

#[tokio::test]
async fn u468_backend_failed_answers_are_hidden_outside_reach() {
    let w = World::new().await;
    let (hook, id) = w.asks(&w.child).await;
    w.answer(agent(&w.door), &id, "invalid-choice")
        .await
        .unwrap_err();
    let original = w.listed(Actor::user()).await;
    assert!(original[0].failure.is_some());
    assert!(w.listed(agent(&w.other)).await.is_empty());
    assert_eq!(
        w.call(
            agent(&w.other),
            "decision.answers",
            json!({"agent": w.child})
        )
        .await
        .unwrap_err()
        .code,
        code::FORBIDDEN
    );
    assert_eq!(
        w.answer(agent(&w.other), &id, "deny")
            .await
            .unwrap_err()
            .code,
        code::FORBIDDEN
    );
    assert_eq!(w.listed(Actor::user()).await, original);
    w.user_answer(&id, "allow").await.unwrap();
    hook.await.unwrap().unwrap();
}
