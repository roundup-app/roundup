//! D10, D11: the Event log in `project.db`. A row's id is the Event number, so no second counter
//! can drift from the log; AUTOINCREMENT keeps a number from returning after its row is pruned.

use std::path::Path;
use std::sync::Mutex;

use contracts::Event;
use rpc::{EVENT_WINDOW, EventLog, RpcError};
use rusqlite::{Connection, params};

pub(crate) struct SqliteLog {
    db: Mutex<Connection>,
}

impl SqliteLog {
    pub(crate) fn open(dir: &Path) -> rusqlite::Result<Self> {
        let db = Connection::open(dir.join("project.db"))?;
        // A SIGKILL cannot lose a committed row in WAL mode; only a power cut can lose the last few.
        db.pragma_update(None, "synchronous", "NORMAL")?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl EventLog for SqliteLog {
    fn append(&self, event: &Event) -> Result<u64, RpcError> {
        let json = serde_json::to_string(event).map_err(RpcError::internal)?;
        let db = self.db();
        db.execute("INSERT INTO events(event) VALUES (?1)", params![json])
            .map_err(RpcError::internal)?;
        let seq = u64::try_from(db.last_insert_rowid()).map_err(RpcError::internal)?;
        if seq > EVENT_WINDOW {
            db.execute(
                "DELETE FROM events WHERE id <= ?1",
                params![(seq - EVENT_WINDOW) as i64],
            )
            .map_err(RpcError::internal)?;
        }
        Ok(seq)
    }

    fn read(&self, after: u64, limit: usize) -> Result<Vec<Event>, RpcError> {
        let db = self.db();
        let mut statement = db
            .prepare_cached("SELECT id, event FROM events WHERE id > ?1 ORDER BY id LIMIT ?2")
            .map_err(RpcError::internal)?;
        let rows = statement
            .query_map(params![after as i64, limit as i64], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(RpcError::internal)?;
        let mut events = Vec::new();
        for row in rows {
            let (seq, json) = row.map_err(RpcError::internal)?;
            let seq = u64::try_from(seq).map_err(RpcError::internal)?;
            let mut event: Event = serde_json::from_str(&json).map_err(RpcError::internal)?;
            event.seq = Some(seq);
            events.push(event);
        }
        Ok(events)
    }

    fn bounds(&self) -> Result<(u64, u64), RpcError> {
        let db = self.db();
        let (oldest, highest): (Option<i64>, Option<i64>) = db
            .query_row("SELECT MIN(id), MAX(id) FROM events", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(RpcError::internal)?;
        match (oldest, highest) {
            (Some(oldest), Some(highest)) => Ok((oldest as u64, highest as u64)),
            // The table emptied only if no Event was ever saved: the sequence has not started.
            _ => {
                let seq: i64 = db
                    .query_row(
                        "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'events'), 0)",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(RpcError::internal)?;
                Ok((seq as u64 + 1, seq as u64))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::{Actor, EventData};
    use rpc::{Bus, code};
    use std::sync::Arc;

    fn open(dir: &Path) -> Bus {
        Bus::with_log(Arc::new(SqliteLog::open(dir).unwrap()))
    }

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        crate::storage::open(dir.path()).unwrap();
        dir
    }

    #[tokio::test]
    async fn d10_every_event_but_terminal_output_is_saved_and_numbered() {
        let dir = project();
        let bus = open(dir.path());
        let mut live = bus.subscribe();
        bus.emit(Actor::user(), EventData::RailChanged);
        bus.emit(Actor::daemon(), EventData::RailChanged);

        let seen: Vec<_> = (0..2).map(|_| live.try_recv().unwrap().seq).collect();
        assert_eq!(seen, [Some(1), Some(2)]);
        let saved = SqliteLog::open(dir.path()).unwrap().read(0, 10).unwrap();
        assert_eq!(
            saved.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [Some(1), Some(2)]
        );
        assert!(
            saved
                .iter()
                .all(|e| matches!(e.data, EventData::RailChanged))
        );
    }

    #[test]
    fn d10_numbers_never_repeat_across_a_reopen() {
        let dir = project();
        let first = open(dir.path());
        for _ in 0..3 {
            first.emit(Actor::user(), EventData::RailChanged);
        }
        drop(first);

        let reopened = open(dir.path());
        reopened.emit(Actor::user(), EventData::RailChanged);
        let (_, highest) = SqliteLog::open(dir.path()).unwrap().bounds().unwrap();
        assert_eq!(highest, 4);
    }

    #[test]
    fn d11_an_after_older_than_the_window_names_the_oldest_kept() {
        let dir = project();
        let bus = open(dir.path());
        let total = EVENT_WINDOW + 5;
        for _ in 0..total {
            bus.emit(Actor::user(), EventData::RailChanged);
        }
        // Kept: 6 to 10 005.
        let (oldest, highest) = SqliteLog::open(dir.path()).unwrap().bounds().unwrap();
        assert_eq!((oldest, highest), (6, total));

        let expired = bus.subscribe_after(Some(oldest - 2)).err().unwrap();
        assert_eq!(expired.code, code::EVENTS_EXPIRED);
        assert!(expired.message.contains("6"), "{}", expired.message);
        assert!(bus.subscribe_after(Some(oldest - 1)).is_ok());
        let ahead = bus.subscribe_after(Some(highest + 1)).err().unwrap();
        assert_eq!(ahead.code, code::INVALID_PARAMS);
    }
}
