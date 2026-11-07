//! P9a, T6a: the one rule by which a deletion key meets its receipt row. A `&Transaction` is the
//! only way in, so no receipt is read or claimed outside a write transaction.
use rusqlite::{OptionalExtension, Transaction};

/// A table holding deletion receipts: `operation` (the key), `actor`, then the request and the receipt text.
#[derive(Clone, Copy, Debug)]
pub enum Ledger {
    Pads,
    Todos,
}

impl Ledger {
    fn lookup(self) -> &'static str {
        match self {
            Self::Pads => "SELECT actor, request, record FROM pad_deletions WHERE operation = ?",
            Self::Todos => "SELECT actor, chosen, result FROM todo_deletions WHERE operation = ?",
        }
    }
}

/// What the key meant: no row yet, or the first receipt's text.
#[derive(Debug, PartialEq, Eq)]
pub enum Retained {
    Fresh,
    Replay(String),
}

/// Why a taken key refuses.
#[derive(Debug)]
pub enum Refusal {
    /// The key names another request.
    Conflict,
    /// The key belongs to another Actor.
    Forbidden,
    Sql(rusqlite::Error),
}

impl From<rusqlite::Error> for Refusal {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

/// `actor` and `request` are the serialized JSON texts stored beside the receipt. The same key,
/// Actor and request is `Replay` with the first receipt; the caller then writes nothing.
pub fn retain(
    tx: &Transaction,
    ledger: Ledger,
    actor: &str,
    key: &str,
    request: &str,
) -> Result<Retained, Refusal> {
    let row: Option<(String, String, String)> = tx
        .query_row(ledger.lookup(), [key], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let Some((owner, first, receipt)) = row else {
        return Ok(Retained::Fresh);
    };
    if owner != actor {
        return Err(Refusal::Forbidden);
    }
    if first != request {
        return Err(Refusal::Conflict);
    }
    Ok(Retained::Replay(receipt))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn ledger() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE todo_deletions (operation TEXT PRIMARY KEY, actor TEXT, chosen TEXT, result TEXT);
             INSERT INTO todo_deletions VALUES ('k', 'a', '[1]', 'first');",
        )
        .unwrap();
        db
    }

    #[test]
    fn p9a_t6a_the_key_replays_for_its_actor_and_request_only() {
        let mut db = ledger();
        let tx = db.transaction().unwrap();
        let go = |actor, key, request| retain(&tx, Ledger::Todos, actor, key, request);
        assert_eq!(go("a", "new", "[1]").unwrap(), Retained::Fresh);
        assert_eq!(
            go("a", "k", "[1]").unwrap(),
            Retained::Replay("first".into())
        );
        assert!(matches!(go("a", "k", "[2]"), Err(Refusal::Conflict)));
        assert!(matches!(go("b", "k", "[1]"), Err(Refusal::Forbidden)));
    }
}
