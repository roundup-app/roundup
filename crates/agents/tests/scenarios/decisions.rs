//! H2 to H7 and H10: the permission Decision store, driven through `agent.permission`,
//! `decision.list` and `decision.answer` the way `rup permission` and the App call them. A hook
//! that closes its connection is a call that is dropped.

use std::sync::Arc;
use std::time::Duration;

use contracts::decision::{ClearedEvent, Decision, Outcome};
use contracts::{Actor, Event, EventData, Kind};
use rpc::{Ctx, Module, RpcError, code};
use serde_json::{Value, json};
use tokio::sync::broadcast::Receiver;
use tokio::task::JoinHandle;

use crate::common::{Fixture, status_of};

const PROOF: &str = "app-proof";

/// The replies `spikes/hooks-permission/REPORT.md` findings 12 and 13 record, with the deny
/// message the Daemon chooses.
const ALLOW: &str = r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#;
const DENY: &str = r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied in roundup"}}}"#;

type Waiting = JoinHandle<Result<Value, RpcError>>;

fn bash(command: &str) -> Value {
    json!({"hook_event_name": "PermissionRequest", "tool_name": "Bash",
           "tool_input": {"command": command}})
}

fn ask_question() -> Value {
    json!({"hook_event_name": "PermissionRequest", "tool_name": "AskUserQuestion",
           "tool_input": {"questions": [{"question": "Do you prefer cats or dogs?", "header": "Pet",
               "options": [{"label": "Cats", "description": "Purr"}]}]}})
}

fn two_questions() -> Value {
    json!({"hook_event_name": "PermissionRequest", "tool_name": "AskUserQuestion",
           "tool_input": {"questions": [
               {"question": "Which layout?", "header": "Layout", "multiSelect": false, "options": [
                   {"label": "Grid", "description": "Tiles", "preview": "a\nb\nc"},
                   {"label": "List", "description": "Rows"}]},
               {"question": "Which parts?", "header": "Parts", "multiSelect": true, "options": [
                   {"label": "Head"}, {"label": "Foot", "preview": ""}]}]}})
}

async fn args_of(payload: Value) -> String {
    let (f, agent) = running().await;
    permission(&f, &agent, payload).await.unwrap().unwrap();
    list(&f).await.remove(0).args
}

#[tokio::test]
async fn h22_a_question_reads_as_lines() {
    let expected = "Layout\nWhich layout?\n1. Grid\n   Tiles\n   a\n   b\n   c\n2. List\n   Rows\n\n\
                    Parts\nWhich parts? (choose several)\n1. Head\n2. Foot";
    assert_eq!(args_of(two_questions()).await, expected);
}

#[tokio::test]
async fn h22_no_json_survives() {
    let args = args_of(two_questions()).await;
    assert!(!args.contains("\\n") && !args.contains("\"label\"") && !args.contains('{'));
}

#[tokio::test]
async fn h22_long_input_is_cut_at_a_line() {
    let preview = vec!["x".repeat(99); 400].join("\n");
    let payload = json!({"hook_event_name": "PermissionRequest", "tool_name": "AskUserQuestion",
        "tool_input": {"questions": [{"question": "Q", "header": "H",
            "options": [{"label": "A", "preview": preview}]}]}});
    let args = args_of(payload).await;
    assert!(args.ends_with("…") && args.chars().count() <= 20001);
    let body = args.trim_end_matches('…');
    assert!(
        body.lines()
            .skip(3)
            .all(|line| line == format!("   {}", "x".repeat(99)))
    );
}

