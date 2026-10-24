//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/child_run.rs"]
mod child_run;
use door_terminals::{notice_events, recorded_bytes};
use child_run::{BOUND, Run};

use base64::{Engine, engine::general_purpose::STANDARD};
use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The Door is mid-turn, so Messages to it stay pending.
async fn busy_door(run: &Run, door: &str, attempt: &Value) {
    tokio::time::timeout(BOUND, async {
        loop {
            let tree = run.user.request("rail.tree", ()).await.unwrap();
            if tree
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["id"] == door && n["status"]["kind"] == "idle")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    run.user.request("agent.signal", json!({"id":door,"attempt":attempt,"payload":{"hook_event_name":"UserPromptSubmit"}})).await.unwrap();
}

async fn failed_notice(
    run: &Run,
    events: &mut Client,
    decision: &Value,
    failure: &str,
    sent: Option<&contracts::message::Message>,
    bound: Duration,
) -> Result<Value, String> {
    let started = Instant::now();
    let marker = format!("[decision {}]", decision["id"].as_str().unwrap());
    let mut stage = sent.map_or_else(
        || "Decision opened (decision.list)".to_owned(),
        |message| format!("message.sent: {}", serde_json::to_value(message).unwrap()),
    );
    let observed = tokio::time::timeout(bound, async {
        loop {
            let event = events
                .next_event()
                .await
                .ok_or("subscription closed".to_owned())?;
            let (name, message) = match event.data {
                EventData::MessageSent(m) => ("message.sent", m),
                EventData::MessageDropped(m) => ("message.dropped", m),
                EventData::MessageDelivered(m) => ("message.delivered", m),
                _ => continue,
            };
            if !message.body.contains(&marker) {
                continue;
            }
            stage = format!("{name}: {}", serde_json::to_value(&message).unwrap());
            eprintln!("{failure}: {:?}; {stage}", started.elapsed());
            if name == "message.delivered" && message.to == contracts::Actor::user().id {
                let stored = run
                    .user
                    .request("message.get", json!({"id":message.id}))
                    .await
                    .map_err(|err| format!("durable read-back unavailable: {err}"))?;
                if stored["status"] != "delivered" || stored["body"] != message.body {
                    return Err(format!(
                        "delivery event disagrees with durable record: {stored}"
                    ));
                }
                return Ok(stored);
            }
        }
    })
    .await;
    let error = match observed {
        Ok(Ok(message)) => {
            eprintln!(
                "{failure}: {} observed and read back after {:?}",
                decision["id"],
                started.elapsed()
            );
            return Ok(message);
        }
        Ok(Err(err)) => err,
        Err(err) => format!("notice observation expired: {err}"),
    };
    // Diagnostics get their own finite bound, including an unresponsive Daemon.
    let mailbox = match tokio::time::timeout(
        Duration::from_secs(2),
        run.user.request("message.list", json!({})),
    )
    .await
    {
        Ok(Ok(messages)) => {
            let relevant: Vec<_> = messages
                .as_array()
                .unwrap()
                .iter()
                .filter(|m| m["body"].as_str().unwrap().contains(&marker))
                .collect();
            serde_json::to_string(&relevant).unwrap()
        }
        Ok(Err(err)) => format!("unavailable: {err}"),
        Err(err) => format!("unavailable: diagnostic read expired: {err}"),
    };
    Err(format!(
        "{failure}: Decision {}; elapsed {:?}; {error}; last stage {stage}; stored Messages {mailbox}",
        decision["id"],
        started.elapsed()
    ))
}

#[tokio::test]
async fn b37_a_failed_decision_note_is_retained_or_visible_to_the_user() {
    // B50(e): a note never reaches the Terminal, so a Terminal refusal cannot fail one; the failure
    // of its inbox leaves it pending (B51), not dropped.
    for failure in ["send", "full"] {
        let mut run = Run::start().await;
        let door = run
            .user
            .request("rail.createWorkstream", json!({"name":"supervisor"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        run.door = Some(door.clone());
        run.spawn().await;
        let mut events = notice_events(&run).await;
        let mut monitor = notice_events(&run).await;
        if failure == "terminal" {
            std::fs::write(run.dir.path().join("decision-notice-fixture"), "").unwrap();
        }
        let started = run
            .user
            .request("rail.startDoor", json!({"id":door}))
            .await
            .unwrap();
        if failure != "terminal" {
            busy_door(&run, &door, &started["attempt"]).await;
        }
        if failure == "full" {
            // Setup may already have queued a Digest. Fill the actual remaining capacity.
            for _ in 0..=32 {
                if let Err(err) = run
                    .user
                    .request(
                        "message.send",
                        json!({"to":door,"kind":"note","body":"queued"}),
                    )
                    .await
                {
                    assert_eq!(err.code, rpc::code::CONFLICT);
                    assert!(err.message.contains("32 pending"), "{err}");
                    break;
                }
            }
        }
        if failure == "send" {
            run.user
                .request("agent.stop", json!({"id":door}))
                .await
                .unwrap();
        }
        // A background Steer must submit before refusal of the Decision note can be isolated.
        let occupying = if failure == "terminal" {
            tokio::time::timeout(BOUND, async {
                loop {
                    if matches!(monitor.next_event().await.unwrap().data,
                        EventData::MessageDropped(ref m) | EventData::MessageDelivered(ref m)
                        if m.to == door && m.body.starts_with("[digest]"))
                    {
                        break;
                    }
                }
            })
            .await
            .unwrap();
            let mut selector = Client::connect(&run.daemon.socket).await.unwrap();
            let mut selected = selector.take_output().unwrap();
            let terminals = run.user.request("terminal.list", ()).await.unwrap();
            for terminal in terminals
                .as_array()
                .unwrap()
                .iter()
                .filter(|terminal| terminal["running"] == true)
            {
                selector
                    .request("terminal.output", json!({"id":terminal["id"]}))
                    .await
                    .unwrap();
            }
            std::fs::write(run.dir.path().join("background-gate"), "").unwrap();
            let sender = Arc::clone(&run.user);
            let receiver = door.clone();
            let task = tokio::spawn(async move {
                sender
                    .request(
                        "message.send",
                        json!({"to":receiver,"kind":"note","body":"occupying steer"}),
                    )
                    .await
            });
            tokio::time::timeout(BOUND, async {
                let mut output = String::new();
                // The paste ends with the B39 id line, then the bracketed-paste end and the Enter.
                let expected: String = b"]\x1b[201~\r"
                    .iter()
                    .map(|byte| format!("BYTE:{byte:02x}\n"))
                    .collect();
                loop {
                    if let rpc::OutputFrame::Bytes(out) = selected.recv().await.unwrap() {
                        output.push_str(&String::from_utf8_lossy(
                            &STANDARD.decode(out.data).unwrap(),
                        ));
                        if output.contains(&expected) {
                            break;
                        }
                    }
                }
            })
            .await
            .unwrap();
            Some(task)
        } else {
            None
        };
        let (decision, waiting) = run.open("permission").await;
        if failure == "terminal" {
            tokio::time::timeout(BOUND, async {
                loop {
                    if matches!(monitor.next_event().await.unwrap().data, EventData::MessageSent(ref m)
                        if m.body.contains(&format!("[decision {}]", decision["id"].as_str().unwrap()))) { break; }
                }
            }).await.unwrap();
            std::fs::remove_file(run.dir.path().join("background-gate")).unwrap();
        }
        let notice = failed_notice(
            &run,
            &mut events,
            &decision,
            failure,
            None,
            Duration::from_secs(40),
        )
        .await
        .unwrap_or_else(|err| panic!("{err}"));
        if let Some(task) = occupying {
            let background = task.await.unwrap().unwrap();
            assert_eq!(
                run.user
                    .request("message.get", json!({"id":background["id"]}))
                    .await
                    .unwrap()["status"],
                "delivered"
            );
        }
        assert!(notice["body"].as_str().unwrap().contains("delivery failed"));
        assert_eq!(notice["status"], "delivered");
        if failure == "full" {
            assert!(
                notice["body"]
                    .as_str()
                    .unwrap()
                    .contains("32 pending"),
                "{notice}"
            );
        }
        if failure == "terminal" {
            let refused = run
                .user
                .request("message.get", json!({"id":notice["replyTo"]}))
                .await
                .unwrap();
            assert_eq!(refused["status"], "dropped");
            assert_eq!(refused["reason"], "not accepted");
            assert_eq!(refused["to"], door);
        }
        assert_eq!(
            run.user
                .request("message.get", json!({"id":notice["id"]}))
                .await
                .unwrap(),
            notice
        );
        assert_eq!(
            run.user.request("decision.list", ()).await.unwrap()[0],
            decision
        );
        run.user_answer(&decision, "permission").await;
        let outcome = waiting.await.unwrap().unwrap();
        assert!(
            outcome["output"].as_str().unwrap().contains("allow"),
            "{outcome}"
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b38_a_missing_notice_fails_with_bounded_delivery_evidence() {
    for stopped in [false, true] {
        let mut run = Run::start().await;
        let door = run
            .user
            .request("rail.createWorkstream", json!({"name":"supervisor"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        run.door = Some(door.clone());
        run.spawn().await;
        std::fs::write(run.dir.path().join("decision-notice-fixture"), "").unwrap();
        let mut events = notice_events(&run).await;
        let mut monitor = notice_events(&run).await;
        run.user
            .request("rail.startDoor", json!({"id":door}))
            .await
            .unwrap();
        tokio::time::timeout(BOUND, async {
            loop {
                if matches!(monitor.next_event().await.unwrap().data,
                    EventData::MessageDelivered(ref m) | EventData::MessageDropped(ref m)
                    if m.to == door && m.body.starts_with("[digest]"))
                {
                    break;
                }
            }
        })
        .await
        .unwrap();
        // The real Terminal writer acknowledges arrival but cannot complete or refuse yet.
        let gate = run.dir.path().join("input-gate");
        std::fs::write(&gate, "pause").unwrap();
        let (decision, waiting) = run.open("permission").await;
        let marker = format!("[decision {}]", decision["id"].as_str().unwrap());
        let sent = tokio::time::timeout(BOUND, async {
            loop {
                if let EventData::MessageSent(m) = events.next_event().await.unwrap().data
                    && m.body.contains(&marker)
                {
                    break m;
                }
            }
        })
        .await
        .unwrap();
        let signal = |name: &str| {
            assert!(
                std::process::Command::new("kill")
                    .args([name, &run.daemon.child.id().to_string()])
                    .status()
                    .unwrap()
                    .success()
            );
        };
        if stopped {
            signal("-STOP");
        }
        let observed = tokio::time::timeout(
            Duration::from_secs(8),
            failed_notice(
                &run,
                &mut events,
                &decision,
                "terminal",
                Some(&sent),
                Duration::from_millis(300),
            ),
        )
        .await;
        if stopped {
            signal("-CONT");
        }
        std::fs::remove_file(gate).unwrap();
        let error = observed
            .expect("observation and diagnostic reads are bounded")
            .unwrap_err();
        assert!(error.contains("terminal: Decision"), "{error}");
        assert!(error.contains(decision["id"].as_str().unwrap()), "{error}");
        assert!(
            error.contains("elapsed") && error.contains("last stage message.sent"),
            "{error}"
        );
        assert!(error.contains(&format!("\"id\":{}", sent.id)), "{error}");
        assert!(
            error.contains("\"status\":\"pending\"") && error.contains("\"reason\":null"),
            "{error}"
        );
        if stopped {
            assert!(
                error.contains("stored Messages unavailable: diagnostic read expired"),
                "{error}"
            );
        } else {
            assert!(!error.contains("unavailable"), "{error}");
            assert!(error.contains("stored Messages [{"), "{error}");
        }
        run.user_answer(&decision, "permission").await;
        assert!(
            waiting.await.unwrap().unwrap()["output"]
                .as_str()
                .unwrap()
                .contains("allow")
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b37_decision_note_exclusions_still_hold() {
    for exclusion in ["unanswerable", "no Door"] {
        let mut run = Run::start().await;
        let door = run
            .user
            .request("rail.createWorkstream", json!({"name":"supervisor"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        if exclusion != "no Door" {
            run.user
                .request("agent.stop", json!({"id":run.child}))
                .await
                .unwrap();
            run.door = Some(door.clone());
            run.spawn().await;
        }
        let kind = if exclusion == "unanswerable" {
            "native"
        } else {
            "permission"
        };
        let (excluded, waiting) = run.open(kind).await;
        run.user_answer(&excluded, kind).await;
        waiting.await.unwrap().unwrap();
        // A later eligible Decision's Message acknowledges the serial note consumer has
        // passed the excluded Decision; no duration stands in for that ordering boundary.
        let excluded_child = run.child.clone();
        run.door = Some(door.clone());
        run.spawn().await;
        let (witness, waiting) = run.open("permission").await;
        let messages = tokio::time::timeout(BOUND, async {
            loop {
                let messages = run.user.request("message.list", json!({})).await.unwrap();
                if messages.as_array().unwrap().iter().any(|m| {
                    m["body"]
                        .as_str()
                        .unwrap()
                        .starts_with(&format!("[decision {}]", witness["id"].as_str().unwrap()))
                }) {
                    break messages;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(
            !messages.as_array().unwrap().iter().any(|m| m["body"]
                .as_str()
                .unwrap()
                .starts_with(&format!("[decision {}]", excluded["id"].as_str().unwrap()))),
            "{exclusion}: {messages}"
        );
        run.user_answer(&witness, "permission").await;
        waiting.await.unwrap().unwrap();
        run.user
            .request("agent.stop", json!({"id":excluded_child}))
            .await
            .unwrap();
        run.finish().await;
    }
}

#[tokio::test]
async fn b37_a_stop_failure_door_receives_its_answered_childs_decision_note() {
    let mut run = Run::start().await;
    let door = run
        .user
        .request("rail.createWorkstream", json!({"name":"supervisor"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    run.door = Some(door.clone());
    run.spawn().await;
    std::fs::write(run.dir.path().join("order-submit"), "").unwrap();
    let mut events = notice_events(&run).await;
    run.user
        .request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    let door_node = tokio::time::timeout(BOUND, async {
        loop {
            let tree = run.user.request("rail.tree", ()).await.unwrap();
            let node = tree
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == door)
                .unwrap();
            if node["status"]["kind"] == "idle" {
                break node.clone();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    busy_door(&run, &door, &door_node["attempt"]).await;
    let (decision, waiting) = run.open("permission").await;
    let marker = format!("[decision {}]", decision["id"].as_str().unwrap());
    let note = tokio::time::timeout(BOUND, async {
        loop {
            if let EventData::MessageSent(m) = events.next_event().await.unwrap().data
                && m.to == door
                && m.body.starts_with(&marker)
            {
                break m;
            }
        }
    })
    .await
    .unwrap();
    run.user.request("agent.signal", json!({"id":door,"attempt":door_node["attempt"],"payload":{"hook_event_name":"StopFailure","error":"server_error"}})).await.unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            if let EventData::AgentStatus(s) = events.next_event().await.unwrap().data
                && s.id == door
                && s.status.kind == contracts::Kind::Error
            {
                break;
            }
        }
    })
    .await
    .unwrap();
    let caller = Client::connect(&run.daemon.socket).await.unwrap();
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door}}),
        )
        .await
        .unwrap();
    caller
        .request(
            "decision.answer",
            json!({"id":decision["id"],"answer":"allow","proof":"0".repeat(64)}),
        )
        .await
        .unwrap();
    assert!(waiting.await.unwrap().is_ok());
    tokio::time::timeout(BOUND, async {
        let mut delivered = false;
        let mut working = false;
        while !delivered || !working {
            match events.next_event().await.unwrap().data {
                EventData::MessageDelivered(m) if m.id == note.id => delivered = true,
                EventData::AgentStatus(s)
                    if s.id == door && s.status.kind == contracts::Kind::Working =>
                {
                    working = true
                }
                _ => {}
            }
        }
    })
    .await
    .unwrap();
    let stored = run
        .user
        .request("message.get", json!({"id":note.id}))
        .await
        .unwrap();
    assert_eq!(stored["status"], "delivered");
    // B50: the note is one line on the Door's messaging socket, and none of it is typed.
    let inbox =
        std::fs::read_to_string(run.dir.path().join(format!("received-{door}.jsonl"))).unwrap();
    assert_eq!(inbox.matches(&marker).count(), 1, "{inbox}");
    let screen = run
        .user
        .request(
            "terminal.read",
            json!({"id":door_node["terminal_id"],"after":0}),
        )
        .await
        .unwrap()["text"]
        .as_str()
        .unwrap()
        .to_owned();
    let typed: Vec<u8> = screen
        .lines()
        .filter_map(|line| line.trim_start().strip_prefix("BYTE:"))
        .map(|hex| u8::from_str_radix(hex.trim(), 16).unwrap())
        .collect();
    assert!(
        !String::from_utf8_lossy(&typed).contains(&marker),
        "{screen}"
    );
    run.finish().await;
}

async fn input_after_error(pending: bool) {
    let run = Run::start().await;
    std::fs::write(run.dir.path().join("order-submit"), "").unwrap();
    let mut events = notice_events(&run).await;
    if pending {
        run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit"}})).await.unwrap();
        for body in ["one", "two"] {
            run.user
                .request(
                    "message.send",
                    json!({"to":run.child,"kind":"note","body":body}),
                )
                .await
                .unwrap();
        }
    }
    run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"StopFailure","error":"server_error"}})).await.unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            if let EventData::AgentStatus(s) = events.next_event().await.unwrap().data
                && s.id == run.child
                && s.status.kind == contracts::Kind::Error
            {
                break;
            }
        }
    })
    .await
    .unwrap();
    if !pending {
        run.user
            .request(
                "message.send",
                json!({"to":run.child,"kind":"note","body":"one"}),
            )
            .await
            .unwrap();
    }
    tokio::time::timeout(BOUND, async {
        let mut delivered = 0;
        let mut working = false;
        while delivered < if pending { 2 } else { 1 } || !working {
            match events.next_event().await.unwrap().data {
                EventData::MessageDelivered(m) if m.to == run.child => delivered += 1,
                EventData::AgentStatus(s)
                    if s.id == run.child && s.status.kind == contracts::Kind::Working =>
                {
                    assert_eq!(s.attempt, run.attempt.as_str().unwrap());
                    working = true;
                }
                _ => {}
            }
        }
    })
    .await
    .unwrap();
    // B3563c: the Messages reach the inbox once each, in id order, and no byte is typed.
    let inbox = std::fs::read_to_string(
        run.dir
            .path()
            .join(format!("received-{}.jsonl", run.child)),
    )
    .unwrap();
    let bodies: Vec<String> = inbox
        .lines()
        .map(|line| {
            serde_json::from_str::<Value>(line).unwrap()["message"]["content"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    let expected: &[&str] = if pending { &["one", "two"] } else { &["one"] };
    assert_eq!(bodies.len(), expected.len(), "{inbox}");
    for (body, wanted) in bodies.iter().zip(expected) {
        assert!(body.contains(wanted), "{inbox}");
    }
    let typed = String::from_utf8(recorded_bytes(&run).await).unwrap();
    assert!(!typed.contains("[from"), "Message bytes were typed: {typed}");
    run.finish().await;
}

#[tokio::test]
async fn b37_a_live_error_accepts_and_delivers_a_new_message() {
    input_after_error(false).await;
}

#[tokio::test]
async fn b37_stop_failure_delivers_pending_messages_in_id_order() {
    input_after_error(true).await;
}
