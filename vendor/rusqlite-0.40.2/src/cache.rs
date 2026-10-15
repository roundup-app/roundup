//! Prepared statements cache for faster execution.

use crate::raw_statement::RawStatement;
use crate::{Connection, Params, PrepFlags, Result, Rows, Statement};
use hashlink::LruCache;
use std::cell::RefCell;
use std::ops::{Deref, DerefMut};
use std::sync::Arc;

impl Connection {
    /// Prepare a SQL statement for execution, returning a previously prepared
    /// (but not currently in-use) statement if one is available. The
    /// returned statement will be cached for reuse by future calls to
    /// [`prepare_cached`](Connection::prepare_cached) once it is dropped.
    ///
    /// ```rust,no_run
    /// # use rusqlite::{Connection, Result};
    /// fn insert_new_people(conn: &Connection) -> Result<()> {
    ///     {
    ///         let mut stmt = conn.prepare_cached("INSERT INTO People (name) VALUES (?1)")?;
    ///         stmt.execute(["Joe Smith"])?;
    ///     }
    ///     {
    ///         // This will return the same underlying SQLite statement handle without
    ///         // having to prepare it again.
    ///         let mut stmt = conn.prepare_cached("INSERT INTO People (name) VALUES (?1)")?;
    ///         stmt.execute(["Bob Jones"])?;
    ///     }
    ///     Ok(())
    /// }
    /// ```
    ///
    /// # Failure
    ///
    /// Will return `Err` if `sql` cannot be converted to a C-compatible string
    /// or if the underlying SQLite call fails.
    #[inline]
    pub fn prepare_cached(&self, sql: &str) -> Result<CachedStatement<'_>> {
        self.cache.get(self, sql)
    }

    /// Execute a cached statement and inspect its fresh rows within `read`.
    ///
    /// Unlike `prepare_cached`, a warm statement stays in its bounded LRU entry:
    /// no entry removal or reinsertion is needed. Bindings are cleared and the
    /// statement is reset on return, callback error, or unwinding. Cache capacity
    /// zero prepares an uncached statement. Eviction and flushing still apply.
    /// The exclusive connection borrow prevents reentrant cache access; neither
    /// rows nor a borrowed statement can escape the callback. Only compiled SQL
    /// is retained, never query results. Existing `prepare_cached` is unchanged.
    ///
    /// Preparation and parameter-binding errors are returned before `read` runs.
    /// Stepping errors are reported by `Rows::next` inside `read`.
    ///
    /// ```
    /// # use rusqlite::{Connection, Result};
    /// # fn main() -> Result<()> {
    /// let mut db = Connection::open_in_memory()?;
    /// let value = db.with_cached_rows("SELECT ?1", [7], |rows| {
    ///     rows.next()?.unwrap().get::<_, i64>(0)
    /// })??;
    /// assert_eq!(value, 7);
    /// # Ok(()) }
    /// ```
    ///
    /// ```compile_fail
    /// # use rusqlite::Connection;
    /// let mut db = Connection::open_in_memory().unwrap();
    /// let rows = db.with_cached_rows("SELECT 1", [], |rows| rows);
    /// ```
    ///
    /// ```compile_fail
    /// # use rusqlite::Connection;
    /// let mut db = Connection::open_in_memory().unwrap();
    /// db.with_cached_rows("SELECT 1", [], |_| db.flush_prepared_statement_cache());
    /// ```
    ///
    /// ```compile_fail
    /// # use rusqlite::Connection;
    /// let mut db = Connection::open_in_memory().unwrap();
    /// db.with_cached_rows("SELECT 1", [], |rows| {
    ///     std::thread::scope(|scope| { scope.spawn(move || { let _ = rows.next(); }); });
    /// });
    /// ```
    pub fn with_cached_rows<T, P: Params>(
        &mut self,
        sql: &str,
        params: P,
        read: impl FnOnce(&mut Rows<'_>) -> T,
    ) -> Result<T> {
        // #1947: checkout/return medians total 721–911 ns on the R16 7763
        // fixture. Keep the existing bounded entry while executing fresh SQL.
        let sql = sql.trim();
        if self.cache.0.borrow().capacity() == 0 {
            let mut stmt = self.prepare_with_flags(sql, PrepFlags::SQLITE_PREPARE_PERSISTENT)?;
            return Ok(read(&mut stmt.query(params)?));
        }
        if !self.cache.0.borrow().contains_key(sql) {
            let mut stmt = self.prepare_cached(sql)?;
            if stmt.stmt.as_ref().unwrap().stmt.is_null() {
                return Ok(read(&mut stmt.query(params)?));
            }
            drop(stmt);
        }
        let mut cache = self.cache.0.borrow_mut();
        let slot = cache
            .get_mut(sql)
            .expect("cached statement was just prepared");
        // SAFETY: the null placeholder owns no SQLite resource. The guard swaps
        // the real statement back before releasing the cache borrow, even on panic.
        let mut stmt = Statement::new(self, unsafe { RawStatement::new(std::ptr::null_mut()) });
        std::mem::swap(&mut stmt.stmt, slot);
        struct Restore<'a, 'conn> {
            stmt: Statement<'conn>,
            slot: &'a mut RawStatement,
        }
        impl Drop for Restore<'_, '_> {
            fn drop(&mut self) {
                if !self.stmt.stmt.is_null() {
                    self.stmt.stmt.reset();
                    self.stmt.clear_bindings();
                }
                std::mem::swap(&mut self.stmt.stmt, self.slot);
            }
        }
        let mut guard = Restore { stmt, slot };
        let mut rows = guard.stmt.query(params)?;
        Ok(read(&mut rows))
    }

    /// Set the maximum number of cached prepared statements this connection
    /// will hold. By default, a connection will hold a relatively small
    /// number of cached statements. If you need more, or know that you
    /// will not use cached statements, you
    /// can set the capacity manually using this method.
    #[inline]
    pub fn set_prepared_statement_cache_capacity(&self, capacity: usize) {
        self.cache.set_capacity(capacity);
    }

    /// Remove/finalize all prepared statements currently in the cache.
    #[inline]
    pub fn flush_prepared_statement_cache(&self) {
        self.cache.flush();
    }
}