#[tokio::test]
async fn h22_a_malformed_questions_value_keeps_h2() {
    let payload = json!({"hook_event_name": "PermissionRequest", "tool_name": "AskUserQuestion",
        "tool_input": {"questions": [{"question": 7}]}});
    assert_eq!(args_of(payload).await, r#"[{"question":7}]"#);
}

async fn running() -> (Arc<Fixture>, String) {
    let f = Arc::new(Fixture::running("sleep 30").with_proof(PROOF));
    let node = f.spawn(None, None).await.unwrap();
    (f, node.id)
}

/// `rup permission`'s call, left waiting.
fn permission(f: &Arc<Fixture>, id: &str, payload: Value) -> Waiting {
    let (f, id) = (Arc::clone(f), id.to_owned());
    tokio::spawn(async move {
        f.call("agent.permission", json!({"id": id, "payload": payload}))
            .await
    })
}

async fn list(f: &Fixture) -> Vec<Decision> {
    serde_json::from_value(f.call("decision.list", Value::Null).await.unwrap()).unwrap()
}

async fn until_open(f: &Fixture, count: usize) -> Vec<Decision> {
    for _ in 0..500 {
        let open = list(f).await;
        if open.len() == count {
            return open;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("never {count} open Decisions");
}

async fn answer(f: &Fixture, id: &str, word: &str, proof: Option<&str>) -> Result<Value, RpcError> {
    f.call(
        "decision.answer",
        json!({"id": id, "answer": word, "proof": proof}),
    )
    .await
}

async fn kind(f: &Fixture, agent: &str) -> Kind {
    status_of(&f.tree().await, agent).kind
}

async fn until_kind(f: &Fixture, agent: &str, want: Kind) {
    f.until(|tree| status_of(tree, agent).kind == want).await;
}

fn signal(f: &Arc<Fixture>, id: &str, event: &str) -> Waiting {
    let (f, id, event) = (Arc::clone(f), id.to_owned(), event.to_owned());
    tokio::spawn(async move {
        let attempt = f.attempt(&id).await;
        let payload = json!({"hook_event_name": event, "tool_name": "Bash"});
        f.call(
            "agent.signal",
            json!({"id": id, "attempt": attempt, "payload": payload}),
        )
        .await
    })
}

fn decision_events(events: &mut Receiver<Event>) -> Vec<EventData> {
    std::iter::from_fn(|| events.try_recv().ok())
        .map(|event| event.data)
        .filter(|data| {
            matches!(
                data,
                EventData::DecisionOpened(_) | EventData::DecisionCleared(_)
            )
        })
        .collect()
}

fn cleared(data: &EventData) -> Option<&ClearedEvent> {
    match data {
        EventData::DecisionCleared(cleared) => Some(cleared),
        _ => None,
    }
}

async fn error_of(waiting: Waiting) -> RpcError {
    tokio::time::timeout(Duration::from_secs(10), waiting)
        .await
        .expect("the hook's call returns")
        .unwrap()
        .unwrap_err()
}

#[tokio::test]
async fn h2_a_permission_request_opens_one_decision_and_the_agent_needs_you() {
    let (f, agent) = running().await;
    let mut events = f.bus.subscribe();

    let _hook = permission(&f, &agent, bash("touch spike_out.txt"));

    let open = until_open(&f, 1).await;
    assert_eq!(open[0].agent, agent);
    assert_eq!(open[0].tool, "Bash");
    assert_eq!(open[0].args, r#"{"command":"touch spike_out.txt"}"#);
    assert!(open[0].answerable);
    let opened: Vec<_> = decision_events(&mut events);
    assert_eq!(opened.len(), 1);
    assert!(matches!(&opened[0], EventData::DecisionOpened(d) if **d == open[0]));
    let tree = f.tree().await;
    assert_eq!(status_of(&tree, &agent).kind, Kind::NeedsYou);
    assert_eq!(status_of(&tree, &agent).label, "Bash: touch spike_out.txt");
}

#[tokio::test]
async fn h2_args_over_2000_characters_are_cut_with_a_final_ellipsis() {
    let (f, agent) = running().await;

    let _hook = permission(&f, &agent, bash(&"é".repeat(3000)));

    let args = until_open(&f, 1).await.remove(0).args;
    assert_eq!(args.chars().count(), 2001);
    assert!(args.ends_with('…'));
}

#[tokio::test]
async fn h2_a_request_for_an_unknown_agent_is_not_found() {
    let (f, _) = running().await;

    let err = permission(&f, "nope", bash("ls"))
        .await
        .unwrap()
        .unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
    assert!(list(&f).await.is_empty());
}

#[tokio::test]
async fn h2_ask_user_question_opens_an_unanswerable_decision_and_returns_at_once() {
    let (f, agent) = running().await;

    let output = permission(&f, &agent, ask_question())
        .await
        .unwrap()
        .unwrap();

    assert_eq!(output, json!({"output": ""}));
    let open = list(&f).await;
    assert_eq!(
        open.len(),
        1,
        "the Daemon ending the call leaves the Decision open"
    );
    assert_eq!(open[0].tool, "AskUserQuestion");
    assert!(!open[0].answerable);
    assert!(open[0].args.contains("Do you prefer cats or dogs?"));
    let tree = f.tree().await;
    assert_eq!(status_of(&tree, &agent).kind, Kind::NeedsYou);
    assert_eq!(
        status_of(&tree, &agent).label,
        "Do you prefer cats or dogs?"
    );
}

#[tokio::test]
async fn h2_a_second_request_replaces_the_first_and_supersedes_its_hook() {
    let (f, agent) = running().await;
    let first = permission(&f, &agent, bash("one"));
    let old = until_open(&f, 1).await.remove(0);
    let mut events = f.bus.subscribe();

    let _second = permission(&f, &agent, bash("two"));

    let superseded = error_of(first).await;
    assert_eq!(superseded.message, "superseded");
    let open = until_open(&f, 1).await;
    assert_ne!(open[0].id, old.id);
    assert_eq!(open[0].args, r#"{"command":"two"}"#);
    let seen = decision_events(&mut events);
    assert_eq!(seen.len(), 2);
    assert!(
        matches!(&seen[0], EventData::DecisionCleared(c) if c.id == old.id && c.outcome == Outcome::Replaced)
    );
    assert!(matches!(&seen[1], EventData::DecisionOpened(d) if d.id == open[0].id));
    assert_eq!(kind(&f, &agent).await, Kind::NeedsYou);
}

#[tokio::test]
async fn h3_an_answer_prints_the_recorded_reply_and_the_agent_works_again() {
    for (word, reply, outcome) in [
        ("allow", ALLOW, Outcome::Allow),
        ("deny", DENY, Outcome::Deny),
    ] {
        let (f, agent) = running().await;
        let hook = permission(&f, &agent, bash("ls"));
        let id = until_open(&f, 1).await.remove(0).id;
        let mut events = f.bus.subscribe();

        let done = answer(&f, &id, word, Some(PROOF)).await.unwrap();

        assert_eq!(done, Value::Null);
        assert_eq!(hook.await.unwrap().unwrap(), json!({"output": reply}));
        assert!(list(&f).await.is_empty());
        let seen = decision_events(&mut events);
        assert_eq!(seen.len(), 1);
        assert_eq!(cleared(&seen[0]).unwrap().outcome, outcome);
        assert_eq!(kind(&f, &agent).await, Kind::Working);
    }
}

#[tokio::test]
async fn h3_an_answer_for_an_unknown_or_cleared_decision_is_not_found() {
    let (f, agent) = running().await;
    let _hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;
    answer(&f, &id, "allow", Some(PROOF)).await.unwrap();

    let again = answer(&f, &id, "allow", Some(PROOF)).await.unwrap_err();
    let unknown = answer(&f, "d99", "allow", Some(PROOF)).await.unwrap_err();

    assert_eq!(again.code, code::NOT_FOUND);
    assert_eq!(unknown.code, code::NOT_FOUND);
}

#[tokio::test]
async fn h3_a_word_that_is_neither_allow_nor_deny_is_invalid_params() {
    let (f, agent) = running().await;
    let _hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;

    let err = answer(&f, &id, "ask", Some(PROOF)).await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(list(&f).await.len(), 1);
}

#[tokio::test]
async fn h3_a_decision_that_is_not_answerable_is_invalid_params() {
    let (f, agent) = running().await;
    permission(&f, &agent, ask_question())
        .await
        .unwrap()
        .unwrap();
    let id = list(&f).await.remove(0).id;

    let err = answer(&f, &id, "allow", Some(PROOF)).await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(list(&f).await.len(), 1);
}

#[tokio::test]
async fn h3_a_missing_or_wrong_proof_is_forbidden_and_changes_nothing() {
    let (f, agent) = running().await;
    let _hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;

    let missing = answer(&f, &id, "allow", None).await.unwrap_err();
    let wrong = answer(&f, &id, "allow", Some("guess")).await.unwrap_err();

    assert_eq!(missing.code, code::FORBIDDEN);
    assert_eq!(wrong.code, code::FORBIDDEN);
    assert_eq!(list(&f).await.len(), 1);
    assert_eq!(kind(&f, &agent).await, Kind::NeedsYou);
}

#[tokio::test]
async fn h3_a_daemon_with_no_proof_refuses_every_answer() {
    let f = Arc::new(Fixture::running("sleep 30"));
    let agent = f.spawn(None, None).await.unwrap().id;
    let _hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;

    let err = answer(&f, &id, "allow", None).await.unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
}

#[tokio::test]
async fn h5_a_new_client_lists_the_same_decision_and_answers_the_waiting_hook() {
    let (f, agent) = running().await;
    let hook = permission(&f, &agent, bash("ls"));
    let before = until_open(&f, 1).await;
    // The reloaded webview is a new connection: a new Ctx with its own Actor.
    let reloaded = Ctx {
        actor: Actor::user(),
        ..f.ctx()
    };

    let seen: Vec<Decision> = serde_json::from_value(
        f.agents
            .call(&reloaded, "decision.list", Value::Null)
            .await
            .unwrap(),
    )
    .unwrap();
    f.agents
        .call(
            &reloaded,
            "decision.answer",
            json!({"id": seen[0].id, "answer": "allow", "proof": PROOF}),
        )
        .await
        .unwrap();

    assert_eq!(seen, before);
    assert_eq!(hook.await.unwrap().unwrap(), json!({"output": ALLOW}));
}

#[tokio::test]
async fn h5_a_new_daemon_holds_no_decision() {
    let (f, agent) = running().await;
    // No waiting hook, so no task keeps the Fixture alive.
    permission(&f, &agent, ask_question())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(list(&f).await.len(), 1);
    let f = Arc::into_inner(f)
        .expect("no task holds the Fixture")
        .reopen();

    assert!(list(&f).await.is_empty());
}

#[tokio::test]
async fn h6_stopping_the_agent_clears_its_decision_and_fails_the_hook() {
    let (f, agent) = running().await;
    let hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;
    let mut events = f.bus.subscribe();

    f.call("agent.stop", json!({"id": agent})).await.unwrap();

    let err = error_of(hook).await;
    assert_eq!(err.message, "the Agent ended");
    assert!(list(&f).await.is_empty());
    let seen = decision_events(&mut events);
    assert_eq!(seen.len(), 1);
    let gone = cleared(&seen[0]).unwrap();
    assert_eq!(
        (gone.id.as_str(), gone.outcome),
        (id.as_str(), Outcome::AgentGone)
    );
    assert_eq!(kind(&f, &agent).await, Kind::Done);
}

#[tokio::test]
async fn h6_a_terminal_that_exits_clears_the_decision() {
    let (f, agent) = running().await;
    let hook = permission(&f, &agent, bash("ls"));
    until_open(&f, 1).await;
    let mut events = f.bus.subscribe();
    let terminal = f
        .tree()
        .await
        .into_iter()
        .find(|node| node.id == agent)
        .and_then(|node| node.terminal_id)
        .expect("a running Agent has a Terminal");

    f.terminals.kill(&terminal).await.unwrap();

    let err = error_of(hook).await;
    assert_eq!(err.message, "the Agent ended");
    assert!(list(&f).await.is_empty());
    let seen = decision_events(&mut events);
    assert_eq!(seen.len(), 1);
    assert_eq!(cleared(&seen[0]).unwrap().outcome, Outcome::AgentGone);
    until_kind(&f, &agent, Kind::Error).await;
}

#[tokio::test]
async fn h7_a_signal_after_an_answer_in_the_terminal_clears_the_decision() {
    for (event, want) in [
        ("PostToolUse", Kind::Working),
        ("PostToolUseFailure", Kind::Working),
        ("UserPromptSubmit", Kind::Working),
        ("Stop", Kind::Idle),
    ] {
        let (f, agent) = running().await;
        let hook = permission(&f, &agent, bash("ls"));
        let id = until_open(&f, 1).await.remove(0).id;
        let mut events = f.bus.subscribe();

        signal(&f, &agent, event).await.unwrap().unwrap();

        let seen = decision_events(&mut events);
        assert_eq!(seen.len(), 1, "{event}");
        assert_eq!(
            cleared(&seen[0]).unwrap().outcome,
            Outcome::Terminal,
            "{event}"
        );
        assert!(list(&f).await.is_empty(), "{event}");
        assert_eq!(kind(&f, &agent).await, want, "{event}");
        let late = answer(&f, &id, "allow", Some(PROOF)).await.unwrap_err();
        assert_eq!(late.code, code::NOT_FOUND, "{event}");
        // The Daemon closes the hook's connection; it is not a dismissal.
        assert_eq!(error_of(hook).await.code, code::CONFLICT, "{event}");
        assert_eq!(kind(&f, &agent).await, want, "{event}");
    }
}

#[tokio::test]
async fn h7_a_hook_that_closes_early_is_a_no_or_an_esc_and_leaves_the_agent_idle() {
    let (f, agent) = running().await;
    let hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;
    let mut events = f.bus.subscribe();

    hook.abort();
    let _ = hook.await;

    f.until(|tree| status_of(tree, &agent).kind == Kind::Idle)
        .await;
    assert!(list(&f).await.is_empty());
    let seen = decision_events(&mut events);
    assert_eq!(seen.len(), 1);
    assert_eq!(cleared(&seen[0]).unwrap().outcome, Outcome::Terminal);
    let late = answer(&f, &id, "allow", Some(PROOF)).await.unwrap_err();
    assert_eq!(late.code, code::NOT_FOUND);
}

#[tokio::test]
async fn h7_a_decision_with_no_live_hook_survives_a_close_and_is_cleared_by_a_signal() {
    let (f, agent) = running().await;
    permission(&f, &agent, ask_question())
        .await
        .unwrap()
        .unwrap();

    // The Daemon itself ended that call: nothing cleared the Decision.
    assert_eq!(list(&f).await.len(), 1);
    assert_eq!(kind(&f, &agent).await, Kind::NeedsYou);

    signal(&f, &agent, "UserPromptSubmit")
        .await
        .unwrap()
        .unwrap();

    assert!(list(&f).await.is_empty());
    assert_eq!(kind(&f, &agent).await, Kind::Working);
}

/// H10: a permission request stays with the user. The parent hears nothing.
#[tokio::test]
async fn h10_a_childs_decision_reaches_no_byte_signal_or_call_of_its_parent() {
    a_childs_decision_reaches_only_the_user().await;
}

/// B18: H10's test is this scenario's test; a Decision is no Message, so no hop climbs.
#[tokio::test]
async fn b18_a_permission_request_does_not_bubble_to_the_parent() {
    a_childs_decision_reaches_only_the_user().await;
}

async fn a_childs_decision_reaches_only_the_user() {
    let f = Arc::new(Fixture::running("sleep 30").with_proof(PROOF));
    // A Door is the parent Agent of the Agents in its Workstream.
    let parent = f.workstream("team", None).await;
    let child = f.spawn(Some(&parent), None).await.unwrap().id;
    f.call("rail.startDoor", json!({"id": parent}))
        .await
        .unwrap();
    until_kind(&f, &parent, Kind::Working).await;
    let parent_before = status_of(&f.tree().await, &parent).clone();
    let mut events = f.bus.subscribe();
    let parent_terminal = f
        .tree()
        .await
        .into_iter()
        .find(|node| node.id == parent)
        .and_then(|node| node.terminal_id)
        .unwrap();
    let mut output = f.terminals.subscribe(&parent_terminal).unwrap();

    let _hook = permission(&f, &child, bash("ls"));
    let open = until_open(&f, 1).await;

    assert_eq!(open[0].agent, child);
    assert_eq!(status_of(&f.tree().await, &parent), &parent_before);
    let mut heard_by_parent = vec![];
    while let Ok(event) = output.try_recv() {
        heard_by_parent.push(event);
    }
    assert!(heard_by_parent.is_empty(), "{heard_by_parent:?}");
    let about_parent =
        std::iter::from_fn(|| events.try_recv().ok()).any(|event| match event.data {
            EventData::AgentStatus(status) => status.id == parent,
            _ => false,
        });
    assert!(!about_parent);
    // The parent cannot answer it however it is addressed: it has no proof.
    let forbidden = answer(&f, &open[0].id, "allow", None).await.unwrap_err();
    assert_eq!(forbidden.code, code::FORBIDDEN);
}

/// `ask_user`'s call as the shim makes it: identified as the Agent.
fn ask_as(f: &Arc<Fixture>, actor: Actor, params: Value) -> Waiting {
    let f = Arc::clone(f);
    tokio::spawn(async move {
        let mut ctx = f.ctx();
        ctx.actor = actor;
        f.agents.call(&ctx, "agent.ask", params).await
    })
}

fn agent_actor(id: &str) -> Actor {
    Actor {
        kind: contracts::ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

fn ask(f: &Arc<Fixture>, agent: &str) -> Waiting {
    ask_as(f, agent_actor(agent), ask_params())
}

fn ask_params() -> Value {
    json!({"question": "Cats or dogs?", "answers": [
        {"label": "cats (recommended)", "description": "quiet; shed", "preview": "```text\nmeow\n```"},
        {"label": "dogs", "description": "loyal; walks"},
    ]})
}

async fn answer_note(
    f: &Fixture,
    id: &str,
    answer: Option<&str>,
    note: &str,
) -> Result<Value, RpcError> {
    f.call(
        "decision.answer",
        json!({"id": id, "answer": answer, "note": note, "proof": PROOF}),
    )
    .await
}

#[tokio::test]
async fn h14_ask_user_returns_the_label_and_the_note() {
    let (f, agent) = running().await;
    let mut events = f.bus.subscribe();
    let waiting = ask(&f, &agent);

    let open = until_open(&f, 1).await;

    assert_eq!(open[0].tool, "ask_user");
    assert_eq!(
        serde_json::from_str::<Value>(&open[0].args).unwrap(),
        ask_params()
    );
    assert_eq!(kind(&f, &agent).await, Kind::NeedsYou);
    assert!(!waiting.is_finished());

    answer_note(&f, &open[0].id, Some("dogs"), "walks daily")
        .await
        .unwrap();

    assert_eq!(
        waiting.await.unwrap().unwrap(),
        json!({"answer": "dogs", "note": "walks daily"})
    );
    assert!(list(&f).await.is_empty());
    let seen = decision_events(&mut events);
    assert_eq!(seen.len(), 2);
    assert_eq!(cleared(&seen[1]).unwrap().outcome, Outcome::Answered);
    assert_eq!(kind(&f, &agent).await, Kind::Working);
}

#[tokio::test]
async fn h14_an_own_answer_returns_null_and_the_note() {
    let (f, agent) = running().await;
    let waiting = ask(&f, &agent);
    let id = until_open(&f, 1).await.remove(0).id;

    answer_note(&f, &id, None, "neither: a fish").await.unwrap();

    assert_eq!(
        waiting.await.unwrap().unwrap(),
        json!({"answer": null, "note": "neither: a fish"})
    );
    assert!(list(&f).await.is_empty());
}

#[tokio::test]
async fn h14_an_own_answer_with_no_note_is_invalid_params() {
    let (f, agent) = running().await;
    let waiting = ask(&f, &agent);
    let id = until_open(&f, 1).await.remove(0).id;
    let too_long = "x".repeat(2001);

    for (pick, note) in [(None, ""), (None, "  "), (Some("dogs"), too_long.as_str())] {
        let err = answer_note(&f, &id, pick, note).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }

    assert_eq!(list(&f).await.len(), 1);
    assert!(!waiting.is_finished());
}

#[tokio::test]
async fn h14_zero_answers_opens_an_open_question() {
    let (f, agent) = running().await;
    let waiting = ask_as(
        &f,
        agent_actor(&agent),
        json!({"question": "What is this for?", "answers": []}),
    );
    let id = until_open(&f, 1).await.remove(0).id;

    let pick = answer_note(&f, &id, Some("x"), "").await.unwrap_err();
    answer_note(&f, &id, None, "docs").await.unwrap();

    assert_eq!(pick.code, code::INVALID_PARAMS);
    assert_eq!(
        waiting.await.unwrap().unwrap(),
        json!({"answer": null, "note": "docs"})
    );
}

#[tokio::test]
async fn h14_a_permission_decision_takes_no_note() {
    let (f, agent) = running().await;
    let _hook = permission(&f, &agent, bash("ls"));
    let id = until_open(&f, 1).await.remove(0).id;

    let noted = answer_note(&f, &id, Some("allow"), "please")
        .await
        .unwrap_err();
    let own = answer_note(&f, &id, None, "").await.unwrap_err();

    assert_eq!(noted.code, code::INVALID_PARAMS);
    assert_eq!(own.code, code::INVALID_PARAMS);
    assert_eq!(list(&f).await.len(), 1);
}

#[tokio::test]
async fn h14_an_answer_not_in_the_list_is_invalid_params_and_leaves_it_open() {
    let (f, agent) = running().await;
    let waiting = ask(&f, &agent);
    let id = until_open(&f, 1).await.remove(0).id;

    let err = answer(&f, &id, "birds", Some(PROOF)).await.unwrap_err();
    let word = answer(&f, &id, "allow", Some(PROOF)).await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(word.code, code::INVALID_PARAMS);
    assert_eq!(list(&f).await.len(), 1);
    assert!(!waiting.is_finished());
}

#[tokio::test]
async fn h14_only_a_caller_with_the_proof_answers_it() {
    let (f, agent) = running().await;
    let waiting = ask(&f, &agent);
    let id = until_open(&f, 1).await.remove(0).id;

    let none = answer(&f, &id, "cats", None).await.unwrap_err();
    let wrong = answer(&f, &id, "cats", Some("guess")).await.unwrap_err();

    assert_eq!(none.code, code::FORBIDDEN);
    assert_eq!(wrong.code, code::FORBIDDEN);
    assert_eq!(list(&f).await.len(), 1);
    assert!(!waiting.is_finished());
}

#[tokio::test]
async fn h14_a_second_question_replaces_the_first() {
    let (f, agent) = running().await;
    let first = ask(&f, &agent);
    let old = until_open(&f, 1).await.remove(0);
    let mut events = f.bus.subscribe();

    let _second = permission(&f, &agent, bash("ls"));
    let now = loop {
        let open = until_open(&f, 1).await;
        if open[0].id != old.id {
            break open;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    };

    assert_eq!(now[0].tool, "Bash");
    assert_eq!(error_of(first).await.message, "superseded");
    let seen = decision_events(&mut events);
    assert!(
        matches!(&seen[0], EventData::DecisionCleared(c) if c.id == old.id && c.outcome == Outcome::Replaced)
    );
    assert_eq!(kind(&f, &agent).await, Kind::NeedsYou);
}

#[tokio::test]
async fn h14_the_end_of_the_agent_fails_the_call_and_clears_the_decision() {
    let (f, agent) = running().await;
    let waiting = ask(&f, &agent);
    until_open(&f, 1).await;
    let mut events = f.bus.subscribe();

    f.call("agent.stop", json!({"id": agent})).await.unwrap();

    assert_eq!(error_of(waiting).await.message, "the Agent ended");
    assert!(list(&f).await.is_empty());
    let seen = decision_events(&mut events);
    assert_eq!(seen.len(), 1);
    assert_eq!(cleared(&seen[0]).unwrap().outcome, Outcome::AgentGone);
}

#[tokio::test]
async fn h14_a_text_answer_a_duplicate_label_two_recommended_or_an_overlong_field_is_invalid_params_and_opens_nothing()
 {
    let (f, agent) = running().await;
    let long = "x".repeat(201);
    let one = |label: &str| json!({"label": label, "description": "d"});
    let bad = [
        json!({"question": "q", "answers": [one("a"), one("b"), one("c"), one("d"), one("e")]}),
        json!({"question": " ", "answers": [one("a")]}),
        json!({"question": "x".repeat(601), "answers": []}),
        json!({"question": "q", "answers": [one(&long)]}),
        json!({"question": "q", "answers": [one("")]}),
        json!({"question": "q", "answers": ["a"]}),
        json!({"question": "q", "answers": [one("a"), one("a")]}),
        json!({"question": "q", "answers": [one("a (recommended)"), one("b (recommended)")]}),
        json!({"question": "q", "answers": [{"label": "a", "description": ""}]}),
        json!({"question": "q", "answers": [{"label": "a", "description": "x".repeat(401)}]}),
        json!({"question": "q", "answers": [{"label": "a", "description": "d", "preview": "x".repeat(4001)}]}),
    ];

    for params in bad {
        let err = ask_as(&f, agent_actor(&agent), params)
            .await
            .unwrap()
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }

    assert!(list(&f).await.is_empty());
}

#[tokio::test]
async fn h14_only_an_agent_asks() {
    let (f, _agent) = running().await;

    let err = ask_as(&f, Actor::user(), json!({"question": "q", "answers": []}))
        .await
        .unwrap()
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    assert!(list(&f).await.is_empty());
}

/// U3016's arithmetic fixture enters both source collectors and the actual routing await.
#[tokio::test]
async fn u3016c_time_categories_use_observed_intervals_sources() {
    use std::future::Future;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let clock = Arc::new(AtomicU64::new(0));
    let mut f = Fixture::running(
        "printf '%s' \"$OTEL_EXPORTER_OTLP_TRACES_ENDPOINT\" > endpoint-$ROUNDUP_AGENT\nsleep 30",
    )
    .with_proof("time-test");
    let wall = clock.clone();
    let mono = clock.clone();
    f.agents = f
        .agents
        .with_clock(move || i64::try_from(wall.load(Ordering::SeqCst)).unwrap())
        .with_measurement_clock(move || u128::from(mono.load(Ordering::SeqCst)) * 1_000_000);
    let first = f.spawn(None, None).await.unwrap();
    let second = f.spawn(None, None).await.unwrap();
    let source = "11111111-1111-4111-8111-111111111111";
    for (node, source) in [
        (&first, source),
        (&second, "22222222-2222-4222-8222-222222222222"),
    ] {
        f.call("agent.signal",json!({"id":node.id,"attempt":node.attempt,"payload":{"hook_event_name":"SessionStart","session_id":source}})).await.unwrap();
        f.call(
            "agent.signal",
            json!({"id":node.id,"attempt":node.attempt,"payload":{"hook_event_name":"Stop"}}),
        )
        .await
        .unwrap();
    }
    let endpoint = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(url) =
                std::fs::read_to_string(f.dir.path().join(format!("endpoint-{}", first.id)))
            {
                break url;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let span = |name: &str, id: &str, start: &str, end: &str| json!({"name":name,"traceId":"time-fixture","spanId":id,"startTimeUnixNano":start,"endTimeUnixNano":end,"attributes":[{"key":"session.id","value":{"stringValue":source}}]});
    let body = json!({"resourceSpans":[{"scopeSpans":[{"spans":[span("claude_code.llm_request","model-early","0","2000000000"),span("claude_code.tool.execution","tool-outer","2000000000","6000000000"),span("claude_code.tool.execution","tool-inner","3000000000","5000000000"),span("claude_code.llm_request","model-late","9000000000","10000000000"),span("claude_code.tool.blocked_on_user","automatic-check","6000000000","8000000000")]}]}]}).to_string();
    let (host, path) = endpoint
        .strip_prefix("http://")
        .unwrap()
        .split_once('/')
        .unwrap();
    for _ in 0..2 {
        let mut socket = tokio::net::TcpStream::connect(host).await.unwrap();
        socket.write_all(format!("POST /{path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
        let mut reply = Vec::new();
        socket.read_to_end(&mut reply).await.unwrap();
        assert!(
            String::from_utf8(reply)
                .unwrap()
                .starts_with("HTTP/1.1 200")
        );
    }
    for sec in 1..=6 {
        clock.store(sec * 1000, Ordering::SeqCst);
        f.call("project.measurements", Value::Null).await.unwrap();
    }
    let Fixture {
        agents, dir, bus, ..
    } = f;
    let agents = Arc::new(agents);
    let touches = Arc::new(provenance::Touches::in_memory().unwrap());
    let user = rpc::Ctx {
        actor: contracts::Actor::user(),
        bus: bus.clone(),
        touches: touches.clone(),
    };
    let sender = rpc::Ctx {
        actor: contracts::Actor {
            kind: contracts::ActorKind::Agent,
            id: first.id.clone(),
            parent: None,
        },
        bus: bus.clone(),
        touches: touches.clone(),
    };
    let mut question = Box::pin(agents.call(
        &sender,
        "agent.ask",
        json!({"question":"Continue?","answers":[{"label":"Yes","description":"Continue"}]}),
    ));
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(question.as_mut().poll(cx)))
            .await
            .is_pending()
    );
    for sec in 7..=8 {
        clock.store(sec * 1000, Ordering::SeqCst);
        agents
            .call(&user, "project.measurements", Value::Null)
            .await
            .unwrap();
    }
    let opened = agents
        .call(&user, "decision.list", Value::Null)
        .await
        .unwrap();
    agents
        .call(
            &user,
            "decision.answer",
            json!({"id":opened[0]["id"],"answer":"Yes","proof":"time-test"}),
        )
        .await
        .unwrap();
    question.await.unwrap();
    let (release, receive) = tokio::sync::oneshot::channel::<()>();
    let receive = Arc::new(std::sync::Mutex::new(Some(receive)));
    let messages = messages::Messages::open(
        dir.path(),
        bus.clone(),
        agents.clone(),
        Arc::new(move |_, _| {
            let receive = receive.lock().unwrap().take().unwrap();
            Box::pin(async move {
                receive.await.unwrap();
                Ok(())
            })
        }),
    )
    .unwrap();
    let mut sending = Box::pin(messages.call(
        &sender,
        "message.send",
        json!({"to":second.id,"kind":"note","body":"coordinate"}),
    ));
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(sending.as_mut().poll(cx)))
            .await
            .is_pending()
    );
    clock.store(9000, Ordering::SeqCst);
    release.send(()).unwrap();
    let message = sending.await.unwrap();
    clock.store(10000, Ordering::SeqCst);
    let read = agents
        .call(&user, "project.measurements", Value::Null)
        .await
        .unwrap();
    let intervals = read["contributions"].as_array().unwrap();
    assert_eq!(
        intervals.len(),
        4,
        "automatic vendor checks are not human waits; duplicate exports retain identities"
    );
    assert!(intervals.iter().any(|c| c["value"]["category"] == "agent"
        && c["value"]["start_unix_ns"] == "0"
        && c["value"]["end_unix_ns"] == "2000000000"));
    assert!(intervals.iter().any(|c| c["value"]["category"] == "tool"
        && c["value"]["start_unix_ns"] == "2000000000"
        && c["value"]["end_unix_ns"] == "6000000000"));
    assert!(intervals.iter().any(|c| c["value"]["category"] == "tool"
        && c["value"]["start_unix_ns"] == "3000000000"
        && c["value"]["end_unix_ns"] == "5000000000"));
    let facts = read["time_evidence"].as_array().unwrap();
    assert_eq!(
        facts
            .iter()
            .filter(|c| c["value"]["activity"]["kind"] == "attempt")
            .count(),
        2
    );
    for (kind, start, end) in [("decision", 6000, 8000), ("coordination", 8000, 9000)] {
        let fact = facts
            .iter()
            .find(|c| c["value"]["activity"]["kind"] == kind)
            .unwrap();
        assert_eq!(fact["value"]["start"]["unix_ms"], start);
        assert_eq!(fact["value"]["state"]["at"]["unix_ms"], end);
        if kind == "coordination" {
            assert_eq!(fact["value"]["activity"]["message"], message["id"]);
        }
    }
    let retained = messages
        .call(&user, "message.get", json!({"id":message["id"]}))
        .await
        .unwrap();
    assert_eq!(retained["body"], "coordinate");
    messages
        .save_wake(&first.id, std::slice::from_ref(&second.id), false, &[], 0)
        .unwrap();
    // A pending Message returns while its receiver works; it does not extend the caller's wait.
    agents.call(&user,"agent.signal",json!({"id":second.id,"attempt":second.attempt,"payload":{"hook_event_name":"PreToolUse","tool_name":"Bash"}})).await.unwrap();
    messages
        .call(
            &sender,
            "message.send",
            json!({"to":second.id,"kind":"note","body":"pending"}),
        )
        .await
        .unwrap();
    let negative = agents
        .call(&user, "project.measurements", Value::Null)
        .await
        .unwrap();
    assert_eq!(
        negative["time_evidence"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["value"]["activity"]["kind"] == "coordination")
            .count(),
        1
    );
    for id in [&first.id, &second.id] {
        agents
            .call(&user, "agent.stop", json!({"id":id}))
            .await
            .unwrap();
    }
}
