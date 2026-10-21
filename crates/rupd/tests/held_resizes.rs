//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{door_terminal, notice_events, start_answer_door};
use takeover_run::{BOUND, launch};

use base64::{Engine, engine::general_purpose::STANDARD};
use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn b6_a_held_resize_is_acknowledged_without_effect_and_released_in_order() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let mut accepted = Vec::new();
    for cols in [101, 102] {
        let held = caller
            .request(
                "terminal.resize",
                json!({"id":run.terminal,"cols":cols,"rows":37}),
            )
            .await
            .unwrap();
        assert_eq!(
            held["outcome"],
            json!({"status":"waiting","reason":"takeover"})
        );
        accepted.push(held);
    }
    let before = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(before["cols"], 80);
    let history = caller
        .request("terminal.resizeHistory", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(history, json!(accepted));
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let after = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(after["cols"], 102);
    let history = caller
        .request("terminal.resizeHistory", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(history.as_array().unwrap().len(), accepted.len());
    for (record, ack) in history.as_array().unwrap().iter().zip(&accepted) {
        assert_eq!(record["id"], ack["id"]);
        assert_eq!(record["outcome"], json!({"status":"completed"}));
    }
    // A duplicate release cannot replay the earlier resize over direct user input.
    run.user
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":111,"rows":38}),
        )
        .await
        .unwrap();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let after = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(after["cols"], 111);
    run.finish().await;
}

#[tokio::test]
async fn b6_a_later_door_resize_cannot_overtake_released_resizes() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    for cols in [101, 102] {
        caller
            .request(
                "terminal.resize",
                json!({"id":run.terminal,"cols":cols,"rows":37}),
            )
            .await
            .unwrap();
    }
    run.pause();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let release =
        tokio::spawn(async move { user.request("takeover.end", json!({"agent":child})).await });
    run.paused().await;
    let terminal = run.terminal.clone();
    let mut later = tokio::spawn(async move {
        caller
            .request(
                "terminal.resize",
                json!({"id":terminal,"cols":103,"rows":39}),
            )
            .await
    });
    let early = tokio::time::timeout(Duration::from_millis(200), &mut later).await;
    run.release();
    release.await.unwrap().unwrap();
    later.await.unwrap().unwrap();
    let after = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(after["cols"], 103);
    assert!(
        early.is_err(),
        "a later resize overtook the paused release: {early:?}"
    );
    run.finish().await;
}

