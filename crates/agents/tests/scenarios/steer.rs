//! H11 the Steer, H12 the first prompt through it, H16 no other keystroke. The fake `claude` puts
//! its Terminal in raw mode and records every byte written to it; the test plays its hooks with
//! `agent.signal`. The clock is injected and never advances: nothing here waits on it.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use agents::FirstSteerCompletion;
use contracts::{Actor, ActorKind, Kind};
use rpc::{Ctx, Module, RpcError, code};
use serde_json::{Value, json};

use crate::common::{Fixture, GATED, star, status_of, until_file};

const RECORD: &str = GATED;
const BOUND: Duration = Duration::from_millis(400);

fn paste(text: &str) -> String {
    format!("{}\x1b[200~{text}\x1b[201~\r", agents::claude_code::LEAD_IN)
}

fn frozen(f: Fixture, bound: Duration) -> Fixture {
    let mut f = f;
    f.agents = f.agents.with_clock(|| 0).with_steer_bound(bound);
    f
}

async fn signal(f: &Fixture, id: &str, event: &str) {
    let payload = json!({"hook_event_name": event, "prompt": "typed by the user"});
    let attempt = f.attempt(id).await;
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": attempt, "payload": payload}),
    )
    .await
    .unwrap();
}

fn typed(f: &Fixture) -> PathBuf {
    f.dir.path().join("typed")
}

fn read(path: &Path) -> String {
    std::fs::read(path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// The recorded bytes, once there are `len` of them.
async fn until_typed(f: &Fixture, len: usize) -> String {
    for _ in 0..500 {
        let text = read(&typed(f));
        if text.len() >= len {
            return text;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("{len} bytes were never typed: {:?}", read(&typed(f)));
}

/// The Agent's `SessionStart` has arrived, so it is `idle`.
async fn start(f: &Fixture, id: &str) {
    signal(f, id, "SessionStart").await;
    // O2: an Agent spawned with neither a prompt nor an order is Steered nothing; the fake records from its star.
    while !typed(f).exists() {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    signal(f, id, "Stop").await;
    f.until(|tree| status_of(tree, id).kind == Kind::Idle).await;
}

/// An Agent that has started, so it is `idle`.
async fn idle(bound: Duration) -> (Arc<Fixture>, String) {
    let f = Arc::new(frozen(Fixture::running(RECORD), bound));
    let node = f.spawn(None, None).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    start(&f, &node.id).await;
    (f, node.id)
}

fn steer(
    f: &Arc<Fixture>,
    id: &str,
    text: &str,
) -> tokio::task::JoinHandle<Result<Value, RpcError>> {
    let (f, id, text) = (Arc::clone(f), id.to_owned(), text.to_owned());
    tokio::spawn(async move {
        f.call("agent.prompt", json!({"id": id, "text": text}))
            .await
    })
}

#[tokio::test]
async fn h11_a_steer_is_one_bracketed_paste_and_returns_when_the_agent_submits_it() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let call = steer(&f, &id, "run the tests");

    let text = paste("run the tests");
    assert_eq!(until_typed(&f, text.len()).await, text);
    assert!(!call.is_finished(), "returned before UserPromptSubmit");
    signal(&f, &id, "UserPromptSubmit").await;
    assert_eq!(call.await.unwrap().unwrap(), Value::Null);
    assert_eq!(read(&typed(&f)), text);
}

#[tokio::test]
async fn h11_the_in_process_path_is_the_one_the_rpc_method_uses() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let waiting = {
        let (f, id) = (Arc::clone(&f), id.clone());
        tokio::spawn(async move { f.agents.prompt(&id, "hi").await })
    };
    until_typed(&f, paste("hi").len()).await;
    signal(&f, &id, "UserPromptSubmit").await;
    assert_eq!(waiting.await.unwrap(), Ok(()));
}

#[tokio::test]
async fn h11_text_cannot_close_the_paste_early() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let call = steer(&f, &id, "a\x1b[201~rm -rf b");
    let text = paste("a[201~rm -rf b");
    assert_eq!(until_typed(&f, text.len()).await, text);
    signal(&f, &id, "UserPromptSubmit").await;
    call.await.unwrap().unwrap();
}

#[tokio::test]
async fn h11_a_lost_submit_is_not_accepted_and_nothing_is_sent_again() {
    let (f, id) = idle(BOUND).await;
    f.call("rail.rename", json!({"id":id,"name":"sad"}))
        .await
        .unwrap();
    let err = steer(&f, &id, "hello").await.unwrap().unwrap_err();

    assert_eq!(err.code, code::NOT_ACCEPTED);
    assert!(
        err.message.contains("sad") && !err.message.contains(&id),
        "{}",
        err.message
    );
    tokio::time::sleep(BOUND).await;
    assert_eq!(read(&typed(&f)), paste("hello"));
    assert_eq!(status_of(&f.tree().await, &id).kind, Kind::Idle);
}

#[tokio::test]
async fn h11_an_agent_that_is_not_idle_is_busy_and_nothing_is_written() {
    let f = Arc::new(frozen(Fixture::running(RECORD), BOUND));
    let node = f.spawn(None, None).await.unwrap();

    let err = steer(&f, &node.id, "early").await.unwrap().unwrap_err();
    assert_eq!(err.code, code::BUSY);
    assert!(err.message.contains("Working"), "{}", err.message);

    signal(&f, &node.id, "UserPromptSubmit").await;
    let err = steer(&f, &node.id, "mid-turn").await.unwrap().unwrap_err();
    assert_eq!(err.code, code::BUSY);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(read(&typed(&f)), "");
}

#[tokio::test]
async fn h11_a_second_steer_while_one_waits_is_busy() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let waiting = steer(&f, &id, "one");
    until_typed(&f, paste("one").len()).await;

    let err = steer(&f, &id, "two").await.unwrap().unwrap_err();
    assert_eq!(err.code, code::BUSY);
    signal(&f, &id, "UserPromptSubmit").await;
    waiting.await.unwrap().unwrap();
    assert_eq!(read(&typed(&f)), paste("one"));
}

#[tokio::test]
async fn h11_an_agent_that_is_gone_or_never_was_is_not_found() {
    let f = Arc::new(frozen(Fixture::running("exit 0"), BOUND));
    let node = f.spawn(None, None).await.unwrap();
    f.until(|tree| status_of(tree, &node.id).kind == Kind::Done)
        .await;

    for id in [node.id.as_str(), "999"] {
        let err = steer(&f, id, "hello").await.unwrap().unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND, "{id}");
    }
}

