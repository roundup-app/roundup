//! P15/P2544d: guarded Pad edits through the built CLI.
use super::*;

#[tokio::test]
async fn p2544d_cli_write_accepts_revision_guard() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    assert_eq!(
        code(
            &run.rup(&["pad", "create", "notes", "--text", "original"])
                .await
        ),
        0
    );
    assert_eq!(
        code(
            &run.rup(&["pad", "write", "notes", "winner", "--expectedRevision", "1"])
                .await
        ),
        0
    );
    let stale = run
        .rup(&[
            "pad",
            "write",
            "notes",
            "loser",
            "--expectedRevision",
            "1",
            "--json",
        ])
        .await;
    assert_eq!(code(&stale), 1);
    assert!(err(&stale).contains("revision 2"));
    let read: Value =
        serde_json::from_str(&out(&run.rup(&["pad", "read", "notes", "--json"]).await)).unwrap();
    assert_eq!(read["text"], "winner");
}