#[tokio::test]
async fn b6_resize_waits_leave_user_input_other_children_and_messages_available() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let held = caller
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":101,"rows":37}),
        )
        .await
        .unwrap();
    assert_eq!(held["outcome"]["status"], "waiting");
    let message = run
        .user
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"held independently"}),
        )
        .await
        .unwrap();
    assert_eq!(message["status"], "held");
    assert_eq!(message["reason"], "takeover");
    run.user
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":111,"rows":38}),
        )
        .await
        .unwrap();
    let before = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(before["cols"], 111);
    let other = caller
        .request("agent.spawn", json!({"name":"other","cwd":run.dir.path()}))
        .await
        .unwrap();
    // A second child-owned Terminal remains accessible while the first child is held.
    let owner = Client::connect(&run.daemon.socket).await.unwrap();
    owner
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":other["id"]}}),
        )
        .await
        .unwrap();
    let other_terminal = owner
        .request(
            "terminal.spawn",
            json!({"cwd":run.dir.path(),"cols":80,"rows":24,"env":{},"command":["sh","-c","cat"]}),
        )
        .await
        .unwrap();
    let result = caller
        .request(
            "terminal.resize",
            json!({"id":other_terminal["id"],"cols":105,"rows":35}),
        )
        .await
        .unwrap();
    assert!(result.is_null(), "another child was held: {result}");
    let snapshot = run
        .user
        .request("terminal.snapshot", json!({"id":other_terminal["id"]}))
        .await
        .unwrap();
    assert_eq!(snapshot["cols"], 105);
    let unrelated = Client::connect(&run.daemon.socket).await.unwrap();
    let foreign = run
        .user
        .request("rail.createWorkstream", json!({"name":"foreign"}))
        .await
        .unwrap();
    unrelated
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":foreign["id"]}}),
        )
        .await
        .unwrap();
    let denied = unrelated
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":106,"rows":35}),
        )
        .await
        .unwrap_err();
    assert_eq!(denied.code, rpc::code::FORBIDDEN);
    assert_eq!(
        unrelated
            .request("terminal.resizeHistory", json!({"id":run.terminal}))
            .await
            .unwrap(),
        json!([])
    );
    let invalid = caller
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":0,"rows":37}),
        )
        .await
        .unwrap_err();
    assert_eq!(invalid.code, rpc::code::INVALID_PARAMS);
    assert_eq!(
        caller
            .request("terminal.resizeHistory", json!({"id":run.terminal}))
            .await
            .unwrap(),
        json!([held])
    );
    run.user
        .request("message.drop", json!({"id":message["id"]}))
        .await
        .unwrap();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let message = run
        .user
        .request("message.get", json!({"id":message["id"]}))
        .await
        .unwrap();
    assert_eq!(message["status"], "dropped");
    for (method, id) in [
        ("terminal.close", other_terminal["id"].clone()),
        ("agent.stop", other["id"].clone()),
    ] {
        run.user.request(method, json!({"id":id})).await.unwrap();
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_an_unavailable_resize_is_recorded_and_does_not_block_the_next_terminal() {
    let (run, caller) = door_terminal().await;
    let child = Client::connect(&run.daemon.socket).await.unwrap();
    child
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let second = child
        .request(
            "terminal.spawn",
            json!({"cwd":run.dir.path(),"cols":80,"rows":24,"env":{},"command":["sh","-c","cat"]}),
        )
        .await
        .unwrap();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    caller
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":101,"rows":37}),
        )
        .await
        .unwrap();
    caller
        .request(
            "terminal.resize",
            json!({"id":second["id"],"cols":102,"rows":38}),
        )
        .await
        .unwrap();
    run.user
        .request("terminal.close", json!({"id":run.terminal}))
        .await
        .unwrap();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let dropped = caller
        .request("terminal.resizeHistory", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(dropped[0]["outcome"]["status"], "dropped");
    assert!(!dropped[0]["outcome"]["reason"].as_str().unwrap().is_empty());
    let completed = caller
        .request("terminal.resizeHistory", json!({"id":second["id"]}))
        .await
        .unwrap();
    assert_eq!(completed[0]["outcome"]["status"], "completed");
    let snapshot = run
        .user
        .request("terminal.snapshot", json!({"id":second["id"]}))
        .await
        .unwrap();
    assert_eq!(snapshot["cols"], 102);
    run.user
        .request("terminal.close", json!({"id":second["id"]}))
        .await
        .unwrap();
    run.finish().await;
}

#[tokio::test]
async fn b6_a_child_exit_accounts_for_its_held_resizes_without_a_release() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    caller
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":101,"rows":37}),
        )
        .await
        .unwrap();
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let actions = caller
        .request("terminal.resizeHistory", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(actions[0]["outcome"]["status"], "dropped");
    assert!(
        actions[0]["outcome"]["reason"]
            .as_str()
            .unwrap()
            .contains("exited")
    );
    let snapshot = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(snapshot["cols"], 80);
    run.user
        .request("terminal.close", json!({"id":run.terminal}))
        .await
        .unwrap();
}

