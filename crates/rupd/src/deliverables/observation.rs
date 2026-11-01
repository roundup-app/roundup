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
    assert!(daemon.route(&mut conn, "deliverable.publish", json!({"key":"bad", "title":"", "target":{"kind":"external","url":"https://example.com"}})).await.is_err());
    assert!(
        observed.try_recv().is_err(),
        "failed publication was observed"
    );
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
    assert_eq!(
        daemon
            .route(&mut conn, "deliverable.list", json!({}))
            .await
            .unwrap(),
        json!([])
    );
}
