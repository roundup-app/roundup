//! B3563d: a Door's action on a child finishes or fails in the call; nothing is stored for later.
#[path = "support/child_run.rs"]
mod child_run;
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
use door_terminals::recorded_bytes;
#[path = "support/door_terminal.rs"]
mod door_terminal;
use door_terminal::door_terminal;
#[path = "support/idle.rs"]
mod idle;
use idle::idle;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

fn not_deferred(method: &str, reply: &Value) {
    for field in ["outcome", "method", "reason"] {
        assert!(
            reply.get(field).is_none(),
            "{method} acknowledged a stored action: {reply}"
        );
    }
}

async fn stopped(run: &child_run::Run, what: &str) {
    tokio::time::timeout(child_run::BOUND, async {
        while terminal_running(run).await {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what} left the Terminal running"));
}

async fn terminal_running(run: &child_run::Run) -> bool {
    let listed = run.user.request("terminal.list", json!({})).await.unwrap();
    listed
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == run.terminal && t["running"] == true)
}

#[tokio::test]
async fn b3563d_door_actions_return_their_effect_or_error_without_deferral() {
    let (run, door) = door_terminal().await;
    idle(&run).await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    let (child, terminal) = (run.child.clone(), run.terminal.clone());

    // Each call is made while the user has typed into the child's Terminal and not submitted it.
    run.user
        .request(
            "terminal.write",
            json!({"id":terminal,"data":STANDARD.encode(b"user")}),
        )
        .await
        .unwrap();

    let reply = door
        .request("agent.prompt", json!({"id":child,"text":"door words"}))
        .await
        .unwrap();
    not_deferred("agent.prompt", &reply);
    idle(&run).await;

    let reply = door
        .request(
            "agent.setOrder",
            json!({"id":child,"order":{"kind":"work","ask":"first order","limits":[]}}),
        )
        .await
        .unwrap();
    not_deferred("agent.setOrder", &reply);
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let ask = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == child)
        .unwrap()["work"]["ask"]
        .clone();
    assert_eq!(ask, "first order", "the Order applied in its call");

    let reply = door
        .request(
            "terminal.write",
            json!({"id":terminal,"data":STANDARD.encode(b"door")}),
        )
        .await
        .unwrap();
    not_deferred("terminal.write", &reply);
    let read = door
        .request("terminal.read", json!({"id":terminal,"after":0}))
        .await
        .unwrap();
    not_deferred("terminal.read", &read);
    let reply = door
        .request(
            "terminal.resize",
            json!({"id":terminal,"cols":100,"rows":30}),
        )
        .await
        .unwrap();
    not_deferred("terminal.resize", &reply);
    let bytes = recorded_bytes(&run).await;
    assert!(bytes.starts_with(b"user"), "{bytes:?}");

    // A child that has not exited has nothing to resume: the call itself says so.
    let refused = door.request("agent.resume", json!({"id":child})).await;
    assert!(refused.is_err(), "{refused:?}");

    let reply = door
        .request("rail.rename", json!({"id":child,"name":"renamed"}))
        .await
        .unwrap();
    not_deferred("rail.rename", &reply);

    let reply = door.request("agent.interrupt", json!({"id":child})).await;
    if let Ok(reply) = &reply {
        not_deferred("agent.interrupt", reply);
    }

    let reply = door
        .request("terminal.close", json!({"id":terminal}))
        .await
        .unwrap();
    not_deferred("terminal.close", &reply);
    stopped(&run, "terminal.close").await;

    let reply = door
        .request("agent.stop", json!({"id":child}))
        .await
        .unwrap();
    not_deferred("agent.stop", &reply);
    let resumed = door
        .request("agent.resume", json!({"id":child}))
        .await
        .unwrap();
    not_deferred("agent.resume", &resumed);
    run.finish().await;
}

#[tokio::test]
async fn b3563d_door_terminal_kill_returns_in_its_call() {
    let (run, door) = door_terminal().await;
    let reply = door
        .request("terminal.kill", json!({"id":run.terminal}))
        .await
        .unwrap();
    not_deferred("terminal.kill", &reply);
    stopped(&run, "terminal.kill").await;
    run.finish().await;
}