#[tokio::test]
async fn h11_an_agent_that_ends_while_a_steer_waits_is_not_found() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let call = steer(&f, &id, "hello");
    until_typed(&f, paste("hello").len()).await;
    f.call("agent.stop", json!({"id": id})).await.unwrap();
    assert_eq!(call.await.unwrap().unwrap_err().code, code::NOT_FOUND);
}

#[tokio::test]
async fn h11_only_the_user_or_a_doors_own_workstream_may_steer() {
    let f = Arc::new(frozen(Fixture::running(RECORD), Duration::from_secs(30)));
    let workstream = f.workstream("team", None).await;
    let child = f.spawn(Some(&workstream), None).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    start(&f, &child.id).await;

    let from = |kind, id: &str| Ctx {
        actor: Actor {
            kind,
            id: id.into(),
            parent: None,
        },
        ..f.ctx()
    };
    let params = json!({"id": child.id, "text": "go"});
    for stranger in [
        from(ActorKind::Agent, "999"),
        from(ActorKind::Ext, &workstream),
    ] {
        let err = f
            .agents
            .call(&stranger, "agent.prompt", params.clone())
            .await
            .unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN);
    }
    assert_eq!(read(&typed(&f)), "");

    let door = from(ActorKind::Agent, &workstream);
    let call = {
        let f = Arc::clone(&f);
        tokio::spawn(async move { f.agents.call(&door, "agent.prompt", params).await })
    };
    until_typed(&f, paste("go").len()).await;
    signal(&f, &child.id, "UserPromptSubmit").await;
    assert_eq!(call.await.unwrap().unwrap(), Value::Null);
}

#[tokio::test]
async fn h12_the_first_prompt_is_steered_at_the_first_session_start_and_not_before() {
    let f = frozen(Fixture::running(RECORD), Duration::from_secs(30));
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;

    signal(&f, &node.id, "UserPromptSubmit").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        read(&typed(&f)),
        "",
        "written before the first SessionStart"
    );

    signal(&f, &node.id, "SessionStart").await;
    star(f.dir.path());
    let text = paste("build it");
    assert_eq!(until_typed(&f, text.len()).await, text);
    signal(&f, &node.id, "UserPromptSubmit").await;
    signal(&f, &node.id, "Stop").await;
    signal(&f, &node.id, "SessionStart").await;

    // Once: a later idle does not send it again.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(read(&typed(&f)), text);
    assert_eq!(status_of(&f.tree().await, &node.id).kind, Kind::Idle);
}

