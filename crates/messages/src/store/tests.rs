use contracts::ActorKind;

use super::*;

fn actor_json(actor: &Actor) -> String {
    super::actor_json(actor).unwrap()
}

fn open(dir: &Path) -> Store {
    Store::open(dir).unwrap()
}

fn put(store: &Store, status: MessageStatus, reason: Option<Reason>) -> u32 {
    let from = Actor {
        kind: ActorKind::Agent,
        id: "a".into(),
        parent: None,
    };
    store
        .insert(
            &from,
            "b",
            MessageKind::Question,
            "hi",
            None,
            status,
            reason,
            1,
            (1, 1),
            &crate::pushes::Payload::Note,
        )
        .unwrap()
        .id
}

#[test]
fn b8_every_reason_status_and_kind_survives_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let reasons = [
        (MessageStatus::Dropped, Reason::ReceiverGone),
        (MessageStatus::Dropped, Reason::NotAccepted),
    ];
    let ids: Vec<u32> = {
        let store = open(dir.path());
        reasons
            .iter()
            .map(|(status, reason)| put(&store, *status, Some(*reason)))
            .collect()
    };

    let store = open(dir.path());

    for (id, (status, reason)) in ids.into_iter().zip(reasons) {
        let message = store.get(id).unwrap().unwrap();
        assert_eq!(
            (message.status, message.reason, message.kind),
            (status, Some(reason), MessageKind::Question)
        );
    }
}

#[test]
fn b8_a_stored_word_no_variant_has_is_an_error_not_a_default() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    let id = put(&store, MessageStatus::Dropped, Some(Reason::NotAccepted));
    for column in ["reason", "status", "kind"] {
        store
            .db
            .execute(
                &format!("UPDATE messages SET {column} = 'bogus' WHERE id = ?1"),
                params![id],
            )
            .unwrap();

        assert!(store.get(id).is_err(), "{column}");
        store.db.execute("UPDATE messages SET reason = 'not accepted', status = 'dropped', kind = 'note' WHERE id = ?1", params![id]).unwrap();
    }
}

#[test]
fn b5_a_stored_route_word_no_variant_has_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(dir.path());
    store
        .db
        .execute(
            "INSERT INTO routes (from_id, to_id, delivery) VALUES ('a', 'b', 'bogus')",
            [],
        )
        .unwrap();

    assert!(store.get_route("a", "b").is_err());
    assert!(store.list_routes().is_err());
}

#[test]
fn b5640a_history_materializes_only_matching_rows() {
    let dir = storage::fixture().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let daemon = actor_json(&Actor::daemon());
    store
        .db
        .execute(
            "INSERT INTO messages(from_actor,to_id,kind,body,status,at,rank) VALUES
        (?1,'m','note','[digest] plain','delivered',90,9),
        (?1,'m','note','[digest] [2 updates kept back]','delivered',30,8),
        (?1,'m','note','[digest] [2 earlier updates: #1 #2]','delivered',10,7),
        (?1,'m','question','[digest] question','delivered',0,6),
        (?1,'other','note','[digest]','delivered',0,0),
        (?1,'m','note','[digest]','pending',0,0),
        (?1,'m','note','[digest]','dropped',0,0),
        (?1,'m','note','ordinary','delivered',0,0),
        (?2,'m','note','[digest]','delivered',0,0),
        (?3,'m','note','[digest]','delivered',0,0),
        (?4,'m','note','[digest]','delivered',0,0),
        (?5,'m','note','[digest]','delivered',0,0),
        (?6,'m','note','[digest]','delivered',0,0),
        (json_object('parent',NULL,'id',?7,'kind',?8),'m','note','[digest] reordered','delivered',0,0)",
            params![
                daemon,
                actor_json(&Actor::user()),
                actor_json(&Actor {
                    kind: ActorKind::Agent,
                    id: Actor::daemon().id,
                    parent: None
                }),
                actor_json(&Actor {
                    kind: ActorKind::Ext,
                    id: "extension".into(),
                    parent: None
                }),
                actor_json(&Actor {
                    id: "other".into(),
                    ..Actor::daemon()
                }),
                actor_json(&Actor {
                    parent: Some("parent".into()),
                    ..Actor::daemon()
                }),
                Actor::daemon().id,
                text_of(Actor::daemon().kind),
            ],
        )
        .unwrap();
    let expected = [1, 2, 3, 4, 14];
    // B6506: the payload alone says which of them are digests.
    store
        .db
        .execute(
            "UPDATE messages SET payload = '{\"Digest\":{\"entries\":[],\"stands_for\":1}}'
             WHERE id IN (1, 2, 3, 4, 14)",
            [],
        )
        .unwrap();
    for unrelated in [false, true] {
        if unrelated {
            store
                .db
                .execute(
                    "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
                INSERT INTO messages(from_actor,to_id,kind,body,status,at)
                SELECT ?1, 'other', 'note', '[digest] unrelated', 'delivered', x FROM n",
                    [actor_json(&Actor::daemon())],
                )
                .unwrap();
        }
        MATERIALIZED.set(0);
        let found = store.delivered_to("m").unwrap();
        assert_eq!(MATERIALIZED.get(), expected.len());
        assert_eq!(found.iter().map(|m| m.id).collect::<Vec<_>>(), expected);
    }
}

/// B6506: `body` as a row written before the `payload` column: from `from`, a `note`.
fn old_row(db: &rusqlite::Connection, from: &contracts::Actor, body: &str) -> i64 {
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

    let mut db = rusqlite::Connection::open_in_memory().unwrap();
    let all = storage::migrations();
    rusqlite_migration::Migrations::new(all[..all.len() - 4].to_vec())
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
    rusqlite_migration::Migrations::new(all.clone())
        .to_latest(&mut db)
        .unwrap();

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
    let mut db = rusqlite::Connection::open_in_memory().unwrap();
    let all = storage::migrations();
    rusqlite_migration::Migrations::new(all[..all.len() - 4].to_vec())
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
    rusqlite_migration::Migrations::new(all)
        .to_latest(&mut db)
        .unwrap();
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
