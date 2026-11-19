//! MG1, MG3: a migration the previous build cannot read fails; a database one migration ahead opens.
use super::*;
use std::collections::HashSet;

fn statements(sql: &str) -> Vec<String> {
    let code: String = sql
        .lines()
        .map(|line| line.split("--").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(" ");
    let mut out: Vec<String> = Vec::new();
    let mut open = false;
    for piece in code.split(';') {
        let piece = piece.split_whitespace().collect::<Vec<_>>().join(" ");
        if piece.is_empty() {
            continue;
        }
        // A trigger's body holds `;`: it is one statement up to its closing `END`.
        if open {
            let last = out.last_mut().unwrap();
            last.push_str("; ");
            last.push_str(&piece);
        } else {
            out.push(piece);
        }
        let last = out.last().unwrap().to_uppercase();
        open = last.starts_with("CREATE TRIGGER ") && !last.ends_with(" END");
    }
    out
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
    // C7707d: a table this file creates holds nothing the previous build reads.
    let created: HashSet<String> = all
        .iter()
        .filter_map(|s| {
            let upper = s.to_uppercase();
            let rest = upper
                .strip_prefix("CREATE VIRTUAL TABLE ")
                .or_else(|| upper.strip_prefix("CREATE TABLE "))?;
            Some(table_of(rest))
        })
        .collect();
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
                "CREATE VIRTUAL TABLE ",
                "CREATE TRIGGER ",
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
            if let Some(rest) = upper.strip_prefix("INSERT INTO ") {
                return !created.contains(&table_of(rest));
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
fn mg1_a_virtual_table_triggers_and_a_rebuild_of_its_own_table_pass() {
    let existing = HashSet::from(["todos".to_string()]);
    let sql = "CREATE VIRTUAL TABLE todos_fts USING fts5(title, content='todos', content_rowid='id');\n\
        CREATE TRIGGER todos_fts_ai AFTER INSERT ON todos BEGIN\n\
            INSERT INTO todos_fts(rowid, title) VALUES (new.id, new.title);\n\
        END;\n\
        INSERT INTO todos_fts(todos_fts) VALUES ('rebuild');";
    assert_eq!(rejected(sql, &existing), Vec::<String>::new());
    for sql in [
        "INSERT INTO todos_fts(todos_fts) VALUES ('rebuild')",
        "INSERT INTO todos(title) VALUES ('x')",
        "CREATE VIRTUAL TABLE t USING fts5(a); DELETE FROM todos",
    ] {
        assert!(!rejected(sql, &existing).is_empty(), "{sql}");
    }
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

#[test]
fn c7707d_rows_written_before_the_migration_are_found_on_first_open() {
    let dir = tempfile::tempdir().unwrap();
    let all = migrations();
    let mut db = Connection::open(dir.path().join("project.db")).unwrap();
    apply(&mut db, all[..all.len() - 1].to_vec()).unwrap();
    db.execute_batch(
        "INSERT INTO todos(title, body, created_at) VALUES ('old todo', 'a token here', 1);
         INSERT INTO pads(key, name, text, updated_at) VALUES ('p', 'old pad', 'token notes', 1);
         INSERT INTO messages(from_actor, to_id, kind, body, status, at)
             VALUES ('{}', 'a1', 'note', 'a token sent', 'delivered', 1);",
    )
    .unwrap();
    drop(db);
    let db = connect(dir.path()).unwrap();
    for (fts, found) in [("todos_fts", 1), ("pads_fts", 1), ("messages_fts", 1)] {
        let n: i64 = db
            .query_row(
                &format!("SELECT count(*) FROM {fts} WHERE {fts} MATCH 'token'"),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, found, "{fts}");
    }
}