#[tokio::test]
async fn h12_a_message_waits_until_the_first_steer_is_accepted() {
    let f = Arc::new(frozen(Fixture::running(RECORD), Duration::from_secs(30)));
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    signal(&f, &node.id, "SessionStart").await;
    f.until(|tree| status_of(tree, &node.id).kind == Kind::Idle)
        .await;

    // Idle, but the first Steer is still waiting for the star: a Message is refused, unwritten.
    let refused = steer(&f, &node.id, "a note").await.unwrap();
    assert_eq!(refused.unwrap_err().code, RpcError::busy("").code);
    assert_eq!(read(&typed(&f)), "");

    star(f.dir.path());
    let text = paste("build it");
    assert_eq!(until_typed(&f, text.len()).await, text);
}

#[tokio::test]
async fn h12_a_first_prompt_that_is_not_accepted_leaves_the_agent_in_error() {
    let f = frozen(Fixture::running(RECORD), BOUND);
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    signal(&f, &node.id, "SessionStart").await;

    let tree = f
        .until(|tree| status_of(tree, &node.id).kind == Kind::Error)
        .await;
    assert_eq!(status_of(&tree, &node.id).label, "prompt not accepted");
    let text = paste("build it");
    assert_eq!(until_typed(&f, text.len()).await, text);
    let attempt = f.attempt(&node.id).await;
    assert_eq!(
        f.agents.first_steer_completion(&node.id, &attempt).await,
        Ok(FirstSteerCompletion::Uncertain)
    );
    // A late acknowledgement cannot turn an accounted timeout into permission to retry.
    signal(&f, &node.id, "UserPromptSubmit").await;
    assert_eq!(
        f.agents.first_steer_completion(&node.id, &attempt).await,
        Ok(FirstSteerCompletion::Uncertain)
    );
}

#[tokio::test]
async fn h16_no_signal_text_reaches_the_terminal_and_only_one_function_writes_to_it() {
    let (f, id) = idle(BOUND).await;
    for event in ["UserPromptSubmit", "PermissionRequest", "Stop"] {
        signal(&f, &id, event).await;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(read(&typed(&f)), "", "a Signal became input");

    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut callers = vec![];
    for dir in ["agents/src", "rupd/src"] {
        collect(&root.join(dir), &mut callers);
    }
    // H11's prompt, H13's Interrupt, B6's explicit Terminal path (user input and
    // original-prompt guarded bytes) and A7's exit keys. A lost Signal must never add a fallback
    // caller.
    assert_eq!(
        callers,
        [
            "agents/src/decision.rs: 2",
            "agents/src/ending.rs: 1",
            "agents/src/lib.rs: 2"
        ]
    );
}

/// Raw and guarded Terminal writes in the code under `dir`, tests excluded, per file.
fn collect(dir: &Path, found: &mut Vec<String>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().collect();
    entries.sort_by_key(std::fs::DirEntry::path);
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, found);
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        // Everything after `#[cfg(test)]` is test code; rustfmt may split a call over lines.
        let code = text.split("#[cfg(test)]").next().unwrap_or_default();
        let squeezed: String = code.chars().filter(|c| !c.is_whitespace()).collect();
        let count =
            squeezed.matches("terminals.write(").count() + squeezed.matches(".write_with(").count();
        if count > 0 {
            let name = path.strip_prefix(dir.parent().unwrap().parent().unwrap());
            found.push(format!("{}: {count}", name.unwrap().display()));
        }
    }
}

/// H19's gate decisions, as `(agent id, released)`, in the order the Agents made them.
type Gate = tokio::sync::mpsc::UnboundedReceiver<(String, bool)>;

/// A frozen fake `claude` whose Agents also report each H19 gate decision.
fn gated(bound: Duration) -> (Fixture, Gate) {
    let (decided, gate) = tokio::sync::mpsc::unbounded_channel();
    let mut f = frozen(Fixture::running(RECORD), bound);
    f.agents = f.agents.with_gate_observer(move |id, released| {
        let _ = decided.send((id.to_owned(), released));
    });
    (f, gate)
}

