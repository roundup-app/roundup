//! NR3: a reaction's firing is accepted in the write that makes its Message, so either both exist, with
//! the ids they were given, or neither does. Deciding that a condition holds is the Daemon's; this
//! module only commits what it decided.
use contracts::Actor;
use contracts::message::{Message, MessageKind};
use rpc::{Ctx, RpcError};
use rusqlite::{OptionalExtension, params};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::store::Store;
use crate::{Messages, SendParams};

/// One firing to accept: `body` goes to `to` as a Message from the Daemon.
pub struct Fire {
    pub reaction: String,
    /// Opaque retry key within explicit runs or automatic matches, separated by `matched`.
    pub operation: String,
    pub to: String,
    pub body: String,
    /// The source facts the firing was accepted on, kept as written.
    pub evidence: String,
    /// False for an explicit run, which claims no condition true.
    pub matched: bool,
}

/// A firing as stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Firing {
    pub id: String,
    pub reaction: String,
    pub operation: String,
    pub ordinal: u32,
    pub message: u32,
    pub matched: bool,
    /// The definition's bytes when it was accepted.
    pub definition: String,
    pub evidence: String,
}

impl Store {
    /// Read the saved bounds inside the accepting write: earlier source/receiver reads and store
    /// waits cannot authorize a firing after expiry, stop or exhaustion.
    pub(crate) fn check_firing(&self, fire: &Fire) -> Result<(), RpcError> {
        let row: Option<(String, u32, u32, String)> = self
            .db
            .query_row(
                "SELECT json_extract(record, '$.state'), json_extract(record, '$.max_firings'),
                        (SELECT COUNT(*) FROM reaction_firings WHERE reaction = reactions.id),
                        json_extract(record, '$.expires_at')
                 FROM reactions WHERE id = ?1",
                params![fire.reaction],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(RpcError::internal)?;
        match row {
            None => Err(RpcError::not_found("no such reaction")),
            Some((state, ..)) if state != "active" => {
                Err(RpcError::conflict("a stopped reaction cannot fire"))
            }
            Some((_, max, used, _)) if used >= max => {
                Err(RpcError::conflict("the reaction has no firing left"))
            }
            Some((_, _, _, expiry)) => {
                let expires =
                    OffsetDateTime::parse(&expiry, &Rfc3339).map_err(RpcError::internal)?;
                if OffsetDateTime::from(crate::now()) >= expires {
                    return Err(RpcError::conflict("the reaction expired; create a new one"));
                }
                Ok(())
            }
        }
    }

    pub(crate) fn accept_firing(&self, fire: &Fire, message: u32) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO reaction_firings
                   (id, reaction, operation, ordinal, message, matched, definition, evidence)
                 SELECT lower(hex(randomblob(16))), ?1, ?2,
                        (SELECT COUNT(*) + 1 FROM reaction_firings WHERE reaction = ?1),
                        ?3, ?4, record, ?5
                 FROM reactions WHERE id = ?1",
                params![
                    fire.reaction,
                    fire.operation,
                    message,
                    fire.matched,
                    fire.evidence
                ],
            )
            .map(drop)
            .map_err(RpcError::internal)
    }

    pub(crate) fn firings(&self, reaction: &str) -> Result<Vec<Firing>, RpcError> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT id, reaction, operation, ordinal, message, matched, definition, evidence
                 FROM reaction_firings WHERE reaction = ?1 ORDER BY ordinal",
            )
            .map_err(RpcError::internal)?;
        stmt.query_map(params![reaction], |r| {
            Ok(Firing {
                id: r.get(0)?,
                reaction: r.get(1)?,
                operation: r.get(2)?,
                ordinal: r.get(3)?,
                message: r.get(4)?,
                matched: r.get(5)?,
                definition: r.get(6)?,
                evidence: r.get(7)?,
            })
        })
        .and_then(|rows| rows.collect())
        .map_err(RpcError::internal)
    }
}

impl Messages {
    /// NR3: in one write, accepts the firing and creates its Message, under the same delivery rules as
    /// any Message from the Daemon. A retried `(matched, operation)` returns its first firing and sends
    /// nothing.
    pub async fn fire_reaction(&self, fire: Fire) -> Result<(Firing, Message), RpcError> {
        let earlier = self
            .store()?
            .firings(&fire.reaction)?
            .into_iter()
            .find(|firing| firing.operation == fire.operation && firing.matched == fire.matched);
        if let Some(firing) = earlier {
            return self.firing_message(firing);
        }
        if let Some(reconciled) = self.firing_of_continuation(&fire)? {
            return Ok(reconciled);
        }
        let ctx = Ctx {
            actor: Actor::daemon(),
            bus: self.inner.bus.clone(),
            touches: std::sync::Arc::clone(&self.inner.touches),
        };
        let params = SendParams {
            to: fire.to.clone(),
            kind: MessageKind::Note,
            body: fire.body.clone(),
            reply_to: None,
        };
        let message = self
            .send_message_with(&ctx, params, false, None, Some(&fire), None)
            .await?;
        let firing = self
            .store()?
            .firings(&fire.reaction)?
            .into_iter()
            .find(|firing| firing.message == message.id)
            .ok_or_else(|| RpcError::internal("accepted firing vanished"))?;
        Ok((firing, message))
    }

    /// NR3: the firings of `reaction`, oldest first, each with its Message as the history holds it.
    pub fn firings_of(&self, reaction: &str) -> Result<Vec<(Firing, Option<Message>)>, RpcError> {
        let store = self.store()?;
        store
            .firings(reaction)?
            .into_iter()
            .map(|firing| {
                let message = store.get(firing.message)?;
                Ok((firing, message))
            })
            .collect()
    }

    fn firing_message(&self, firing: Firing) -> Result<(Firing, Message), RpcError> {
        let message = self
            .store()?
            .get(firing.message)?
            .ok_or_else(|| RpcError::internal("an accepted firing lost its Message"))?;
        Ok((firing, message))
    }
}
