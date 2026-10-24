//! SQLite persistence for Messages and Routes. `<dir>/messages.db` (ADR 0004, WAL).

use std::path::Path;

use contracts::Actor;
use contracts::message::{Delivery, Message, MessageKind, MessageStatus, Reason, Route};
use rpc::{OpenError, RpcError};

use crate::wake::Wake;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(crate) type Binding = (i64, i64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ReceiverState {
    pub attempt: i64,
    pub revision: i64,
    pub closed_revision: i64,
    pub closed: bool,
}

/// One bubbling question (B13): who asked, what, the Doors still to try, and the hop now waiting.
pub(crate) struct Chain {
    pub id: i64,
    pub origin: Actor,
    pub body: String,
    pub rest: Vec<String>,
    pub current: u32,
    /// When the current hop's bound started (B14); `None` while the hop has no live Message.
    pub armed_at: Option<i64>,
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
        let store = Self { db };
        store.migrate_removed_holds()?;
        Ok(store)
    }

    pub(crate) fn record_sender_name(&self, agent: &str, name: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO message_sender_names (agent, name) VALUES (?1, ?2)
             ON CONFLICT(agent) DO UPDATE SET name=excluded.name WHERE name != excluded.name",
                params![agent, name],
            )
            .map(|_| ())
            .map_err(RpcError::internal)
    }

    pub(crate) fn sender_name(&self, agent: &str) -> Result<String, RpcError> {
        self.db
            .query_row(
                "SELECT name FROM message_sender_names WHERE agent=?1",
                [agent],
                |row| row.get(0),
            )
            .optional()
            .map(|name| name.unwrap_or_else(|| "an Agent that is gone".into()))
            .map_err(RpcError::internal)
    }

    pub(crate) fn is_reserved(&self, agent: &str) -> Result<bool, RpcError> {
        self.db
            .prepare("SELECT 1 FROM message_restarts WHERE agent=? AND released IS NULL")
            .and_then(|mut q| q.exists([agent]))
            .map_err(RpcError::internal)
    }

    pub(crate) fn is_protected(&self, agent: &str) -> Result<bool, RpcError> {
        self.db
            .prepare("SELECT 1 FROM message_protection WHERE agent=?")
            .and_then(|mut q| q.exists([agent]))
            .map_err(RpcError::internal)
    }

    pub(crate) fn retirement(&self, agent: &str) -> Result<Option<(String, bool)>, RpcError> {
        self.db
            .query_row(
                "SELECT key,completed FROM message_retirements WHERE agent=?",
                [agent],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(RpcError::internal)
    }

    pub(crate) fn reserve_retirement(&self, agent: &str, key: &str) -> Result<(), RpcError> {
        if self.is_protected(agent)? {
            return Err(RpcError::conflict(
                "another operation reserved this receiver",
            ));
        }
        self.db
            .execute(
                "INSERT INTO message_retirements(agent,key) VALUES (?,?)",
                params![agent, key],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn complete_retirement(&self, agent: &str, key: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE message_retirements SET completed=1 WHERE agent=? AND key=?",
                params![agent, key],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn restart(&self, agent: &str, key: &str) -> Result<Option<Restart>, RpcError> {
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
        }).optional().map_err(RpcError::internal)
    }

    pub(crate) fn reserve_restart(
        &self,
        agent: &str,
        key: &str,
        before: i64,
        prompt: Option<&str>,
    ) -> Result<(), RpcError> {
        if self.is_protected(agent)? {
            return Err(RpcError::conflict("another restart reserved this receiver"));
        }
        self.db
            .execute(
                "INSERT INTO message_restarts(agent,key,before,prompt) VALUES (?,?,?,?)",
                params![agent, key, before, prompt],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn end_restart(&self, agent: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE message_restarts SET released=-1 WHERE agent=? AND released IS NULL",
                [agent],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn record_restart_note(
        &self,
        agent: &str,
        key: &str,
        id: u32,
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE message_restarts SET note=? WHERE agent=? AND key=?",
                params![id, agent, key],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn publish_restart_note(&self, agent: &str, key: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE message_restarts SET published=1 WHERE agent=? AND key=?",
                params![agent, key],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn release_restart(
        &mut self,
        agent: &str,
        key: &str,
        at: Binding,
        now: i64,
    ) -> Result<(), RpcError> {
        self.db.execute("UPDATE messages SET receiver_attempt=?,receiver_revision=? WHERE to_id=? AND status = 'pending'", params![at.0,at.1,agent]).map_err(RpcError::internal)?;
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
            .map_err(RpcError::internal)?;
        self.arm_chains(now)
    }

    pub(crate) fn receivers(&self) -> Result<Vec<String>, RpcError> {
        self.db.prepare("SELECT id FROM receiver_generations UNION SELECT to_id FROM messages WHERE to_id != 'you'").and_then(|mut q| q.query_map([], |r| r.get(0))?.collect()).map_err(RpcError::internal)
    }

    pub(crate) fn generation(&self, agent: &str) -> Result<Option<ReceiverState>, RpcError> {
        self.db.query_row("SELECT attempt, revision, closed_revision, closed FROM receiver_generations WHERE id=?", [agent], |r| Ok(ReceiverState { attempt:r.get(0)?, revision:r.get(1)?, closed_revision:r.get(2)?, closed:r.get(3)? })).optional().map_err(RpcError::internal)
    }

    pub(crate) fn set_generation(&self, agent: &str, state: ReceiverState) -> Result<(), RpcError> {
        self.db.execute("INSERT INTO receiver_generations (id,attempt,revision,closed_revision,closed) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET attempt=excluded.attempt,revision=excluded.revision,closed_revision=excluded.closed_revision,closed=excluded.closed", params![agent,state.attempt,state.revision,state.closed_revision,state.closed]).map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn require_generation(&self, agent: &str, binding: Binding) -> Result<(), RpcError> {
        if self.generation(agent)?.is_some_and(|state| {
            state.attempt == binding.0 && !state.closed && binding.1 > state.closed_revision
        }) {
            return Ok(());
        }
        Err(RpcError::conflict(format!(
            "{agent}: stale or stopped Status revision"
        )))
    }

    pub(crate) fn bind(&self, id: u32, binding: Binding) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE messages SET receiver_attempt=?,receiver_revision=? WHERE id=?",
                params![binding.0, binding.1, id],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn bound(&self, id: u32) -> Result<Binding, RpcError> {
        self.db
            .query_row(
                "SELECT receiver_attempt,receiver_revision FROM messages WHERE id=?",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(RpcError::internal)
    }

    /// B3563e: a Project written before holds were removed reopens without them. A Message
    /// waiting on a user release is `pending` again, in id order behind what already waits, and
    /// one waiting on the user's answer is available to the user; an approval Route is `auto`;
    /// a stored Reason on a live Message is cleared. Terminal rows and their ids never change.
    fn migrate_removed_holds(&self) -> rusqlite::Result<()> {
        let base: i64 =
            self.db
                .query_row("SELECT COALESCE(MAX(rank), 0) FROM messages", [], |r| {
                    r.get(0)
                })?;
        self.db.execute(
            "UPDATE messages SET status = 'delivered', reason = NULL
             WHERE status NOT IN ('pending', 'delivered', 'dropped') AND to_id = 'you'",
            [],
        )?;
        self.db.execute(
            "UPDATE messages SET status = 'pending', reason = NULL, rank = ?1 + id
             WHERE status NOT IN ('pending', 'delivered', 'dropped')",
            [base],
        )?;
        self.db.execute(
            "UPDATE messages SET reason = NULL WHERE status IN ('pending', 'delivered') AND reason IS NOT NULL",
            [],
        )?;
        self.db.execute(
            "UPDATE routes SET delivery = 'auto' WHERE delivery NOT IN ('auto', 'drop')",
            [],
        )?;
        Ok(())
    }

    /// Runs `f` as one SQLite transaction: its writes all land or none do, so a kill between two
    /// of them never leaves a Message and the chain that should have moved with it disagreeing
    /// (B8, B17).
    pub(crate) fn atomically<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, RpcError>,
    ) -> Result<T, RpcError> {
        self.db
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(RpcError::internal)?;
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
                    return Err(RpcError::internal(err));
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
        passed_from: Option<u32>,
    ) -> Result<Message, RpcError> {
        self.db
            .execute(
                "INSERT INTO messages (from_actor, to_id, kind, body, reply_to, status, reason, at, receiver_attempt, receiver_revision, passed_from, rank)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                     CASE WHEN ?6 = 'pending' THEN (SELECT COALESCE(MAX(rank), 0) + 1 FROM messages) ELSE 0 END)",
                params![
                    actor_json(from),
                    to,
                    text_of(kind),
                    body,
                    reply_to,
                    text_of(status),
                    reason.map(text_of),
                    at,
                    binding.0,
                    binding.1,
                    passed_from
                ],
            )
            .map_err(RpcError::internal)?;
        let id = u32::try_from(self.db.last_insert_rowid()).map_err(RpcError::internal)?;
        self.get(id)?
            .ok_or_else(|| RpcError::internal("message vanished right after it was inserted"))
    }

    /// A32: every Message sent to or by `door`, each with the Iteration it belongs to: one more
    /// than the number of ended Iterations whose last Message came before it.
    pub(crate) fn thread(&self, door: &str) -> Result<Vec<Message>, RpcError> {
        let ended: Vec<u32> = self
            .db
            .prepare("SELECT upto FROM iterations WHERE door = ? ORDER BY iteration")
            .and_then(|mut q| q.query_map([door], |r| r.get(0))?.collect())
            .map_err(RpcError::internal)?;
        let mut thread = self.list()?;
        thread.retain(|m| m.to == door || m.from.id == door);
        for message in &mut thread {
            let before = ended.iter().filter(|upto| **upto < message.id).count();
            message.iteration = Some(before as u32 + 1);
        }
        Ok(thread)
    }

    /// A32: the Iteration `door` is in ends with the Messages stored so far.
    pub(crate) fn end_iteration(&self, door: &str) -> Result<u32, RpcError> {
        let ended: u32 = self
            .db
            .query_row(
                "SELECT COUNT(*) FROM iterations WHERE door = ?",
                [door],
                |r| r.get(0),
            )
            .map_err(RpcError::internal)?;
        self.db
            .execute(
                "INSERT INTO iterations (door, iteration, upto)
                 VALUES (?1, ?2, COALESCE((SELECT MAX(id) FROM messages), 0))",
                params![door, ended + 1],
            )
            .map_err(RpcError::internal)?;
        Ok(ended + 1)
    }

    pub(crate) fn get(&self, id: u32) -> Result<Option<Message>, RpcError> {
        self.db
            .query_row(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, passed_from
                 FROM messages WHERE id = ?1",
                [id],
                row_to_message,
            )
            .optional()
            .map_err(RpcError::internal)
    }

    pub(crate) fn list(&self) -> Result<Vec<Message>, RpcError> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, passed_from
                 FROM messages ORDER BY id",
            )
            .and_then(|mut stmt| stmt.query_map([], row_to_message)?.collect())
            .map_err(RpcError::internal)
    }

    /// The `pending` Messages to `to` bound before `before`, in the order they became deliverable
    /// (B7): their `rank`, ties by id.
    pub(crate) fn pending_queue(
        &self,
        to: &str,
        before: Binding,
    ) -> Result<Vec<Message>, RpcError> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, passed_from
                 FROM messages WHERE to_id = ?1 AND status = 'pending' AND receiver_attempt = ?2 AND receiver_revision < ?3
                 ORDER BY rank ASC, id ASC",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![to, before.0, before.1], row_to_message)?
                    .collect()
            })
            .map_err(RpcError::internal)
    }

    /// B39: saves the in-flight record of `id` (prompt `prompt`), only if it is still `pending`
    /// (B2's one conditional write). `None` when it was not `pending` any more.
    pub(crate) fn record_flight(&self, id: u32, prompt: u32) -> Result<Option<Message>, RpcError> {
        let changed = self
            .db
            .execute(
                "INSERT OR REPLACE INTO message_flight(message_id, prompt)
                 SELECT id, ?2 FROM messages WHERE id = ?1 AND status = 'pending'",
                params![id, prompt],
            )
            .map_err(RpcError::internal)?;
        if changed == 0 {
            return Ok(None);
        }
        self.get(id)
    }

    /// B30, B39: saves the in-flight record of every `id` in one transaction, only if all are
    /// still `pending`; `None` and no change otherwise. The prompt is named by its first id.
    pub(crate) fn record_flight_all(
        &mut self,
        ids: &[u32],
    ) -> Result<Option<Vec<Message>>, RpcError> {
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
                        return Err(RpcError::internal("a Message is no longer pending"));
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
    pub(crate) fn in_flight(&self, id: u32) -> Result<bool, RpcError> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM message_flight WHERE message_id = ?1)",
                params![id],
                |row| row.get(0),
            )
            .map_err(RpcError::internal)
    }

    /// B8: forgets the in-flight records of every Message to `to`; they are ordinary `pending`.
    pub(crate) fn clear_flights_to(&self, to: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "DELETE FROM message_flight
                 WHERE message_id IN (SELECT id FROM messages WHERE to_id = ?1)",
                params![to],
            )
            .map(drop)
            .map_err(RpcError::internal)
    }

    /// B2: a refused `deliver` that typed nothing (`Busy`): the record is cleared and the Message
    /// stays as it is, `pending`.
    pub(crate) fn clear_flight(&self, id: u32) -> Result<(), RpcError> {
        self.db
            .execute(
                "DELETE FROM message_flight WHERE message_id = ?1",
                params![id],
            )
            .map(drop)
            .map_err(RpcError::internal)
    }

    /// B50: the transcript of `agent` recorded the entries naming `ids`. Records `delivered`,
    /// in one write, each of them that is in flight (`pending`). The answer is the Messages it confirmed, and whether the prompt only
    /// repeats Messages that were `delivered` before (it names at least one, and every one).
    pub(crate) fn confirm_flight(
        &mut self,
        agent: &str,
        ids: &[u32],
    ) -> Result<(Vec<Message>, bool), RpcError> {
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
                    .map_err(RpcError::internal)?;
                store.clear_flight(id)?;
                if changed == 1 {
                    confirmed.push(store.get(id)?.expect("just updated"));
                }
            }
            Ok((confirmed, repeated))
        })
    }

    fn list_pending_to(&self, to: &str) -> Result<Vec<Message>, RpcError> {
        self.db
            .prepare(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, passed_from
                 FROM messages WHERE to_id = ?1 AND status = 'pending' ORDER BY id",
            )
            .and_then(|mut stmt| stmt.query_map(params![to], row_to_message)?.collect())
            .map_err(RpcError::internal)
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
    ) -> Result<Vec<Message>, RpcError> {
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
                .map_err(RpcError::internal)?;
            if changed == 1 {
                dropped.push(self.get(message.id)?.expect("just updated"));
            }
        }
        Ok(dropped)
    }

    /// B13: the live question chain whose current hop is `hop`.
    pub(crate) fn chain_of(&self, hop: u32) -> Result<Option<Chain>, RpcError> {
        self.chains("WHERE done = 0 AND current = ?1", params![hop])
            .map(|mut chains| chains.pop())
    }

    /// B13, B14: every question chain still waiting on a hop, oldest first.
    pub(crate) fn live_chains(&self) -> Result<Vec<Chain>, RpcError> {
        self.chains("WHERE done = 0", params![])
    }

    fn chains(&self, filter: &str, args: impl rusqlite::Params) -> Result<Vec<Chain>, RpcError> {
        self.db
            .prepare(&format!(
                "SELECT id, origin, body, rest, current, armed_at FROM chains {filter} ORDER BY id"
            ))
            .and_then(|mut stmt| {
                stmt.query_map(args, |row| {
                    let origin: String = row.get(1)?;
                    let rest: String = row.get(3)?;
                    let bad = |err: serde_json::Error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            Box::new(err),
                        )
                    };
                    Ok(Chain {
                        id: row.get(0)?,
                        origin: serde_json::from_str(&origin).map_err(bad)?,
                        body: row.get(2)?,
                        rest: serde_json::from_str(&rest).map_err(bad)?,
                        current: row.get(4)?,
                        armed_at: row.get(5)?,
                    })
                })?
                .collect()
            })
            .map_err(RpcError::internal)
    }

    pub(crate) fn start_chain(
        &self,
        origin: &Actor,
        body: &str,
        rest: &[String],
        current: u32,
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO chains (origin, body, rest, current) VALUES (?1, ?2, ?3, ?4)",
                params![
                    actor_json(origin),
                    body,
                    serde_json::to_string(rest).expect("strings serialize"),
                    current
                ],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    /// Points a chain at its next hop with the Doors still to come, or ends it (`current` of
    /// `None`).
    pub(crate) fn move_chain(
        &self,
        id: i64,
        current: Option<u32>,
        rest: &[String],
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE chains SET current = COALESCE(?2, current), done = ?2 IS NULL, rest = ?3, armed_at = NULL
                 WHERE id = ?1",
                params![id, current, serde_json::to_string(rest).expect("strings serialize")],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    /// B14: a hop's bound runs from the moment it is `pending` or `delivered`.
    pub(crate) fn arm_chains(&self, now: i64) -> Result<(), RpcError> {
        self.db
            .execute_batch(
                "UPDATE chains SET armed_at = NULL WHERE done = 0 AND armed_at IS NOT NULL
                     AND ((SELECT status FROM messages WHERE id = current) NOT IN ('pending', 'delivered') OR (SELECT to_id FROM messages WHERE id=current) IN (SELECT agent FROM message_protection));",
            )
            .map_err(RpcError::internal)?;
        self.db
            .execute(
                "UPDATE chains SET armed_at = ?1 WHERE done = 0 AND armed_at IS NULL
                     AND (SELECT status FROM messages WHERE id = current) IN ('pending', 'delivered') AND (SELECT to_id FROM messages WHERE id=current) NOT IN (SELECT agent FROM message_protection)",
                params![now],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    /// B13: a hop still `pending` becomes `dropped` with the reason `passed`; any other status
    /// is left as it is. `None` when the hop was not `pending`.
    pub(crate) fn drop_passed(&self, id: u32) -> Result<Option<Message>, RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE messages SET status = 'dropped', reason = 'passed'
                 WHERE id = ?1 AND status = 'pending'",
                params![id],
            )
            .map_err(RpcError::internal)?;
        if changed == 0 {
            return Ok(None);
        }
        self.get(id)
    }

    pub(crate) fn count_wakes(&self, waiter: &str) -> Result<u32, RpcError> {
        self.db
            .query_row(
                "SELECT COUNT(*) FROM wakes WHERE waiter = ?1",
                params![waiter],
                |row| row.get(0),
            )
            .map_err(RpcError::internal)
    }

    pub(crate) fn insert_wake(
        &self,
        waiter: &str,
        ids: &[String],
        any_of: bool,
        finished: &[String],
        seen: u64,
    ) -> Result<Wake, RpcError> {
        self.db
            .execute(
                "INSERT INTO wakes (waiter, any_of, ids, finished, seen) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![waiter, any_of, list_text(ids), list_text(finished), seen as i64],
            )
            .map_err(RpcError::internal)?;
        let id = u32::try_from(self.db.last_insert_rowid()).map_err(RpcError::internal)?;
        self.wake(id)?
            .ok_or_else(|| RpcError::internal("wake request vanished right after it was saved"))
    }

    pub(crate) fn wakes(&self) -> Result<Vec<Wake>, RpcError> {
        self.db
            .prepare("SELECT id, waiter, any_of, ids, finished, seen FROM wakes ORDER BY id")
            .and_then(|mut stmt| stmt.query_map([], row_to_wake)?.collect())
            .map_err(RpcError::internal)
    }

    pub(crate) fn wake(&self, id: u32) -> Result<Option<Wake>, RpcError> {
        self.db
            .query_row(
                "SELECT id, waiter, any_of, ids, finished, seen FROM wakes WHERE id = ?1",
                params![id],
                row_to_wake,
            )
            .optional()
            .map_err(RpcError::internal)
    }

    pub(crate) fn update_wake(
        &self,
        id: u32,
        finished: &[String],
        seen: u64,
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE wakes SET finished = ?2, seen = ?3 WHERE id = ?1",
                params![id, list_text(finished), seen as i64],
            )
            .map(drop)
            .map_err(RpcError::internal)
    }

    /// Whether the request was open.
    pub(crate) fn delete_wake(&self, id: u32) -> Result<bool, RpcError> {
        self.db
            .execute("DELETE FROM wakes WHERE id = ?1", params![id])
            .map(|changed| changed > 0)
            .map_err(RpcError::internal)
    }

    pub(crate) fn delete_wakes_of(&self, waiter: &str) -> Result<(), RpcError> {
        self.db
            .execute("DELETE FROM wakes WHERE waiter = ?1", params![waiter])
            .map(drop)
            .map_err(RpcError::internal)
    }

    /// B1: the Messages to `to` that are `pending`, pushed digests (B22) and Wake notes
    /// (B42) left out.
    pub(crate) fn count_open(&self, to: &str) -> Result<u32, RpcError> {
        self.db
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM messages WHERE to_id = ?1 AND status = 'pending' AND NOT ({DIGEST}) AND NOT (kind = 'note' AND from_actor = ?2 AND substr(body, 1, length(?4)) = ?4)"
                ),
                params![
                    to,
                    actor_json(&Actor::daemon()),
                    crate::pushes::PREFIX,
                    crate::wake::PREFIX
                ],
                |row| row.get(0),
            )
            .map_err(RpcError::internal)
    }

    /// B51(g): the latest non-user Message by B7 delivery rank.
    fn last_inbox_message(
        &self,
        to: &str,
        attempt: i64,
        except: Option<u32>,
    ) -> Result<Option<Message>, RpcError> {
        self.db
            .query_row(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, passed_from
                 FROM messages
                 WHERE to_id = ?1 AND status IN ('pending', 'delivered')
                   AND receiver_attempt = ?2 AND from_actor != ?3 AND (?4 IS NULL OR id != ?4)
                 ORDER BY rank DESC, id DESC LIMIT 1",
                params![to, attempt, actor_json(&Actor::user()), except],
                row_to_message,
            )
            .optional()
            .map_err(RpcError::internal)
    }

    /// B51(g): generated hops cannot bypass the sender/body repeat refusal.
    pub(crate) fn is_inbox_repeat(
        &self,
        from: &Actor,
        to: &str,
        body: &str,
        attempt: i64,
        except: Option<u32>,
    ) -> Result<bool, RpcError> {
        if from.kind == contracts::ActorKind::User || to == Actor::user().id {
            return Ok(false);
        }
        Ok(self
            .last_inbox_message(to, attempt, except)?
            .is_some_and(|last| last.from == *from && last.body == body))
    }

    /// B22: the pushed digests to `to` that are `pending`, oldest first.
    pub(crate) fn open_digests(&self, to: &str) -> Result<Vec<Message>, RpcError> {
        self.db
            .prepare(&format!(
                "SELECT id, from_actor, to_id, kind, body, reply_to, status, reason, at, passed_from
                 FROM messages WHERE to_id = ?1 AND status = 'pending' AND ({DIGEST})
                 ORDER BY id"
            ))
            .and_then(|mut stmt| {
                stmt.query_map(
                    params![to, actor_json(&Actor::daemon()), crate::pushes::PREFIX],
                    row_to_message,
                )?
                .collect()
            })
            .map_err(RpcError::internal)
    }

    /// B22: `id` folded into a newer digest: `dropped` with the reason `merged`, only while it is
    /// still `pending`. Whether it was.
    pub(crate) fn drop_merged(&self, id: u32) -> Result<bool, RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE messages SET status = 'dropped', reason = 'merged'
                 WHERE id = ?1 AND status = 'pending'",
                params![id],
            )
            .map_err(RpcError::internal)?;
        Ok(changed == 1)
    }

    pub(crate) fn set_route(
        &self,
        from: &str,
        to: &str,
        delivery: Delivery,
        set_by: &str,
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO routes (from_id, to_id, delivery, set_by) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(from_id, to_id) DO UPDATE SET
                     delivery = excluded.delivery, set_by = excluded.set_by",
                params![from, to, text_of(delivery), set_by],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    /// M14: whether an Agent set the Route `from` to `to`; false for none, the user's or an Extension's.
    pub(crate) fn route_set_by_agent(&self, from: &str, to: &str) -> Result<bool, RpcError> {
        self.db
            .query_row(
                "SELECT set_by FROM routes WHERE from_id = ?1 AND to_id = ?2",
                params![from, to],
                |row| Ok(row.get::<_, String>(0)? == "agent"),
            )
            .optional()
            .map(|set| set.unwrap_or(false))
            .map_err(RpcError::internal)
    }

    pub(crate) fn get_route(&self, from: &str, to: &str) -> Result<Option<Delivery>, RpcError> {
        self.db
            .query_row(
                "SELECT delivery FROM routes WHERE from_id = ?1 AND to_id = ?2",
                params![from, to],
                |row| from_text(0, &row.get::<_, String>(0)?),
            )
            .optional()
            .map_err(RpcError::internal)
    }

    pub(crate) fn list_routes(&self) -> Result<Vec<Route>, RpcError> {
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
            .map_err(RpcError::internal)
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

fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<Message> {
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
        at: row.get(8)?,
        passed_from: row.get(9)?,
        iteration: None,
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

fn actor_json(actor: &Actor) -> String {
    serde_json::to_string(actor).expect("an Actor is always serializable")
}

#[cfg(test)]
mod tests {
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
                None,
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
}