#[tokio::test]
async fn b6_resize_crashes_preserve_receipts_and_never_replay_an_uncertain_effect() {
    for boundary in ["waiting", "before", "after-resize", "completed"] {
        let (mut run, caller) = door_terminal().await;
        let terminal = run.terminal.clone();
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        let door = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["parent"]
            .clone();
        run.user
            .request("takeover.begin", json!({"agent":run.child}))
            .await
            .unwrap();
        let receipt = caller
            .request(
                "terminal.resize",
                json!({"id":terminal,"cols":101,"rows":37}),
            )
            .await
            .unwrap();
        let release = if boundary == "waiting" {
            None
        } else {
            if boundary != "completed" {
                std::fs::write(run.dir.path().join("effect-gate"), boundary).unwrap();
            }
            let user = Arc::clone(&run.user);
            let child = run.child.clone();
            Some(tokio::spawn(async move {
                user.request("takeover.end", json!({"agent":child})).await
            }))
        };
        if boundary == "completed" {
            release.unwrap().await.unwrap().unwrap();
        } else if let Some(release) = release {
            run.paused().await;
            let snapshot = run
                .user
                .request("terminal.snapshot", json!({"id":terminal}))
                .await
                .unwrap();
            assert_eq!(
                snapshot["cols"],
                if boundary == "before" { 80 } else { 101 }
            );
            run.daemon.child.kill().unwrap();
            run.daemon.child.wait().unwrap();
            assert!(release.await.unwrap().is_err());
        }
        if run.daemon.child.try_wait().unwrap().is_none() {
            run.daemon.child.kill().unwrap();
            run.daemon.child.wait().unwrap();
        }
        let _ = std::fs::remove_file(run.dir.path().join("effect-gate"));
        run.daemon = launch(run.dir.path(), run.data.path());
        run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
        let caller = Client::connect(&run.daemon.socket).await.unwrap();
        caller
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":door}}),
            )
            .await
            .unwrap();
        let history = caller
            .request("terminal.resizeHistory", json!({"id":terminal}))
            .await
            .unwrap();
        assert_eq!(history.as_array().unwrap().len(), 1);
        assert_eq!(history[0]["id"], receipt["id"]);
        assert_eq!(
            run.user
                .request("terminal.resizeHistory", json!({"id":terminal}))
                .await
                .unwrap(),
            history
        );
        if boundary == "completed" {
            assert_eq!(history[0]["outcome"]["status"], "completed");
        } else {
            assert_eq!(history[0]["outcome"]["status"], "dropped");
            let reason = history[0]["outcome"]["reason"].as_str().unwrap();
            assert!(
                reason.contains(if boundary == "waiting" {
                    "did not survive"
                } else {
                    "may have happened"
                }),
                "{boundary}: {reason}"
            );
        }
        // Restart clears Takeover; an explicitly resumed child accepts a new Takeover.
        run.resumed().await;
        run.user
            .request("takeover.begin", json!({"agent":run.child}))
            .await
            .unwrap();
        run.user
            .request("takeover.end", json!({"agent":run.child}))
            .await
            .unwrap();
        assert_eq!(
            caller
                .request("terminal.resizeHistory", json!({"id":terminal}))
                .await
                .unwrap(),
            history
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_held_resizes_preserve_wire_arrival_order_before_task_scheduling() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (run, _) = door_terminal().await;
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let door = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()["parent"]
        .clone();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let mut client = tokio::net::UnixStream::connect(&run.daemon.socket)
        .await
        .unwrap();
    let mut batch = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"method":"daemon.identify","params":{"actor":{"kind":"agent","id":door}}})).unwrap();
    batch.push(b'\n');
    for cols in 120..152 {
        batch.extend(serde_json::to_vec(&json!({"jsonrpc":"2.0","id":cols,"method":"terminal.resize","params":{"id":run.terminal,"cols":cols,"rows":37}})).unwrap());
        batch.push(b'\n');
    }
    client.write_all(&batch).await.unwrap();
    client.shutdown().await.unwrap();
    let mut replies = BufReader::new(client).lines();
    for _ in 0..33 {
        let line = tokio::time::timeout(BOUND, replies.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert!(reply.get("result").is_some(), "{reply}");
    }
    let history = run
        .user
        .request("terminal.resizeHistory", json!({"id":run.terminal}))
        .await
        .unwrap();
    let widths: Vec<_> = history
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["cols"].as_u64().unwrap())
        .collect();
    assert_eq!(
        widths,
        (120..152).collect::<Vec<_>>(),
        "acceptance must follow the already-read wire frames"
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let snapshot = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(snapshot["cols"], 151);
    run.finish().await;
}

