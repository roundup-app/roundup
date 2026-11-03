//! MG1, MG3: a migration the previous build cannot read fails; a database one migration ahead opens.
use super::*;
use std::collections::HashSet;

fn statements(sql: &str) -> Vec<String> {
    let code: String = sql
        .lines()
        .map(|line| line.split("--").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(" ");
    code.split(';')
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|s| !s.is_empty())
        .collect()
}

/// The statements of `sql` the previous build cannot read; `existing` are the tables on `origin/main`.
fn rejected(sql: &str, existing: &HashSet<String>) -> Vec<String> {
    let table_of = |rest: &str| {
        rest.trim_start_matches("IF NOT EXISTS ")
            .split(|c: char| c == ' ' || c == '(')
            .next()
            .unwrap_or("")
            .trim_matches(|c| c == '"' || c == '`' || c == '[' || c == ']')
            .to_lowercase()
    };
    statements(sql)
        .into_iter()
        .filter(|statement| {
            let upper = statement.to_uppercase();
            let creates = [
                "CREATE TABLE ",
                "CREATE INDEX ",
                "CREATE UNIQUE INDEX ",
                "CREATE VIEW ",
            ]
            .iter()
            .any(|p| upper.starts_with(p));
            if creates {
                return false;
            }
            if let Some(rest) = upper.strip_prefix("ALTER TABLE ") {
                let tail = rest.split_once(' ').map_or("", |(_, tail)| tail);
                let Some(column) = tail
                    .strip_prefix("ADD COLUMN ")
                    .or_else(|| tail.strip_prefix("ADD "))
                else {
                    return true;
                };
                return column.contains("NOT NULL") && !column.contains("DEFAULT");
            }
            if let Some(rest) = upper.strip_prefix("UPDATE ") {
                return existing.contains(&table_of(rest));
            }
            if let Some(rest) = upper.strip_prefix("DELETE FROM ") {
                return existing.contains(&table_of(rest));
            }
            true
        })
        .collect()
}

#[test]
fn mg1_only_additive_statements_pass() {
    let existing = HashSet::from(["todos".to_string()]);
    let sql = "-- note\nCREATE TABLE IF NOT EXISTS notes(id TEXT);\nCREATE INDEX i ON notes(id);\n\
        CREATE VIEW v AS SELECT 1;\nALTER TABLE todos ADD COLUMN a INTEGER;\n\
        ALTER TABLE todos ADD COLUMN b TEXT NOT NULL DEFAULT '';\nUPDATE notes SET id = 'x';";
    assert_eq!(rejected(sql, &existing), Vec::<String>::new());
}

#[test]
fn mg1_dropping_renaming_or_rewriting_fails_naming_the_statement() {
    let existing = HashSet::from(["todos".to_string()]);
    for sql in [
        "DROP TABLE todos",
        "DROP INDEX i",
        "ALTER TABLE todos RENAME TO t2",
        "ALTER TABLE todos RENAME COLUMN a TO b",
        "ALTER TABLE todos DROP COLUMN a",
        "ALTER TABLE todos ADD COLUMN a TEXT NOT NULL",
        "UPDATE todos SET a = 1",
        "DELETE FROM todos",
    ] {
        assert_eq!(rejected(sql, &existing), vec![sql.to_string()], "{sql}");
    }
}

/// The migration files on this change and not on `origin/main` hold only additive statements.
#[test]
fn mg1_the_changes_own_migrations_are_additive() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let listed = std::process::Command::new("git")
        .current_dir(root)
        .args([
            "diff",
            "--name-only",
            "--diff-filter=A",
            "origin/main...HEAD",
            "--",
            "migrations/project",
        ])
        .output();
    let Ok(listed) = listed.map(|o| o).and_then(|o| {
        if o.status.success() {
            Ok(o)
        } else {
            Err(std::io::Error::other("no origin/main"))
        }
    }) else {
        return;
    };
    let new: Vec<String> = String::from_utf8(listed.stdout)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect();
    let mut previous = Connection::open_in_memory().unwrap();
    apply(
        &mut previous,
        migrations()[..migrations().len() - new.len()].to_vec(),
    )
    .unwrap();
    let existing: HashSet<String> = previous
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|n| n.unwrap().to_lowercase())
        .collect();
    for file in new {
        let sql = std::fs::read_to_string(root.join(&file)).unwrap();
        let bad = rejected(&sql, &existing);
        assert!(bad.is_empty(), "{file}: {bad:?}");
    }
}

fn ahead(dir: &Path, statement: &str) -> i64 {
    let known = migrations().len() as i64;
    let mut db = Connection::open(dir.join("project.db")).unwrap();
    apply(&mut db, migrations()).unwrap();
    db.execute_batch(statement).unwrap();
    db.pragma_update(None, "user_version", known + 1).unwrap();
    known + 1
}

#[test]
fn mg3_a_database_ahead_by_additive_migrations_opens() {
    let dir = tempfile::tempdir().unwrap();
    let stored = ahead(
        dir.path(),
        "CREATE TABLE mg3_added(x); ALTER TABLE todos ADD COLUMN mg3_extra INTEGER;",
    );
    let db = open(dir.path()).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, stored);
    let extra: i64 = db
        .query_row(
            "SELECT count(*) FROM pragma_table_info('todos') WHERE name = 'mg3_extra'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(extra, 1);
    let table: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name = 'mg3_added'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(table, 1);
}

#[test]
fn mg3_a_database_ahead_with_a_missing_column_still_refuses() {
    let dir = tempfile::tempdir().unwrap();
    ahead(dir.path(), "ALTER TABLE todos DROP COLUMN priority;");
    let message = open(dir.path()).unwrap_err().to_string();
    assert!(message.contains("lacks column `priority`"), "{message}");
    assert!(message.contains("newer or branch build"), "{message}");
}
