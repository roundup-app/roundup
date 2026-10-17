#[path = "common/d9_fixture.rs"]
mod fixture;
#[path = "../../rupd/tests/support/rupd_harness.rs"]
mod harness;
use serde_json::{Value, json};
use std::time::Duration;

async fn observe(completion: bool) {
    let fixture = fixture::Fixture::new(if completion { 120000 } else { 1000 });
    let mut daemon = harness::start(&fixture.wrapper, &fixture.project, true, |command| {
        command.env("ROUNDUP_DATA_DIR", fixture.dir.path().join("data"));
    });
    let mut stderr = daemon.stderr.take().unwrap();
    std::thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::stderr()));
    let mut client = rpc::Client::connect(&daemon.socket).await.unwrap();
    let ws = fixture::start_door(&client).await;
    fixture
        .ready(async || client.request("rail.tree", Value::Null).await.unwrap())
        .await;
    let before = client.request("rail.tree", Value::Null).await.unwrap();
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    client
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let reply = tokio::time::timeout(
        Duration::from_secs(1),
        client.request("workstream.clear", json!({"id":ws,"reason":"D9"})),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(reply, json!({"pending":true}));
    fixture.received().await;
    let tree = tokio::time::timeout(
        Duration::from_secs(1),
        client.request("rail.tree", Value::Null),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        tree.as_array().unwrap().len(),
        before.as_array().unwrap().len()
    );
    assert_eq!(tree[0]["id"], before[0]["id"]);
    assert_eq!(tree[0]["iteration"], before[0]["iteration"]);
    fixture::terminal_events(&mut client, &ws, completion).await;
    if !completion {
        let after = client.request("rail.tree", Value::Null).await.unwrap();
        assert_eq!(after[0]["iteration"], before[0]["iteration"]);
        assert_eq!(after[0]["id"], before[0]["id"]);
        assert_eq!(
            client.request("todo.list", Value::Null).await.unwrap(),
            todos
        );
        assert_eq!(client.request("pad.list", Value::Null).await.unwrap(), pads);
        assert_eq!(
            client
                .request("pad.read", json!({"name":"D9"}))
                .await
                .unwrap()["text"],
            "keep until Handoff"
        );
    }
    drop(daemon.stdin.take());
    tokio::time::timeout(Duration::from_secs(10), async {
        while daemon.child.try_wait().unwrap().is_none() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn d9_clear_with_a_sixty_second_handoff_keeps_the_connection_available() {
    observe(true).await;
}

#[tokio::test]
async fn d9_clear_failure_is_evented_without_an_app_timeout() {
    observe(false).await;
}
