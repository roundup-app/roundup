//! DV2/DV3 source-lifecycle prerequisite; publication observers remain owned by #2796.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use pads::{PadDeletion, PadSourceState, source, source_state};
use rusqlite::Connection;
use serde_json::json;

#[tokio::test]
async fn dv3_revoked_access_survives_recreation_and_restart() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    client
        .request("pad.create", json!({"name":"Notes", "text":"original"}))
        .await
        .unwrap();
    let db = Connection::open(project.data_dir().join("project.db")).unwrap();
    let first = source(&db, "NOTES").unwrap().unwrap();
    client
        .request("pad.delete", json!({"name":"notes"}))
        .await
        .unwrap();
    project.restart(&[]);
    let client = project.client().await;
    client
        .request("pad.create", json!({"name":"notes", "text":"replacement"}))
        .await
        .unwrap();
    let second = source(&db, "Notes").unwrap().unwrap();
    assert_ne!(first.incarnation, second.incarnation);
    assert_eq!(second.pad.text, "replacement");
    assert_eq!(second.pad.revision, 1);
    assert_eq!(
        source_state(&db, first.incarnation).unwrap(),
        PadSourceState::Deleted(PadDeletion::User)
    );
    project.restart(&[]);
    assert_eq!(
        source_state(&db, first.incarnation).unwrap(),
        PadSourceState::Deleted(PadDeletion::User)
    );
    assert_eq!(
        source_state(&db, second.incarnation).unwrap(),
        PadSourceState::Live(second)
    );
}

#[tokio::test]
async fn dv2_source_incarnation_survives_edits_owner_home_and_restart() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let home = client
        .request("rail.createWorkstream", json!({"name":"home"}))
        .await
        .unwrap();
    client
        .request("pad.create", json!({"name":"notes", "text":"one"}))
        .await
        .unwrap();
    let mut db = Connection::open(project.data_dir().join("project.db")).unwrap();
    let first = source(&db, "notes").unwrap().unwrap();
    // The publication writer's transaction pins identity, Revision and text together.
    let snapshot = db.transaction().unwrap();
    assert_eq!(source(&snapshot, "notes").unwrap(), Some(first.clone()));
    client
        .request(
            "pad.write",
            json!({"name":"notes", "text":"two", "expectedRevision":1}),
        )
        .await
        .unwrap();
    client
        .request("pad.append", json!({"name":"notes", "text":"!"}))
        .await
        .unwrap();
    client
        .request("pad.move", json!({"name":"notes", "home":home["id"]}))
        .await
        .unwrap();
    let owner = json!({"kind":"agent", "id":"maker"});
    client
        .request("pad.setOwner", json!({"name":"notes", "owner":owner}))
        .await
        .unwrap();
    assert_eq!(
        source_state(&snapshot, first.incarnation).unwrap(),
        PadSourceState::Live(first.clone())
    );
    snapshot.commit().unwrap();
    project.restart(&[]);
    let current = source(&db, "notes").unwrap().unwrap();
    assert_eq!(current.incarnation, first.incarnation);
    assert_eq!(current.pad.text, "two!");
    assert_eq!(current.pad.revision, 3);
    assert_eq!(current.pad.owner.id, "maker");
    assert_eq!(current.pad.home.as_deref(), home["id"].as_str());
    assert_eq!(
        source_state(&db, i64::MAX).unwrap(),
        PadSourceState::Unknown
    );
}

#[tokio::test]
async fn dv3_rejected_file_deletion_restarts_without_denial_then_retry_commits() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    client
        .request("pad.create", json!({"name":"notes", "text":"keep"}))
        .await
        .unwrap();
    client
        .request("pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    let db = Connection::open(project.data_dir().join("project.db")).unwrap();
    let first = source(&db, "notes").unwrap().unwrap();
    let file = project.data_dir().join("pads/notes.md");
    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    assert!(
        client
            .request("pad.delete", json!({"name":"notes"}))
            .await
            .is_err()
    );
    project.restart(&[]);
    assert_eq!(
        source_state(&db, first.incarnation).unwrap(),
        PadSourceState::Live(first.clone())
    );
    std::fs::remove_dir(&file).unwrap();
    std::fs::write(&file, "keep").unwrap();
    let client = project.client().await;
    client
        .request("pad.delete", json!({"name":"notes"}))
        .await
        .unwrap();
    project.restart(&[]);
    let client = project.client().await;
    assert_eq!(
        client
            .request("pad.delete", json!({"name":"notes"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    assert!(!file.exists());
    assert_eq!(source(&db, "notes").unwrap(), None);
    assert_eq!(
        source_state(&db, first.incarnation).unwrap(),
        PadSourceState::Deleted(PadDeletion::User)
    );
}

#[tokio::test]
async fn dv2_preexisting_project_pads_gain_durable_source_incarnations() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    client
        .request(
            "pad.create",
            json!({"name":"existing", "text":"before upgrade"}),
        )
        .await
        .unwrap();
    project.crash();
    let db = Connection::open(project.data_dir().join("project.db")).unwrap();
    // Reconstruct the immediately preceding Project schema, retaining its real Pad row.
    // This migration is the only schema difference from that version.
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    db.execute_batch(
        "DROP TRIGGER pad_source_created; DROP TRIGGER pad_source_removed; DROP TABLE pad_sources;",
    )
    .unwrap();
    db.pragma_update(None, "user_version", version - 1).unwrap();
    project.restart(&[]);
    let first = source(&db, "existing").unwrap().unwrap();
    assert_eq!(first.pad.text, "before upgrade");
    assert_eq!(first.pad.revision, 1);
    project.restart(&[]);
    assert_eq!(source(&db, "EXISTING").unwrap(), Some(first));
}
