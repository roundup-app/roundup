//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{
    door_peer_request, door_terminal, order_child, rewrite_script, start_answer_door,
};
use takeover_run::{BOUND, Run, launch};

use rpc::Client;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn b6_a_door_stop_waits_for_takeover_release() {
    let (run, caller) = order_child().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let terminals = run.user.request("terminal.list", ()).await.unwrap();
    let still_running = terminals
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == run.terminal && t["running"] == true);
    assert!(
        still_running,
        "Door Stop affected the child during Takeover"
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let after = run.user.request("terminal.list", ()).await.unwrap();
    let stopped = !after
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == run.terminal && t["running"] == true);
    run.finish().await;
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert_eq!(receipt["method"], "agent.stop");
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed");
    assert!(stopped, "released Stop did not end the original Terminal");
}

#[tokio::test]
async fn b6_held_stops_share_resize_and_rename_release_order() {
    let (run, caller) = door_terminal().await;
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let primary = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()["terminal_id"]
        .clone();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    for (method, params) in [
        (
            "terminal.resize",
            json!({"id":run.terminal,"cols":103,"rows":39}),
        ),
        ("agent.stop", json!({"id":run.child})),
        ("rail.rename", json!({"id":run.child,"name":"after Stop"})),
        (
            "terminal.resize",
            json!({"id":run.terminal,"cols":104,"rows":40}),
        ),
    ] {
        let receipt = caller.request(method, params).await.unwrap();
        assert_eq!(receipt["outcome"]["status"], "waiting");
    }
    std::fs::write(run.dir.path().join("effect-gate"), "after-resize").unwrap();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let end =
        tokio::spawn(async move { user.request("takeover.end", json!({"agent":child})).await });
    run.paused().await;
    let terminals = run.user.request("terminal.list", ()).await.unwrap();
    assert!(
        terminals
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == primary && t["running"] == true)
    );
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert_ne!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"],
        "after Stop"
    );
    run.release();
    end.await.unwrap().unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(
        history
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["outcome"]["status"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["completed", "completed", "completed", "dropped"]
    );
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"],
        "after Stop"
    );
    assert!(
        history[3]["outcome"]["reason"]
            .as_str()
            .unwrap()
            .contains("exited")
    );
    // Even a stale end must not replay Stop: its Rail Touch is an observable effect.
    let _ = run
        .user
        .request("takeover.end", json!({"agent":run.child}))
        .await;
    let touches = run
        .user
        .request(
            "provenance.history",
            json!({"item":format!("rail:{}",run.child)}),
        )
        .await
        .unwrap();
    let writes = touches
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["actor"]["kind"] == "agent" && t["verb"] == "wrote")
        .count();
    assert_eq!(writes, 2, "exactly one Stop and one rename: {touches}");
    run.finish().await;
}

#[tokio::test]
async fn b6_a_door_process_cannot_claim_user_to_bypass_a_held_stop() {
    let (run, _) = order_child().await;
    let (door, terminal) = start_answer_door(&run).await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let replies = door_peer_request(
        &run,
        &terminal,
        json!([
            {"id":1,"method":"daemon.identify","params":{"actor":{"kind":"user","id":"you"}}},
            {"id":2,"method":"agent.stop","params":{"id":run.child}}
        ]),
    )
    .await;
    let reply = replies
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == 2)
        .unwrap();
    assert_eq!(
        reply["result"]["outcome"],
        json!({"status":"waiting","reason":"takeover"}),
        "{replies}"
    );
    let terminals = run.user.request("terminal.list", ()).await.unwrap();
    assert!(
        terminals
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == run.terminal && t["running"] == true)
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = run
        .user
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(history[0]["outcome"]["status"], "completed");
    run.user
        .request("agent.stop", json!({"id":door}))
        .await
        .unwrap();
    run.finish().await;
}

