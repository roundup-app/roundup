use contracts::agent::NodeKind;
use rpc::code;

use super::Rail;

fn rail() -> (tempfile::TempDir, Rail) {
    let dir = tempfile::tempdir().unwrap();
    let rail = Rail::open(&dir.path().join("agents.db")).unwrap();
    (dir, rail)
}

#[test]
fn u2875c_each_reservation_write_rolls_back_without_a_partial_rail_entry() {
    for failure in [
        "CREATE TRIGGER fail AFTER INSERT ON nodes WHEN NEW.kind='workstream' BEGIN SELECT RAISE(ABORT,'interrupted Workstream write'); END;",
        "CREATE TRIGGER fail AFTER INSERT ON nodes WHEN NEW.kind='agent' BEGIN SELECT RAISE(ABORT,'interrupted Agent write'); END;",
        "CREATE TRIGGER fail AFTER INSERT ON closed_sources BEGIN SELECT RAISE(ABORT,'interrupted source write'); END;",
    ] {
        let (dir, mut rail) = rail();
        rail.db.execute_batch(failure).unwrap();
        assert!(rail.reserve_closed("failed", "hidden").is_err());
        assert!(rail.tree().unwrap().is_empty());
        // A reopen refuses a schema that differs from the migrations' (N5420a).
        rail.db.execute_batch("DROP TRIGGER fail").unwrap();
        drop(rail);
        let mut rail = Rail::open(&dir.path().join("agents.db")).unwrap();
        assert!(rail.tree().unwrap().is_empty());
        assert!(rail.closed_source("failed").unwrap().is_none());
        rail.reserve_closed("failed", "retry").unwrap();
    }
}

