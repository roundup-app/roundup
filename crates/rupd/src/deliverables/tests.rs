use super::*;
use serde_json::json;
#[tokio::test]
async fn dv2_metadata_only() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: contracts::Actor::user(),
        peer: None,
        events,
        output: None,
    };
    let pad = daemon
        .route(
            &mut conn,
            "pad.create",
            json!({"name":"notes","text":"retained"}),
        )
        .await
        .unwrap();
    let record=daemon.route(&mut conn,"deliverable.publish",json!({"key":"notes","title":"Result","target":{"kind":"pad","name":"notes","incarnation":pad["incarnation"],"revision":1}})).await.unwrap();
    let denied = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = denied.clone();
    {
        let db = daemon.publications.db.lock().unwrap();
        let settings: (String, i64) = db
            .query_row(
                "SELECT journal_mode,synchronous FROM pragma_journal_mode(),pragma_synchronous()",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(settings, ("wal".to_owned(), 2));
        db.authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
            if matches!(
                ctx.action,
                rusqlite::hooks::AuthAction::Read {
                    table_name: "deliverable_files",
                    ..
                }
            ) {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                rusqlite::hooks::Authorization::Deny
            } else {
                rusqlite::hooks::Authorization::Allow
            }
        }))
        .unwrap();
    }
    assert_eq!(
        daemon
            .route(&mut conn, "deliverable.list", json!({}))
            .await
            .unwrap(),
        json!([record])
    );
    let id = json!({"project":record["project"],"id":record["id"]});
    assert_eq!(
        daemon
            .route(&mut conn, "deliverable.get", id.clone())
            .await
            .unwrap(),
        record
    );
    assert_eq!(denied.load(std::sync::atomic::Ordering::SeqCst), 0);
    // Confirm the instrument actually catches a payload read at the same public seam.
    assert!(
        daemon
            .route(&mut conn, "deliverable.resolve", id)
            .await
            .is_err()
    );
    assert!(denied.load(std::sync::atomic::Ordering::SeqCst) > 0);
}
