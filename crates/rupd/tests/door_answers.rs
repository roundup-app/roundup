//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{door_terminal, start_answer_door};
use takeover_run::{BOUND, Run, launch};

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::Client;
use serde_json::{Value, json};
use std::sync::Arc;

#[tokio::test]
async fn b6_wire_door_decision_calls_wait_for_all_earlier_resizes() {
    for (kind, method) in [
        ("permission", "decision.list"),
        ("ask_user", "decision.list"),
        ("permission", "decision.capture"),
        ("ask_user", "decision.capture"),
        ("permission", "decision.answers"),
        ("ask_user", "decision.answers"),
        ("permission", "decision.answer"),
        ("ask_user", "decision.answer"),
    ] {
        let (run, caller) = door_terminal().await;
        let (door, terminal) = start_answer_door(&run).await;
        let (decision, waiting) = run.open(kind).await;
        let identity = run.capture(&decision).await;
        run.pause();
        let id = run.terminal.clone();
        let first = tokio::spawn(async move {
            caller
                .request("terminal.resize", json!({"id":id,"cols":101,"rows":37}))
                .await
        });
        run.paused().await;
        let mut frames = vec![
            json!({"id":1,"method":"daemon.identify","params":{"actor":{"kind":"agent","id":door}}}),
        ];
        for cols in 102..110 {
            frames.push(json!({"id":cols,"method":"terminal.resize","params":{"id":run.terminal,"cols":cols,"rows":37}}));
        }
        let params = match method {
            "decision.list" => Value::Null,
            "decision.capture" => json!({"id":decision["id"]}),
            "decision.answers" => json!({"agent":run.child}),
            _ => {
                json!({"id":decision["id"],"identity":identity,"answer":if kind == "permission" { "allow" } else { "Yes" }})
            }
        };
        frames.push(json!({"id":110,"method":method,"params":params}));
        frames.push(json!({"id":111,"method":"rail.tree"}));
        std::fs::write(
            run.dir.path().join("peer-request"),
            serde_json::to_vec(&frames).unwrap(),
        )
        .unwrap();
        // The real Door sends the batch, retaining H21's authenticated process identity.
        run.user
            .request(
                "terminal.write",
                json!({"id":terminal,"data":STANDARD.encode(b"\x02")}),
            )
            .await
            .unwrap();
        tokio::time::timeout(BOUND, async {
            while !run.dir.path().join("peer-barrier").is_file() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        run.release();
        let replies: Value = tokio::time::timeout(BOUND, async {
            loop {
                if let Ok(text) = std::fs::read_to_string(run.dir.path().join("peer-result"))
                    && let Ok(value) = serde_json::from_str::<Value>(&text)
                {
                    break value;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        first.await.unwrap().unwrap();
        if method != "decision.answer" {
            run.user_answer(&decision, kind).await;
        }
        waiting.await.unwrap().unwrap();
        for reply in replies.as_array().unwrap() {
            assert!(reply.get("result").is_some(), "{reply}");
        }
        let order: Vec<_> = replies
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["id"].as_u64().unwrap())
            .collect();
        run.user
            .request("agent.stop", json!({"id":door}))
            .await
            .unwrap();
        run.finish().await;
        assert_eq!(
            order,
            [1, 111, 102, 103, 104, 105, 106, 107, 108, 109, 110],
            "{kind} {method}: Decision call overtook an earlier wire resize"
        );
    }
}

// U468's backend prerequisite; the App observer belongs to #1497.
#[tokio::test]
async fn u468_a_door_answer_remains_visible_with_its_identity() {
    let (mut run, door, door_terminal) = answer_child().await;
    let unrelated = run
        .user
        .request("rail.createWorkstream", json!({"name":"unrelated"}))
        .await
        .unwrap()["id"]
        .clone();
    // Seed an answered request in a different Workstream before the retained ones.
    let original_child = run.child.clone();
    let original_terminal = run.terminal.clone();
    let original_attempt = run.attempt.clone();
    run.door = Some(unrelated.as_str().unwrap().to_owned());
    run.spawn().await;
    let unrelated_child = run.child.clone();
    let (outside_request, outside_waiting) = run.open("permission").await;
    let denied = door_call(
        &run,
        &door_terminal,
        "decision.answer",
        json!({"id":outside_request["id"],"answer":"allow"}),
    )
    .await;
    assert_eq!(denied["error"]["code"], rpc::code::FORBIDDEN);
    assert_eq!(
        run.user.request("decision.list", ()).await.unwrap(),
        json!([outside_request])
    );
    assert_eq!(
        run.user
            .request("decision.answers", json!({"agent":unrelated_child}))
            .await
            .unwrap(),
        json!([])
    );
    run.user_answer(&outside_request, "permission").await;
    outside_waiting.await.unwrap().unwrap();
    run.child = original_child;
    run.terminal = original_terminal;
    run.attempt = original_attempt;
    run.door = Some(door.clone());
    let mut originals = Vec::new();
    for (kind, answer, note) in [
        ("ask_user", "Yes", "Exact note: α\nsecond line"),
        ("permission", "allow", ""),
        ("permission", "deny", ""),
    ] {
        let prompt = if kind == "permission" {
            format!("{}complete tail", "long command α\n".repeat(600))
        } else {
            "Question?\nComplete second line".to_owned()
        };
        let (decision, waiting) = run.open_prompt(kind, &prompt).await;
        let reply = door_call(
            &run,
            &door_terminal,
            "decision.answer",
            json!({"id":decision["id"],"answer":answer,"note":note}),
        )
        .await;
        assert!(reply.get("error").is_none(), "{reply}");
        waiting.await.unwrap().unwrap();
        originals.push((decision, answer, note, prompt));
    }
    // The first answer reader connects only after all answers have completed.
    let reader = Client::connect(&run.daemon.socket).await.unwrap();
    let records = reader
        .request("decision.answers", json!({"agent":run.child}))
        .await
        .unwrap();
    assert_eq!(records.as_array().unwrap().len(), 3);
    assert_ne!(originals[0].0["id"], originals[1].0["id"]);
    for (record, (decision, answer, note, prompt)) in
        records.as_array().unwrap().iter().zip(&originals)
    {
        assert_eq!(record["decision"], *decision);
        assert_eq!(
            record["kind"],
            if decision["tool"] == "ask_user" {
                "question"
            } else {
                "permission"
            }
        );
        let original: Value = serde_json::from_str(record["prompt"].as_str().unwrap()).unwrap();
        assert_eq!(
            original[if decision["tool"] == "ask_user" {
                "question"
            } else {
                "command"
            }],
            *prompt
        );
        assert_eq!(record["answer"], *answer);
        assert_eq!(record["note"], *note);
        assert_eq!(record["answered_by"]["kind"], "agent");
        assert_eq!(record["answered_by"]["id"], door);
    }
    let outside = door_call(
        &run,
        &door_terminal,
        "decision.answers",
        json!({"agent":unrelated_child}),
    )
    .await;
    assert_eq!(outside["error"]["code"], rpc::code::FORBIDDEN);
    assert_eq!(
        reader
            .request("decision.answers", json!({"agent":unrelated_child}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        door_call(
            &run,
            &door_terminal,
            "decision.answers",
            json!({"agent":run.child})
        )
        .await["result"],
        records
    );
    drop(reader);
    let project = run.dir.path().to_owned();
    let data = run.data.path().to_owned();
    drop(run.daemon);
    run.daemon = launch(&project, &data);
    run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
    assert_eq!(
        run.user
            .request("decision.answers", json!({"agent":run.child}))
            .await
            .unwrap(),
        records
    );
    run.resumed().await;
    let (new_request, waiting) = run.open("permission").await;
    assert!(
        !records
            .as_array()
            .unwrap()
            .iter()
            .any(|record| record["decision"]["id"] == new_request["id"])
    );
    run.user_answer(&new_request, "permission").await;
    waiting.await.unwrap().unwrap();
    let after = run
        .user
        .request("decision.answers", json!({"agent":run.child}))
        .await
        .unwrap();
    assert_eq!(&after.as_array().unwrap()[..3], records.as_array().unwrap());
    assert_eq!(after.as_array().unwrap().len(), 4);
    run.finish().await;
}

#[tokio::test]
async fn u468_a_child_permission_is_answered_in_its_terminal() {
    let run = Run::start().await;
    let (decision, waiting) = run.open("native").await;
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let kinds: Vec<_> = tree
        .as_array()
        .unwrap()
        .iter()
        .filter(|node| node["id"] == run.child)
        .map(|node| node["status"]["kind"].clone())
        .collect();
    assert_eq!(kinds, [json!("needs-you")]);
    // The user answers by typing into the child's Terminal, with no Takeover.
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"y")}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("BYTE:79") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        run.user.request("decision.list", ()).await.unwrap()[0]["id"],
        decision["id"]
    );
    run.clear().await;
    waiting.await.unwrap().unwrap();
    assert_eq!(
        run.user.request("decision.list", ()).await.unwrap(),
        json!([])
    );
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .filter(|node| node["id"] == run.child)
            .all(|node| node["status"]["kind"] != "needs-you")
    );
    run.finish().await;
}

// D13: the Status reads `needs-you` before the request is published, so a reader that sees the
// Decision in `decision.list` and reads `rail.tree` once never meets an idle Agent.
#[tokio::test]
async fn d13_a_decision_in_the_list_means_the_agent_reads_needs_you() {
    let run = Run::start().await;
    for round in 0..30 {
        let kind = if round % 2 == 0 {
            "native"
        } else {
            "permission"
        };
        let (decision, waiting) = run.open(kind).await;
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        let kinds: Vec<_> = tree
            .as_array()
            .unwrap()
            .iter()
            .filter(|node| node["id"] == run.child)
            .map(|node| node["status"]["kind"].clone())
            .collect();
        assert_eq!(kinds, [json!("needs-you")], "round {round} ({kind})");
        run.user_answer(&decision, kind).await;
        waiting.await.unwrap().unwrap();
    }
    run.finish().await;
}

async fn answer_child() -> (Run, String, Value) {
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
    let door_node = run
        .user
        .request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    let door_terminal = door_node["terminal_id"].clone();
    run.user
        .request(
            "terminal.write",
            json!({"id":door_terminal,"data":STANDARD.encode(b"\r")}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            let screen = run
                .user
                .request("terminal.read", json!({"id":door_terminal,"after":0}))
                .await
                .unwrap();
            if screen["text"].as_str().unwrap().contains("READY") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (run, door, door_terminal)
}

#[tokio::test]
async fn u468_backend_refused_answers_are_readable_on_the_actionable_original() {
    let (run, door, terminal) = answer_child().await;
    for (kind, refusal) in [
        ("ask_user", "label"),
        ("permission", "word"),
        ("permission", "proof"),
        ("permission", "identity"),
    ] {
        let (decision, waiting) = run.open(kind).await;
        let mut params =
            json!({"id":decision["id"],"answer":if kind == "ask_user" { "Yes" } else { "allow" }});
        let expected = match refusal {
            "label" | "word" => {
                params["answer"] = json!("unlisted");
                rpc::code::INVALID_PARAMS
            }
            "proof" => rpc::code::FORBIDDEN,
            "identity" => {
                let mut identity = run.capture(&decision).await;
                identity["attempt"] = json!("an earlier Attempt");
                params["identity"] = identity;
                rpc::code::CONFLICT
            }
            _ => unreachable!(),
        };
        let reply = if refusal == "proof" {
            // A claimed Door is still an unauthenticated user process.
            run.user
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":door}}),
                )
                .await
                .unwrap();
            let error = run
                .user
                .request("decision.answer", params)
                .await
                .unwrap_err();
            json!({"error":{"code":error.code}})
        } else {
            door_call(&run, &terminal, "decision.answer", params).await
        };
        if refusal == "proof" {
            run.user
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"user","id":"you"}}),
                )
                .await
                .unwrap();
        }
        assert_eq!(reply["error"]["code"], expected, "{refusal}: {reply}");
        let mut listed = run.user.request("decision.list", ()).await.unwrap();
        if matches!(refusal, "label" | "word") {
            let failure = listed[0]
                .as_object_mut()
                .unwrap()
                .remove("failure")
                .unwrap();
            assert_eq!(failure["error_code"], expected);
            assert_eq!(failure["message"], reply["error"]["message"]);
            assert_eq!(
                failure["message"],
                match refusal {
                    "label" => format!(
                        "decision {} takes one of its listed answers, or a note as your own",
                        decision["id"].as_str().unwrap()
                    ),
                    "word" => "answer is allow or deny, with no note".to_owned(),
                    _ => unreachable!(),
                }
            );
            assert_eq!(failure["answered_by"]["kind"], "agent");
            assert_eq!(failure["answered_by"]["id"], door);
            assert_eq!(failure["attempt"], run.attempt);
            assert!(failure["failed_at"].as_i64().unwrap() > 0);
        }
        assert_eq!(listed, json!([decision]));
        let records = run
            .user
            .request("decision.answers", json!({"agent":run.child}))
            .await
            .unwrap();
        assert!(
            !records
                .as_array()
                .unwrap()
                .iter()
                .any(|record| record["decision"]["id"] == decision["id"]),
            "{refusal}: {records}"
        );
        // An ordinary successful retry proves the same request is still actionable.
        run.user_answer(&decision, kind).await;
        waiting.await.unwrap().unwrap();
        let accepted = run
            .user
            .request("decision.answers", json!({"agent":run.child}))
            .await
            .unwrap();
        assert_eq!(
            accepted.as_array().unwrap().last().unwrap()["decision"],
            decision
        );
    }
    run.finish().await;
}

