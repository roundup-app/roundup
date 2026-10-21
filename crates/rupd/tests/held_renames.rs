//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{door_peer_request, door_terminal, notice_events, start_answer_door};
use takeover_run::{BOUND, Run, launch};

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};
use std::sync::Arc;

#[tokio::test]
async fn b6_child_snapshots_keep_reach_restrictions() {
    let (run, door) = door_terminal().await;
    let foreign = run
        .user
        .request("rail.createWorkstream", json!({"name":"unrelated"}))
        .await
        .unwrap();
    let unrelated = Client::connect(&run.daemon.socket).await.unwrap();
    unrelated
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":foreign["id"]}}),
        )
        .await
        .unwrap();
    let allowed = door
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await;
    let denied = unrelated
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await;
    let absent = door
        .request("terminal.snapshot", json!({"id":"999999"}))
        .await;
    run.finish().await;
    assert_eq!(allowed.unwrap()["cols"], 80);
    assert_eq!(denied.unwrap_err().code, rpc::code::FORBIDDEN);
    assert_eq!(absent.unwrap_err().code, rpc::code::NOT_FOUND);
}

#[tokio::test]
async fn b6_takeover_holds_a_door_rename_without_blocking_user_rename() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let accepted = caller
        .request("rail.rename", json!({"id":run.child,"name":"Door rename"}))
        .await;
    let before = run
        .user
        .request("rail.tree", ())
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()
        .clone();
    run.user
        .request("rail.rename", json!({"id":run.child,"name":"User rename"}))
        .await
        .unwrap();
    let user_name = run
        .user
        .request("rail.tree", ())
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()
        .clone()["name"]
        .clone();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let after = run
        .user
        .request("rail.tree", ())
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()
        .clone();
    run.finish().await;
    assert_eq!(
        accepted.unwrap()["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert_ne!(before["name"], "Door rename");
    assert_eq!(user_name, "User rename");
    assert_eq!(after["name"], "Door rename");
}

async fn child_name(run: &Run, id: &Value) -> Value {
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    tree.as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == *id)
        .unwrap()["name"]
        .clone()
}

#[tokio::test]
async fn u467_giving_back_releases_only_that_childs_door_actions() {
    let (run, caller) = door_terminal().await;
    let other = caller
        .request(
            "agent.spawn",
            json!({"name":"other child","cwd":run.dir.path()}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            let output = run
                .user
                .request(
                    "terminal.read",
                    json!({"id":other["terminal_id"],"after":0}),
                )
                .await
                .unwrap();
            if output["text"].as_str().unwrap().contains("READY") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let first = json!(run.child);
    for id in [&first, &other["id"]] {
        run.user
            .request("takeover.begin", json!({"agent":id}))
            .await
            .unwrap();
    }
    for (id, name) in [(&first, "first held"), (&other["id"], "other held")] {
        let receipt = caller
            .request("rail.rename", json!({"id":id,"name":name}))
            .await
            .unwrap();
        assert_eq!(
            receipt["outcome"],
            json!({"status":"waiting","reason":"takeover"})
        );
    }
    run.user
        .request("takeover.end", json!({"agent":first}))
        .await
        .unwrap();
    let released = child_name(&run, &first).await;
    let still_held = child_name(&run, &other["id"]).await;
    run.user
        .request("takeover.end", json!({"agent":other["id"]}))
        .await
        .unwrap();
    let then_released = child_name(&run, &other["id"]).await;
    run.user
        .request("agent.stop", json!({"id":other["id"]}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(released, "first held");
    assert_ne!(still_held, "other held");
    assert_eq!(then_released, "other held");
}

#[tokio::test]
async fn b6_held_renames_share_resize_order_at_most_once() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let mut receipts = Vec::new();
    for (method, params) in [
        (
            "terminal.resize",
            json!({"id":run.terminal,"cols":101,"rows":37}),
        ),
        ("rail.rename", json!({"id":run.child,"name":"first rename"})),
        (
            "terminal.resize",
            json!({"id":run.terminal,"cols":102,"rows":38}),
        ),
        ("rail.rename", json!({"id":run.child,"name":"last rename"})),
    ] {
        receipts.push(caller.request(method, params).await.unwrap());
    }
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(
        history
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a["id"].clone())
            .collect::<Vec<_>>(),
        receipts.iter().map(|a| a["id"].clone()).collect::<Vec<_>>()
    );
    assert!(
        history
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["outcome"]["status"] == "waiting")
    );
    std::fs::write(run.dir.path().join("effect-gate"), "after-rename").unwrap();
    let child = run.child.clone();
    let user = Arc::clone(&run.user);
    let end =
        tokio::spawn(async move { user.request("takeover.end", json!({"agent":child})).await });
    run.paused().await;
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"],
        "first rename"
    );
    assert_eq!(
        run.user
            .request("terminal.snapshot", json!({"id":run.terminal}))
            .await
            .unwrap()["cols"],
        101
    );
    run.release();
    end.await.unwrap().unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(history.as_array().unwrap().len(), 4);
    assert!(
        history
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["outcome"]["status"] == "completed")
    );
    assert_eq!(
        run.user
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(
        run.user
            .request("terminal.snapshot", json!({"id":run.terminal}))
            .await
            .unwrap()["cols"],
        102
    );
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"],
        "last rename"
    );
    run.user
        .request(
            "rail.rename",
            json!({"id":run.child,"name":"user after release"}),
        )
        .await
        .unwrap();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"],
        "user after release"
    );
    run.finish().await;
}