/// Whether H19's next gate decision, which must be Agent `id`'s, released its first prompt.
async fn released(gate: &mut Gate, id: &str) -> bool {
    let (agent, released) = tokio::time::timeout(Duration::from_secs(10), gate.recv())
        .await
        .expect("H19's gate published its decision")
        .expect("the Agents still report gate decisions");
    assert_eq!(agent, id);
    released
}

#[tokio::test]
async fn h19_the_first_steer_waits_for_the_star_whichever_comes_last() {
    let (f, mut gate) = gated(Duration::from_secs(30));
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    signal(&f, &node.id, "SessionStart").await;

    assert!(
        !released(&mut gate, &node.id).await,
        "released before the star"
    );
    assert_eq!(
        read(&f.dir.path().join("dropped")),
        "",
        "written before the star"
    );
    assert_eq!(read(&typed(&f)), "");

    star(f.dir.path());
    let text = paste("build it");
    assert_eq!(until_typed(&f, text.len()).await, text);
    assert_eq!(read(&f.dir.path().join("dropped")), "");
}

#[tokio::test]
async fn h19_a_star_that_never_comes_leaves_the_agent_in_error_and_writes_nothing() {
    let (f, mut gate) = gated(BOUND);
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    signal(&f, &node.id, "SessionStart").await;
    assert!(
        !released(&mut gate, &node.id).await,
        "released before the star"
    );

    let tree = f
        .until(|tree| status_of(tree, &node.id).kind == Kind::Error)
        .await;
    assert_eq!(status_of(&tree, &node.id).label, "prompt not accepted");
    let attempt = f.attempt(&node.id).await;
    assert_eq!(
        f.agents.first_steer_completion(&node.id, &attempt).await,
        Ok(FirstSteerCompletion::Refused)
    );
    star(f.dir.path());
    assert!(
        !released(&mut gate, &node.id).await,
        "a late star released the dropped prompt"
    );
    assert_eq!(read(&f.dir.path().join("dropped")), "");
    assert_eq!(read(&typed(&f)), "", "a late star wrote the dropped prompt");
}

async fn h20_one_write(text: &str) {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let call = steer(&f, &id, text);
    let sent = paste(text);
    assert_eq!(until_typed(&f, sent.len()).await, sent);
    let write = &sent[..];
    assert!(write.starts_with("Follow this instruction: \x1b[200~"));
    assert_eq!(write.matches("\x1b[200~").count(), 1);
    assert_eq!(write.matches('\r').count(), 1);
    signal(&f, &id, "UserPromptSubmit").await;
    call.await.unwrap().unwrap();
}

#[tokio::test]
async fn h20_four_line_steer_has_typed_lead_in() {
    h20_one_write("fix\n\nLimits:\n- edit no file").await;
}

#[tokio::test]
async fn h20_one_line_steer_has_typed_lead_in() {
    h20_one_write("run the tests").await;
}

#[test]
fn b33_a_batch_of_only_digests_is_typed_without_the_lead_in() {
    let digests = "[from rupd, note] [digest] c is idle\n  last: x\n  open todos: 0\n\n\
                   [from rupd, note] [digest] [2 updates held back]\nd is done\n  last: y\n  open todos: 1\n\n\
                   [rup messages: 3 4]";
    let typed = String::from_utf8(agents::claude_code::steer_bytes(digests)).unwrap();
    assert_eq!(
        typed,
        format!(
            "{}\x1b[200~{digests}\x1b[201~\r",
            agents::claude_code::STATUS_LEAD
        )
    );
    assert!(!typed.contains(agents::claude_code::LEAD_IN));
}

#[test]
fn b33_a_batch_with_a_work_order_keeps_the_lead_in() {
    let mixed = "[from rupd, note] [digest] c is idle\n  last: x\n  open todos: 0\n\n[from saad, note] fix it";
    let typed = String::from_utf8(agents::claude_code::steer_bytes(mixed)).unwrap();
    assert!(typed.starts_with(agents::claude_code::LEAD_IN));
    let order = String::from_utf8(agents::claude_code::steer_bytes("Fix the race")).unwrap();
    assert!(order.starts_with(agents::claude_code::LEAD_IN));
}

