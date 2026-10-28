use super::*;

#[tokio::test]
async fn a33_completing_the_blocker_reads_idle() {
    let (_project, client, agent) =
        a33_blocked_agent("a33_completing_the_blocker_reads_idle").await;
    let blocked = a33_reading(&client, &agent.id, Kind::Blocked).await;
    assert_eq!(blocked.label, "waits on #1");
    client
        .request("todo.complete", json!({ "id": 1 }))
        .await
        .unwrap();
    a33_reading(&client, &agent.id, Kind::Idle).await;
    let blocker = client
        .request("todo.create", json!({"title":"next blocker"}))
        .await
        .unwrap();
    client
        .request(
            "todo.setBlockers",
            json!({"id":2,"blockers":[blocker["id"]]}),
        )
        .await
        .unwrap();
    a33_reading(&client, &agent.id, Kind::Blocked).await;
    client
        .request("todo.delete", json!({"operation": "delete-2", "ids": [2]}))
        .await
        .unwrap();
    a33_reading(&client, &agent.id, Kind::Idle).await;
}
