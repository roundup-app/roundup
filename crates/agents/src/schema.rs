//! Migration 1 adopts main's schema; later changes append numbered SQL migrations.
use rusqlite::{Connection, OptionalExtension, Transaction};
use rusqlite_migration::{HookError, HookResult, M, Migrations};
use std::path::Path;

fn migrations() -> Vec<M<'static>> {
    vec![
        M::up_with_hook(include_str!("../migrations/001/up.sql"), bootstrap),
        M::up(include_str!("../migrations/002/up.sql")),
    ]
}

pub fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    if path.file_name().is_some_and(|name| name == "project.db") {
        let verified: bool = db.query_row(
            "SELECT verified FROM project_import WHERE id = 0",
            [],
            |row| row.get(0),
        )?;
        return if verified {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        };
    }
    apply(db, path, migrations())
}

fn apply(db: &mut Connection, path: &Path, migrations: Vec<M<'_>>) -> rusqlite::Result<()> {
    let count = migrations.len();
    Migrations::new(migrations).to_latest(db).map_err(|error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "{}: migration through {count}: {error}",
            path.display()
        ))))
    })
}

fn bootstrap(tx: &Transaction<'_>) -> HookResult {
    // These probes select only pre-versioned upgrades, inside the library's migration-1 transaction.
    if has_table(tx, "nodes")? {
        let old = tx.prepare("SELECT \"notnull\", dflt_value IS NOT NULL FROM pragma_table_info('nodes') WHERE name = 'incarnation'")?
            .query_row([], |r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?))).optional()?;
        let new = has_column(tx, "nodes", "attempt")?;
        if let Some((not_null, has_default)) = old {
            let unfit: i64 = tx.query_row("SELECT COUNT(*) FROM nodes WHERE typeof(incarnation) != 'integer' OR incarnation < 0", [], |r| r.get(0))?;
            if unfit > 0 {
                return Err(HookError::Hook(
                    "cannot migrate nodes.incarnation: a value is not a non-negative integer"
                        .into(),
                ));
            }
            if new {
                if not_null && !has_default {
                    return Err(HookError::Hook(
                        "cannot migrate nodes.incarnation: it is NOT NULL without a default".into(),
                    ));
                }
                tx.execute_batch(include_str!("../migrations/001/nodes-copy-attempt.sql"))?;
            } else {
                tx.execute_batch(include_str!("../migrations/001/nodes-rename-attempt.sql"))?;
            }
        } else if !new {
            tx.execute_batch(include_str!("../migrations/001/nodes-add-attempt.sql"))?;
        }
    }
    for (table, name, sql) in [
        (
            "nodes",
            "worktree_owner",
            include_str!("../migrations/001/nodes-add-worktree_owner.sql"),
        ),
        (
            "nodes",
            "worktree_commit",
            include_str!("../migrations/001/nodes-add-worktree_commit.sql"),
        ),
        (
            "nodes",
            "worktree_path",
            include_str!("../migrations/001/nodes-add-worktree_path.sql"),
        ),
        (
            "nodes",
            "worktree_branch",
            include_str!("../migrations/001/nodes-add-worktree_branch.sql"),
        ),
        (
            "nodes",
            "worktree_base",
            include_str!("../migrations/001/nodes-add-worktree_base.sql"),
        ),
        (
            "nodes",
            "worktree_state",
            include_str!("../migrations/001/nodes-add-worktree_state.sql"),
        ),
        (
            "nodes",
            "conversation_id",
            include_str!("../migrations/001/nodes-add-conversation_id.sql"),
        ),
        (
            "nodes",
            "conversation_cwd",
            include_str!("../migrations/001/nodes-add-conversation_cwd.sql"),
        ),
        (
            "nodes",
            "work",
            include_str!("../migrations/001/nodes-add-work.sql"),
        ),
        (
            "nodes",
            "spawn_prompt",
            include_str!("../migrations/001/nodes-add-spawn_prompt.sql"),
        ),
        (
            "nodes",
            "creator",
            include_str!("../migrations/001/nodes-add-creator.sql"),
        ),
        (
            "nodes",
            "spawner",
            include_str!("../migrations/001/nodes-add-spawner.sql"),
        ),
        (
            "nodes",
            "model",
            include_str!("../migrations/001/nodes-add-model.sql"),
        ),
        (
            "nodes",
            "effort",
            include_str!("../migrations/001/nodes-add-effort.sql"),
        ),
        (
            "nodes",
            "iteration",
            include_str!("../migrations/001/nodes-add-iteration.sql"),
        ),
    ] {
        if has_table(tx, table)? && !has_column(tx, table, name)? {
            tx.execute_batch(sql)?;
        }
    }
    if has_table(tx, "nodes")? {
        tx.prepare("SELECT id, kind, name, parent, ord, meta, terminal_id, attempt, worktree_owner, worktree_commit, worktree_path, worktree_branch, worktree_base, worktree_state, conversation_id, conversation_cwd, work, spawn_prompt, creator, spawner, model, effort, iteration FROM nodes LIMIT 0")?;
    }
    if has_table(tx, "settings")? {
        tx.prepare("SELECT id, worktrees_on, worktrees_check FROM settings LIMIT 0")?;
    }
    if has_table(tx, "role_models")? {
        tx.prepare("SELECT role, model, effort FROM role_models LIMIT 0")?;
    }
    if has_table(tx, "allowed_models")? {
        tx.prepare("SELECT ord, model FROM allowed_models LIMIT 0")?;
    }
    Ok(())
}

fn has_table(db: &Connection, table: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")?
        .exists([table])
}

fn has_column(db: &Connection, table: &str, name: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")?
        .exists([table, name])
}

#[cfg(test)]
mod tests {
    const STORE: &str = "agents";
    const INVALID_SQL: &str = "ALTER TABLE nodes RENAME COLUMN name TO missing";
    const FAILURE_SQL: &str =
        "INSERT INTO nodes(kind,name,ord) VALUES('agent','rollback',1); THIS IS INVALID SQL;";
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rupd/tests/support/schema_tests.rs"
    ));

    #[test]
    fn n10_versioned_agents_upgrade_without_data_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agents.db");
        std::fs::copy(support::fixture(STORE), &path).unwrap();
        let mut db = Connection::open(&path).unwrap();
        let mut previous = migrations();
        previous.truncate(1);
        apply(&mut db, &path, previous).unwrap();
        let rows = support::rows(&db);
        open(&mut db, &path).unwrap();
        assert_eq!(support::rows(&db), rows);
        assert_eq!(
            version(&db),
            SchemaVersion::Inside(NonZeroUsize::new(2).unwrap())
        );
        let index: String = db
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE name = 'nodes_terminal'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            index,
            "CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL"
        );
    }

    #[test]
    fn n10_supported_older_schemas_still_upgrade() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{STORE}.db"));
        std::fs::copy(support::fixture(STORE), &path).unwrap();
        let mut db = Connection::open(&path).unwrap();
        db.execute_batch(r#"ALTER TABLE nodes RENAME COLUMN attempt TO incarnation;"#)
            .unwrap();
        open(&mut db, &path).unwrap();
        assert_eq!(db.query_row(r#"SELECT COUNT(*) FROM nodes WHERE (id = 7 AND attempt = 2) OR (id = 9 AND attempt = 4)"#, [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(
            version(&db),
            SchemaVersion::Inside(NonZeroUsize::new(2).unwrap())
        );
    }
}