#[tokio::test]
async fn b37_live_error_accepts_one_prompt_in_the_same_attempt() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    let attempt = f.attempt(&id).await;
    signal(&f, &id, "StopFailure").await;
    assert_eq!(status_of(&f.tree().await, &id).kind, Kind::Error);
    let waiting = {
        let (f, id) = (Arc::clone(&f), id.clone());
        tokio::spawn(async move { f.agents.prompt(&id, "continue").await })
    };
    let expected = paste("continue");
    assert_eq!(until_typed(&f, expected.len()).await, expected);
    assert!(!waiting.is_finished());
    signal(&f, &id, "UserPromptSubmit").await;
    assert_eq!(waiting.await.unwrap(), Ok(()));
    assert_eq!(f.attempt(&id).await, attempt);
    assert_eq!(status_of(&f.tree().await, &id).kind, Kind::Working);
    assert_eq!(read(&typed(&f)), expected);
}

#[tokio::test]
async fn b37_live_error_refuses_concurrent_input() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    signal(&f, &id, "StopFailure").await;
    let waiting = steer(&f, &id, "one");
    let expected = paste("one");
    until_typed(&f, expected.len()).await;
    assert_eq!(
        steer(&f, &id, "two").await.unwrap().unwrap_err().code,
        code::BUSY
    );
    signal(&f, &id, "UserPromptSubmit").await;
    waiting.await.unwrap().unwrap();
    assert_eq!(read(&typed(&f)), expected);
}

#[tokio::test]
async fn b37_live_error_owner_is_open_until_terminal_exit() {
    let (f, id) = idle(Duration::from_secs(30)).await;
    signal(&f, &id, "StopFailure").await;
    let terminal = f
        .tree()
        .await
        .into_iter()
        .find(|node| node.id == id)
        .unwrap()
        .terminal_id
        .unwrap();
    f.agents
        .with_terminal_owner(&terminal, |owner| {
            assert!(!owner.unwrap().ended);
            Ok(())
        })
        .unwrap();
    f.terminals.kill(&terminal).await.unwrap();
    f.until(|tree| {
        status_of(tree, &id).kind == Kind::Error && status_of(tree, &id).label != "error"
    })
    .await;
    f.agents
        .with_terminal_owner(&terminal, |owner| {
            assert!(owner.is_none_or(|owner| owner.ended));
            Ok(())
        })
        .unwrap();
    assert!(matches!(
        f.agents.prompt(&id, "late").await,
        Err(agents::PromptError::NotFound { .. })
    ));
}

#[tokio::test]
async fn b6_first_steer_completion_includes_the_gate_and_physical_writer() {
    let (arrived, mut arrival) = tokio::sync::mpsc::unbounded_channel();
    let (release, released) = std::sync::mpsc::channel();
    let released = std::sync::Mutex::new(released);
    let mut f = frozen(Fixture::running(RECORD), BOUND);
    f.agents = f.agents.with_steer_effect(move |_| {
        arrived.send(()).unwrap();
        released.lock().unwrap().recv().unwrap();
        Ok(())
    });
    let node = f.spawn(None, Some("build it")).await.unwrap();
    let attempt = f.attempt(&node.id).await;
    let completion = f.agents.first_steer_completion(&node.id, &attempt);
    tokio::pin!(completion);
    assert!(
        tokio::time::timeout(BOUND, &mut completion).await.is_err(),
        "gate is still closed"
    );
    until_file(&f.dir.path().join("ready")).await;
    signal(&f, &node.id, "SessionStart").await;
    star(f.dir.path());
    arrival.recv().await.unwrap();
    assert!(
        tokio::time::timeout(BOUND * 2, &mut completion)
            .await
            .is_err(),
        "writer is still running beyond submit timeout"
    );
    release.send(()).unwrap();
    until_typed(&f, paste("build it").len()).await;
    signal(&f, &node.id, "UserPromptSubmit").await;
    assert_eq!(completion.await, Ok(FirstSteerCompletion::Submitted));
    assert_eq!(
        f.agents.first_steer_completion(&node.id, &attempt).await,
        Ok(FirstSteerCompletion::Submitted)
    );
}

