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
            .split([' ', '('])
            .next()
            .unwrap_or("")
            .trim_matches(|c| c == '"' || c == '`' || c == '[' || c == ']')
            .to_lowercase()
    };
    let all = statements(sql);
    let added: Vec<String> = all
        .iter()
        .filter_map(|s| {
            let upper = s.to_uppercase();
            let rest = upper.strip_prefix("ALTER TABLE ")?;
            let (_, tail) = rest.split_once(' ')?;
            let column = tail
                .strip_prefix("ADD COLUMN ")
                .or_else(|| tail.strip_prefix("ADD "))?;
            Some(column.split(' ').next()?.to_owned())
        })
        .collect();
    all.into_iter()
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
                return existing.contains(&table_of(rest)) && !fills_added_column(rest, &added);
            }
            if let Some(rest) = upper.strip_prefix("DELETE FROM ") {
                return existing.contains(&table_of(rest));
            }
            true
        })
        .collect()
}

/// Whether `update` (the text after `UPDATE `) assigns only a column this file adds: the old build
/// does not read that column, so filling it changes nothing it reads.
fn fills_added_column(update: &str, added: &[String]) -> bool {
    let Some((_, set)) = update.split_once(" SET ") else {
        return false;
    };
    if !added.iter().any(|c| set.starts_with(&format!("{c} = "))) {
        return false;
    }
    let (mut depth, mut quoted) = (0, false);
    for (at, c) in set.char_indices() {
        match c {
            '\'' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => depth -= 1,
            ',' if !quoted && depth == 0 => return false,
            _ if !quoted && depth == 0 && set[at..].starts_with(" WHERE ") => return true,
            _ => {}
        }
    }
    true
}

#[test]
fn mg1_filling_the_column_the_file_adds_passes() {
    let existing = HashSet::from(["messages".to_string()]);
    let add = "ALTER TABLE messages ADD COLUMN payload TEXT NOT NULL DEFAULT 'x';";
    let ok = format!("{add} UPDATE messages SET payload = json_object('a', 1) WHERE kind = 'note'");
    assert_eq!(rejected(&ok, &existing), Vec::<String>::new());
    let more = format!("{add} UPDATE messages SET payload = 'x', body = 'y'");
    assert_eq!(rejected(&more, &existing).len(), 1);
    let other = "UPDATE messages SET body = 'y' WHERE payload = 'x'";
    assert_eq!(rejected(other, &existing).len(), 1);
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
        ])
        .output();
    let Ok(listed) = listed.and_then(|o| {
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
        .filter_map(|l| l.strip_prefix("crates/storage/"))
        .filter(|l| l.starts_with("migrations/project/"))
        .map(str::to_string)
        .collect();
    let mut previous = Connection::open_in_memory().unwrap();
    apply(
        &mut previous,
        migrations()[..migrations().len() - new.len()].to_vec(),
    )
    .unwrap();
    let mut all = Connection::open_in_memory().unwrap();
    apply(&mut all, migrations()).unwrap();
    assert_eq!(
        crate::migration::missing(&all, &previous).unwrap(),
        None,
        "MG2: the change's migrations drop or retype what origin/main has"
    );
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
    let db = connect(dir.path()).unwrap();
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
    let message = connect(dir.path()).unwrap_err().to_string();
    assert!(message.contains("lacks column `priority`"), "{message}");
    assert!(message.contains("newer or branch build"), "{message}");
}
