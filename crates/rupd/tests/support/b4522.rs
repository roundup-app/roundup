use super::*;

// T4902 removes one entry from c54017c92's 44-position sequence and shifts Pad deletion to 38.
fn b4522_history(dir: &Path, version: usize, skipped: bool) {
    let mut db = Connection::open(dir.join("project.db")).unwrap();
    let sequence = migrations()
        .into_iter()
        .take(43)
        .enumerate()
        .map(|(i, m)| {
            if skipped && i == 38 {
                M::up("-- observed skipped Pad migration")
            } else {
                m
            }
        })
        .collect();
    Migrations::new(sequence)
        .to_version(&mut db, version)
        .unwrap();
}

async fn b4522_call(
    daemon: &crate::Daemon,
    method: &str,
    params: serde_json::Value,
) -> serde_json::Value {
    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    daemon
        .route(
            &mut crate::Conn {
                actor: contracts::Actor::user(),
                peer: None,
                events,
                output: None,
            },
            method,
            params,
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn b4522_earlier_project_versions_support_pad_deletion() {
    use serde_json::json;
    for version in 0..=43 {
        let dir = tempfile::tempdir().unwrap();
        b4522_history(dir.path(), version, false);
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let pad = b4522_call(
            &daemon,
            "pad.create",
            json!({"name":"notes","text":"retained 雪"}),
        )
        .await;
        let deletion = b4522_call(
            &daemon,
            "pad.delete",
            json!({"name":"notes","operation":"remove"}),
        )
        .await;
        assert_eq!(
            b4522_call(&daemon, "pad.getDeletion", json!({"operation":"remove"})).await,
            deletion,
            "prefix {version}"
        );
        let restored = b4522_call(
            &daemon,
            "pad.restore",
            json!({"project":deletion["project"],"operation":"remove"}),
        )
        .await;
        assert_eq!(restored["pad"], pad, "prefix {version}");
    }
}

#[tokio::test]
async fn b4522_skipped_pad_migration_recovers_on_open() {
    use serde_json::json;
    let dir = tempfile::tempdir().unwrap();
    b4522_history(dir.path(), 43, true);
    let original;
    let publication;
    let deletion;
    {
        let daemon = crate::test_daemon(dir.path()).unwrap();
        original = b4522_call(
            &daemon,
            "pad.create",
            json!({"name":"notes","text":"exact\n雪\n"}),
        )
        .await;
        publication = b4522_call(&daemon, "deliverable.publish", json!({"key":"result","title":"Result","target":{"kind":"pad","name":"notes","incarnation":original["incarnation"],"revision":1}})).await;
        deletion = b4522_call(
            &daemon,
            "pad.delete",
            json!({"name":"notes","operation":"remove"}),
        )
        .await;
    }
    for _ in 0..2 {
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let retained = b4522_call(&daemon, "pad.getDeletion", json!({"operation":"remove"})).await;
        assert_eq!(retained["pad"], original);
        assert_eq!(retained["project"], deletion["project"]);
        let restored = b4522_call(
            &daemon,
            "pad.restore",
            json!({"project":deletion["project"],"operation":"remove"}),
        )
        .await;
        assert_eq!(restored["pad"], original);
        assert_eq!(
            b4522_call(&daemon, "pad.read", json!({"name":"notes"})).await,
            original
        );
        assert_eq!(
            b4522_call(
                &daemon,
                "deliverable.resolve",
                json!({"project":publication["project"],"id":publication["id"]})
            )
            .await,
            json!({"kind":"unavailable","cause":"access-revoked"})
        );
    }
}

#[tokio::test]
async fn b4522_existing_pad_deletion_survives_repair() {
    use serde_json::json;
    let dir = tempfile::tempdir().unwrap();
    b4522_history(dir.path(), 43, false);
    // Use the installed Pad owner on the actual pre-repair schema to retain an operation.
    let mut db = Connection::open(dir.path().join("project.db")).unwrap();
    let actor = contracts::Actor::user();
    db.execute(
        "INSERT INTO pads(key,name,text,updated_at) VALUES('notes','notes','kept text',1)",
        [],
    )
    .unwrap();
    let tx = db.transaction().unwrap();
    let receipt = pads::retain(
        &tx,
        &actor,
        &contracts::pad::DeleteParams {
            name: "notes".into(),
            operation: Some("existing".into()),
            expected_incarnation: None,
        },
    )
    .unwrap();
    let expected = serde_json::to_value(&receipt).unwrap();
    tx.execute("DELETE FROM pads WHERE key='notes'", [])
        .unwrap();
    tx.commit().unwrap();
    drop(db);
    for _ in 0..2 {
        let daemon = crate::test_daemon(dir.path()).unwrap();
        assert_eq!(
            b4522_call(&daemon, "pad.getDeletion", json!({"operation":"existing"})).await,
            expected
        );
    }
    let daemon = crate::test_daemon(dir.path()).unwrap();
    assert_eq!(
        b4522_call(
            &daemon,
            "pad.restore",
            json!({"project":expected["project"],"operation":"existing"})
        )
        .await["pad"],
        expected["pad"]
    );
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM pad_deletions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}
