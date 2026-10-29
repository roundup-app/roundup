use super::*;

// The PTY reader retains early paste bytes but drops Enter until it has emitted its star.
// Its accepted file is the fake vendor's UserPromptSubmit, independent of Recorder's bytes.
const PROGRAM: &str = r#"#!/usr/bin/env python3
import os, pathlib, select, sys, tty
if len(sys.argv) > 1 and sys.argv[1] == 'plugin':
    print('Q11 runtime hook closure: 1 pass')
    sys.exit(0)
d = pathlib.Path(__file__).parent
tty.setraw(0)
(d / 'ready').touch()
starred = False
pending = b''
while True:
    if not starred and (d / 'star').exists():
        os.write(1, '\x1b]0;✳ Claude Code\x07'.encode())
        starred = True
    if select.select([0], [], [], 0.005)[0]:
        for byte in os.read(0, 4096):
            if byte == 13:
                if starred:
                    (d / 'accepted').write_bytes(pending)
                    pending = b''
            else:
                pending += bytes([byte])
"#;

async fn until_file(path: &std::path::Path) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

async fn new_part(f: &mut DoorHarness, text: &str) -> (Value, String, String) {
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send(text).await;
    f.h.calls
        .recv()
        .await
        .unwrap()
        .answer
        .send(vec![AskPart {
            text: text.into(),
            destination: Destination::New {
                title: "New work".into(),
            },
        }])
        .unwrap();
    let (id, attempt) = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            events.recv().await.unwrap();
            let tree =
                f.h.agents
                    .call(&f.h.ctx, "rail.tree", Value::Null)
                    .await
                    .unwrap();
            if tree[0]["terminal_id"].is_string() {
                break (
                    tree[0]["id"].as_str().unwrap().to_owned(),
                    tree[0]["attempt"].as_str().unwrap().to_owned(),
                );
            }
        }
    })
    .await
    .unwrap();
    (ask, id, attempt)
}

async fn star(f: &DoorHarness, dir: &std::path::Path, id: &str) {
    let mut events = f.h.ctx.bus.subscribe();
    std::fs::write(dir.join("star"), "").unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let contracts::EventData::AgentStatus(status) = events.recv().await.unwrap().data
                && status.id == id
                && status.status.kind == contracts::Kind::Idle
            {
                break;
            }
        }
    })
    .await
    .unwrap();
}

async fn unwritten(f: &mut DoorHarness) {
    assert!(
        tokio::time::timeout(Duration::from_millis(80), f.bytes.recv())
            .await
            .is_err()
    );
    assert_eq!(f.h.list().await[0]["parts"][0]["state"], "placing");
}

#[tokio::test]
async fn h4612a_session_start_alone_keeps_the_part_unwritten() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open_with_program(dir.path(), ASK_BOUND, Some(PROGRAM));
    let (_, id, attempt) = new_part(&mut f, "hello").await;
    f.signal(&id, "SessionStart").await;
    f.h.agents
        .first_steer_completion(&id, &attempt)
        .await
        .unwrap();
    unwritten(&mut f).await;
    star(&f, dir.path(), &id).await;
    assert_eq!(f.read().await, paste("hello"));
    f.signal(&id, "UserPromptSubmit").await;
    f.stop().await;
}

#[tokio::test]
async fn h4612a_star_alone_keeps_the_part_unwritten() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open_with_program(dir.path(), ASK_BOUND, Some(PROGRAM));
    let (_, id, _) = new_part(&mut f, "hello").await;
    star(&f, dir.path(), &id).await;
    unwritten(&mut f).await;
    f.signal(&id, "SessionStart").await;
    assert_eq!(f.read().await, paste("hello"));
    f.signal(&id, "UserPromptSubmit").await;
    f.stop().await;
}

