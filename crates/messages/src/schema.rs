//! Current schema creation for standalone stores; the Daemon initializes `project.db`.
use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::path::Path;

pub fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    if path.file_name().is_some_and(|name| name == "project.db") {
        return Ok(());
    }
    let sequence = migrations();
    let stored: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if stored == sequence.len() as i64 - 1 {
        let run = || -> rusqlite::Result<()> {
            let mut reference = Connection::open_in_memory()?;
            Migrations::new(
                sequence
                    .split_last()
                    .map(|(_, rest)| rest.to_vec())
                    .unwrap_or_default(),
            )
            .to_latest(&mut reference)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            if let Some(difference) = provenance::migration::difference(db, &reference)? {
                return Err(rusqlite::Error::InvalidParameterName(
                    provenance::migration::divergence(&difference, stored, sequence.len()),
                ));
            }
            Migrations::new(sequence)
                .to_latest(db)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
        };
        return run().map_err(|e| {
            rusqlite::Error::InvalidParameterName(format!(
                "{}: {e} To start fresh, close roundup and delete {}.",
                path.display(),
                path.parent().unwrap_or(path).display()
            ))
        });
    }
    provenance::migration::migrate(db, path, sequence)
}

fn migrations() -> Vec<M<'static>> {
    vec![
        M::up(include_str!("../migrations/001/up.sql")),
        M::up(include_str!("../migrations/002/up.sql")),
        M::up(include_str!("../migrations/003/up.sql")),
        M::up(
            "CREATE TABLE message_sender_names (agent TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);",
        ),
        M::up(include_str!("../migrations/004/up.sql")),
        M::up(include_str!("../migrations/005/up.sql")),
        M::up(crate::evidence::SCHEMA),
        M::up(crate::continuation::SCHEMA),
        M::up(include_str!("../migrations/006/up.sql")),
        M::up(include_str!("../migrations/007/up.sql")),
        M::up(include_str!("../migrations/008/up.sql")),
        M::up(include_str!("../migrations/009/up.sql")),
        M::up(include_str!("../migrations/010/up.sql")),
        M::up(include_str!("../migrations/012/up.sql")),
        // B6506: the one migration is the Project one; the standalone store reads the same file.
        M::up(include_str!(
            "../../storage/migrations/project/0052-message-payload.sql"
        )),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite_migration::Migrations;

    /// B6506: `body` as a row written before the `payload` column: from `from`, a `note`.
    fn old_row(db: &Connection, from: &contracts::Actor, body: &str) -> i64 {
        db.execute(
            "INSERT INTO messages (from_actor, to_id, kind, body, status, at)
             VALUES (?1, 'door', 'note', ?2, 'pending', 0)",
            rusqlite::params![serde_json::to_string(from).unwrap(), body],
        )
        .unwrap();
        db.last_insert_rowid()
    }

    fn message(id: u32, body: &str) -> contracts::message::Message {
        contracts::message::Message {
            id,
            from: contracts::Actor::daemon(),
            to: "door".into(),
            kind: contracts::message::MessageKind::Note,
            body: body.into(),
            reply_to: None,
            status: contracts::message::MessageStatus::Pending,
            reason: None,
            waiting: None,
            at: 0,
        }
    }

    #[test]
    fn b6506_the_backfill_keeps_every_digests_weight_and_fold() {
        use crate::digest::push_body;
        use crate::pushes::{self, Payload};
        use contracts::agent::DigestEntry;
        let entry = |name: &str, last: &str, link: bool, pads: &[&str]| DigestEntry {
            name: name.into(),
            kind: contracts::Kind::NeedsYou,
            last: last.into(),
            todos: 3,
            link: link.then(|| "roundup://agent/a1?project=k".to_owned()),
            pads: pads.iter().map(|p| (*p).to_owned()).collect(),
        };
        let a = entry(
            "worker is a name",
            "ran the (tests)",
            true,
            &["notes", "plan"],
        );
        let b = entry("b", "", false, &[]);
        let plain = push_body(&a);
        let folded = pushes::counted(&push_body(&b), 4);
        let (rollup, rollup_payload) =
            pushes::rollup_body(&[("a".into(), a.clone(), 3), ("b".into(), b.clone(), 2)]);
        let older = message(7, &plain);
        let newer = message(8, &folded);
        let plain_payload = Payload::Digest {
            entries: vec![a.clone()],
            stands_for: 1,
        };
        let folded_payload = Payload::Digest {
            entries: vec![b.clone()],
            stands_for: 4,
        };
        let (merged, merged_payload) =
            pushes::merged((&older, &plain_payload), (&newer, &folded_payload));
        let wake = "[wake]\nworker is idle\n  last: done".to_owned();

        let mut db = Connection::open_in_memory().unwrap();
        let all = migrations();
        Migrations::new(all[..all.len() - 1].to_vec())
            .to_latest(&mut db)
            .unwrap();
        let daemon = contracts::Actor::daemon();
        let user = contracts::Actor::user();
        let digests = [&plain, &folded, &rollup, &merged];
        let ids: Vec<i64> = digests
            .iter()
            .map(|body| old_row(&db, &daemon, body))
            .collect();
        let wake_id = old_row(&db, &daemon, &wake);
        let user_id = old_row(&db, &user, &plain);
        let note_id = old_row(&db, &daemon, "a Daemon note");
        let before: Vec<(String, String)> = db
            .prepare("SELECT body, status FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        Migrations::new(all.clone()).to_latest(&mut db).unwrap();

        let payload = |id: i64| -> Payload {
            let text: String = db
                .query_row("SELECT payload FROM messages WHERE id = ?1", [id], |r| {
                    r.get(0)
                })
                .unwrap();
            serde_json::from_str(&text).unwrap()
        };
        let expected = [
            plain_payload,
            folded_payload,
            rollup_payload,
            merged_payload,
        ];
        for ((id, body), expected) in ids.iter().zip(digests).zip(expected) {
            assert_eq!(payload(*id), expected, "{body}");
        }
        assert_eq!(payload(wake_id), Payload::Wake { ids: vec![] });
        assert_eq!(payload(user_id), Payload::Note);
        assert_eq!(payload(note_id), Payload::Note);
        let after: Vec<(String, String)> = db
            .prepare("SELECT body, status FROM messages ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(before, after);
    }

    #[test]
    fn b6506_a_pending_digest_is_never_stored_as_note() {
        let mut db = Connection::open_in_memory().unwrap();
        let all = migrations();
        Migrations::new(all[..all.len() - 1].to_vec())
            .to_latest(&mut db)
            .unwrap();
        let body = crate::digest::push_body(&contracts::agent::DigestEntry {
            name: "c".into(),
            kind: contracts::Kind::Error,
            last: "failed".into(),
            todos: 1,
            link: None,
            pads: vec![],
        });
        old_row(&db, &contracts::Actor::daemon(), &body);
        old_row(&db, &contracts::Actor::user(), "a note");
        Migrations::new(all).to_latest(&mut db).unwrap();
        let count = |filter: &str| -> i64 {
            db.query_row(
                &format!("SELECT COUNT(*) FROM messages WHERE status = 'pending' AND {filter}"),
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(count("json_extract(payload, '$.Digest') IS NOT NULL"), 1);
        // B1 counts only the Messages that are neither a Digest nor a Wake.
        assert_eq!(count("json_extract(payload, '$.Digest') IS NULL"), 1);
    }

    #[test]
    fn n5088a_messages_refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.db");
        let known = i64::try_from(migrations().len()).unwrap();
        let stored = known + 1;
        let db = Connection::open(&path).unwrap();
        db.pragma_update(None, "user_version", stored).unwrap();
        drop(db);

        let mut db = Connection::open(&path).unwrap();
        let message = open(&mut db, &path).unwrap_err().to_string();
        assert!(message.contains(&path.display().to_string()), "{message}");
        assert!(
            message.contains(&format!("database version {stored}")),
            "{message}"
        );
        assert!(
            message.contains(&format!("supports through {known}")),
            "{message}"
        );
        assert!(message.contains("newer or branch build"), "{message}");
        assert!(message.contains("closing roundup"), "{message}");
        drop(db);

        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            stored
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn n5420a_messages_refuses_a_divergent_database() {
        for prefix in [migrations().len() - 1, migrations().len()] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("messages.db");
            let known = migrations().len();
            let mut swapped = migrations()[..prefix].to_vec();
            *swapped.last_mut().unwrap() = M::up("CREATE TABLE n5420a_swapped (c);");
            let mut db = Connection::open(&path).unwrap();
            Migrations::new(swapped).to_latest(&mut db).unwrap();
            let schema = |db: &Connection| -> Vec<(String, String)> {
                db.prepare("SELECT name, coalesce(sql, '') FROM sqlite_schema ORDER BY name")
                    .unwrap()
                    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                    .unwrap()
                    .map(Result::unwrap)
                    .collect()
            };
            let before = schema(&db);
            drop(db);

            let mut db = Connection::open(&path).unwrap();
            let message = open(&mut db, &path).unwrap_err().to_string();
            assert!(message.contains(&path.display().to_string()), "{message}");
            assert!(message.contains("schema differs"), "{message}");
            assert!(
                message.contains(&format!("database version {prefix}")),
                "{message}"
            );
            assert!(
                message.contains(&format!("supports through {known}")),
                "{message}"
            );
            assert!(message.contains("newer or branch build"), "{message}");
            drop(db);

            let db = Connection::open(&path).unwrap();
            assert_eq!(
                db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                    .unwrap(),
                i64::try_from(prefix).unwrap()
            );
            assert_eq!(schema(&db), before);
        }
    }
}

#[cfg(test)]
mod retirement_tests {
    use super::*;
    use rusqlite_migration::Migrations;

    #[test]
    fn n5467a_older_store_is_refused_without_changes() {
        for prefix in if migrations().len() == 1 {
            vec![0]
        } else {
            vec![0, migrations().len() - 2]
        } {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("messages.db");
            let mut db = Connection::open(&path).unwrap();
            if prefix > 0 {
                Migrations::new(migrations()[..prefix].to_vec())
                    .to_latest(&mut db)
                    .unwrap();
            }
            let read = if prefix == 0 {
                db.execute_batch("CREATE TABLE retirement_sentinel(value TEXT); INSERT INTO retirement_sentinel VALUES ('keep me');").unwrap();
                "SELECT value FROM retirement_sentinel"
            } else {
                db.execute_batch("INSERT INTO messages(from_actor,to_id,kind,body,status,at) VALUES('{}','you','note','keep me','delivered',1)").unwrap();
                "SELECT body FROM messages WHERE body='keep me'"
            };
            let schema = |db: &Connection| -> Vec<(String, String)> {
                db.prepare("SELECT name, coalesce(sql, '') FROM sqlite_schema ORDER BY name")
                    .unwrap()
                    .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .unwrap()
                    .map(Result::unwrap)
                    .collect()
            };
            let before = schema(&db);
            drop(db);
            for _ in 0..2 {
                let mut db = Connection::open(&path).unwrap();
                let message = open(&mut db, &path).unwrap_err().to_string();
                assert!(
                    message.contains("incompatible with this build"),
                    "{message}"
                );
                assert!(
                    message.contains(&dir.path().display().to_string()),
                    "{message}"
                );
                assert!(
                    message.contains("close roundup") && message.contains("delete"),
                    "{message}"
                );
                assert_eq!(schema(&db), before);
                assert_eq!(
                    db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                        .unwrap(),
                    prefix as i64
                );
                assert_eq!(
                    db.query_row(read, [], |r| r.get::<_, String>(0)).unwrap(),
                    "keep me"
                );
            }
        }
    }
}

#[cfg(test)]
mod deletion_tests {
    use super::*;

    #[test]
    fn u5740c_standalone_drops_only_retired_tables() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.db");
        let mut db = Connection::open(&path).unwrap();
        let sequence = migrations();
        // The one before the last three (010) drops the retired tables; the last adds tables of its own.
        Migrations::new(sequence[..sequence.len() - 3].to_vec())
            .to_latest(&mut db)
            .unwrap();
        db.execute_batch(r#"INSERT INTO messages(id,from_actor,to_id,kind,body,status,at) VALUES(77,'{"kind":"user","id":"you","parent":null}','you','note','keep exact','delivered',42);
        INSERT INTO reactions(id,actor_key,operation,request,record) VALUES('saved','user:you','op','request','{}');
        INSERT INTO reaction_firings(id,reaction,operation,ordinal,message,matched,definition,evidence) VALUES('fired','saved','op',1,77,0,'{}','kept');
        INSERT INTO continuation_decisions(id,agent,request,payload,message,evidence) VALUES('decision','agent','request','payload',77,'evidence');
        INSERT INTO continuation_actions(action,decision) VALUES('action','decision');"#).unwrap();
        let mut reference = Connection::open_in_memory().unwrap();
        Migrations::new(migrations())
            .to_latest(&mut reference)
            .unwrap();
        for _ in 0..2 {
            // `open` upgrades only a store one version behind; this one is three behind.
            Migrations::new(migrations()).to_latest(&mut db).unwrap();
            assert_eq!(
                provenance::migration::difference(&db, &reference).unwrap(),
                None
            );
            assert_eq!(
                db.query_row("SELECT id,body,status,at FROM messages", [], |r| Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?
                )))
                .unwrap(),
                (77, "keep exact".into(), "delivered".into(), 42)
            );
            assert_eq!(
                db.query_row(
                    "SELECT action,decision FROM continuation_actions",
                    [],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                )
                .unwrap(),
                ("action".into(), "decision".into())
            );
        }
    }
}
