//! D10, D11: the Event log in `project.db`. A row's id is the Event number, so no second counter
//! can drift from the log; AUTOINCREMENT keeps a number from returning after its row is pruned.

#[cfg(test)]
use std::path::Path;
use std::sync::Mutex;

use contracts::Event;
use rpc::{EVENT_WINDOW, EventLog, RpcError};
use rusqlite::{Connection, params};

pub(crate) struct SqliteLog {
    db: Mutex<Connection>,
}

impl SqliteLog {
    #[cfg(test)]
    fn open(dir: &Path) -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open(dir.join("project.db"))?)
    }

    pub(crate) fn from_connection(db: Connection) -> rusqlite::Result<Self> {
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
        // Keep persisted numbers intact while excluding retired notifications from replay.
        // Filter before LIMIT so a page of retired rows cannot hide later ordinary Events.
        let mut statement = db
            .prepare_cached(
                "SELECT id, event FROM events WHERE id > ?1
                 AND json_extract(event, '$.name') IS NOT 'reaction.changed'
                 ORDER BY id LIMIT ?2",
            )
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

    #[test]
    fn r3696c_migration_keeps_the_wal_open_for_the_event_log() {
        let dir = tempfile::tempdir().unwrap();
        let _opened = crate::storage::open(dir.path()).unwrap();
        assert!(dir.path().join("project.db-wal").exists());
    }

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
        bus.emit(Actor::user(), EventData::DeliverableChanged);
        bus.emit(
            Actor::daemon(),
            EventData::AgentCompleted(contracts::event::Completion {
                maker: "7".into(),
                attempt: "2".into(),
                turn: "completed-turn".into(),
            }),
        );

        let seen: Vec<_> = (0..2).map(|_| live.try_recv().unwrap().seq).collect();
        assert_eq!(seen, [Some(1), Some(2)]);
        let saved = SqliteLog::open(dir.path()).unwrap().read(0, 10).unwrap();
        assert_eq!(
            saved.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [Some(1), Some(2)]
        );
        assert!(matches!(saved[0].data, EventData::DeliverableChanged));
        let EventData::AgentCompleted(completion) = &saved[1].data else {
            panic!("completion survived reopen")
        };
        assert_eq!(
            (&*completion.maker, &*completion.attempt, &*completion.turn),
            ("7", "2", "completed-turn")
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

    struct PausedBounds {
        log: SqliteLog,
        pause: Mutex<Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>>,
        bounds_read: std::sync::atomic::AtomicUsize,
        first_read_bounds: Mutex<Option<usize>>,
    }

    impl EventLog for PausedBounds {
        fn append(&self, event: &Event) -> Result<u64, RpcError> {
            self.log.append(event)
        }
        fn read(&self, after: u64, limit: usize) -> Result<Vec<Event>, RpcError> {
            self.first_read_bounds
                .lock()
                .unwrap()
                .get_or_insert_with(|| self.bounds_read.load(std::sync::atomic::Ordering::SeqCst));
            self.log.read(after, limit)
        }
        fn bounds(&self) -> Result<(u64, u64), RpcError> {
            let bounds = self.log.bounds()?;
            self.bounds_read
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if let Some((entered, release)) = self.pause.lock().unwrap().take() {
                entered.send(()).unwrap();
                release
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
            }
            Ok(bounds)
        }
    }

    fn prune_at_bounds(dir: &Path) -> (Bus, Arc<PausedBounds>, std::thread::JoinHandle<()>) {
        let (entered, waiting) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let log = Arc::new(PausedBounds {
            log: SqliteLog::open(dir).unwrap(),
            pause: Mutex::new(Some((entered, released))),
            bounds_read: Default::default(),
            first_read_bounds: Mutex::new(None),
        });
        let bus = Bus::with_log(log.clone());
        let writer_bus = bus.clone();
        let writer = std::thread::spawn(move || {
            waiting
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            let (attempt, attempted) = std::sync::mpsc::channel();
            let (done, completed) = std::sync::mpsc::channel();
            let append = std::thread::spawn(move || {
                attempt.send(()).unwrap();
                writer_bus.emit(Actor::user(), EventData::RailChanged);
                done.send(()).unwrap();
            });
            attempted
                .recv_timeout(std::time::Duration::from_secs(5))
                .unwrap();
            // This observation window asserts absence: appends cannot pass paused acceptance.
            let blocked = completed
                .recv_timeout(std::time::Duration::from_millis(50))
                .is_err();
            release.send(()).unwrap();
            append.join().unwrap();
            assert!(blocked, "append passed bounds before replay was captured");
        });
        (bus, log, writer)
    }

    #[tokio::test]
    async fn d11_a_subscribe_for_every_kept_event_never_expires() {
        let dir = project();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let bus = &daemon.bus;
        for _ in 0..EVENT_WINDOW + 5 {
            bus.emit(Actor::user(), EventData::RailChanged);
        }
        let (bus, _log, writer) = prune_at_bounds(dir.path());
        let mut daemon = daemon;
        daemon.bus = bus;
        let bus = &daemon.bus;
        let (events, mut replay) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = crate::Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        let answer = daemon
            .dispatch(
                &mut conn,
                r#"{"jsonrpc":"2.0","id":1,"method":"events.subscribe","params":{"kept":true}}"#,
                None,
            )
            .await
            .unwrap()
            .into_value();
        assert!(answer.get("error").is_none(), "{answer}");
        let first = answer["result"]["head"].as_u64().unwrap() - EVENT_WINDOW + 1;
        writer.join().unwrap();
        // Prune once more before reading: accepted replay must already be safe.
        bus.emit(Actor::user(), EventData::RailChanged);
        let end = bus.subscribe_after(Default::default()).unwrap().head();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            for expected in first..=end {
                let event = replay.recv().await.unwrap().into_value();
                assert_eq!(event["params"]["seq"], expected);
            }
        })
        .await
        .expect("the complete kept replay and live Events arrive");
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), replay.recv())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn d11_kept_with_after_fails_invalid_params() {
        let dir = project();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        daemon.bus.emit(Actor::user(), EventData::RailChanged);
        let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = crate::Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        let answer = daemon.dispatch(&mut conn,
            r#"{"jsonrpc":"2.0","id":1,"method":"events.subscribe","params":{"kept":true,"after":0}}"#,
            None,
        ).await.unwrap().into_value();
        assert_eq!(answer["error"]["code"], code::INVALID_PARAMS);
        daemon.bus.emit(Actor::user(), EventData::RailChanged);
        // A mistaken subscription would queue retained or live Events on this connection.
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), received.recv())
                .await
                .is_err()
        );
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

        let expired = bus
            .subscribe_after(contracts::SubscribeParams {
                after: Some(oldest - 2),
                kept: false,
            })
            .err()
            .unwrap();
        assert_eq!(expired.code, code::EVENTS_EXPIRED);
        assert_eq!(
            expired.data,
            Some(contracts::RpcErrorData::EventsExpired { oldest: 6 })
        );
        let saved = bus.saved_after(oldest - 2).unwrap_err();
        assert_eq!(saved.code, code::EVENTS_EXPIRED);
        assert_eq!(saved.data, expired.data);
        for error in [expired, saved] {
            let wire = serde_json::to_value(&error).unwrap();
            assert_eq!(
                wire["data"],
                serde_json::json!({"kind":"events-expired", "oldest":6})
            );
            assert!(!error.message.is_empty());
        }
        assert!(
            bus.subscribe_after(contracts::SubscribeParams {
                after: Some(oldest - 1),
                kept: false
            })
            .is_ok()
        );
        let ahead = bus
            .subscribe_after(contracts::SubscribeParams {
                after: Some(highest + 1),
                kept: false,
            })
            .err()
            .unwrap();
        assert_eq!(ahead.code, code::INVALID_PARAMS);
    }
}