#[tokio::test]
async fn h4612a_ready_part_is_written_once_byte_for_byte() {
    for text in ["hello café 🚀", "first\n  second\nthird", "/skill café"] {
        let dir = tempfile::tempdir().unwrap();
        let mut f = DoorHarness::open_with_program(dir.path(), ASK_BOUND, Some(PROGRAM));
        let mut events = f.h.ctx.bus.subscribe();
        let (ask, id, _) = new_part(&mut f, text).await;
        star(&f, dir.path(), &id).await;
        f.signal(&id, "SessionStart").await;
        assert_eq!(f.read_write().await, &paste(text)[..paste(text).len() - 1]);
        assert_eq!(f.read_write().await, b"\r");
        until_file(&dir.path().join("accepted")).await;
        assert_eq!(
            std::fs::read(dir.path().join("accepted")).unwrap(),
            &paste(text)[..paste(text).len() - 1]
        );
        f.signal(&id, "UserPromptSubmit").await;
        f.changed(&mut events, &ask["id"], "typed").await;
        f.signal(&id, "Stop").await;
        assert!(
            tokio::time::timeout(Duration::from_millis(80), f.bytes.recv())
                .await
                .is_err()
        );
        f.stop().await;
    }
}

#[tokio::test]
async fn h4612a_part_waits_for_submit_acceptance() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open_with_program(dir.path(), ASK_BOUND, Some(PROGRAM));
    let mut events = f.h.ctx.bus.subscribe();
    let (ask, id, _) = new_part(&mut f, "hello").await;
    star(&f, dir.path(), &id).await;
    f.signal(&id, "SessionStart").await;
    assert_eq!(f.read().await, paste("hello"));
    until_file(&dir.path().join("accepted")).await;
    assert_eq!(f.h.list().await[0]["parts"][0]["state"], "placing");
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    f.stop().await;
}

#[tokio::test]
async fn h4612a_missing_star_fails_without_late_typing() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open_with_program(dir.path(), ASK_BOUND, Some(PROGRAM));
    let mut events = f.h.ctx.bus.subscribe();
    let (ask, id, attempt) = new_part(&mut f, "hello").await;
    until_file(&dir.path().join("ready")).await;
    tokio::time::pause();
    f.signal(&id, "SessionStart").await;
    f.h.agents
        .first_steer_completion(&id, &attempt)
        .await
        .unwrap();
    tokio::time::advance(agents::START_DOOR_ACK_BOUND).await;
    let failed = f.changed(&mut events, &ask["id"], "failed").await;
    tokio::time::resume();
    assert_eq!(failed["parts"][0]["reason"], "prompt not accepted");
    assert!(f.bytes.try_recv().is_err());
    star(&f, dir.path(), &id).await;
    assert!(
        tokio::time::timeout(Duration::from_millis(80), f.bytes.recv())
            .await
            .is_err()
    );
    assert_eq!(f.h.list().await[0]["parts"][0]["state"], "failed");
    f.stop().await;
}

#[tokio::test]
async fn h4612a_previous_attempt_cannot_open_the_gate() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open_with_program(dir.path(), ASK_BOUND, Some(PROGRAM));
    let mut events = f.h.ctx.bus.subscribe();
    let (ask, id, attempt) = new_part(&mut f, "original attempt only").await;
    star(&f, dir.path(), &id).await;
    // Replace a starred Attempt before its SessionStart. Its observations must not
    // let the old Ask worker type into the replacement, even when that one is ready.
    f.h.agents
        .call(&f.h.ctx, "agent.stop", json!({"id":id}))
        .await
        .unwrap();
    while f.bytes.try_recv().is_ok() {}
    let node =
        f.h.agents
            .call(&f.h.ctx, "rail.startDoor", json!({"id":id}))
            .await
            .unwrap();
    assert_ne!(node["attempt"], attempt);
    let stale =
        f.h.agents
            .call(
                &f.h.ctx,
                "agent.signal",
                json!({"id":id,"attempt":attempt,"payload":{"hook_event_name":"SessionStart"}}),
            )
            .await;
    // A stale Signal may be ignored or refused, but never folds into the new Attempt.
    let _ = stale;
    f.signal(&id, "SessionStart").await;
    let failed = f.changed(&mut events, &ask["id"], "failed").await;
    assert_eq!(failed["parts"][0]["reason"], "prompt not accepted");
    assert!(
        tokio::time::timeout(Duration::from_millis(80), f.bytes.recv())
            .await
            .is_err()
    );
    f.stop().await;
}
