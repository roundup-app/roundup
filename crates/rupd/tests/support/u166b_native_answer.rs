//! U166b: a native prompt answered in the Terminal settles the Agent idle.
use super::*;

/// U166b: a Message delivered, the vendor asks natively, the user types `answer` in that Terminal,
/// and the vendor then makes its `todo_create` call (when `answer` is `y`) and stops.
async fn u166b_answered(answer: &str) {
    let run = Run::start().await;
    let id = run.note("ship a").await;
    run.record(&[id]).await;
    until("delivered", async || {
        (run.status(id).await.0 == "delivered").then_some(())
    })
    .await;
    run.signal(json!({"hook_event_name":"PermissionRequest","tool_name":"todo_create"}))
        .await;
    until("the Agent needs the user", async || {
        (run.rail_status().await == "needs-you").then_some(())
    })
    .await;
    let typed = run.typed().await;
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":base64::Engine::encode(&base64::engine::general_purpose::STANDARD, answer)}),
        )
        .await
        .unwrap();
    until("the answer reaches the Terminal", async || {
        (run.typed().await > typed).then_some(())
    })
    .await;
    if answer == "y" {
        let vendor = Client::connect(&run.daemon.socket).await.unwrap();
        vendor
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":run.child}}),
            )
            .await
            .unwrap();
        vendor
            .request("todo.create", json!({"title":"ship a"}))
            .await
            .unwrap();
    }
    run.signal(json!({"hook_event_name":"Stop"})).await;
    until("the Workstream is idle", async || {
        (run.rail_status().await == "idle").then_some(())
    })
    .await;
    assert_eq!(run.status(id).await.0, "delivered");
    let todos = run.user.request("todo.list", Value::Null).await.unwrap();
    let titles: Vec<_> = todos
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["title"].as_str().unwrap())
        .collect();
    assert_eq!(
        titles,
        if answer == "y" {
            vec!["ship a"]
        } else {
            vec![]
        }
    );
}

// U166b Yes
#[tokio::test]
async fn u166b_yes_settles_idle_with_the_todo() {
    u166b_answered("y").await;
}

// U166b No
#[tokio::test]
async fn u166b_no_settles_idle_without_a_todo() {
    u166b_answered("n").await;
}
