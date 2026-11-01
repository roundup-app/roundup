// T4902 retires T29 migration inventory only; existing migration proofs remain.
use rusqlite::Connection;

pub fn schema(db: &Connection) -> Vec<(String, String)> {
    db.prepare("SELECT name, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name")
        .unwrap()
        .query_map([], |row| {
            let sql: String = row.get(1)?;
            Ok((
                row.get(0)?,
                sql.split_whitespace()
                    .collect::<String>()
                    .replace("IFNOTEXISTS", ""),
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

// Storage-only prerequisite: no Ask RPC exists yet.
pub fn write_ask(db: &Connection) {
    db.execute_batch(
        r#"INSERT INTO asks(id,text,at) VALUES('ask-kept','first second',42);
           INSERT INTO ask_parts(ask,ord,text,placement,state)
           VALUES('ask-kept',1,'second','{"kind":"unclear","question":"Where?","candidates":[]}','waiting'),
                 ('ask-kept',0,'first','{"kind":"routed","workstream":"door"}','queued');"#,
    ).unwrap();
    assert_eq!(
        db.execute(
            "UPDATE ask_parts SET state='typed' WHERE ask='ask-kept' AND ord=0 AND state='queued'",
            [],
        )
        .unwrap(),
        1
    );
}

pub fn read_ask(db: &Connection) {
    let ask: (String, String, i64) = db
        .query_row("SELECT id,text,at FROM asks", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!(ask, ("ask-kept".into(), "first second".into(), 42));
    let parts = db.prepare(
        "SELECT ord,text,placement,state,reason FROM ask_parts WHERE ask='ask-kept' ORDER BY ord"
    ).unwrap().query_map([], |r| Ok((
        r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
        r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?,
    ))).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(
        parts,
        vec![
            (
                0,
                "first".into(),
                r#"{"kind":"routed","workstream":"door"}"#.into(),
                "typed".into(),
                None
            ),
            (
                1,
                "second".into(),
                r#"{"kind":"unclear","question":"Where?","candidates":[]}"#.into(),
                "waiting".into(),
                None
            ),
        ]
    );
    assert_eq!(
        db.execute(
            "UPDATE ask_parts SET state='typed' WHERE ask='ask-kept' AND ord=0 AND state='queued'",
            [],
        )
        .unwrap(),
        0
    );
}

// Frozen shipped prefixes keep historical fixtures independent of future additions.
#[allow(dead_code)]
pub fn project(dir: &std::path::Path, version: usize) -> Connection {
    let mut db = Connection::open(dir.join("project.db")).unwrap();
    let shipped = [
        include_str!("../../migrations/001/up.sql"),
        include_str!("../../../agents/migrations/003/up.sql"),
        include_str!("../../migrations/003/up.sql"),
        include_str!("../../../agents/migrations/004/up.sql"),
        include_str!("../../migrations/005/up.sql"),
        include_str!("../../../pads/migrations/002/up.sql"),
        include_str!("../../migrations/006/up.sql"),
        include_str!("../../../agents/migrations/005/up.sql"),
        include_str!("../../../messages/migrations/002/up.sql"),
        include_str!("../../../messages/migrations/003/up.sql"),
        include_str!("../../migrations/project/0001-prepared.sql"),
        include_str!("../../migrations/project/0002-message-sender-names.sql"),
        include_str!("../../migrations/project/0003-pad-sources.sql"),
        include_str!("../../migrations/project/0004-deliverables.sql"),
        include_str!("../../migrations/project/0005-ask-submissions.sql"),
        include_str!("../../migrations/project/0006-closed-sources.sql"),
        include_str!("../../migrations/project/0007-todo-owner.sql"),
        include_str!("../../migrations/project/0008-reactions.sql"),
        include_str!("../../migrations/project/0009-reaction-firings.sql"),
        include_str!("../../migrations/project/0010-reaction-watch.sql"),
        include_str!("../../migrations/project/0011-measurements.sql"),
        include_str!("../../migrations/project/0012-instruction-revisions.sql"),
        include_str!("../../migrations/project/0013-instruction-messages.sql"),
        include_str!("../../migrations/project/0014-reaction-firing-identities.sql"),
        include_str!("../../migrations/project/0015-message-results.sql"),
        include_str!("../../migrations/project/0015-todo-change-actor.sql"),
        include_str!("../../migrations/project/0016-todo-change-time.sql"),
        include_str!("../../migrations/project/0017-todo-comments.sql"),
        include_str!("../../migrations/project/0018-todo-handed.sql"),
        include_str!("../../migrations/project/0019-workstream-queue.sql"),
        include_str!("../../migrations/project/0020-continuations.sql"),
        include_str!("../../migrations/project/0020-todo-refs.sql"),
        include_str!("../../migrations/project/0022-workstream-auto.sql"),
        include_str!("../../migrations/project/0023-agent-finished.sql"),
        include_str!("../../migrations/project/0023-measurement-no-tokens-or-money.sql"),
        include_str!("../../migrations/project/0023-remove-decisions.sql"),
    ];
    rusqlite_migration::Migrations::new(
        shipped.into_iter().map(rusqlite_migration::M::up).collect(),
    )
    .to_version(&mut db, version)
    .unwrap();
    db
}

// Version 35 ends before Decision removal; future migrations must run only on upgrade.
#[allow(dead_code)] // Shared with current-store tests that need no historical prefix.
pub const PROJECT_V35: [&str; 35] = [
    include_str!("../../migrations/001/up.sql"),
    include_str!("../../../agents/migrations/003/up.sql"),
    include_str!("../../migrations/003/up.sql"),
    include_str!("../../../agents/migrations/004/up.sql"),
    include_str!("../../migrations/005/up.sql"),
    include_str!("../../../pads/migrations/002/up.sql"),
    include_str!("../../migrations/006/up.sql"),
    include_str!("../../../agents/migrations/005/up.sql"),
    include_str!("../../../messages/migrations/002/up.sql"),
    include_str!("../../../messages/migrations/003/up.sql"),
    include_str!("../../migrations/project/0001-prepared.sql"),
    include_str!("../../migrations/project/0002-message-sender-names.sql"),
    include_str!("../../migrations/project/0003-pad-sources.sql"),
    include_str!("../../migrations/project/0004-deliverables.sql"),
    include_str!("../../migrations/project/0005-ask-submissions.sql"),
    include_str!("../../migrations/project/0006-closed-sources.sql"),
    include_str!("../../migrations/project/0007-todo-owner.sql"),
    include_str!("../../migrations/project/0008-reactions.sql"),
    include_str!("../../migrations/project/0009-reaction-firings.sql"),
    include_str!("../../migrations/project/0010-reaction-watch.sql"),
    include_str!("../../migrations/project/0011-measurements.sql"),
    include_str!("../../migrations/project/0012-instruction-revisions.sql"),
    include_str!("../../migrations/project/0013-instruction-messages.sql"),
    include_str!("../../migrations/project/0014-reaction-firing-identities.sql"),
    include_str!("../../migrations/project/0015-message-results.sql"),
    include_str!("../../migrations/project/0015-todo-change-actor.sql"),
    include_str!("../../migrations/project/0016-todo-change-time.sql"),
    include_str!("../../migrations/project/0017-todo-comments.sql"),
    include_str!("../../migrations/project/0018-todo-handed.sql"),
    include_str!("../../migrations/project/0019-workstream-queue.sql"),
    include_str!("../../migrations/project/0020-continuations.sql"),
    include_str!("../../migrations/project/0020-todo-refs.sql"),
    include_str!("../../migrations/project/0022-workstream-auto.sql"),
    include_str!("../../migrations/project/0023-agent-finished.sql"),
    include_str!("../../migrations/project/0023-measurement-no-tokens-or-money.sql"),
];

// Copy accepted records into the schema that actually shipped before firing identity scoping.
// A latest-schema copy would retain additive objects that the upgrade must create itself.
#[allow(dead_code)] // Only the Daemon E2E fixture transfers accepted reaction records.
pub fn legacy_reaction(path: &std::path::Path, firings: &str) {
    let accepted = Connection::open(path).unwrap();
    accepted
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    drop(accepted);
    let legacy = path.with_extension("legacy.db");
    let db = Connection::open(&legacy).unwrap();
    for (index, sql) in PROJECT_V35[..23].iter().enumerate() {
        db.execute_batch(if index == 18 { firings } else { sql })
            .unwrap();
    }
    db.pragma_update(None, "user_version", 23).unwrap();
    transfer(path, db);
}

// A Project database at version 41, the last before 0028-deliverable-files, holding `path`'s rows.
// The real migrations build it, so the upgrade from it is the one a user's database takes.
#[allow(dead_code)] // Only the deliverables fixtures need a database older than the Daemon's own.
pub fn legacy_project_v41(path: &std::path::Path) {
    let accepted = Connection::open(path).unwrap();
    accepted
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .unwrap();
    drop(accepted);
    let mut db = Connection::open(path.with_extension("legacy.db")).unwrap();
    let later = [
        include_str!("../../migrations/project/0023-remove-decisions.sql"),
        include_str!("../../migrations/project/0024-remove-bubbling.sql"),
        include_str!("../../migrations/project/0025-remove-deferred-actions.sql"),
        include_str!("../../migrations/project/0026-pad-deletions.sql"),
        include_str!("../../migrations/project/0026-todo-deletions.sql"),
        include_str!("../../migrations/project/0027-rail-deletions.sql"),
    ];
    rusqlite_migration::Migrations::new(
        PROJECT_V35
            .into_iter()
            .chain(later)
            .map(rusqlite_migration::M::up)
            .collect(),
    )
    .to_latest(&mut db)
    .unwrap();
    transfer(path, db);
}

// Replace `path` with `db`, after copying into it the rows of every table both have, over the
// columns `db` has: later columns never enter the fixture.
fn transfer(path: &std::path::Path, db: Connection) {
    let legacy = path.with_extension("legacy.db");
    db.execute("ATTACH DATABASE ?1 AS accepted", [path.to_str().unwrap()])
        .unwrap();
    let tables = db
        .prepare(
            "SELECT name FROM main.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'
         AND name IN (SELECT name FROM accepted.sqlite_schema WHERE type='table')",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    db.execute_batch("BEGIN").unwrap();
    for table in tables {
        // Only columns both schemas have: later ones never enter the fixture, dropped ones stay default.
        let columns: String = db
            .query_row(
                r#"SELECT group_concat(printf('"%w"', name)) FROM pragma_table_info(?1, 'main')
                   WHERE name IN (SELECT name FROM pragma_table_info(?1, 'accepted'))"#,
                [&table],
                |row| row.get(0),
            )
            .unwrap();
        db.execute_batch(&format!(
            "DELETE FROM main.{table}; INSERT INTO main.{table} ({columns}) SELECT {columns} FROM accepted.{table};"
        )).unwrap();
    }
    db.execute_batch("COMMIT; DETACH DATABASE accepted")
        .unwrap();
    drop(db);
    std::fs::rename(legacy, path).unwrap();
}
