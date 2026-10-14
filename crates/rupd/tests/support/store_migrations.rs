use rusqlite::{Connection, types::Value};
use std::{collections::BTreeMap, path::PathBuf};

pub fn fixture(store: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../rupd/tests/fixtures/store-migrations")
        .join(format!("{store}.db"))
}

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

// Rows include sqlite_sequence; migration metadata lives in the SQLite header.
pub fn rows(db: &Connection) -> BTreeMap<String, Vec<Vec<Value>>> {
    let tables: Vec<String> = db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    tables
        .into_iter()
        .map(|table| {
            let mut q = db
                .prepare(&format!("SELECT * FROM \"{table}\" ORDER BY rowid"))
                .unwrap();
            let count = q.column_count();
            let rows = q
                .query_map([], |r| {
                    (0..count)
                        .map(|i| r.get(i))
                        .collect::<rusqlite::Result<Vec<Value>>>()
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            (table, rows)
        })
        .collect()
}

// The retained fixture is the independent migration-1 baseline. Only this
// approved Agents successor may change it; unknown versions remain errors.
pub fn expected_schema(store: &str, version: usize) -> Vec<(String, String)> {
    assert!(
        version == 1 || (store == "agents" && version == 2),
        "unexpected {store} migration {version}"
    );
    let baseline = Connection::open(fixture(store)).unwrap();
    let mut expected = schema(&baseline);
    if version == 2 {
        let index = expected
            .iter_mut()
            .find(|(name, _)| name == "nodes_terminal")
            .unwrap();
        index.1 =
            "CREATEINDEXnodes_terminalONnodes(terminal_id,attempt)WHEREterminal_idISNOTNULL".into();
    }
    expected
}

pub fn assert_current_schema(store: &str, db: &Connection) -> usize {
    use rusqlite_migration::{M, Migrations, SchemaVersion};
    // These definitions inspect library metadata only; they never migrate a DB.
    let count = if store == "agents" { 2 } else { 1 };
    let definition = Migrations::new((0..count).map(|_| M::up("")).collect());
    let SchemaVersion::Inside(version) = definition.current_version(db).unwrap() else {
        panic!("unexpected {store} migration version");
    };
    let version = version.get();
    assert_eq!(
        schema(db),
        expected_schema(store, version),
        "{store} migration {version}"
    );
    version
}
