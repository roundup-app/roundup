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
        include_str!("../../migrations/project/0021-todo-estimate.sql"),
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

// Later migrations need their objects absent, while accepted identities and bytes must survive.
#[allow(dead_code)]
pub fn retain_project(dir: &std::path::Path, version: usize) {
    let historical = tempfile::tempdir_in(dir).unwrap();
    let db = project(historical.path(), version);
    db.execute(
        "ATTACH DATABASE ?1 AS accepted",
        [dir.join("project.db").to_str().unwrap()],
    )
    .unwrap();
    let tables = db.prepare("SELECT m.name FROM main.sqlite_schema m JOIN accepted.sqlite_schema a ON a.name=m.name WHERE m.type='table' AND a.type='table' AND m.name NOT LIKE 'sqlite_%'")
        .unwrap().query_map([], |row| row.get::<_, String>(0)).unwrap()
        .collect::<Result<Vec<_>, _>>().unwrap();
    for table in tables {
        // Only shipped identifiers enter SQL; values are copied by SQLite without decoding.
        let columns = db
            .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join(",");
        db.execute_batch(&format!("DELETE FROM main.{table}; INSERT INTO main.{table} ({columns}) SELECT {columns} FROM accepted.{table};"))
            .unwrap();
    }
    db.execute_batch("DETACH DATABASE accepted").unwrap();
    drop(db);
    // The fixture's Daemon is stopped; its stale WAL would replay modern pages over the old schema.
    for name in ["project.db-wal", "project.db-shm"] {
        let path = dir.join(name);
        if path.exists() {
            std::fs::remove_file(path).unwrap();
        }
    }
    std::fs::rename(historical.path().join("project.db"), dir.join("project.db")).unwrap();
}
