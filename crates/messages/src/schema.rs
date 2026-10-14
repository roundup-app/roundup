//! Migration 1 adopts main's schema; later changes append numbered SQL migrations.
use rusqlite::{Connection, OptionalExtension, Transaction};
use rusqlite_migration::{HookError, HookResult, M, Migrations};
use std::path::Path;

fn migrations() -> Vec<M<'static>> {
    vec![M::up_with_hook(
        include_str!("../migrations/001/up.sql"),
        bootstrap,
    )]
}

pub(crate) fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
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
    if exists(tx, "messages")? {
        let old = tx.prepare("SELECT \"notnull\", dflt_value IS NOT NULL FROM pragma_table_info('messages') WHERE name = 'receiver_incarnation'")?
            .query_row([], |r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?))).optional()?;
        let new = column(tx, "messages", "receiver_attempt")?;
        if let Some((not_null, has_default)) = old {
            let unfit: i64 = tx.query_row("SELECT COUNT(*) FROM messages WHERE typeof(receiver_incarnation) != 'integer' OR receiver_incarnation < 0", [], |r| r.get(0))?;
            if unfit > 0 {
                return Err(HookError::Hook("cannot migrate messages.receiver_incarnation: a value is not a non-negative integer".into()));
            }
            if new {
                if not_null && !has_default {
                    return Err(HookError::Hook("cannot migrate messages.receiver_incarnation: it is NOT NULL without a default".into()));
                }
                tx.execute_batch(include_str!(
                    "../migrations/001/messages-copy-receiver_attempt.sql"
                ))?;
            } else {
                tx.execute_batch(include_str!(
                    "../migrations/001/messages-rename-receiver_attempt.sql"
                ))?;
            }
        } else if !new {
            tx.execute_batch(include_str!(
                "../migrations/001/messages-add-receiver_attempt.sql"
            ))?;
        }
    }
    if exists(tx, "receiver_generations")? {
        let old = tx.prepare("SELECT \"notnull\", dflt_value IS NOT NULL FROM pragma_table_info('receiver_generations') WHERE name = 'incarnation'")?
            .query_row([], |r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?))).optional()?;
        let new = column(tx, "receiver_generations", "attempt")?;
        if let Some((not_null, has_default)) = old {
            let unfit: i64 = tx.query_row("SELECT COUNT(*) FROM receiver_generations WHERE typeof(incarnation) != 'integer' OR incarnation < 0", [], |r| r.get(0))?;
            if unfit > 0 {
                return Err(HookError::Hook("cannot migrate receiver_generations.incarnation: a value is not a non-negative integer".into()));
            }
            if new {
                if not_null && !has_default {
                    return Err(HookError::Hook("cannot migrate receiver_generations.incarnation: it is NOT NULL without a default".into()));
                }
                tx.execute_batch(include_str!(
                    "../migrations/001/receiver_generations-copy-attempt.sql"
                ))?;
            } else {
                tx.execute_batch(include_str!(
                    "../migrations/001/receiver_generations-rename-attempt.sql"
                ))?;
            }
        } else if !new {
            tx.execute_batch(include_str!(
                "../migrations/001/receiver_generations-add-attempt.sql"
            ))?;
        }
    }
    for (table, name, sql) in [
        (
            "routes",
            "set_by",
            include_str!("../migrations/001/routes-add-set_by.sql"),
        ),
        (
            "messages",
            "rank",
            include_str!("../migrations/001/messages-add-rank.sql"),
        ),
        (
            "messages",
            "receiver_revision",
            include_str!("../migrations/001/messages-add-receiver_revision.sql"),
        ),
        (
            "messages",
            "passed_from",
            include_str!("../migrations/001/messages-add-passed_from.sql"),
        ),
        (
            "receiver_generations",
            "revision",
            include_str!("../migrations/001/receiver_generations-add-revision.sql"),
        ),
        (
            "receiver_generations",
            "closed_revision",
            include_str!("../migrations/001/receiver_generations-add-closed_revision.sql"),
        ),
    ] {
        if exists(tx, table)? && !column(tx, table, name)? {
            tx.execute_batch(sql)?;
        }
    }
    if exists(tx, "messages")? {
        tx.prepare("SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, rank, receiver_attempt, receiver_revision, passed_from FROM messages LIMIT 0")?;
    }
    if exists(tx, "message_retirements")? {
        tx.prepare("SELECT agent, key, completed FROM message_retirements LIMIT 0")?;
    }
    if exists(tx, "message_restarts")? {
        tx.prepare("SELECT agent, key, before, prompt, note, released, published FROM message_restarts LIMIT 0")?;
    }
    if exists(tx, "routes")? {
        tx.prepare("SELECT from_id, to_id, delivery, set_by FROM routes LIMIT 0")?;
    }
    if exists(tx, "chains")? {
        tx.prepare("SELECT id, origin, body, rest, current, armed_at, done FROM chains LIMIT 0")?;
    }
    if exists(tx, "iterations")? {
        tx.prepare("SELECT door, iteration, upto FROM iterations LIMIT 0")?;
    }
    if exists(tx, "receiver_generations")? {
        tx.prepare("SELECT id, attempt, closed, revision, closed_revision FROM receiver_generations LIMIT 0")?;
    }
    Ok(())
}

fn exists(db: &Connection, table: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")?
        .exists([table])
}

fn column(db: &Connection, table: &str, name: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")?
        .exists([table, name])
}

#[cfg(test)]
mod tests {
    const STORE: &str = "messages";
    const INVALID_SQL: &str = "ALTER TABLE messages RENAME COLUMN body TO missing";
    const FAILURE_SQL: &str = "INSERT INTO messages(from_actor,to_id,kind,body,status,at) VALUES('{}','rollback','note','row','pending',120); THIS IS INVALID SQL;";
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rupd/tests/support/schema_tests.rs"
    ));

    #[test]
    fn n10_supported_older_schemas_still_upgrade() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{STORE}.db"));
        std::fs::copy(support::fixture(STORE), &path).unwrap();
        let mut db = Connection::open(&path).unwrap();
        db.execute_batch(r#"ALTER TABLE messages RENAME COLUMN receiver_attempt TO receiver_incarnation; ALTER TABLE receiver_generations RENAME COLUMN attempt TO incarnation;"#).unwrap();
        open(&mut db, &path).unwrap();
        assert_eq!(db.query_row(r#"SELECT COUNT(*) FROM messages WHERE (id = 13 AND receiver_attempt = 4) OR (id = 16 AND receiver_attempt = 2)"#, [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(
            version(&db),
            SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
        );
    }
}