#[tokio::test]
async fn u468_storage_refusal_keeps_the_request_actionable() {
    let (run, _, terminal) = answer_child().await;
    let (decision, waiting) = run.open("permission").await;
    // Inject a storage refusal; all verification still crosses the public Daemon.
    let path = rupd::data::project_data(run.data.path(), run.dir.path())
        .unwrap()
        .join("project.db");
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_answer BEFORE INSERT ON decision_answers BEGIN SELECT RAISE(ABORT, 'storage refused'); END;").unwrap();
    let reply = door_call(
        &run,
        &terminal,
        "decision.answer",
        json!({"id":decision["id"],"answer":"allow"}),
    )
    .await;
    assert_eq!(reply["error"]["code"], rpc::code::INTERNAL);
    let mut listed = run.user.request("decision.list", ()).await.unwrap();
    let failure = listed[0]
        .as_object_mut()
        .unwrap()
        .remove("failure")
        .unwrap();
    assert_eq!(failure["error_code"], rpc::code::INTERNAL);
    assert_eq!(failure["message"], reply["error"]["message"]);
    assert_eq!(listed, json!([decision]));
    assert_eq!(
        run.user
            .request("decision.answers", json!({"agent":run.child}))
            .await
            .unwrap(),
        json!([])
    );
    db.execute_batch("DROP TRIGGER refuse_answer;").unwrap();
    let retry = door_call(
        &run,
        &terminal,
        "decision.answer",
        json!({"id":decision["id"],"answer":"allow"}),
    )
    .await;
    assert!(retry.get("error").is_none(), "{retry}");
    waiting.await.unwrap().unwrap();
    run.finish().await;
}

async fn door_call(run: &Run, terminal: &Value, method: &str, params: Value) -> Value {
    let reply = run.dir.path().join("door-reply.json");
    if reply.exists() {
        std::fs::remove_file(&reply).unwrap();
    }
    std::fs::write(
        run.dir.path().join("door-call.json"),
        json!({"method":method,"params":params}).to_string(),
    )
    .unwrap();
    run.user
        .request(
            "terminal.write",
            json!({"id":terminal,"data":STANDARD.encode([1])}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            if let Ok(bytes) = std::fs::read(&reply) {
                break serde_json::from_slice(&bytes).unwrap();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}
