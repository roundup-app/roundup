use rusqlite::Connection;

use crate::RpcError;

/// Make `table` hold `new` with the values of `old`, a column an earlier release named otherwise.
/// `decl` is `new`'s declaration when neither exists. `old` alone is renamed; both present copies
/// `old` into every row whose `new` is 0. A table that is absent is left to its `CREATE`.
/// Refuses with `INTERNAL` naming the table and column when `old` holds a value that is not a
/// non-negative integer, or would reject the inserts of this release (NOT NULL, no default).
pub fn adopt_renamed_column(
    db: &Connection,
    table: &str,
    old: &str,
    new: &str,
    decl: &str,
) -> Result<(), RpcError> {
    let refuse = |column: &str, why: &str| {
        RpcError::internal(format!("cannot migrate {table}.{column}: {why}"))
    };
    let columns = |name: &str| -> Result<Option<(bool, bool)>, RpcError> {
        db.prepare(
            "SELECT \"notnull\", dflt_value IS NOT NULL FROM pragma_table_info(?) WHERE name = ?",
        )
        .and_then(|mut q| {
            let mut rows = q.query([table, name])?;
            rows.next()?
                .map(|r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?)))
                .transpose()
        })
        .map_err(|e| refuse(name, &e.to_string()))
    };
    let sql = |column: &str, statement: String| {
        db.execute(&statement, [])
            .map(drop)
            .map_err(|e| refuse(column, &e.to_string()))
    };
    let (old_col, new_col) = (columns(old)?, columns(new)?);
    if let Some((not_null, has_default)) = old_col {
        let unfit: i64 = db
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM {table} WHERE typeof({old}) != 'integer' OR {old} < 0"
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| refuse(old, &e.to_string()))?;
        if unfit > 0 {
            return Err(refuse(old, "a value is not a non-negative integer"));
        }
        if new_col.is_some() {
            if not_null && !has_default {
                return Err(refuse(old, "it is NOT NULL without a default"));
            }
            sql(
                new,
                format!("UPDATE {table} SET {new} = {old} WHERE {new} = 0"),
            )?;
        } else {
            sql(
                old,
                format!("ALTER TABLE {table} RENAME COLUMN {old} TO {new}"),
            )?;
        }
    } else if new_col.is_none() {
        let exists = db
            .prepare("SELECT 1 FROM pragma_table_info(?)")
            .and_then(|mut q| q.exists([table]))
            .map_err(|e| refuse(new, &e.to_string()))?;
        if exists {
            sql(new, format!("ALTER TABLE {table} ADD COLUMN {new} {decl}"))?;
        }
    }
    Ok(())
}
