use super::*;
use serde_json::json;

#[tokio::test]
async fn u3787j_unremovable_blocker_refusal_retains_the_deletion() {
    for (caller, blocker_creator, removable) in [
        ("agent", None, false),
        ("agent", Some("1"), true),
        ("user", None, true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute(
            "INSERT INTO nodes(id,kind,name,parent,ord) VALUES(1,'agent','caller',NULL,0)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO nodes(id,kind,name,parent,ord,creator) VALUES(2,'workstream','chosen',NULL,1,'1')",
            [],
        )
        .unwrap();
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = crate::Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        let removed = daemon
            .route(
                &mut conn,
                "rail.remove",
                json!({"id":"2","operation":"blocked"}),
            )
            .await
            .unwrap();
        let deletion = removed["deletion"].clone();
        db.execute("DELETE FROM instruction_homes WHERE agent='2'", [])
            .unwrap();
        db.execute(
            "INSERT INTO nodes(id,kind,name,parent,ord,creator) VALUES(2,'workstream','blocker',NULL,1,?)",
            [blocker_creator],
        )
        .unwrap();
        let refusal = if caller == "agent" {
            // The Daemon refuses an Agent caller before the Rail; the Rail's own check decides the
            // refusal copy, so run it in the transaction `rail.restore` would open.
            let agent = contracts::Actor {
                kind: contracts::ActorKind::Agent,
                id: "1".into(),
                parent: None,
            };
            db.execute(
                "UPDATE rail_deletions SET actor=?",
                [serde_json::to_string(&agent).unwrap()],
            )
            .unwrap();
            let mut other = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
            let tx = other.transaction().unwrap();
            let params = serde_json::from_value(deletion.clone()).unwrap();
            let refusal = agents::Agents::restore_reversible_in(&tx, &agent, &params).unwrap_err();
            drop(tx);
            db.execute(
                "UPDATE rail_deletions SET actor=?",
                [serde_json::to_string(&Actor::user()).unwrap()],
            )
            .unwrap();
            refusal
        } else {
            daemon
                .route(&mut conn, "rail.restore", deletion.clone())
                .await
                .unwrap_err()
        };
        assert_eq!(refusal.code, rpc::code::CONFLICT);
        let expected = if removable {
            "Remove that item before trying Undo again."
        } else {
            "the deletion is retained."
        };
        assert!(
            refusal.message.ends_with(expected),
            "{caller} {blocker_creator:?}: {}",
            refusal.message
        );
        let kept = daemon
            .route(&mut conn, "rail.deletion", deletion)
            .await
            .unwrap();
        assert_eq!(kept["deletion"]["restored"], false);
        assert_eq!(kept["removed"], removed["removed"]);
    }
}