#[tokio::test]
async fn b6_a_held_child_action_losing_reach_drops_and_the_new_doors_rename_proceeds() {
    for method in ["rail.rename", "agent.stop"] {
        let (run, caller) = door_terminal().await;
        run.user
            .request("takeover.begin", json!({"agent":run.child}))
            .await
            .unwrap();
        caller
            .request(method, json!({"id":run.child,"name":"must not rename"}))
            .await
            .unwrap();
        let other = run
            .user
            .request("rail.createWorkstream", json!({"name":"new owner"}))
            .await
            .unwrap();
        run.user
            .request(
                "rail.move",
                json!({"id":run.child,"parent":other["id"],"index":0}),
            )
            .await
            .unwrap();
        let new_door = Client::connect(&run.daemon.socket).await.unwrap();
        new_door
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":other["id"]}}),
            )
            .await
            .unwrap();
        let later = new_door
            .request(
                "rail.rename",
                json!({"id":run.child,"name":"new Doors rename"}),
            )
            .await
            .unwrap();
        assert_eq!(later["outcome"]["status"], "waiting");
        run.user
            .request("takeover.end", json!({"agent":run.child}))
            .await
            .unwrap();
        let history = run
            .user
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap();
        assert_eq!(history.as_array().unwrap().len(), 2);
        assert_eq!(history[0]["outcome"]["status"], "dropped");
        assert!(
            history[0]["outcome"]["reason"]
                .as_str()
                .unwrap()
                .contains("not in the Reach")
        );
        assert_eq!(history[1]["outcome"]["status"], "completed");
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        assert_eq!(
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == run.child)
                .unwrap()["name"],
            "new Doors rename"
        );
        assert_eq!(
            caller
                .request("agent.actionHistory", json!({"id":run.child}))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_rename_crashes_replay_waiting_but_never_repeat_started_effects() {
    for boundary in ["waiting", "before", "after-rename", "completed"] {
        let (mut run, caller) = door_terminal().await;
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
                "rail.rename",
                json!({"id":run.child,"name":"durable rename"}),
            )
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
        // Ping at launch follows startup reconciliation, before anyone reads action history.
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        let name = &tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"];
        assert_eq!(name == "durable rename", boundary != "before", "{boundary}");
        let history = run
            .user
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap();
        assert_eq!(history.as_array().unwrap().len(), 1);
        assert_eq!(history[0]["id"], receipt["id"]);
        if matches!(boundary, "before" | "after-rename") {
            assert_eq!(history[0]["outcome"]["status"], "dropped");
            assert!(
                history[0]["outcome"]["reason"]
                    .as_str()
                    .unwrap()
                    .contains("may have happened")
            );
        } else {
            assert_eq!(history[0]["outcome"]["status"], "completed");
        }
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
            usize::from(boundary != "before"),
            "{boundary}: {touches}"
        );
        run.resumed().await;
        run.user
            .request(
                "rail.rename",
                json!({"id":run.child,"name":"after restart"}),
            )
            .await
            .unwrap();
        run.user
            .request("takeover.end", json!({"agent":run.child}))
            .await
            .unwrap();
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        assert_eq!(
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == run.child)
                .unwrap()["name"],
            "after restart"
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_a_child_exit_releases_its_valid_held_rename_without_a_history_read() {
    let (run, caller) = door_terminal().await;
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let door = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()["parent"]
        .clone();
    let mut events = notice_events(&run).await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    caller
        .request(
            "rail.rename",
            json!({"id":run.child,"name":"rename after exit"}),
        )
        .await
        .unwrap();
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            let event = events.next_event().await.expect("exit observer closed");
            if event.actor.id == door && matches!(event.data, EventData::RailChanged) {
                break;
            }
        }
    })
    .await
    .unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == run.child)
            .unwrap()["name"],
        "rename after exit"
    );
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(history[0]["outcome"]["status"], "completed");
}