#[test]
fn u2875c_final_commit_failure_keeps_both_nodes_unpublished() {
    let (dir, mut rail) = rail();
    let (workstream, agent) = rail.reserve_closed("failed", "hidden").unwrap();
    rail.closed_copy("failed", b"opaque ownership").unwrap();
    rail.save_conversation(&agent, "retained", "/project")
        .unwrap();
    // A deferred FK failure happens at COMMIT, after every publication statement ran.
    rail.db.execute_batch("PRAGMA foreign_keys=ON;
        CREATE TABLE commit_guard (source TEXT REFERENCES closed_sources(source) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail AFTER UPDATE OF published ON closed_sources WHEN NEW.published=1
        BEGIN INSERT INTO commit_guard VALUES('absent'); END;").unwrap();
    assert!(rail.publish_closed("failed").is_err());
    assert!(rail.tree().unwrap().is_empty());
    assert!(rail.node(&workstream).is_err());
    assert!(rail.has_conversation(&agent).is_err());
    // A reopen refuses a schema that differs from the migrations' (N5420a).
    rail.db
        .execute_batch("DROP TRIGGER fail; DROP TABLE commit_guard;")
        .unwrap();
    drop(rail);
    let mut rail = Rail::open(&dir.path().join("agents.db")).unwrap();
    assert!(rail.tree().unwrap().is_empty());
    rail.publish_closed("failed").unwrap();
    assert_eq!(rail.tree().unwrap().len(), 2);
}

#[test]
fn a2703a_rail_resolves_current_names_and_gone_agents() {
    let (_dir, mut rail) = rail();
    let node = rail.insert(NodeKind::Agent, "sad", None, None).unwrap();
    assert_eq!(rail.name(&node.id).unwrap(), "sad");
    rail.rename(&node.id, "glad").unwrap();
    assert_eq!(rail.name(&node.id).unwrap(), "glad");
    assert_eq!(rail.name("7013").unwrap(), "an Agent that is gone");
    rail.db.execute_batch("DROP TABLE nodes").unwrap();
    assert_eq!(rail.name(&node.id).unwrap_err().code, code::INTERNAL);
}

#[test]
fn r16_loaded_rail_keeps_complete_conversation_availability_in_tree_order() {
    let (_dir, mut rail) = rail();
    let first = rail
        .insert(NodeKind::Workstream, "first", None, None)
        .unwrap();
    let child = rail
        .insert(NodeKind::Agent, "child", Some(&first.id), None)
        .unwrap();
    let second = rail
        .insert(NodeKind::Workstream, "second", None, None)
        .unwrap();
    rail.db.execute("UPDATE nodes SET conversation_id = 'saved', conversation_cwd = '/project' WHERE id = ?", [&child.id]).unwrap();
    rail.db
        .execute(
            "UPDATE nodes SET conversation_id = 'partial' WHERE id = ?",
            [&second.id],
        )
        .unwrap();
    let tree = rail.tree().unwrap();
    assert_eq!(
        tree.iter()
            .map(|n| (n.id.as_str(), n.can_resume))
            .collect::<Vec<_>>(),
        [
            (first.id.as_str(), false),
            (child.id.as_str(), true),
            (second.id.as_str(), false),
        ]
    );
    assert!(rail.node(&child.id).unwrap().can_resume);
}

#[test]
fn a7_attempt_exhaustion_does_not_wrap_or_change_the_node() {
    let (_dir, mut rail) = rail();
    let node = rail
        .insert(NodeKind::Workstream, "workstream", None, None)
        .unwrap();
    rail.db
        .execute("UPDATE nodes SET attempt = ?", [i64::MAX])
        .unwrap();
    let before = rail.node(&node.id).unwrap();
    assert_eq!(
        rail.allocate_attempt(&node.id).unwrap_err().code,
        code::INTERNAL
    );
    assert_eq!(rail.node(&node.id).unwrap(), before);
}

#[test]
fn a6_nothing_nests_under_an_agent() {
    let (_dir, mut rail) = rail();
    let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
    {
        let kind = NodeKind::Agent;
        let leaf = rail.insert(kind, "leaf", None, Some("1")).unwrap();
        let inserted = rail
            .insert(NodeKind::Workstream, "x", Some(&leaf.id), None)
            .unwrap_err();
        let moved = rail.move_node(&group.id, Some(&leaf.id), 0).unwrap_err();
        assert_eq!(
            (inserted.code, moved.code),
            (code::CONFLICT, code::CONFLICT),
            "{kind:?}"
        );
    }
}

#[test]
fn a6_rename_needs_the_exact_id() {
    let (_dir, mut rail) = rail();
    let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
    let err = rail.rename(&format!("0{}", group.id), "other").unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert_eq!(rail.tree().unwrap()[0].name, "g");
}

#[test]
fn n5467b_obsolete_rail_records_are_refused_without_rewriting() {
    for (kind, parent) in [
        ("room", None),
        ("group", None),
        ("terminal", None),
        ("workstream", Some(1)),
    ] {
        let (dir, mut rail) = rail();
        rail.insert(NodeKind::Workstream, "kept", None, Some("9"))
            .unwrap();
        rail.db
            .execute(
                "UPDATE nodes SET kind=?,parent=? WHERE name='kept'",
                rusqlite::params![kind, parent],
            )
            .unwrap();
        drop(rail);
        let path = dir.path().join("agents.db");
        for _ in 0..2 {
            let error = match Rail::open(&path) {
                Ok(_) => panic!("obsolete Rail opened"),
                Err(error) => error.to_string(),
            };
            assert!(
                error.contains(dir.path().to_str().unwrap())
                    && error.contains("close roundup")
                    && error.contains("delete"),
                "{error}"
            );
            let kept: (String, Option<i64>, String) = rusqlite::Connection::open(&path)
                .unwrap()
                .query_row(
                    "SELECT kind,parent,terminal_id FROM nodes WHERE name='kept'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(kept, (kind.into(), parent, "9".into()));
        }
    }
}

#[test]
fn a8_reopening_unlinks_every_terminal_id() {
    let (dir, mut rail) = rail();
    rail.insert(NodeKind::Agent, "claude", None, Some("1"))
        .unwrap();
    rail.insert(NodeKind::Agent, "shell", None, Some("2"))
        .unwrap();
    drop(rail);

    let reopened = Rail::open(&dir.path().join("agents.db")).unwrap();
    let ids: Vec<_> = reopened
        .tree()
        .unwrap()
        .into_iter()
        .map(|n| n.terminal_id)
        .collect();
    assert_eq!(ids, [None, None]);
}

#[test]
fn a6_removing_a_node_closes_the_gap_among_its_siblings() {
    let (_dir, mut rail) = rail();
    let ids: Vec<_> = ["a", "b", "c"]
        .map(|name| {
            rail.insert(NodeKind::Workstream, name, None, None)
                .unwrap()
                .id
        })
        .into();
    rail.remove(&ids[1]).unwrap();
    let tree = rail.tree().unwrap();
    let rest: Vec<_> = tree.iter().map(|n| (n.name.as_str(), n.order)).collect();
    assert_eq!(rest, [("a", 0), ("c", 1)]);
}

/// A16: moving a Workstream's children and deleting the Workstream are one transaction. A trigger
/// that only rejects the delete (the updates `place` runs are untouched) tells this apart
/// from a mutant that commits the move before deleting in a second transaction: there, the
/// move would survive even though the delete failed.
#[test]
fn a16_a_groups_delete_failing_after_a_successful_move_rolls_both_back() {
    let (_dir, mut rail) = rail();
    let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
    let child = rail
        .insert(NodeKind::Agent, "child", Some(&group.id), None)
        .unwrap();
    rail.db
        .execute_batch(
            "CREATE TRIGGER forbid_delete BEFORE DELETE ON nodes
             BEGIN SELECT RAISE(ABORT, 'delete forbidden'); END;",
        )
        .unwrap();

    let err = rail.remove(&group.id).unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    let found = rail.node(&child.id).unwrap();
    assert_eq!(found.parent.as_deref(), Some(group.id.as_str()));
}