/// Prepared statements LRU cache.
#[derive(Debug)]
pub struct StatementCache(RefCell<LruCache<Arc<str>, RawStatement>>);

unsafe impl Send for StatementCache {}

/// Cacheable statement.
///
/// Statement will return automatically to the cache by default.
/// If you want the statement to be discarded, call
/// [`discard()`](CachedStatement::discard) on it.
pub struct CachedStatement<'conn> {
    stmt: Option<Statement<'conn>>,
    cache: &'conn StatementCache,
}

impl<'conn> Deref for CachedStatement<'conn> {
    type Target = Statement<'conn>;

    #[inline]
    fn deref(&self) -> &Statement<'conn> {
        self.stmt.as_ref().unwrap()
    }
}

impl<'conn> DerefMut for CachedStatement<'conn> {
    #[inline]
    fn deref_mut(&mut self) -> &mut Statement<'conn> {
        self.stmt.as_mut().unwrap()
    }
}

impl Drop for CachedStatement<'_> {
    #[inline]
    fn drop(&mut self) {
        if let Some(stmt) = self.stmt.take() {
            self.cache.cache_stmt(unsafe { stmt.into_raw() });
        }
    }
}

impl CachedStatement<'_> {
    #[inline]
    fn new<'conn>(stmt: Statement<'conn>, cache: &'conn StatementCache) -> CachedStatement<'conn> {
        CachedStatement {
            stmt: Some(stmt),
            cache,
        }
    }

    /// Discard the statement, preventing it from being returned to its
    /// [`Connection`]'s collection of cached statements.
    #[inline]
    pub fn discard(mut self) {
        self.stmt = None;
    }
}

impl StatementCache {
    /// Create a statement cache.
    #[inline]
    pub fn with_capacity(capacity: usize) -> Self {
        Self(RefCell::new(LruCache::new(capacity)))
    }

    #[inline]
    fn set_capacity(&self, capacity: usize) {
        self.0.borrow_mut().set_capacity(capacity);
    }