#[tokio::test]
async fn b6_later_door_effects_cannot_overtake_a_released_resize() {
    for method in [
        "rail.rename",
        "rail.move",
        "rail.remove",
        "agent.discard",
        "agent.land",
        "agent.worktreeState",
        "agent.run",
        "agent.spawnPrompt",
        "agent.digest",
        "terminal.kill",
        "terminal.snapshot",
        "terminal.screen",
        "terminal.read",
        "terminal.search",
    ] {
        let (run, caller) = door_terminal().await;
        std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
        let digest_door = if method == "agent.digest" {
            let door = start_answer_door(&run).await.0;
            let tree = run.user.request("rail.tree", ()).await.unwrap();
            let stopped = tree
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["kind"] == "agent" && n["parent"].is_null())
                .unwrap();
            run.user
                .request(
                    "rail.move",
                    json!({"id":stopped["id"],"parent":door,"index":0}),
                )
                .await
                .unwrap();
            Some(door)
        } else {
            None
        };
        run.user
            .request("takeover.begin", json!({"agent":run.child}))
            .await
            .unwrap();
        caller
            .request(
                "terminal.resize",
                json!({"id":run.terminal,"cols":101,"rows":37}),
            )
            .await
            .unwrap();
        run.user
            .request(
                "message.send",
                json!({"to":run.child,"kind":"note","body":"release ordering"}),
            )
            .await
            .unwrap();
        let mut events = notice_events(&run).await;
        let gate = run.dir.path().join("input-gate");
        std::fs::write(&gate, "pause").unwrap();
        let user = Arc::clone(&run.user);
        let child = run.child.clone();
        let end =
            tokio::spawn(async move { user.request("takeover.end", json!({"agent":child})).await });
        // A background Digest can reach the shared input gate before the child is released.
        // Observe the child's Takeover boundary independently of the physical input gate.
        tokio::time::timeout(BOUND, async {
            loop {
                if matches!(events.next_event().await.unwrap().data,
                    EventData::TakeoverChanged(ref change)
                    if change.agent == run.child && !change.on)
                {
                    break;
                }
            }
        })
        .await
        .unwrap();
        tokio::time::timeout(BOUND, async {
            while !gate.with_extension("arrived").is_file() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let params = match method {
            "agent.digest" => json!({"id":digest_door}),
            "rail.rename" => json!({"id":run.child,"name":"after resize"}),
            "agent.run" => json!({"id":run.child,"command":["/bin/true"]}),
            "rail.move" => json!({"id":run.child,"parent":null,"index":0}),
            "rail.remove"
            | "agent.discard"
            | "agent.land"
            | "agent.worktreeState"
            | "agent.spawnPrompt" => {
                json!({"id":run.child})
            }
            "terminal.read" => json!({"id":run.terminal,"after":0}),
            "terminal.search" => json!({"id":run.terminal,"pattern":"READY"}),
            _ => json!({"id":run.terminal}),
        };
        let effect = tokio::time::timeout(BOUND, caller.request(method, params)).await;
        let history = tokio::time::timeout(
            BOUND,
            run.user
                .request("terminal.resizeHistory", json!({"id":run.terminal})),
        )
        .await;
        std::fs::remove_file(gate).unwrap();
        end.await.unwrap().unwrap();
        if method == "rail.remove" {
            drop(run);
        } else {
            run.finish().await;
        }
        let effect = effect.unwrap();
        if matches!(
            method,
            "agent.discard" | "agent.land" | "agent.worktreeState"
        ) {
            assert_eq!(effect.unwrap_err().code, rpc::code::NOT_FOUND);
        } else {
            effect.unwrap();
        }
        assert_eq!(
            history.unwrap().unwrap()[0]["outcome"]["status"],
            "completed",
            "{method} returned before the older resize ran"
        );
    }
}

#[tokio::test]
async fn b6_wire_later_door_effects_wait_for_all_earlier_resizes() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    for method in [
        "terminal.snapshot",
        "terminal.screen",
        "terminal.read",
        "terminal.search",
        "terminal.write",
        "agent.prompt",
        "agent.setOrder",
        "agent.interrupt",
        "agent.resume",
        "agent.stop",
        "terminal.kill",
        "terminal.close",
        "rail.rename",
        "rail.move",
        "rail.remove",
        "agent.discard",
        "agent.land",
        "agent.worktreeState",
        "agent.run",
        "agent.spawnPrompt",
        "agent.digest",
    ] {
        let (run, _) = door_terminal().await;
        std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
        if method == "agent.digest" {
            start_answer_door(&run).await;
        }
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        let door = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["parent"]
            .clone();
        if method == "agent.digest" {
            let stopped = tree
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["kind"] == "agent" && n["parent"].is_null())
                .unwrap();
            run.user
                .request(
                    "rail.move",
                    json!({"id":stopped["id"],"parent":door,"index":0}),
                )
                .await
                .unwrap();
        }
        let client = tokio::net::UnixStream::connect(&run.daemon.socket)
            .await
            .unwrap();
        let (read, mut write) = client.into_split();
        let mut replies = BufReader::new(read).lines();
        write.write_all(format!("{}\n", json!({"id":1,"method":"daemon.identify","params":{"actor":{"kind":"agent","id":door}}})).as_bytes()).await.unwrap();
        let identified: Value = serde_json::from_str(
            &tokio::time::timeout(BOUND, replies.next_line())
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert!(identified.get("result").is_some(), "{identified}");
        run.pause();
        write.write_all(format!("{}\n", json!({"id":2,"method":"terminal.resize","params":{"id":run.terminal,"cols":101,"rows":37}})).as_bytes()).await.unwrap();
        run.paused().await;
        let mut batch = Vec::new();
        for cols in 102..110 {
            batch.extend(format!("{}\n", json!({"id":cols,"method":"terminal.resize","params":{"id":run.terminal,"cols":cols,"rows":37}})).as_bytes());
        }
        let params = match method {
            "terminal.snapshot" | "terminal.screen" => json!({"id":run.terminal}),
            "terminal.read" => json!({"id":run.terminal,"after":0}),
            "terminal.search" => json!({"id":run.terminal,"pattern":"READY"}),
            "terminal.write" => json!({"id":run.terminal,"data":STANDARD.encode(b"later")}),
            "terminal.kill" | "terminal.close" => json!({"id":run.terminal}),
            "agent.prompt" => json!({"id":run.child,"text":"later prompt"}),
            "agent.setOrder" => {
                json!({"id":run.child,"order":{"kind":"work","ask":"later order","limits":[]}})
            }
            "agent.digest" => json!({"id":door}),
            "rail.rename" => json!({"id":run.child,"name":"after every resize"}),
            "agent.run" => json!({"id":run.child,"command":["/bin/true"]}),
            "rail.move" => json!({"id":run.child,"parent":null,"index":0}),
            _ => json!({"id":run.child}),
        };
        batch.extend(format!("{}\n", json!({"id":110,"method":method,"params":params})).as_bytes());
        // This reply acknowledges that the reader has scheduled every earlier wire frame.
        batch.extend(format!("{}\n", json!({"id":111,"method":"rail.tree"})).as_bytes());
        write.write_all(&batch).await.unwrap();
        let barrier: Value = serde_json::from_str(
            &tokio::time::timeout(BOUND, replies.next_line())
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if barrier["id"] != 111 {
            run.release();
            if method == "rail.remove" {
                drop(run);
            } else {
                run.finish().await;
            }
            panic!("{method} overtook earlier resizes before the wire barrier: {barrier}");
        }
        run.release();
        let mut order = Vec::new();
        for _ in 0..10 {
            let reply: Value = serde_json::from_str(
                &tokio::time::timeout(BOUND, replies.next_line())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
            if reply["id"] == 110
                && matches!(
                    method,
                    "agent.discard" | "agent.land" | "agent.worktreeState"
                )
            {
                assert_eq!(reply["error"]["code"], rpc::code::NOT_FOUND, "{reply}");
            } else if reply["id"] == 110 && method == "agent.resume" {
                assert_eq!(reply["error"]["code"], rpc::code::CONFLICT, "{reply}");
            } else if reply["id"] == 110 && method == "agent.interrupt" {
                // A fake Claude need not acknowledge Escape; its accounted unknown is final.
                assert!(
                    reply.get("result").is_some()
                        || (reply["error"]["code"] == rpc::code::UNKNOWN_OUTCOME
                            || reply["error"]["code"] == rpc::code::NOT_RUNNING),
                    "{reply}"
                );
            } else {
                assert!(reply.get("result").is_some(), "{method}: {reply}");
            }
            if reply["id"] == 110 && matches!(method, "terminal.snapshot" | "terminal.screen") {
                assert_eq!(
                    reply["result"]["cols"], 109,
                    "read observed stale dimensions"
                );
                assert_eq!(reply["result"]["rows"], 37);
            }
            order.push(reply["id"].as_u64().unwrap());
        }
        if method == "rail.remove" {
            drop(run);
        } else {
            run.finish().await;
        }
        assert_eq!(
            order,
            [2, 102, 103, 104, 105, 106, 107, 108, 109, 110],
            "{method} overtook an already-arrived resize"
        );
    }
}
