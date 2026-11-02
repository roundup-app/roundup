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
