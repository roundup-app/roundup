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
