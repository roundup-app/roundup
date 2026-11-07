use contracts::ActorKind;

use super::*;

fn actor_json(actor: &Actor) -> String {
    super::actor_json(actor).unwrap()
}

fn open(dir: &Path) -> Store {
    Store::open(&dir.join("messages.db")).unwrap()
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
    let store = Store::open(Path::new(":memory:")).unwrap();
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