#[tokio::test]
async fn b6_first_steer_writer_failure_retains_its_outcome_without_retry() {
    for (uncertain, expected) in [
        (false, FirstSteerCompletion::Refused),
        (true, FirstSteerCompletion::Uncertain),
    ] {
        let mut f = frozen(Fixture::running(RECORD), BOUND);
        f.agents = f.agents.with_steer_effect(move |_| {
            Err(if uncertain {
                RpcError::unknown_outcome("physical outcome lost")
            } else {
                RpcError::conflict("refused before bytes")
            })
        });
        let node = f.spawn(None, Some("build it")).await.unwrap();
        until_file(&f.dir.path().join("ready")).await;
        let attempt = f.attempt(&node.id).await;
        signal(&f, &node.id, "SessionStart").await;
        star(f.dir.path());
        assert_eq!(
            f.agents.first_steer_completion(&node.id, &attempt).await,
            Ok(expected)
        );
        assert_eq!(read(&typed(&f)), "");
        signal(&f, &node.id, "SessionStart").await;
        assert_eq!(
            f.agents.first_steer_completion(&node.id, &attempt).await,
            Ok(expected)
        );
        assert_eq!(read(&typed(&f)), "");
    }
}

#[tokio::test]
async fn b6_first_steer_exit_drops_the_unreleased_prompt() {
    let (f, mut gate) = gated(Duration::from_secs(30));
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    let attempt = f.attempt(&node.id).await;
    signal(&f, &node.id, "SessionStart").await;
    assert!(!released(&mut gate, &node.id).await);
    f.terminals
        .kill(node.terminal_id.as_ref().unwrap())
        .await
        .unwrap();
    assert_eq!(
        f.agents.first_steer_completion(&node.id, &attempt).await,
        Ok(FirstSteerCompletion::Refused)
    );
    assert_eq!(read(&typed(&f)), "");
}

#[tokio::test]
async fn b6_cancelling_a_completion_observer_keeps_the_physical_effect_accounted() {
    let (arrived, mut arrival) = tokio::sync::mpsc::unbounded_channel();
    let (release, released) = std::sync::mpsc::channel();
    let released = std::sync::Mutex::new(released);
    let mut f = frozen(Fixture::running(RECORD), BOUND);
    f.agents = f.agents.with_steer_effect(move |_| {
        arrived.send(()).unwrap();
        released.lock().unwrap().recv().unwrap();
        Ok(())
    });
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    let attempt = f.attempt(&node.id).await;
    signal(&f, &node.id, "SessionStart").await;
    star(f.dir.path());
    arrival.recv().await.unwrap();
    // Drop this observer at its deadline, then subscribe again while the writer is active.
    assert!(
        tokio::time::timeout(
            BOUND * 2,
            f.agents.first_steer_completion(&node.id, &attempt)
        )
        .await
        .is_err()
    );
    let next = f.agents.first_steer_completion(&node.id, &attempt);
    tokio::pin!(next);
    assert!(tokio::time::timeout(BOUND, &mut next).await.is_err());
    release.send(()).unwrap();
    // No submit: the retained result is an accounted timeout, never a second write.
    assert_eq!(next.await, Ok(FirstSteerCompletion::Uncertain));
    assert_eq!(
        until_typed(&f, paste("build it").len()).await,
        paste("build it")
    );
}

#[tokio::test]
async fn b6_first_steer_completion_refuses_a_failed_launch() {
    let f = Fixture::running(RECORD);
    std::fs::remove_file(f.dir.path().join("fake-claude")).unwrap();
    assert!(f.spawn(None, Some("build it")).await.is_err());
    assert!(f.tree().await.is_empty());
    assert_eq!(
        f.agents.first_steer_completion("1", "1").await,
        Err(agents::PromptError::NotFound {
            id: "1".into(),
            name: "an Agent that is gone".into()
        })
    );
}

