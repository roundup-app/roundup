//! DTC1: a Door's own Todo is no Hand-off. Real Daemon, fake `claude`: the Door's transcript
//! (the `Next:` notes it received) and the Todo's history decide.
use super::*;

async fn door_creates(run: &Run, owner: Value) -> u32 {
    run.sender
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let todo = run
        .sender
        .request(
            "todo.create",
            json!({"title":"Review changes","owner":owner}),
        )
        .await
        .unwrap();
    todo["id"].as_u64().unwrap() as u32
}

async fn other_agent(run: &Run) -> Value {
    let node = run
        .user
        .request("agent.spawn", json!({"name":"other","cwd":run.dir.path()}))
        .await
        .unwrap();
    json!({"kind":"agent","id":node["id"]})
}

async fn handed_changes(run: &Run, id: u32) -> usize {
    let history = run
        .user
        .request("todo.getHistory", json!({"id":id}))
        .await
        .unwrap();
    history["changes"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|change| !change["handed"].is_null())
        .count()
}

#[tokio::test]
async fn dtc1_a_door_that_creates_its_own_todo_gets_no_next_turn() {
    let mut run = Run::start().await;
    run.spawn().await;
    let own = json!({"kind":"agent","id":run.child});
    let id = door_creates(&run, own).await;
    run.idle_edge().await;
    run.idle_edge().await;
    assert_eq!(run.entries(), Vec::<String>::new());
    assert_eq!(handed_changes(&run, id).await, 0);
}

#[tokio::test]
async fn dtc1_a_user_assigned_todo_is_still_handed_to_the_door() {
    let mut run = Run::start().await;
    run.spawn().await;
    let own = json!({"kind":"agent","id":run.child});
    // The Door's own Todo, moved away and back by the user, is the user's assignment.
    let id = door_creates(&run, own.clone()).await;
    for owner in [other_agent(&run).await, own] {
        run.user
            .request("todo.assign", json!({"id":id,"owner":owner}))
            .await
            .unwrap();
    }
    run.idle_edge().await;
    until("the user's assignment is handed", async || {
        (handed_changes(&run, id).await == 1).then_some(())
    })
    .await;
    let body = format!("Next: #{id} Review changes");
    until("the Door is told", async || {
        let listed = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["body"] == body)
            .then_some(())
    })
    .await;
    until("the note reaches its transcript", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    run.idle_edge().await;
    assert_eq!(handed_changes(&run, id).await, 1, "handed once");
}

#[tokio::test]
async fn dtc1_a_todo_a_door_gave_another_agent_is_handed_to_that_agent() {
    let mut run = Run::start().await;
    run.spawn().await;
    let id = door_creates(&run, other_agent(&run).await).await;
    run.idle_edge().await;
    assert_eq!(run.entries(), Vec::<String>::new(), "not the Door's turn");
    let todo = run
        .user
        .request("todo.get", json!({"id":id}))
        .await
        .unwrap();
    assert_ne!(todo["owner"]["id"], run.child);
    // Its creator is the Door, not its owner, so the owner's own idle hands it.
    let wire = run
        .user
        .request("todo.getHistory", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(wire["changes"][0]["actor"]["id"], run.child);
    assert_eq!(todo["creator"]["id"], run.child);
}