#[tokio::test]
async fn b6_existing_resize_receipts_migrate_without_changing_ids_or_outcomes() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let project_data = rupd::data::project_data(data.path(), dir.path()).unwrap();
    std::fs::create_dir_all(&project_data).unwrap();
    let db = rusqlite::Connection::open(project_data.join("project.db")).unwrap();
    for schema in [
        include_str!("../migrations/001/up.sql"),
        include_str!("../../agents/migrations/003/up.sql"),
        include_str!("../migrations/003/up.sql"),
        include_str!("../../agents/migrations/004/up.sql"),
    ] {
        db.execute_batch(schema).unwrap();
    }
    db.pragma_update(None, "user_version", 4).unwrap();
    db.execute("INSERT INTO resize_actions(id,actor,agent,attempt,child_terminal,terminal,cols,rows) VALUES(42,?,'old-child','1','old-terminal','old-terminal',101,37)",[json!({"kind":"agent","id":"old-door","parent":null}).to_string()]).unwrap();
    for outcome in [
        json!({"status":"waiting","reason":"takeover"}),
        json!({"status":"in-progress"}),
        json!({"status":"completed"}),
    ] {
        db.execute(
            "INSERT INTO resize_outcomes(action,outcome) VALUES(42,?)",
            [outcome.to_string()],
        )
        .unwrap();
    }
    drop(db);
    let daemon = launch(dir.path(), data.path());
    let user = Client::connect(&daemon.socket).await.unwrap();
    let history = user
        .request("terminal.resizeHistory", json!({"id":"old-terminal"}))
        .await
        .unwrap();
    assert_eq!(
        history,
        json!([{"id":"42","agent":"old-child","terminal":"old-terminal","cols":101,"rows":37,"outcome":{"status":"completed"}}])
    );
    let actions = user
        .request("agent.actionHistory", json!({"id":"old-child"}))
        .await
        .unwrap();
    assert_eq!(
        actions,
        json!([{"id":"42","agent":"old-child","method":"terminal.resize","params":{"id":"old-terminal","cols":101,"rows":37},"outcome":{"status":"completed"}}])
    );
}

#[tokio::test]
async fn b6_held_action_history_is_private_to_the_accepting_agent_and_user() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request(
            "rail.rename",
            json!({"id":run.child,"name":"private rename"}),
        )
        .await
        .unwrap();
    let other = run
        .user
        .request("rail.createWorkstream", json!({"name":"other"}))
        .await
        .unwrap();
    let outsider = Client::connect(&run.daemon.socket).await.unwrap();
    outsider
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":other["id"]}}),
        )
        .await
        .unwrap();
    assert_eq!(
        outsider
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap(),
        json!([])
    );
    let forbidden = outsider
        .request(
            "rail.rename",
            json!({"id":run.child,"name":"outside Reach"}),
        )
        .await
        .unwrap_err();
    assert_eq!(forbidden.code, rpc::code::FORBIDDEN);

    assert_eq!(
        caller
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap(),
        json!([receipt.clone()])
    );
    assert_eq!(
        run.user
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap(),
        json!([receipt])
    );
    run.finish().await;
}

#[tokio::test]
async fn b6_a_child_cannot_queue_a_parent_rename_during_the_parents_takeover() {
    let (run, _) = door_terminal().await;
    let (door, _) = start_answer_door(&run).await;
    let child = Client::connect(&run.daemon.socket).await.unwrap();
    child
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let params = json!({"id":door,"name":"forbidden parent rename"});
    let before = child
        .request("rail.rename", params.clone())
        .await
        .unwrap_err();
    assert_eq!(before.code, rpc::code::FORBIDDEN);
    run.user
        .request("takeover.begin", json!({"agent":door}))
        .await
        .unwrap();
    let during = child.request("rail.rename", params).await;
    let history = run
        .user
        .request("agent.actionHistory", json!({"id":door}))
        .await
        .unwrap();
    run.user
        .request("takeover.end", json!({"agent":door}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(
        during.unwrap_err(),
        before,
        "Takeover must not expand Reach"
    );
    assert_eq!(
        history,
        json!([]),
        "a forbidden action must never be accepted"
    );
}

#[tokio::test]
async fn b6_a_door_process_cannot_claim_user_to_bypass_a_held_rename() {
    let (run, _) = door_terminal().await;
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
            {"id":2,"method":"rail.rename","params":{"id":run.child,"name":"process rename"}}
        ]),
    )
    .await;
    let reply = replies
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == 2)
        .unwrap()
        .clone();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let before = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()["name"]
        .clone();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let after = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()["name"]
        .clone();
    run.user
        .request("agent.stop", json!({"id":door}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(
        reply["result"]["outcome"],
        json!({"status":"waiting","reason":"takeover"}),
        "{reply}"
    );
    assert_ne!(before, "process rename");
    assert_eq!(after, "process rename");
}

#[tokio::test]
async fn b6_action_history_uses_the_door_process_identity_despite_a_user_claim() {
    let (run, caller) = door_terminal().await;
    let (door, terminal) = start_answer_door(&run).await;
    let child = Client::connect(&run.daemon.socket).await.unwrap();
    child
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    child
        .request(
            "rail.rename",
            json!({"id":run.child,"name":"childs rename"}),
        )
        .await
        .unwrap();
    let own = caller
        .request("rail.rename", json!({"id":run.child,"name":"doors rename"}))
        .await
        .unwrap();
    let replies = door_peer_request(
        &run,
        &terminal,
        json!([
            {"id":1,"method":"daemon.identify","params":{"actor":{"kind":"user","id":"you"}}},
            {"id":2,"method":"agent.actionHistory","params":{"id":run.child}}
        ]),
    )
    .await;
    let reply = replies
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == 2)
        .unwrap()
        .clone();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    run.user
        .request("agent.stop", json!({"id":door}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(
        reply["result"],
        json!([own]),
        "the Door read another Actor's receipt: {reply}"
    );
}