#[tokio::test]
async fn b6_exit_cannot_settle_a_first_steer_queued_on_terminal_input() {
    let (f, mut gate) = gated(BOUND);
    let node = f.spawn(None, Some("build it")).await.unwrap();
    until_file(&f.dir.path().join("ready")).await;
    let attempt = f.attempt(&node.id).await;
    let terminal = node.terminal_id.as_ref().unwrap();
    let (arrived, arrival) = tokio::sync::oneshot::channel();
    let (release, input_release) = std::sync::mpsc::channel();
    let blocker = f.terminals.write_with(terminal, move |_| {
        arrived.send(()).unwrap();
        input_release.recv().unwrap();
        Ok(())
    });
    tokio::pin!(blocker);
    // Poll the real input operation to enqueue it; its closure acknowledges physical arrival.
    tokio::select! {
        result = &mut blocker => panic!("input blocker completed: {result:?}"),
        result = arrival => result.unwrap(),
    }
    signal(&f, &node.id, "SessionStart").await;
    assert!(!released(&mut gate, &node.id).await);
    star(f.dir.path());
    assert!(released(&mut gate, &node.id).await);
    let completion = f.agents.first_steer_completion(&node.id, &attempt);
    tokio::pin!(completion);
    // Shared::prompt enqueues before awaiting physical completion; this observation window
    // also exceeds H19's timer, which must not settle an already released prompt.
    assert!(
        tokio::time::timeout(BOUND * 2, &mut completion)
            .await
            .is_err()
    );
    f.terminals.kill(terminal).await.unwrap();
    f.until(|tree| matches!(status_of(tree, &node.id).kind, Kind::Done | Kind::Error))
        .await;
    assert!(
        tokio::time::timeout(BOUND, &mut completion).await.is_err(),
        "exit hid queued input"
    );
    release.send(()).unwrap();
    blocker.await.unwrap();
    assert_eq!(completion.await, Ok(FirstSteerCompletion::Uncertain));
}

#[tokio::test]
async fn b6_first_steer_completion_refuses_a_stale_attempt() {
    let f = Fixture::running(RECORD);
    let node = f.spawn(None, Some("build it")).await.unwrap();
    assert_eq!(
        f.agents.first_steer_completion(&node.id, "999").await,
        Err(agents::PromptError::NotFound {
            id: node.id,
            name: node.name
        })
    );
}

#[tokio::test]
async fn o2_a_spawn_without_prompt_or_order_types_nothing_and_holds_no_order() {
    let (f, id) = idle(BOUND).await;

    tokio::time::sleep(Duration::from_millis(200)).await;

    assert_eq!(read(&typed(&f)), "");
    let tree: Vec<contracts::agent::RailNode> = f.tree().await;
    assert_eq!(tree.iter().find(|node| node.id == id).unwrap().work, None);
}

async fn named_idle() -> (Arc<Fixture>, String) {
    let f = Arc::new(frozen(Fixture::running(RECORD), BOUND));
    rusqlite::Connection::open(f.dir.path().join("agents.db")).unwrap()
        .execute_batch("DELETE FROM sqlite_sequence WHERE name = 'nodes'; INSERT INTO sqlite_sequence(name,seq) VALUES('nodes',7012)").unwrap();
    let node = f.spawn(None, None).await.unwrap();
    assert_eq!(node.id, "7013");
    until_file(&f.dir.path().join("ready")).await;
    star(f.dir.path());
    start(&f, &node.id).await;
    (f, node.id)
}

#[tokio::test]
async fn a2703a_prompt_errors_use_rail_names() {
    let (f, id) = named_idle().await;
    f.call("rail.rename", json!({"id": id, "name": "sad"}))
        .await
        .unwrap();
    signal(&f, &id, "UserPromptSubmit").await;
    let busy = f.agents.prompt(&id, "hello").await.unwrap_err();
    assert!(matches!(busy, agents::PromptError::Busy { .. }));
    assert!(busy.to_string().contains("sad") && !busy.to_string().contains("7013"));
    signal(&f, &id, "Stop").await;
    let rejected = f.agents.prompt(&id, "hello").await.unwrap_err();
    assert!(matches!(rejected, agents::PromptError::NotAccepted { .. }));
    assert!(
        rejected
            .to_string()
            .contains("sad did not accept the prompt")
    );
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let stopped = f.agents.prompt(&id, "hello").await.unwrap_err();
    assert!(matches!(stopped, agents::PromptError::NotFound { .. }));
    assert!(stopped.to_string().contains("sad") && !stopped.to_string().contains("7013"));
    let gone = f.agents.prompt("8013", "hello").await.unwrap_err();
    assert!(gone.to_string().contains("an Agent that is gone"));
    assert!(!gone.to_string().contains("8013"));
}

#[tokio::test]
async fn a2703a_prompt_failure_uses_renamed_rail_name() {
    let (f, id) = named_idle().await;
    for name in ["sad", "glad"] {
        f.call("rail.rename", json!({"id":id,"name":name}))
            .await
            .unwrap();
        let error = f.agents.prompt(&id, "hello").await.unwrap_err().to_string();
        assert_eq!(error, format!("{name} did not accept the prompt"));
    }
}