#[tokio::test]
async fn b6_stop_crashes_explain_waiting_and_uncertain_effects_without_repeating() {
    for boundary in ["waiting", "before", "after-stop", "completed"] {
        let (mut run, caller) = order_child().await;
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
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        if boundary != "waiting" {
            if boundary != "completed" {
                std::fs::write(run.dir.path().join("effect-gate"), boundary).unwrap();
            }
            let user = Arc::clone(&run.user);
            let child = run.child.clone();
            let end =
                tokio::spawn(
                    async move { user.request("takeover.end", json!({"agent":child})).await },
                );
            if boundary == "completed" {
                end.await.unwrap().unwrap();
            } else {
                run.paused().await;
                run.daemon.child.kill().unwrap();
                run.daemon.child.wait().unwrap();
                assert!(end.await.unwrap().is_err());
            }
        }
        if run.daemon.child.try_wait().unwrap().is_none() {
            run.daemon.child.kill().unwrap();
            run.daemon.child.wait().unwrap();
        }
        let _ = std::fs::remove_file(run.dir.path().join("effect-gate"));
        run.daemon = launch(run.dir.path(), run.data.path());
        run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
        let history = run
            .user
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap();
        assert_eq!(history.as_array().unwrap().len(), 1, "{boundary}");
        assert_eq!(history[0]["id"], receipt["id"]);
        match boundary {
            "completed" => assert_eq!(history[0]["outcome"]["status"], "completed"),
            _ => {
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
        }
        let _ = run
            .user
            .request("takeover.end", json!({"agent":run.child}))
            .await;
        let touches = run
            .user
            .request(
                "provenance.history",
                json!({"item":format!("rail:{}",run.child)}),
            )
            .await
            .unwrap();
        let effects = touches
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["actor"]["id"] == door && t["verb"] == "wrote")
            .count();
        assert_eq!(
            effects,
            usize::from(matches!(boundary, "after-stop" | "completed")),
            "{boundary}: {touches}"
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_a_held_stop_never_stops_a_replacement_attempt() {
    for kind in ["user", "ext"] {
        let (mut run, caller) = order_child().await;
        let direct = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
        direct
            .request(
                "daemon.identify",
                json!({"actor":{"kind":kind,"id":"direct-observer"}}),
            )
            .await
            .unwrap();
        run.user
            .request("takeover.begin", json!({"agent":run.child}))
            .await
            .unwrap();
        caller
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        run.pause();
        let user = Arc::clone(&run.user);
        let child = run.child.clone();
        let end =
            tokio::spawn(async move { user.request("takeover.end", json!({"agent":child})).await });
        run.paused().await;
        tokio::time::timeout(
            Duration::from_secs(2),
            direct.request("agent.stop", json!({"id":run.child})),
        )
        .await
        .expect("direct Stop remains available")
        .unwrap();
        let resumed = direct
            .request("agent.resume", json!({"id":run.child}))
            .await
            .unwrap();
        assert_ne!(resumed["attempt"], run.attempt);
        run.terminal = resumed["terminal_id"].clone();
        run.release();
        end.await.unwrap().unwrap();
        let history = caller
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap();
        let terminals = run.user.request("terminal.list", ()).await.unwrap();
        let replacement_running = terminals
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == run.terminal && t["running"] == true);
        run.finish().await;
        assert!(
            replacement_running,
            "{kind}: held Stop killed the replacement Attempt"
        );
        assert_eq!(history[0]["outcome"]["status"], "dropped");
        assert!(
            history[0]["outcome"]["reason"]
                .as_str()
                .unwrap()
                .contains("original Attempt"),
            "{history}"
        );
    }
}

#[tokio::test]
async fn b6_a_stop_accepted_before_terminal_attachment_keeps_the_same_attempt() {
    let mut run = Run::start().await;
    let fake = run.dir.path().join("claude");
    let source = std::fs::read_to_string(&fake).unwrap();
    rewrite_script(
        &fake,
        source.replace(
            "if sys.argv[1:3] == ['plugin', 'test']:\n    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)",
            r#"if sys.argv[1:3] == ['plugin', 'test']:
    gate = os.path.join(os.path.dirname(__file__), 'launch-gate')
    if os.path.isfile(gate):
        open(gate + '.arrived', 'w').write('plugin test requested')
        deadline = time.monotonic() + 10
        while os.path.isfile(gate):
            if time.monotonic() > deadline: raise RuntimeError('launch probe was not released')
            time.sleep(0.005)
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)"#,
        ),
    );
    // Reopen with an empty runtime admission cache; the probe precedes Terminal creation.
    run.daemon.child.kill().unwrap();
    run.daemon.child.wait().unwrap();
    run.daemon = launch(run.dir.path(), run.data.path());
    run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
    let door = run
        .user
        .request("rail.createWorkstream", json!({"name":"starting child"}))
        .await
        .unwrap();
    let caller = Client::connect(&run.daemon.socket).await.unwrap();
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door["id"]}}),
        )
        .await
        .unwrap();
    let gate = run.dir.path().join("launch-gate");
    std::fs::write(&gate, "pause").unwrap();
    let user = Arc::clone(&run.user);
    let cwd = run.dir.path().to_owned();
    let parent = door["id"].clone();
    let spawning = tokio::spawn(async move {
        user.request("agent.spawn", json!({"cwd":cwd,"parent":parent}))
            .await
    });
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let starting = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["parent"] == door["id"])
        .unwrap();
    run.child = starting["id"].as_str().unwrap().to_owned();
    assert!(starting["terminal_id"].is_null());
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(receipt["outcome"]["status"], "waiting");
    std::fs::remove_file(gate).unwrap();
    let attached = spawning.await.unwrap().unwrap();
    assert_eq!(attached["attempt"], starting["attempt"]);
    assert!(attached["terminal_id"].is_string());
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
}

