//! B3563e: a Project stored before the holds were removed reopens with its Messages, ids and
//! outcomes intact: what waited on a hold is `pending`, an old question for the user is
//! `delivered`, and both approval Routes are `auto`.

use std::sync::Arc;

use async_trait::async_trait;
use contracts::Actor;
use messages::{Messages, TerminalOwners};
use rpc::{Bus, Ctx, Module, RpcError};
use rusqlite::{Connection, params};
use serde_json::Value;

struct NoRail;

impl TerminalOwners for NoRail {
    fn with_terminal_owner(
        &self,
        _: &str,
        record: &mut dyn FnMut(Option<&agents::TerminalOwner>) -> Result<(), RpcError>,
    ) -> Result<(), RpcError> {
        record(None)
    }
}

#[async_trait]
impl Module for NoRail {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent", "rail"]
    }

    async fn call(&self, _: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
        Err(RpcError::method_not_found(method))
    }
}

type Row = (i64, String, String, String, String, String, Option<String>);

fn reopen(dir: &std::path::Path) {
    drop(Messages::open(dir, Bus::new(), Arc::new(NoRail)).unwrap());
}

fn rows(db: &Connection) -> Vec<Row> {
    db.prepare("SELECT id, from_actor, to_id, body, status, kind, reason FROM messages ORDER BY id")
        .unwrap()
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn b3563e_legacy_rows_reopen_as_pending_delivered_or_auto() {
    let dir = tempfile::tempdir().unwrap();
    reopen(dir.path());
    let db = Connection::open(dir.path().join("messages.db")).unwrap();
    let agent = |id: &str| {
        serde_json::to_string(&Actor {
            kind: contracts::ActorKind::Agent,
            id: id.into(),
            parent: None,
        })
        .unwrap()
    };
    let user = serde_json::to_string(&Actor::user()).unwrap();
    // (from, to, body, status, reason): ids 1..=9 in this order.
    let legacy = [
        (agent("a"), "b", "waiting", "pending", None),
        (agent("a"), "b", "ask", "held", Some("ask-first")),
        (user.clone(), "b", "typed over", "held", Some("takeover")),
        (agent("c"), "b", "no inbox", "held", Some("inbox")),
        (agent("c"), "you", "which?", "held", Some("escalated")),
        (agent("b"), "a", "sent", "delivered", None),
        (agent("a"), "b", "passed on", "dropped", Some("passed")),
        (user, "b", "taken back", "dropped", Some("removed")),
        (agent("d"), "b", "also ask", "held", Some("ask-first")),
    ];
    for (from, to, body, status, reason) in &legacy {
        db.execute(
            "INSERT INTO messages (from_actor, to_id, kind, body, status, reason, at, rank)
             VALUES (?1, ?2, 'note', ?3, ?4, ?5, 1, CASE WHEN ?4 = 'pending' THEN 1 ELSE 0 END)",
            params![from, to, body, status, reason],
        )
        .unwrap();
    }
    for (from, to, delivery) in [
        ("a", "b", "ask-first"),
        ("d", "b", "ask-first"),
        ("c", "b", "drop"),
        ("e", "b", "auto"),
    ] {
        db.execute(
            "INSERT INTO routes (from_id, to_id, delivery) VALUES (?1, ?2, ?3)",
            params![from, to, delivery],
        )
        .unwrap();
    }
    let before = rows(&db);
    drop(db);

    reopen(dir.path());
    let db = Connection::open(dir.path().join("messages.db")).unwrap();
    let after = rows(&db);
    let identity = |rows: &[Row]| -> Vec<_> {
        rows.iter()
            .map(|r| (r.0, r.1.clone(), r.2.clone(), r.3.clone(), r.5.clone()))
            .collect()
    };
    assert_eq!(identity(&before), identity(&after), "ids, senders and bodies");
    let outcome: Vec<_> = after.iter().map(|r| (r.4.as_str(), r.6.as_deref())).collect();
    assert_eq!(
        outcome,
        [
            ("pending", None),
            ("pending", None),
            ("pending", None),
            ("pending", None),
            ("delivered", None),
            ("delivered", None),
            ("dropped", Some("passed")),
            ("dropped", Some("removed")),
            ("pending", None),
        ]
    );
    // Those that waited keep id order behind what already waited.
    let order: Vec<i64> = db
        .prepare("SELECT id FROM messages WHERE status = 'pending' ORDER BY rank, id")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(order, [1, 2, 3, 4, 9]);
    let routes: Vec<(String, String, String)> = db
        .prepare("SELECT from_id, to_id, delivery FROM routes ORDER BY from_id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let delivery: Vec<_> = routes.iter().map(|r| (r.0.as_str(), r.2.as_str())).collect();
    assert_eq!(delivery, [("a", "auto"), ("c", "drop"), ("d", "auto"), ("e", "auto")]);
    drop(db);

    reopen(dir.path());
    let db = Connection::open(dir.path().join("messages.db")).unwrap();
    assert_eq!(rows(&db), after, "a second reopen changes nothing");
}
