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
