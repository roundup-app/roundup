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
    let created = client
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
    let client = project.client().await;
    let read = client
        .request("pad.read", json!({"name":"NOTES"}))
        .await
        .unwrap();
    assert_eq!(read["incarnation"], created["incarnation"]);
    assert_eq!(read["incarnation"], first.incarnation.to_string());
    assert_eq!(
        client.request("pad.list", json!(null)).await.unwrap()[0],
        read
    );
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
    let original = client
        .request(
            "pad.create",
            json!({"name":"existing", "text":"before upgrade"}),
        )
        .await
        .unwrap();
    project.crash();
    let path = project.data_dir().join("project.db");
    for name in ["project.db", "project.db-wal", "project.db-shm"] {
        match std::fs::remove_file(project.data_dir().join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("remove current fixture database: {error}"),
        }
    }
    let db = Connection::open(path).unwrap();
    // Pin historical Project version 12, before source incarnations. New migrations must
    // not turn this fixture into a different predecessor or replay already-created tables.
    let historical = [
        include_str!("../../rupd/migrations/001/up.sql"),
        include_str!("../../agents/migrations/003/up.sql"),
        include_str!("../../rupd/migrations/003/up.sql"),
        include_str!("../../agents/migrations/004/up.sql"),
        include_str!("../../rupd/migrations/005/up.sql"),
        include_str!("../../pads/migrations/002/up.sql"),
        include_str!("../../rupd/migrations/006/up.sql"),
        include_str!("../../agents/migrations/005/up.sql"),
        include_str!("../../messages/migrations/002/up.sql"),
        include_str!("../../messages/migrations/003/up.sql"),
        include_str!("../../rupd/migrations/project/0001-prepared.sql"),
        include_str!("../../rupd/migrations/project/0002-message-sender-names.sql"),
    ];
    for sql in historical {
        db.execute_batch(sql).unwrap();
    }
    db.execute("INSERT INTO pads(key,name,owner,text,updated_at,home,revision) VALUES ('existing','existing',?1,?2,?3,NULL,1)",rusqlite::params![original["owner"].to_string(),original["text"].as_str().unwrap(),original["updated_at"].as_i64().unwrap()]).unwrap();
    db.pragma_update(None, "user_version", 12).unwrap();
    project.restart(&[]);
    let first = source(&db, "existing").unwrap().unwrap();
    assert_eq!(first.pad.text, "before upgrade");
    assert_eq!(first.pad.revision, 1);
    project.restart(&[]);
    assert_eq!(source(&db, "EXISTING").unwrap(), Some(first));
}

#[tokio::test]
async fn u2773c_pads_external_change_keeps_original() {
    for replacement_after_restart in [None, Some(false), Some(true)] {
        let mut project = daemon::start(&[]);
        let client = project.client().await;
        client
            .request("pad.create", json!({"name":"Notes", "text":"original"}))
            .await
            .unwrap();
        client
            .request("pad.setStorage", json!({"files":true}))
            .await
            .unwrap();
        // This is the recovery read: deletion/recreation happens after it and before save.
        let original = client
            .request("pad.read", json!({"name":"NOTES"}))
            .await
            .unwrap();
        client
            .request("pad.delete", json!({"name":"notes"}))
            .await
            .unwrap();
        let replacement = if replacement_after_restart.is_some() {
            Some(
                client
                    .request(
                        "pad.create",
                        json!({"name":"notes", "text":"  replacement\n👋 é  "}),
                    )
                    .await
                    .unwrap(),
            )
        } else {
            None
        };
        if replacement_after_restart == Some(true) {
            project.restart(&[]);
        }
        let client = project.client().await;
        let before = client.request("pad.list", json!(null)).await.unwrap();
        let touches = client
            .request("provenance.history", json!({"item":"pad:notes"}))
            .await
            .unwrap();
        let mut events = project.subscribed().await;
        let error = client.request("pad.write", json!({"name":"NOTES", "text":"old recovered draft", "expectedIncarnation":original["incarnation"], "expectedRevision":original["revision"]})).await.unwrap_err();
        assert_eq!(
            error.code,
            if replacement.is_some() {
                rpc::code::CONFLICT
            } else {
                rpc::code::NOT_FOUND
            }
        );
        if let Some(replacement) = replacement {
            assert_ne!(original["incarnation"], replacement["incarnation"]);
            assert_eq!(original["revision"], replacement["revision"]);
        }
        assert_eq!(
            client.request("pad.list", json!(null)).await.unwrap(),
            before
        );
        let mirror = project.data_dir().join("pads/notes.md");
        if replacement_after_restart.is_some() {
            assert_eq!(
                std::fs::read_to_string(mirror).unwrap(),
                "  replacement\n👋 é  "
            );
        } else {
            assert!(!mirror.exists());
        }
        assert_eq!(
            client
                .request("provenance.history", json!({"item":"pad:notes"}))
                .await
                .unwrap(),
            touches
        );
        // An accepted marker bounds the Event stream without a quiet-time sleep.
        client
            .request("pad.create", json!({"name":"marker"}))
            .await
            .unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(5), events.next_event())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(event.data, contracts::EventData::PadChanged(ref pad) if pad.name == "marker"),
            "refused write emitted an Event: {event:?}"
        );
    }
}

#[tokio::test]
async fn u2773a_pads_incarnation_is_scoped_to_original_project() {
    let one = daemon::start(&[]);
    let two = daemon::start(&[]);
    let a = one.client().await;
    let b = two.client().await;
    let first = a
        .request("pad.create", json!({"name":"notes", "text":"one"}))
        .await
        .unwrap();
    let second = b
        .request("pad.create", json!({"name":"notes", "text":"two"}))
        .await
        .unwrap();
    // Each Project owns its own incarnation namespace, so the Project must be retained too.
    a.request("pad.write", json!({"name":"notes", "text":"one changed", "expectedIncarnation":first["incarnation"], "expectedRevision":first["revision"]})).await.unwrap();
    assert_eq!(
        b.request("pad.read", json!({"name":"notes"}))
            .await
            .unwrap(),
        second
    );
    let current = a
        .request("pad.read", json!({"name":"notes"}))
        .await
        .unwrap();
    assert_eq!(current["text"], "one changed");
    assert_eq!(current["incarnation"], first["incarnation"]);
}