#[tokio::test]
async fn b6_a_stop_accepted_during_user_resume_follows_the_resuming_attempt() {
    let (mut run, caller) = order_child().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let fake = run.dir.path().join("claude");
    let script = std::fs::read_to_string(&fake).unwrap().replace(
        "hook('SessionStart',",
        "if '--resume' in sys.argv:\n    open('resume-arrived', 'w').close()\n    deadline = time.monotonic() + 10\n    while os.path.isfile('resume-gate'):\n        if time.monotonic() > deadline: raise RuntimeError('resume observer was not released')\n        time.sleep(0.005)\nhook('SessionStart',",
    );
    rewrite_script(&fake, script);
    let gate = run.dir.path().join("resume-gate");
    std::fs::write(&gate, "pause").unwrap();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let resume =
        tokio::spawn(async move { user.request("agent.resume", json!({"id":child})).await });
    tokio::time::timeout(BOUND, async {
        while !run.dir.path().join("resume-arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // Direct user Resume must not hold Takeover acquisition behind SessionStart.
    tokio::time::timeout(
        Duration::from_secs(2),
        run.user
            .request("takeover.begin", json!({"agent":run.child})),
    )
    .await
    .expect("Takeover is available before user Resume acknowledges")
    .unwrap();
    let receipt = caller
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let waiting = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    std::fs::remove_file(gate).unwrap();
    let attached = resume.await.unwrap().unwrap();
    run.terminal = attached["terminal_id"].clone();
    assert_ne!(attached["attempt"], run.attempt);
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let terminals = run.user.request("terminal.list", ()).await.unwrap();
    let stopped = !terminals
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == run.terminal && t["running"] == true);
    run.finish().await;
    assert_eq!(waiting[0]["outcome"]["status"], "waiting", "{waiting}");
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
    assert!(stopped);
}

#[tokio::test]
async fn b6_a_failed_launch_accounts_for_a_held_stop_without_terminal_exit() {
    let mut run = Run::start().await;
    let fake = run.dir.path().join("claude");
    let source = std::fs::read_to_string(&fake).unwrap();
    rewrite_script(
        &fake,
        source.replace(
            "if sys.argv[1:3] == ['plugin', 'test']:\n    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)",
            r#"if sys.argv[1:3] == ['plugin', 'test']:
    gate = os.path.join(os.path.dirname(__file__), 'launch-gate')
    if os.path.isfile(gate):
        open(gate + '.arrived', 'w').write('plugin test requested')
        deadline = time.monotonic() + 10
        while os.path.isfile(gate):
            if time.monotonic() > deadline: raise RuntimeError('launch probe was not released')
            time.sleep(0.005)
    print('unsupported runtime'); sys.exit(1)"#,
        ),
    );
    // Reopen with an empty runtime admission cache; the probe precedes Terminal creation.
    run.daemon.child.kill().unwrap();
    run.daemon.child.wait().unwrap();
    run.daemon = launch(run.dir.path(), run.data.path());
    run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
    let door = run
        .user
        .request("rail.createWorkstream", json!({"name":"starting child"}))
        .await
        .unwrap();
    let caller = Client::connect(&run.daemon.socket).await.unwrap();
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door["id"]}}),
        )
        .await
        .unwrap();
    let gate = run.dir.path().join("launch-gate");
    std::fs::write(&gate, "pause").unwrap();
    let user = Arc::clone(&run.user);
    let cwd = run.dir.path().to_owned();
    let parent = door["id"].clone();
    let spawning = tokio::spawn(async move {
        user.request("agent.spawn", json!({"cwd":cwd,"parent":parent}))
            .await
    });
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let starting = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["parent"] == door["id"])
        .unwrap();
    run.child = starting["id"].as_str().unwrap().to_owned();
    assert!(starting["terminal_id"].is_null());
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(receipt["outcome"]["status"], "waiting");
    std::fs::remove_file(gate).unwrap();
    assert!(spawning.await.unwrap().is_err());
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
    assert!(
        history[0]["outcome"]["reason"]
            .as_str()
            .unwrap()
            .contains("removed"),
        "{history}"
    );
}
