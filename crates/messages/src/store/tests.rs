use contracts::ActorKind;

use super::*;

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
    let mut expected = Vec::new();
    for (from, to, status, body, kind, selected) in [
        (
            Actor::daemon(),
            "m",
            MessageStatus::Delivered,
            "[digest] plain",
            MessageKind::Note,
            true,
        ),
        (
            Actor::daemon(),
            "m",
            MessageStatus::Delivered,
            "[digest] [2 updates kept back]",
            MessageKind::Note,
            true,
        ),
        (
            Actor::daemon(),
            "m",
            MessageStatus::Delivered,
            "[digest] [2 earlier updates: #1 #2]",
            MessageKind::Note,
            true,
        ),
        (
            Actor::daemon(),
            "m",
            MessageStatus::Delivered,
            "[digest] question",
            MessageKind::Question,
            true,
        ),
        (
            Actor::daemon(),
            "other",
            MessageStatus::Delivered,
            "[digest]",
            MessageKind::Note,
            false,
        ),
        (
            Actor::daemon(),
            "m",
            MessageStatus::Pending,
            "[digest]",
            MessageKind::Note,
            false,
        ),
        (
            Actor::daemon(),
            "m",
            MessageStatus::Dropped,
            "[digest]",
            MessageKind::Note,
            false,
        ),
        (
            Actor::daemon(),
            "m",
            MessageStatus::Delivered,
            "ordinary",
            MessageKind::Note,
            false,
        ),
        (
            Actor::user(),
            "m",
            MessageStatus::Delivered,
            "[digest]",
            MessageKind::Note,
            false,
        ),
        (
            Actor {
                kind: ActorKind::Agent,
                id: "daemon".into(),
                parent: None,
            },
            "m",
            MessageStatus::Delivered,
            "[digest]",
            MessageKind::Note,
            false,
        ),
        (
            Actor {
                kind: ActorKind::Ext,
                id: "daemon".into(),
                parent: None,
            },
            "m",
            MessageStatus::Delivered,
            "[digest]",
            MessageKind::Note,
            false,
        ),
        (
            Actor {
                kind: Actor::daemon().kind,
                id: "other".into(),
                parent: None,
            },
            "m",
            MessageStatus::Delivered,
            "[digest]",
            MessageKind::Note,
            false,
        ),
    ] {
        let m = store
            .insert(&from, to, kind, body, None, status, None, -1, (1, 1))
            .unwrap();
        if selected {
            expected.push(m.id);
        }
    }
    for unrelated in [false, true] {
        if unrelated {
            store.db.execute_batch("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000)
                INSERT INTO messages(from_actor,to_id,kind,body,status,at)
                SELECT '{\"kind\":\"daemon\",\"id\":\"daemon\"}', 'other', 'note', '[digest] unrelated', 'delivered', x FROM n").unwrap();
        }
        MATERIALIZED.set(0);
        let found = store.delivered_to("m").unwrap();
        assert_eq!(MATERIALIZED.get(), expected.len());
        assert_eq!(found.iter().map(|m| m.id).collect::<Vec<_>>(), expected);
    }
}
