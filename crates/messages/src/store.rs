//! SQLite persistence for Messages and Routes. `<dir>/messages.db` (ADR 0004, WAL).

use crate::Error;
use std::path::Path;

use contracts::Actor;
use contracts::message::{Delivery, Message, MessageKind, MessageStatus, Reason, Route};
use rpc::OpenError;

use crate::pushes::Payload;
use crate::wake::Wake;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use storage::Json;

pub(crate) type Binding = (i64, i64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ReceiverState {
    pub attempt: i64,
    pub revision: i64,
    pub closed_revision: i64,
    pub closed: bool,
}

pub(crate) enum FirstPrompt {
    Absent,
    Reserved(String),
    Recorded { body: String, id: u32 },
    Published { body: String, id: u32 },
}

impl FirstPrompt {
    pub(crate) fn body(&self) -> Option<&str> {
        match self {
            Self::Absent => None,
            Self::Reserved(body) | Self::Recorded { body, .. } | Self::Published { body, .. } => {
                Some(body)
            }
        }
    }

    pub(crate) fn note(&self) -> Option<u32> {
        match self {
            Self::Absent | Self::Reserved(_) => None,
            Self::Recorded { id, .. } | Self::Published { id, .. } => Some(*id),
        }
    }
}

pub(crate) struct Restart {
    pub before: i64,
    pub prompt: FirstPrompt,
    pub released: Option<i64>,
}

pub(crate) struct Store {
    pub(crate) db: Connection,
}

impl Store {
    pub(crate) fn open(path: &Path) -> Result<Self, OpenError> {
        let mut db = Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        crate::schema::open(&mut db, path)?;
        Ok(Self { db })
    }

    pub(crate) fn record_sender_name(&self, agent: &str, name: &str) -> Result<(), Error> {
        self.db
            .execute(
                "INSERT INTO message_sender_names (agent, name) VALUES (?1, ?2)
             ON CONFLICT(agent) DO UPDATE SET name=excluded.name WHERE name != excluded.name",
                params![agent, name],
            )
            .map(|_| ())
            .map_err(Error::internal)
    }

    pub(crate) fn sender_name(&self, agent: &str) -> Result<String, Error> {
        self.db
            .query_row(
                "SELECT name FROM message_sender_names WHERE agent=?1",
                [agent],
                |row| row.get(0),
            )
            .optional()
            .map(|name| name.unwrap_or_else(|| "an Agent that is gone".into()))
            .map_err(Error::internal)
    }

    pub(crate) fn is_reserved(&self, agent: &str) -> Result<bool, Error> {
        self.db
            .prepare("SELECT 1 FROM message_restarts WHERE agent=? AND released IS NULL")
            .and_then(|mut q| q.exists([agent]))
            .map_err(Error::internal)
    }

    pub(crate) fn is_protected(&self, agent: &str) -> Result<bool, Error> {
        self.db
            .prepare("SELECT 1 FROM message_protection WHERE agent=?")
            .and_then(|mut q| q.exists([agent]))
            .map_err(Error::internal)
    }

    pub(crate) fn retirement(&self, agent: &str) -> Result<Option<(String, bool)>, Error> {
        self.db
            .query_row(
                "SELECT key,completed FROM message_retirements WHERE agent=?",
                [agent],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(Error::internal)
    }

    pub(crate) fn reserve_retirement(&self, agent: &str, key: &str) -> Result<(), Error> {
        if self.is_protected(agent)? {
            return Err(Error::conflict("another operation reserved this receiver"));
        }
        self.db
            .execute(
                "INSERT INTO message_retirements(agent,key) VALUES (?,?)",
                params![agent, key],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn complete_retirement(&self, agent: &str, key: &str) -> Result<(), Error> {
        self.db
            .execute(
                "UPDATE message_retirements SET completed=1 WHERE agent=? AND key=?",
                params![agent, key],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn restart(&self, agent: &str, key: &str) -> Result<Option<Restart>, Error> {
        self.db.query_row("SELECT before,prompt,note,released,published FROM message_restarts WHERE agent=? AND key=?", params![agent,key], |r| {
            let prompt: Option<String> = r.get(1)?;
            let note: Option<u32> = r.get(2)?;
            let published: bool = r.get(4)?;
            let prompt = match (prompt,note,published) {
                (None,None,false) => FirstPrompt::Absent,
                (Some(body),None,false) => FirstPrompt::Reserved(body),
                (Some(body),Some(id),false) => FirstPrompt::Recorded { body,id },
                (Some(body),Some(id),true) => FirstPrompt::Published { body,id },
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(Restart { before:r.get(0)?, prompt, released:r.get(3)? })
        }).optional().map_err(Error::internal)
    }

    pub(crate) fn reserve_restart(
        &self,
        agent: &str,
        key: &str,
        before: i64,
        prompt: Option<&str>,
    ) -> Result<(), Error> {
        if self.is_protected(agent)? {
            return Err(Error::conflict("another restart reserved this receiver"));
        }
        self.db
            .execute(
                "INSERT INTO message_restarts(agent,key,before,prompt) VALUES (?,?,?,?)",
                params![agent, key, before, prompt],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn end_restart(&self, agent: &str) -> Result<(), Error> {
        self.db
            .execute(
                "UPDATE message_restarts SET released=-1 WHERE agent=? AND released IS NULL",
                [agent],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn record_restart_note(&self, agent: &str, key: &str, id: u32) -> Result<(), Error> {
        self.db
            .execute(
                "UPDATE message_restarts SET note=? WHERE agent=? AND key=?",
                params![id, agent, key],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn publish_restart_note(&self, agent: &str, key: &str) -> Result<(), Error> {
        self.db
            .execute(
                "UPDATE message_restarts SET published=1 WHERE agent=? AND key=?",
                params![agent, key],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn release_restart(
        &mut self,
        agent: &str,
        key: &str,
        at: Binding,
    ) -> Result<(), Error> {
        self.db.execute("UPDATE messages SET receiver_attempt=?,receiver_revision=? WHERE to_id=? AND status = 'pending'", params![at.0,at.1,agent]).map_err(Error::internal)?;
        self.set_generation(
            agent,
            ReceiverState {
                attempt: at.0,
                revision: at.1,
                closed_revision: -1,
                closed: false,
            },
        )?;
        self.db
            .execute(
                "UPDATE message_restarts SET released=? WHERE agent=? AND key=?",
                params![at.0, agent, key],
            )
            .map_err(Error::internal)
            .map(|_| ())
    }

    pub(crate) fn receivers(&self) -> Result<Vec<String>, Error> {
        self.db.prepare("SELECT id FROM receiver_generations UNION SELECT to_id FROM messages WHERE to_id != 'you'").and_then(|mut q| q.query_map([], |r| r.get(0))?.collect()).map_err(Error::internal)
    }

    pub(crate) fn generation(&self, agent: &str) -> Result<Option<ReceiverState>, Error> {
        self.db.query_row("SELECT attempt, revision, closed_revision, closed FROM receiver_generations WHERE id=?", [agent], |r| Ok(ReceiverState { attempt:r.get(0)?, revision:r.get(1)?, closed_revision:r.get(2)?, closed:r.get(3)? })).optional().map_err(Error::internal)
    }

    pub(crate) fn set_generation(&self, agent: &str, state: ReceiverState) -> Result<(), Error> {
        self.db.execute("INSERT INTO receiver_generations (id,attempt,revision,closed_revision,closed) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET attempt=excluded.attempt,revision=excluded.revision,closed_revision=excluded.closed_revision,closed=excluded.closed", params![agent,state.attempt,state.revision,state.closed_revision,state.closed]).map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn require_generation(&self, agent: &str, binding: Binding) -> Result<(), Error> {
        if self.generation(agent)?.is_some_and(|state| {
            state.attempt == binding.0 && !state.closed && binding.1 > state.closed_revision
        }) {
            return Ok(());
        }
        Err(Error::conflict(format!(
            "{agent}: stale or stopped Status revision"
        )))
    }

    pub(crate) fn bind(&self, id: u32, binding: Binding) -> Result<(), Error> {
        self.db
            .execute(
                "UPDATE messages SET receiver_attempt=?,receiver_revision=? WHERE id=?",
                params![binding.0, binding.1, id],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    pub(crate) fn bound(&self, id: u32) -> Result<Binding, Error> {
        self.db
            .query_row(
                "SELECT receiver_attempt,receiver_revision FROM messages WHERE id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(Error::internal)
    }

    /// Runs `f` as one SQLite transaction: its writes all land or none do, so a kill between two
    /// of them never leaves the Store half-written (B8).
    pub(crate) fn atomically<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, Error>,
    ) -> Result<T, Error> {
        self.db
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(Error::internal)?;
        // A panic in `f` rolls back too, so the next transaction can begin (B28).
        let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(self)));
        let ran = ran.unwrap_or_else(|panic| {
            let _ = self.db.execute_batch("ROLLBACK");
            std::panic::resume_unwind(panic)
        });
        match ran {
            Ok(value) => {
                if let Err(err) = self.db.execute_batch("COMMIT") {
                    let _ = self.db.execute_batch("ROLLBACK");
                    return Err(Error::internal(err));
                }
                Ok(value)
            }
            Err(err) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(err)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn insert(
        &self,
        from: &Actor,
        to: &str,
        kind: MessageKind,
        body: &str,
        reply_to: Option<u32>,
        status: MessageStatus,
        reason: Option<Reason>,
        at: i64,
        binding: Binding,
        payload: &Payload,
    ) -> Result<Message, Error> {
        let from_json = actor_json(from)?;
        self.db
            .execute(
                "INSERT INTO messages (from_actor, to_id, kind, body, reply_to, status, reason, at, receiver_attempt, receiver_revision, payload, rank)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                     CASE WHEN ?6 = 'pending' THEN (SELECT COALESCE(MAX(rank), 0) + 1 FROM messages) ELSE 0 END)",
                params![
                    from_json,
                    to,
                    text_of(kind),
                    body,
                    reply_to,
                    text_of(status),
                    reason.map(text_of),
                    at,
                    binding.0,
                    binding.1,
                    Json(payload)
                ],
            )
            .map_err(Error::internal)?;
        let id = u32::try_from(self.db.last_insert_rowid()).map_err(Error::internal)?;
        self.get(id)?
            .ok_or_else(|| Error::internal("message vanished right after it was inserted"))
    }

    /// Every Message sent to or by `door`, in order.
    pub(crate) fn thread(&self, door: &str) -> Result<Vec<Message>, Error> {
        let mut thread = self.list()?;
        thread.retain(|m| m.to == door || m.from.id == door);
        Ok(thread)
    }

    /// Delivered digest history only, in Message-id order (B5640a).
    pub(crate) fn delivered_to(&self, to: &str) -> Result<Vec<Message>, Error> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages WHERE to_id = ?1 AND status = 'delivered'
                   AND json_extract(from_actor, '$.kind') = ?2
                   AND json_extract(from_actor, '$.id') = ?3
                   AND json_extract(from_actor, '$.parent') IS NULL
                   AND substr(body, 1, 8) = '[digest]'
                 ORDER BY id",
            )
            .and_then(|mut stmt| {
                let daemon = Actor::daemon();
                stmt.query_map(params![to, text_of(daemon.kind), daemon.id], row_to_message)?
                    .collect()
            })
            .map_err(Error::internal)
    }

    /// B6506: what the Message `id` is, by the payload written with it.
    #[cfg(test)]
    pub(crate) fn payload(&self, id: u32) -> Result<Payload, Error> {
        self.db
            .query_row("SELECT payload FROM messages WHERE id = ?1", [id], |row| {
                row.get::<_, Json<Payload>>(0).map(|json| json.0)
            })
            .map_err(Error::internal)
    }

    pub(crate) fn get(&self, id: u32) -> Result<Option<Message>, Error> {
        self.db
            .query_row(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages WHERE id = ?1",
                [id],
                row_to_message,
            )
            .optional()
            .map_err(Error::internal)
    }

    pub(crate) fn list(&self) -> Result<Vec<Message>, Error> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages ORDER BY id",
            )
            .and_then(|mut stmt| stmt.query_map([], row_to_message)?.collect())
            .map_err(Error::internal)
    }

    /// The `pending` Messages to `to` bound before `before`, in the order they became deliverable
    /// (B7): their `rank`, ties by id.
    pub(crate) fn pending_queue(&self, to: &str, before: Binding) -> Result<Vec<Message>, Error> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages WHERE to_id = ?1 AND status = 'pending' AND receiver_attempt = ?2 AND receiver_revision < ?3
                 ORDER BY rank ASC, id ASC",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![to, before.0, before.1], row_to_message)?
                    .collect()
            })
            .map_err(Error::internal)
    }

    /// Every `pending` Message, oldest first.
    pub(crate) fn pending_all(&self) -> Result<Vec<Message>, Error> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages WHERE status = 'pending' ORDER BY id",
            )
            .and_then(|mut stmt| stmt.query_map([], row_to_message)?.collect())
            .map_err(Error::internal)
    }

    /// B5763b: only a successful write establishes comparison history for this session.
    pub(crate) fn last_inbox(
        &self,
        receiver: &str,
        session: &str,
    ) -> Result<Option<String>, Error> {
        self.db
            .query_row(
                "SELECT content FROM message_inbox_last WHERE receiver=? AND session=?",
                params![receiver, session],
                |r| r.get(0),
            )
            .optional()
            .map_err(Error::internal)
    }

    pub(crate) fn record_inbox(
        &self,
        receiver: &str,
        session: &str,
        content: &str,
    ) -> Result<(), Error> {
        self.db.execute("INSERT INTO message_inbox_last(receiver,session,content) VALUES(?,?,?) ON CONFLICT(receiver,session) DO UPDATE SET content=excluded.content", params![receiver,session,content]).map_err(Error::internal)?;
        Ok(())
    }

    /// A repeat is an explicit delivery outcome, never a fabricated transcript receipt.
    pub(crate) fn deliver_repeat(&mut self, id: u32) -> Result<Option<Message>, Error> {
        self.atomically(|store| {
            let changed = store.db.execute("UPDATE messages SET status='delivered',reason=? WHERE id=? AND status='pending'", params![text_of(Reason::InboxRepeat),id]).map_err(Error::internal)?;
            store.clear_flight(id)?;
            if changed == 0 { Ok(None) } else { store.get(id) }
        })
    }

    /// B39: saves the in-flight record of `id` (prompt `prompt`), only if it is still `pending`
    /// (B2's one conditional write). `None` when it was not `pending` any more.
    pub(crate) fn record_flight(&self, id: u32, prompt: u32) -> Result<Option<Message>, Error> {
        let changed = self
            .db
            .execute(
                "INSERT OR REPLACE INTO message_flight(message_id, prompt)
                 SELECT id, ?2 FROM messages WHERE id = ?1 AND status = 'pending'",
                params![id, prompt],
            )
            .map_err(Error::internal)?;
        if changed == 0 {
            return Ok(None);
        }
        self.get(id)
    }

    /// B30, B39: saves the in-flight record of every `id` in one transaction, only if all are
    /// still `pending`; `None` and no change otherwise. The prompt is named by its first id.
    pub(crate) fn record_flight_all(&mut self, ids: &[u32]) -> Result<Option<Vec<Message>>, Error> {
        let mut partial = false;
        let prompt = ids.first().copied().unwrap_or_default();
        let marked = self.atomically(|store| {
            let mut marked = Vec::new();
            for &id in ids {
                match store.record_flight(id, prompt)? {
                    Some(message) => marked.push(message),
                    None => {
                        // The error rolls back the ones already recorded.
                        partial = true;
                        return Err(Error::internal("a Message is no longer pending"));
                    }
                }
            }
            Ok(marked)
        });
        match marked {
            Ok(marked) => Ok(Some(marked)),
            Err(_) if partial => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// Whether `id` was typed and not yet confirmed (B39).
    pub(crate) fn in_flight(&self, id: u32) -> Result<bool, Error> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM message_flight WHERE message_id = ?1)",
                params![id],
                |row| row.get(0),
            )
            .map_err(Error::internal)
    }

    /// B8: forgets the in-flight records of every Message to `to`; they are ordinary `pending`.
    pub(crate) fn clear_flights_to(&self, to: &str) -> Result<(), Error> {
        self.db
            .execute(
                "DELETE FROM message_flight
                 WHERE message_id IN (SELECT id FROM messages WHERE to_id = ?1)",
                params![to],
            )
            .map(drop)
            .map_err(Error::internal)
    }

    /// B2: a refused `deliver` that typed nothing (`Busy`): the record is cleared and the Message
    /// stays as it is, `pending`.
    pub(crate) fn clear_flight(&self, id: u32) -> Result<(), Error> {
        self.db
            .execute(
                "DELETE FROM message_flight WHERE message_id = ?1",
                params![id],
            )
            .map(drop)
            .map_err(Error::internal)
    }

    /// B50: the transcript of `agent` recorded the entries naming `ids`. Records `delivered`,
    /// in one write, each of them that is in flight (`pending`). The answer is the Messages it confirmed, and whether the prompt only
    /// repeats Messages that were `delivered` before (it names at least one, and every one).
    pub(crate) fn confirm_flight(
        &mut self,
        agent: &str,
        ids: &[u32],
    ) -> Result<(Vec<Message>, bool), Error> {
        self.atomically(|store| {
            let mut confirmed = Vec::new();
            let mut repeated = !ids.is_empty();
            for &id in ids {
                let message = store.get(id)?.filter(|m| m.to == agent);
                let Some(message) = message else {
                    repeated = false;
                    continue;
                };
                if message.status == MessageStatus::Delivered {
                    continue;
                }
                repeated = false;
                if !store.in_flight(id)? {
                    continue;
                }
                let changed = store
                    .db
                    .execute(
                        "UPDATE messages SET status = 'delivered', reason = NULL
                         WHERE id = ?1 AND status = 'pending'",
                        params![id],
                    )
                    .map_err(Error::internal)?;
                store.clear_flight(id)?;
                if changed == 1 {
                    confirmed.push(store.get(id)?.ok_or_else(|| {
                        Error::internal("message vanished right after it was updated")
                    })?);
                }
            }
            Ok((confirmed, repeated))
        })
    }

    pub(crate) fn list_pending_to(&self, to: &str) -> Result<Vec<Message>, Error> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages WHERE to_id = ?1 AND status = 'pending' ORDER BY id",
            )
            .and_then(|mut stmt| stmt.query_map(params![to], row_to_message)?.collect())
            .map_err(Error::internal)
    }

    /// Drops every `pending` Message to `to` that `gone` (the pure `step`) names,
    /// with `reason`, in id order (B9). With `keep`, a Message in flight (B39) is not dropped: it
    /// waits for the Agent to be resumed, and moves to `rebind`, the new Attempt, once there is one;
    /// so does a note from the Daemon at a restart (`notes_wait`).
    pub(crate) fn drop_all_pending(
        &mut self,
        to: &str,
        reason: Reason,
        through: Binding,
        gone: fn(&[Message]) -> Vec<u32>,
        keep: Option<Option<Binding>>,
        notes_wait: bool,
    ) -> Result<Vec<Message>, Error> {
        let mut dropped = Vec::new();
        let mut open = Vec::new();
        for message in self.list_pending_to(to)? {
            if self.bound(message.id)? <= through {
                open.push(message);
            }
        }
        let to_drop = gone(&open);
        for message in open {
            if !to_drop.contains(&message.id) {
                continue;
            }
            // B46: a note from the Daemon (B47) waits for the resumed Agent like one in flight.
            let note =
                notes_wait && message.kind == MessageKind::Note && message.from == Actor::daemon();
            if let Some(rebind) = keep
                && (note || self.in_flight(message.id)?)
            {
                if let Some(at) = rebind {
                    self.bind(message.id, at)?;
                    self.clear_flight(message.id)?;
                }
                continue;
            }
            let changed = self
                .db
                .execute(
                    "UPDATE messages SET status = 'dropped', reason = ?2
                     WHERE id = ?1 AND status = 'pending'",
                    params![message.id, text_of(reason)],
                )
                .map_err(Error::internal)?;
            if changed == 1 {
                dropped.push(self.get(message.id)?.ok_or_else(|| {
                    Error::internal("message vanished right after it was updated")
                })?);
            }
        }
        Ok(dropped)
    }

    pub(crate) fn count_wakes(&self, waiter: &str) -> Result<u32, Error> {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM wakes WHERE waiter = ?1",
                params![waiter],
                |row| row.get(0),
            )
            .map_err(Error::internal)
    }

    pub(crate) fn insert_wake(
        &self,
        waiter: &str,
        ids: &[String],
        any_of: bool,
        finished: &[String],
        seen: u64,
    ) -> Result<Wake, Error> {
        self.db
            .execute(
                "INSERT INTO wakes (waiter, any_of, ids, finished, seen) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![waiter, any_of, list_text(ids), list_text(finished), seen as i64],
            )
            .map_err(Error::internal)?;
        let id = u32::try_from(self.db.last_insert_rowid()).map_err(Error::internal)?;
        self.wake(id)?
            .ok_or_else(|| Error::internal("wake request vanished right after it was saved"))
    }

    pub(crate) fn wakes(&self) -> Result<Vec<Wake>, Error> {
        self.db
            .prepare("SELECT id, waiter, any_of, ids, finished, seen FROM wakes ORDER BY id")
            .and_then(|mut stmt| stmt.query_map([], row_to_wake)?.collect())
            .map_err(Error::internal)
    }

    pub(crate) fn wake(&self, id: u32) -> Result<Option<Wake>, Error> {
        self.db
            .query_row(
                "SELECT id, waiter, any_of, ids, finished, seen FROM wakes WHERE id = ?1",
                params![id],
                row_to_wake,
            )
            .optional()
            .map_err(Error::internal)
    }

    pub(crate) fn update_wake(&self, id: u32, finished: &[String], seen: u64) -> Result<(), Error> {
        self.db
            .execute(
                "UPDATE wakes SET finished = ?2, seen = ?3 WHERE id = ?1",
                params![id, list_text(finished), seen as i64],
            )
            .map(drop)
            .map_err(Error::internal)
    }

    /// Whether the request was open.
    pub(crate) fn delete_wake(&self, id: u32) -> Result<bool, Error> {
        self.db
            .execute("DELETE FROM wakes WHERE id = ?1", params![id])
            .map(|changed| changed > 0)
            .map_err(Error::internal)
    }

    pub(crate) fn delete_wakes_of(&self, waiter: &str) -> Result<(), Error> {
        self.db
            .execute("DELETE FROM wakes WHERE waiter = ?1", params![waiter])
            .map(drop)
            .map_err(Error::internal)
    }

    /// B1: the Messages to `to` that are `pending`, pushed digests (B22) and Wake notes
    /// (B42) left out.
    pub(crate) fn count_open(&self, to: &str) -> Result<u32, Error> {
        let daemon = actor_json(&Actor::daemon())?;
        self.db
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM messages WHERE to_id = ?1 AND status = 'pending' AND NOT ({DIGEST}) AND NOT (kind = 'note' AND from_actor = ?2 AND substr(body, 1, length(?4)) = ?4)"
                ),
                params![
                    to,
                    daemon,
                    crate::pushes::PREFIX,
                    crate::wake::PREFIX
                ],
                |row| row.get(0),
            )
            .map_err(Error::internal)
    }

    /// B51(g): the latest non-user Message by B7 delivery rank.
    fn last_inbox_message(
        &self,
        to: &str,
        attempt: i64,
        except: Option<u32>,
    ) -> Result<Option<Message>, Error> {
        let user = actor_json(&Actor::user())?;
        self.db
            .query_row(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages
                 WHERE to_id = ?1 AND status IN ('pending', 'delivered')
                   AND receiver_attempt = ?2 AND from_actor != ?3 AND (?4 IS NULL OR id != ?4)
                 ORDER BY rank DESC, id DESC LIMIT 1",
                params![to, attempt, user, except],
                row_to_message,
            )
            .optional()
            .map_err(Error::internal)
    }

    /// B51(g): generated hops cannot bypass the sender/body repeat refusal.
    pub(crate) fn is_inbox_repeat(
        &self,
        from: &Actor,
        to: &str,
        body: &str,
        attempt: i64,
        except: Option<u32>,
    ) -> Result<bool, Error> {
        if from.kind == contracts::ActorKind::User || to == Actor::user().id {
            return Ok(false);
        }
        Ok(self
            .last_inbox_message(to, attempt, except)?
            .is_some_and(|last| last.from == *from && last.body == body))
    }

    /// B22: the pushed digests to `to` that are `pending`, oldest first.
    pub(crate) fn open_digests(&self, to: &str) -> Result<Vec<Message>, Error> {
        let daemon = actor_json(&Actor::daemon())?;
        self.db
            .prepare(&format!(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at
                 FROM messages WHERE to_id = ?1 AND status = 'pending' AND ({DIGEST})
                 ORDER BY id"
            ))
            .and_then(|mut stmt| {
                stmt.query_map(params![to, daemon, crate::pushes::PREFIX], row_to_message)?
                    .collect()
            })
            .map_err(Error::internal)
    }

    /// B22: `id` folded into a newer digest: `dropped` with the reason `merged`, only while it is
    /// still `pending`. Whether it was.
    pub(crate) fn drop_merged(&self, id: u32) -> Result<bool, Error> {
        let changed = self
            .db
            .execute(
                "UPDATE messages SET status = 'dropped', reason = 'merged'
                 WHERE id = ?1 AND status = 'pending'",
                params![id],
            )
            .map_err(Error::internal)?;
        Ok(changed == 1)
    }

    pub(crate) fn set_route(
        &self,
        from: &str,
        to: &str,
        delivery: Delivery,
        set_by: &str,
    ) -> Result<(), Error> {
        self.db
            .execute(
                "INSERT INTO routes (from_id, to_id, delivery, set_by) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(from_id, to_id) DO UPDATE SET
                     delivery = excluded.delivery, set_by = excluded.set_by",
                params![from, to, text_of(delivery), set_by],
            )
            .map_err(Error::internal)?;
        Ok(())
    }

    /// M14: whether an Agent set the Route `from` to `to`; false for none, the user's or an Extension's.
    pub(crate) fn route_set_by_agent(&self, from: &str, to: &str) -> Result<bool, Error> {
        self.db
            .query_row(
                "SELECT set_by FROM routes WHERE from_id = ?1 AND to_id = ?2",
                params![from, to],
                |row| Ok(row.get::<_, String>(0)? == "agent"),
            )
            .optional()
            .map(|set| set.unwrap_or(false))
            .map_err(Error::internal)
    }

    pub(crate) fn get_route(&self, from: &str, to: &str) -> Result<Option<Delivery>, Error> {
        self.db
            .query_row(
                "SELECT delivery FROM routes WHERE from_id = ?1 AND to_id = ?2",
                params![from, to],
                |row| from_text(0, &row.get::<_, String>(0)?),
            )
            .optional()
            .map_err(Error::internal)
    }

    pub(crate) fn list_routes(&self) -> Result<Vec<Route>, Error> {
        self.db
            .prepare("SELECT from_id, to_id, delivery FROM routes ORDER BY from_id, to_id")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok(Route {
                        from: row.get(0)?,
                        to: row.get(1)?,
                        delivery: from_text(2, &row.get::<_, String>(2)?)?,
                    })
                })?
                .collect()
            })
            .map_err(Error::internal)
    }
}

