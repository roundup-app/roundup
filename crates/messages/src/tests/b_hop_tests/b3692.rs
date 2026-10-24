//! B3692a, B3692b: a question is one ordinary Message, and a store from before that holds no bubbling.

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use super::*;

fn count_and_statuses(all: &[(String, String, Value)]) -> Vec<(String, String)> {
    all.iter().map(|m| (m.0.clone(), m.1.clone())).collect()
}

#[tokio::test]
async fn b3692a_an_unanswered_question_makes_no_second_message() {
    let dir = tempfile::tempdir().unwrap();
    let mut nodes = tree();
    nodes.push(door("other", None));
    nodes.push(child("e", "other"));
    let h = Hops::over(dir.path(), FakeRail::new(nodes), Arc::default());
    h.ask("c", "sub").await;
    h.ask("e", "other").await;
    let sent = count_and_statuses(&h.all().await);
    assert_eq!(
        sent,
        [
            ("sub".into(), "pending".into()),
            ("other".into(), "pending".into())
        ]
    );
    for ms in [59_999, 60_000, 600_000] {
        h.at(ms).await;
        assert_eq!(count_and_statuses(&h.all().await), sent, "at {ms} ms");
    }

    h.becomes("sub", Kind::Idle).await;
    h.becomes("sub", Kind::Working).await;
    h.becomes("sub", Kind::Idle).await;
    h.at(1_200_000).await;
    let delivered = count_and_statuses(&h.all().await);
    assert_eq!(delivered[0], ("sub".into(), "delivered".into()));
    assert_eq!(delivered.len(), 2);

    let h = h.restarted();
    h.at(2_400_000).await;
    assert_eq!(count_and_statuses(&h.all().await), delivered);
    assert!(h.all().await.iter().all(|m| m.0 != Actor::user().id));
}

#[tokio::test]
async fn b3692a_a_question_to_an_agent_that_ends_stays_dropped_and_nothing_replaces_it() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Done).await;
    h.at(600_000).await;
    let all = h.all().await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].1, "dropped");
    assert_eq!(all[0].2, "receiver gone");
}

/// The pre-change schema: every migration before B3692b's.
fn old_schema(db: &mut Connection) {
    let before = vec![
        M::up(include_str!("../../../migrations/001/up.sql")),
        M::up(include_str!("../../../migrations/002/up.sql")),
        M::up(include_str!("../../../migrations/003/up.sql")),
        M::up(
            "CREATE TABLE message_sender_names (agent TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);",
        ),
        M::up(include_str!("../../../migrations/004/up.sql")),
        M::up(include_str!("../../../migrations/005/up.sql")),
        M::up(crate::evidence::SCHEMA),
        M::up(crate::continuation::SCHEMA),
    ];
    Migrations::new(before).to_latest(db).unwrap();
}

#[tokio::test]
async fn b3692b_a_store_with_hops_and_a_waiting_question_opens_terminal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("messages.db");
    {
        let mut db = Connection::open(&path).unwrap();
        old_schema(&mut db);
        let from = r#"{"kind":"agent","id":"c","parent":"sub"}"#;
        let row = |id: u32, to: &str, status: &str, reason: Option<&str>, passed: Option<u32>| {
            db.execute(
                "INSERT INTO messages (id, from_actor, to_id, kind, body, status, reason, at, rank, passed_from)
                 VALUES (?1, ?2, ?3, 'question', 'which?', ?4, ?5, 1, 0, ?6)",
                rusqlite::params![id, from, to, status, reason, passed],
            )
            .unwrap();
        };
        row(1, "sub", "delivered", None, None);
        row(2, "mid", "delivered", None, Some(1));
        row(3, "top", "pending", None, Some(2));
        row(
            4,
            "you",
            concat!("he", "ld"),
            Some(concat!("escal", "ated")),
            Some(3),
        );
        db.execute(
            "INSERT INTO chains (origin, body, rest, current, armed_at) VALUES (?1, 'which?', '[]', 3, 1)",
            [from],
        )
        .unwrap();
    }
    for opening in 0..2 {
        let h = Hops::new(dir.path());
        let all = h.all().await;
        let status = |i: usize| (all[i].1.as_str(), all[i].2.as_str().unwrap_or(""));
        assert_eq!(status(0), ("delivered", ""), "opening {opening}");
        assert_eq!(status(1).0, "delivered");
        assert_eq!(status(2), ("dropped", "not accepted"));
        assert_eq!(status(3), ("dropped", "not accepted"));
        h.at(600_000).await;
        assert_eq!(h.all().await, all);
        assert!(h.inbox.typed().is_empty());
    }
}
