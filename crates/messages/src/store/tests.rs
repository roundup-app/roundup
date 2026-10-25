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
