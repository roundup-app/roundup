use super::*;
use contracts::EventData;
use serde_json::json;

#[tokio::test]
async fn u5502_publication_observation_names_only_committed_membership_changes() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let mut observed = daemon.bus.subscribe();
    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: contracts::Actor::user(),
        peer: None,
        events,
        output: None,
    };
    let request = json!({"key":"report", "title":"Result", "target":{"kind":"external","url":"https://example.com/result"}});
    let record = daemon
        .route(&mut conn, "deliverable.publish", request.clone())
        .await
        .unwrap();
    let fact = serde_json::to_value(observed.try_recv().unwrap()).unwrap();
    assert_eq!(fact["name"], "deliverable.published");
    assert_eq!(fact["data"]["record"], record);
    assert!(fact["data"]["completion"].is_null());
    assert!(matches!(
        observed.try_recv().unwrap().data,
        EventData::DeliverableChanged
    ));
    assert_eq!(
        daemon
            .route(&mut conn, "deliverable.list", json!({}))
            .await
            .unwrap(),
        json!([record])
    );
    assert_eq!(
        daemon
            .route(&mut conn, "deliverable.publish", request)
            .await
            .unwrap(),
        record
    );
    assert!(
        observed.try_recv().is_err(),
        "idempotent replay published another observation"
    );
    for refused in [
        json!({"key":"bad", "title":"", "target":{"kind":"external","url":"https://example.com"}}),
        json!({"key":"unsafe", "title":"Result", "target":{"kind":"external","url":"javascript:bad"}}),
    ] {
        assert!(
            daemon
                .route(&mut conn, "deliverable.publish", refused)
                .await
                .is_err()
        );
        assert!(
            observed.try_recv().is_err(),
            "failed publication was observed"
        );
    }
    let home = daemon
        .route(
            &mut conn,
            "rail.createWorkstream",
            json!({"name":"Home", "parent":null}),
        )
        .await
        .unwrap();
    while let Ok(event) = observed.try_recv() {
        assert!(!matches!(
            event.data,
            EventData::DeliverablePublished { .. } | EventData::AgentCompleted(_)
        ));
    }
    daemon
        .route(
            &mut conn,
            "deliverable.move",
            json!({"project":record["project"], "id":record["id"], "home":home["id"]}),
        )
        .await
        .unwrap();
    assert!(matches!(
        observed.try_recv().unwrap().data,
        EventData::DeliverableChanged
    ));
    assert!(observed.try_recv().is_err());
    daemon
        .route(
            &mut conn,
            "deliverable.remove",
            json!({"project":record["project"],"id":record["id"]}),
        )
        .await
        .unwrap();
    assert!(matches!(
        observed.try_recv().unwrap().data,
        EventData::DeliverableChanged
    ));
    assert!(observed.try_recv().is_err());
    assert_eq!(
        daemon
            .route(&mut conn, "deliverable.list", json!({}))
            .await
            .unwrap(),
        json!([])
    );
}