    // Search the cache for a prepared-statement object that implements `sql`.
    // If no such prepared-statement can be found, allocate and prepare a new one.
    //
    // # Failure
    //
    // Will return `Err` if no cached statement can be found and the underlying
    // SQLite prepare call fails.
    fn get<'conn>(
        &'conn self,
        conn: &'conn Connection,
        sql: &str,
    ) -> Result<CachedStatement<'conn>> {
        let trimmed = sql.trim();
        let mut cache = self.0.borrow_mut();
        let stmt = match cache.remove(trimmed) {
            Some(raw_stmt) => Ok(Statement::new(conn, raw_stmt)),
            None => conn
                .prepare_with_flags(trimmed, PrepFlags::SQLITE_PREPARE_PERSISTENT)
                .map(|mut stmt| {
                    stmt.stmt.set_statement_cache_key(trimmed);
                    stmt
                }),
        };
        stmt.map(|stmt| CachedStatement::new(stmt, self))
    }

    // Return a statement to the cache.
    fn cache_stmt(&self, mut stmt: RawStatement) {
        if stmt.is_null() {
            return;
        }
        let mut cache = self.0.borrow_mut();
        stmt.clear_bindings();
        if let Some(sql) = stmt.statement_cache_key() {
            cache.insert(sql, stmt);
        } else {
            debug_assert!(
                false,
                "bug in statement cache code, statement returned to cache that without key"
            );
        }
    }

    #[inline]
    fn flush(&self) {
        let mut cache = self.0.borrow_mut();
        cache.clear();
    }
}

#[cfg(all(test, not(miri)))]
mod test {
    #[cfg(all(target_family = "wasm", target_os = "unknown"))]
    use wasm_bindgen_test::wasm_bindgen_test as test;

    use super::StatementCache;
    use crate::{Connection, Result};
    use fallible_iterator::FallibleIterator as _;

    impl StatementCache {
        fn clear(&self) {
            self.0.borrow_mut().clear();
        }

        fn len(&self) -> usize {
            self.0.borrow().len()
        }

        fn capacity(&self) -> usize {
            self.0.borrow().capacity()
        }
    }

    // B32/R16: retain the allocation while the statement is checked out, so an
    // allocator cannot reuse its address and hide a replacement on a warm hit.
    #[test]
    fn b32_r16_warm_checkout_retains_sql_key() -> Result<()> {
        let db = Connection::open_in_memory()?;
        let first = db.prepare_cached(" SELECT ?1 ")?;
        let key = first
            .stmt
            .as_ref()
            .unwrap()
            .stmt
            .statement_cache_key()
            .unwrap();
        drop(first);
        let mut warm = db.prepare_cached("SELECT ?1")?;
        let warm_key = warm
            .stmt
            .as_ref()
            .unwrap()
            .stmt
            .statement_cache_key()
            .unwrap();
        assert!(std::sync::Arc::ptr_eq(&key, &warm_key));
        assert_eq!(warm.query_row([7], |row| row.get::<_, i64>(0))?, 7);
        Ok(())
    }

    #[test]
    fn b32_r16_eviction_or_flush_requires_a_new_key() -> Result<()> {
        for flush in [false, true] {
            let db = Connection::open_in_memory()?;
            db.set_prepared_statement_cache_capacity(1);
            let first = db.prepare_cached("SELECT 1")?;
            let key = first
                .stmt
                .as_ref()
                .unwrap()
                .stmt
                .statement_cache_key()
                .unwrap();
            drop(first);
            if flush {
                db.flush_prepared_statement_cache();
            } else {
                assert_eq!(
                    db.prepare_cached("SELECT 2")?
                        .query_row([], |r| r.get::<_, i64>(0))?,
                    2
                );
            }
            let mut fresh = db.prepare_cached("SELECT 1")?;
            let fresh_key = fresh
                .stmt
                .as_ref()
                .unwrap()
                .stmt
                .statement_cache_key()
                .unwrap();
            assert!(!std::sync::Arc::ptr_eq(&key, &fresh_key));
            assert_eq!(fresh.query_row([], |r| r.get::<_, i64>(0))?, 1);
        }
        Ok(())
    }

    #[test]
    fn b32_r16_binding_failure_returns_an_unbound_statement() -> Result<()> {
        let db = Connection::open_in_memory()?;
        let mut failed = db.prepare_cached("SELECT ?1")?;
        failed.raw_bind_parameter(1, 7)?;
        assert!(failed.raw_bind_parameter(2, 8).is_err());
        drop(failed);
        let mut next = db.prepare_cached("SELECT ?1")?;
        assert_eq!(
            next.raw_query().next()?.unwrap().get::<_, Option<i64>>(0)?,
            None
        );
        Ok(())
    }

