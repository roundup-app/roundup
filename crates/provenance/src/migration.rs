//! N5088a, N5420a: the open every standalone store shares, and the schema comparison the Project's open uses too.
use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

const ADVICE: &str = "This database came from a newer or branch build. Use the build that wrote it, or reset this disposable pre-release database after closing roundup.";

/// Migrate `db` to the latest of `migrations`, refusing first a database from a newer build and
/// one whose schema differs from what its first `user_version` migrations build.
pub fn migrate(
    db: &mut Connection,
    path: &Path,
    migrations: Vec<M<'static>>,
) -> rusqlite::Result<()> {
    let known = migrations.len();
    let stored: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let fail = |message: String| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "{}: {message}",
            path.display()
        ))))
    };
    if let Ok(prefix) = usize::try_from(stored)
        && prefix <= known
    {
        let mut reference = Connection::open_in_memory()?;
        if prefix > 0 {
            Migrations::new(migrations[..prefix].to_vec())
                .to_latest(&mut reference)
                .map_err(|e| fail(format!("reference schema through {prefix}: {e}")))?;
        }
        if let Some(difference) = difference(db, &reference)? {
            return Err(fail(divergence(&difference, stored, known)));
        }
    }
    Migrations::new(migrations).to_latest(db).map_err(|error| {
        fail(match error {
            rusqlite_migration::Error::MigrationDefinition(
                rusqlite_migration::MigrationDefinitionError::DatabaseTooFarAhead,
            ) => {
                format!("database version {stored}; this build supports through {known}. {ADVICE}")
            }
            error => format!("migration through {known}: {error}"),
        })
    })
}

/// The refusal text, without the path the caller prefixes.
pub fn divergence(difference: &str, stored: i64, known: usize) -> String {
    format!(
        "database schema differs from the one this build's migrations build: {difference}; database version {stored}; this build supports through {known}. {ADVICE}"
    )
}

/// What `type name` maps to in `sqlite_schema`, internal tables excluded.
fn objects(db: &Connection) -> rusqlite::Result<BTreeMap<(String, String), String>> {
    db.prepare(
        "SELECT type, name, coalesce(sql, '') FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
    )?
    .query_map([], |row| Ok(((row.get(1)?, row.get(0)?), row.get(2)?)))?
    .collect()
}

fn columns(db: &Connection, table: &str) -> rusqlite::Result<Vec<(String, String)>> {
    db.prepare("SELECT name, type FROM pragma_table_info(?1) ORDER BY cid")?
        .query_map([table], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

/// The first object (by name, then type) that `db` and `reference` hold differently, or `None`.
pub fn difference(db: &Connection, reference: &Connection) -> rusqlite::Result<Option<String>> {
    let (have, want) = (objects(db)?, objects(reference)?);
    let mut keys: Vec<_> = have.keys().chain(want.keys()).collect();
    keys.sort();
    keys.dedup();
    for key in keys {
        let (name, kind) = (&key.0, &key.1);
        match (have.get(key), want.get(key)) {
            (Some(a), Some(b)) if a == b => continue,
            (None, _) => return Ok(Some(format!("{kind} `{name}` is missing"))),
            (_, None) => {
                return Ok(Some(format!(
                    "{kind} `{name}` is not in this build's schema"
                )));
            }
            _ => {}
        }
        if kind == "table" {
            let (a, b) = (columns(db, name)?, columns(reference, name)?);
            for i in 0..a.len().max(b.len()) {
                if a.get(i) == b.get(i) {
                    continue;
                }
                return Ok(Some(match (a.get(i), b.get(i)) {
                    (_, Some((column, _))) if !a.iter().any(|(c, _)| c == column) => {
                        format!("table `{name}` lacks column `{column}`")
                    }
                    (Some((column, _)), _) if !b.iter().any(|(c, _)| c == column) => {
                        format!(
                            "table `{name}` has column `{column}`, which this build's schema lacks"
                        )
                    }
                    (Some((column, _)), _) => format!("table `{name}` column `{column}` differs"),
                    _ => format!("table `{name}` differs"),
                }));
            }
        }
        return Ok(Some(format!("{kind} `{name}` differs in its SQL")));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built(sql: &[&'static str]) -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        Migrations::new(sql.iter().map(|s| M::up(s)).collect())
            .to_latest(&mut db)
            .unwrap();
        db
    }

    #[test]
    fn n5420a_the_first_differing_column_is_named() {
        let reference = built(&["CREATE TABLE a(x); CREATE TABLE z(y);"]);
        let same = built(&["CREATE TABLE z(y); CREATE TABLE a(x);"]);
        assert_eq!(difference(&same, &reference).unwrap(), None);
        let other = built(&["CREATE TABLE a(x, w); CREATE TABLE z(y);"]);
        assert_eq!(
            difference(&reference, &other).unwrap().unwrap(),
            "table `a` lacks column `w`"
        );
        assert_eq!(
            difference(&other, &reference).unwrap().unwrap(),
            "table `a` has column `w`, which this build's schema lacks"
        );
        let missing = built(&["CREATE TABLE a(x);"]);
        assert_eq!(
            difference(&missing, &reference).unwrap().unwrap(),
            "table `z` is missing"
        );
    }
}