/// The SQL that picks a pushed digest (B22) out of `messages`, taking the Daemon as `?2` and the
/// body prefix as `?3`.
const DIGEST: &str = "kind = 'note' AND from_actor = ?2 AND substr(body, 1, length(?3)) = ?3";

fn list_text(list: &[String]) -> String {
    serde_json::to_string(list).unwrap_or_else(|_| "[]".to_owned())
}

fn from_list(column: usize, text: &str) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(text).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(err),
        )
    })
}

fn row_to_wake(row: &rusqlite::Row<'_>) -> rusqlite::Result<Wake> {
    let ids: String = row.get(3)?;
    let finished: String = row.get(4)?;
    Ok(Wake {
        id: row.get(0)?,
        waiter: row.get(1)?,
        any_of: row.get(2)?,
        ids: from_list(3, &ids)?,
        finished: from_list(4, &finished)?,
        seen: u64::try_from(row.get::<_, i64>(5)?).unwrap_or(0),
    })
}

#[cfg(test)]
thread_local! { static MATERIALIZED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<Message> {
    #[cfg(test)]
    MATERIALIZED.set(MATERIALIZED.get() + 1);
    let from: String = row.get(1)?;
    Ok(Message {
        id: row.get(0)?,
        from: serde_json::from_str(&from).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(err))
        })?,
        to: row.get(2)?,
        kind: from_text(3, &row.get::<_, String>(3)?)?,
        body: row.get(4)?,
        reply_to: row.get(5)?,
        status: from_text(6, &row.get::<_, String>(6)?)?,
        reason: row
            .get::<_, Option<String>>(7)?
            .map(|text| from_text(7, &text))
            .transpose()?,
        waiting: None,
        at: row.get(8)?,
    })
}

/// The word a contract enum has on the wire: the one spelling stored, so a new variant needs no
/// second table.
pub(crate) fn text_of(value: impl Serialize) -> String {
    match serde_json::to_value(value) {
        Ok(Value::String(text)) => text,
        other => unreachable!("a contract enum is a string on the wire: {other:?}"),
    }
}

/// The inverse of [`text_of`]; a stored word no variant has is an error, never a default.
fn from_text<T: DeserializeOwned>(column: usize, text: &str) -> rusqlite::Result<T> {
    serde_json::from_value(Value::String(text.to_owned())).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(err),
        )
    })
}

fn actor_json(actor: &Actor) -> Result<String, Error> {
    serde_json::to_string(actor).map_err(Error::internal)
}

#[cfg(test)]
mod tests;