    #[test]
    fn r16_cached_rows_rebind_and_execute_fresh() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        db.execute_batch("CREATE TABLE owner (id INTEGER); INSERT INTO owner VALUES (7)")?;
        for expected in [7, 9] {
            db.execute("UPDATE owner SET id = ?1", [expected])?;
            let actual =
                db.with_cached_rows("SELECT id FROM owner WHERE id = ?1", [expected], |rows| {
                    rows.next()?.unwrap().get::<_, i64>(0)
                })??;
            assert_eq!(actual, expected);
        }
        Ok(())
    }

    #[test]
    fn r16_cached_rows_retain_compilation_until_flush() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        for runs in [1, 2] {
            let actual = db.with_cached_rows("SELECT 7", [], |rows| -> Result<i32> {
                rows.next()?;
                Ok(rows
                    .as_ref()
                    .unwrap()
                    .get_status(crate::StatementStatus::Run))
            })??;
            assert_eq!(actual, runs);
        }
        db.flush_prepared_statement_cache();
        let actual = db.with_cached_rows("SELECT 7", [], |rows| -> Result<i32> {
            rows.next()?;
            Ok(rows
                .as_ref()
                .unwrap()
                .get_status(crate::StatementStatus::Run))
        })??;
        assert_eq!(actual, 1);
        Ok(())
    }

    #[test]
    fn r16_cached_rows_clear_bindings_after_callback_error() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        let failed: Result<()> =
            db.with_cached_rows("SELECT :id", crate::named_params! { ":id": 7 }, |_| {
                Err(crate::Error::InvalidQuery)
            })?;
        assert!(failed.is_err());
        let value =
            db.with_cached_rows("SELECT :id", &[] as &[(&str, &dyn crate::ToSql)], |rows| {
                rows.next()?.unwrap().get::<_, Option<i64>>(0)
            })??;
        assert_eq!(value, None);
        Ok(())
    }

    #[test]
    fn r16_cached_rows_recover_after_binding_failure() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        assert!(db
            .with_cached_rows(
                "SELECT :id",
                crate::named_params! { ":id": 7, ":bad": 8 },
                |_| { panic!("binding failure must not invoke callback") }
            )
            .is_err());
        let value =
            db.with_cached_rows("SELECT :id", &[] as &[(&str, &dyn crate::ToSql)], |rows| {
                rows.next()?.unwrap().get::<_, Option<i64>>(0)
            })??;
        assert_eq!(value, None);
        Ok(())
    }

    #[test]
    fn r16_cached_rows_recover_after_unwind() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = db.with_cached_rows(
                "SELECT :id UNION ALL SELECT 8",
                crate::named_params! { ":id": 7 },
                |rows| {
                    assert!(rows.next().unwrap().is_some());
                    panic!("callback failed with an active reader")
                },
            );
        }));
        assert!(panic.is_err());
        let value = db.with_cached_rows(
            "SELECT :id UNION ALL SELECT 8",
            &[] as &[(&str, &dyn crate::ToSql)],
            |rows| rows.next()?.unwrap().get::<_, Option<i64>>(0),
        )??;
        assert_eq!(value, None);
        Ok(())
    }

    #[test]
    fn r16_cached_rows_recover_after_schema_error() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        db.execute_batch("CREATE TABLE owner (id INTEGER); INSERT INTO owner VALUES (7)")?;
        let query = "SELECT id FROM owner";
        assert_eq!(
            db.with_cached_rows(query, [], |r| r.next()?.unwrap().get::<_, i64>(0))??,
            7
        );
        db.execute_batch("DROP TABLE owner")?;
        assert!(db
            .with_cached_rows(query, [], |r| r.next().map(|_| ()))?
            .is_err());
        db.execute_batch("CREATE TABLE owner (id INTEGER); INSERT INTO owner VALUES (9)")?;
        assert_eq!(
            db.with_cached_rows(query, [], |r| r.next()?.unwrap().get::<_, i64>(0))??,
            9
        );
        Ok(())
    }

    #[test]
    fn r16_cached_rows_empty_sql_does_not_require_a_cache_entry() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        for query in ["", " ", "-- no statement"] {
            db.with_cached_rows(query, [], |_| ())?;
        }
        assert_eq!(
            db.with_cached_rows("SELECT 7", [], |r| r.next()?.unwrap().get::<_, i64>(0))??,
            7
        );
        Ok(())
    }

    #[test]
    fn r16_cached_rows_prepare_failure_does_not_invoke_callback() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        assert!(db
            .with_cached_rows("SELECT FROM", [], |_| panic!(
                "invalid SQL must not invoke callback"
            ))
            .is_err());
        assert_eq!(
            db.with_cached_rows("SELECT 7", [], |r| r.next()?.unwrap().get::<_, i64>(0))??,
            7
        );
        Ok(())
    }

    #[test]
    fn r16_cached_rows_connection_remains_send() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        db.with_cached_rows("SELECT ?1", [7], |_| ())?;
        let db = std::thread::spawn(move || -> Result<Connection> {
            assert_eq!(
                db.with_cached_rows("SELECT ?1", [9], |r| r.next()?.unwrap().get::<_, i64>(0))??,
                9
            );
            Ok(db)
        })
        .join()
        .unwrap()?;
        db.close().unwrap();
        Ok(())
    }

    #[test]
    fn r16_cached_rows_obey_capacity_eviction_and_flush() -> Result<()> {
        let mut db = Connection::open_in_memory()?;
        for capacity in [0, 1] {
            db.set_prepared_statement_cache_capacity(capacity);
            for flush in [false, true] {
                db.with_cached_rows("SELECT ?1", [7], |_| ())?;
                if flush {
                    db.flush_prepared_statement_cache();
                } else {
                    db.with_cached_rows("SELECT 2", [], |_| ())?;
                }
                assert!(db.cache.len() <= capacity);
                assert_eq!(
                    db.with_cached_rows("SELECT ?1", [9], |r| r
                        .next()?
                        .unwrap()
                        .get::<_, i64>(0))??,
                    9
                );
            }
        }
        Ok(())
    }

    #[test]
    fn test_cache() -> Result<()> {
        let db = Connection::open_in_memory()?;
        let cache = &db.cache;
        let initial_capacity = cache.capacity();
        assert_eq!(0, cache.len());
        assert!(initial_capacity > 0);

        let sql = "PRAGMA schema_version";
        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(0, cache.len());
            assert_eq!(0, stmt.query_row([], |r| r.get::<_, i64>(0))?);
        }
        assert_eq!(1, cache.len());

        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(0, cache.len());
            assert_eq!(0, stmt.query_row([], |r| r.get::<_, i64>(0))?);
        }
        assert_eq!(1, cache.len());

        cache.clear();
        assert_eq!(0, cache.len());
        assert_eq!(initial_capacity, cache.capacity());
        Ok(())
    }

    #[test]
    fn test_set_capacity() -> Result<()> {
        let db = Connection::open_in_memory()?;
        let cache = &db.cache;

        let sql = "PRAGMA schema_version";
        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(0, cache.len());
            assert_eq!(0, stmt.query_row([], |r| r.get::<_, i64>(0))?);
        }
        assert_eq!(1, cache.len());

        db.set_prepared_statement_cache_capacity(0);
        assert_eq!(0, cache.len());

        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(0, cache.len());
            assert_eq!(0, stmt.query_row([], |r| r.get::<_, i64>(0))?);
        }
        assert_eq!(0, cache.len());

        db.set_prepared_statement_cache_capacity(8);
        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(0, cache.len());
            assert_eq!(0, stmt.query_row([], |r| r.get::<_, i64>(0))?);
        }
        assert_eq!(1, cache.len());
        Ok(())
    }

    #[test]
    fn test_discard() -> Result<()> {
        let db = Connection::open_in_memory()?;
        let cache = &db.cache;

        let sql = "PRAGMA schema_version";
        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(0, cache.len());
            assert_eq!(0, stmt.query_row([], |r| r.get::<_, i64>(0))?);
            stmt.discard();
        }
        assert_eq!(0, cache.len());
        Ok(())
    }

    #[test]
    fn test_ddl() -> Result<()> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(
            r"
            CREATE TABLE foo (x INT);
            INSERT INTO foo VALUES (1);
        ",
        )?;

        let sql = "SELECT * FROM foo";

        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(Ok(Some(1i32)), stmt.query([])?.map(|r| r.get(0)).next());
        }

        db.execute_batch(
            r"
            ALTER TABLE foo ADD COLUMN y INT;
            UPDATE foo SET y = 2;
        ",
        )?;

        {
            let mut stmt = db.prepare_cached(sql)?;
            assert_eq!(
                Ok(Some((1i32, 2i32))),
                stmt.query([])?.map(|r| Ok((r.get(0)?, r.get(1)?))).next()
            );
        }
        Ok(())
    }

    #[test]
    fn test_connection_close() -> Result<()> {
        let conn = Connection::open_in_memory()?;
        conn.prepare_cached("SELECT * FROM sqlite_master;")?;

        conn.close().expect("connection not closed");
        Ok(())
    }

    #[test]
    fn test_empty_stmt() -> Result<()> {
        let conn = Connection::open_in_memory()?;
        conn.prepare_cached("")?;
        Ok(())
    }
}
