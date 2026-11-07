//! U3078e/f: one accepted decision to continue unfinished work, written in the same transaction
//! as its successor Message, so either both exist with the ids they were given or neither does.
//! Which actions are eligible is the Daemon's to decide; this module only commits what it decided.
use crate::Error;
use contracts::Actor;
use contracts::message::{Message, MessageKind};
use rpc::Ctx;
use rusqlite::{OptionalExtension, params};

use crate::store::Store;
use crate::{Messages, SendParams};

/// Shared by standalone Message migrations; the Project sequence holds the same text.
#[doc(hidden)]
pub const SCHEMA: &str = "
CREATE TABLE continuation_decisions (
    id TEXT PRIMARY KEY NOT NULL,
    agent TEXT NOT NULL,
    request TEXT NOT NULL,
    payload TEXT NOT NULL,
    message INTEGER NOT NULL,
    evidence TEXT NOT NULL,
    UNIQUE(agent, request)
);
CREATE TABLE continuation_actions (
    action TEXT PRIMARY KEY NOT NULL,
    decision TEXT NOT NULL REFERENCES continuation_decisions(id)
);";

/// One decision to accept: `body` goes to `agent` as a Message from the Daemon.
pub struct Continue {
    pub agent: String,
    /// The client's retry key, scoped to `agent`.
    pub request: String,
    /// What the client asked for; the same request with other bytes is refused.
    pub payload: String,
    /// Identities of the unfinished actions this decision accepts, each at most once ever.
    pub actions: Vec<String>,
    pub body: String,
    /// The reconciled facts the decision was accepted on, kept as written.
    pub evidence: String,
}

/// A decision as stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub id: String,
    pub agent: String,
    pub request: String,
    pub actions: Vec<String>,
    pub message: u32,
    pub evidence: String,
}

/// Where an action was already accepted: by a decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Covered {
    pub decision: String,
    pub message: u32,
}

impl Store {
    pub(crate) fn covered(&self, action: &str) -> Result<Option<Covered>, Error> {
        let decided = self
            .db
            .query_row(
                "SELECT d.id, d.message FROM continuation_actions a
                 JOIN continuation_decisions d ON d.id = a.decision WHERE a.action = ?1",
                params![action],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)),
            )
            .optional()
            .map_err(Error::internal)?;
        if let Some((decision, message)) = decided {
            return Ok(Some(Covered { decision, message }));
        }
        Ok(None)
    }

    fn decision(&self, sql: &str, key: &[&str]) -> Result<Option<Choice>, Error> {
        let row = self
            .db
            .query_row(sql, rusqlite::params_from_iter(key), |r| {
                Ok(Choice {
                    id: r.get(0)?,
                    agent: r.get(1)?,
                    request: r.get(2)?,
                    actions: Vec::new(),
                    message: r.get(3)?,
                    evidence: r.get(4)?,
                })
            })
            .optional()
            .map_err(Error::internal)?;
        let Some(mut decision) = row else {
            return Ok(None);
        };
        decision.actions = self
            .db
            .prepare("SELECT action FROM continuation_actions WHERE decision = ?1 ORDER BY rowid")
            .map_err(Error::internal)?
            .query_map(params![decision.id], |r| r.get(0))
            .and_then(|rows| rows.collect())
            .map_err(Error::internal)?;
        Ok(Some(decision))
    }

    /// The decision a retried request names; a request with other bytes is refused.
    fn requested(
        &self,
        agent: &str,
        request: &str,
        payload: &str,
    ) -> Result<Option<Choice>, Error> {
        let stored: Option<String> = self
            .db
            .query_row(
                "SELECT payload FROM continuation_decisions WHERE agent = ?1 AND request = ?2",
                params![agent, request],
                |r| r.get(0),
            )
            .optional()
            .map_err(Error::internal)?;
        match stored {
            None => Ok(None),
            Some(saved) if saved != payload => Err(Error::conflict(
                "this request id already names another resume",
            )),
            Some(_) => self.decision(
                "SELECT id, agent, request, message, evidence FROM continuation_decisions
                 WHERE agent = ?1 AND request = ?2",
                &[agent, request],
            ),
        }
    }

    fn decision_of(&self, action: &str) -> Result<Option<Choice>, Error> {
        self.decision(
            "SELECT d.id, d.agent, d.request, d.message, d.evidence FROM continuation_decisions d
             JOIN continuation_actions a ON a.decision = d.id WHERE a.action = ?1",
            &[action],
        )
    }

    /// The decision that already accepts every action of `c`, whether by this request, an earlier
    /// one; `None` when some action is still unaccepted.
    pub(crate) fn accepted(&self, c: &Continue) -> Result<Option<Choice>, Error> {
        if let Some(decision) = self.requested(&c.agent, &c.request, &c.payload)? {
            return Ok(Some(decision));
        }
        for action in &c.actions {
            if self.covered(action)?.is_none() {
                return Ok(None);
            }
        }
        match c.actions.first() {
            Some(action) => self.decision_of(action),
            None => Ok(None),
        }
    }

    fn insert_decision(&self, c: &Continue, message: u32) -> Result<Choice, Error> {
        let id: String = self
            .db
            .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
            .map_err(Error::internal)?;
        self.db
            .execute(
                "INSERT INTO continuation_decisions (id, agent, request, payload, message, evidence)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, c.agent, c.request, c.payload, message, c.evidence],
            )
            .map_err(Error::internal)?;
        for action in &c.actions {
            self.db
                .execute(
                    "INSERT INTO continuation_actions (action, decision) VALUES (?1, ?2)",
                    params![action, id],
                )
                .map_err(|_| Error::conflict("an action was accepted by another resume"))?;
        }
        Ok(Choice {
            id,
            agent: c.agent.clone(),
            request: c.request.clone(),
            actions: c.actions.clone(),
            message,
            evidence: c.evidence.clone(),
        })
    }

    pub(crate) fn accept_continuation(&self, c: &Continue, message: u32) -> Result<(), Error> {
        self.insert_decision(c, message).map(drop)
    }
}

impl Messages {
    /// In one write, accepts the decision and creates its successor Message under the same delivery
    /// rules as any Message from the Daemon. A retry, a fresh request id for an accepted action, a
    /// concurrent observer of the same action all return the first decision
    /// and its Message; nothing more is sent.
    pub async fn continue_work(&self, c: Continue) -> Result<(Choice, Message), Error> {
        if c.actions.is_empty() {
            return Err(Error::conflict(
                "there is no unfinished action to accept",
            ));
        }
        if let Some(found) = self.accepted_now(&c)? {
            return Ok(found);
        }
        let ctx = Ctx {
            actor: Actor::daemon(),
            bus: self.inner.bus.clone(),
            touches: std::sync::Arc::clone(&self.inner.touches),
        };
        let params = SendParams {
            to: c.agent.clone(),
            kind: MessageKind::Note,
            body: c.body.clone(),
            reply_to: None,
        };
        let sent = self
            .send_message_with(&ctx, params, false, None, Some(&c))
            .await;
        let message = match sent {
            Ok(message) => message,
            // A concurrent observer may have accepted the same action first.
            Err(error) => {
                return self.accepted_now(&c)?.ok_or(error);
            }
        };
        // After the commit: a failure here is a lost reply, and a retry returns this decision.
        (self.inner.fault)("continuation_reply").map_err(Error::internal)?;
        let decision = self
            .store()?
            .decision_of(&c.actions[0])?
            .ok_or_else(|| Error::internal("accepted decision vanished"))?;
        Ok((decision, message))
    }

    fn accepted_now(&self, c: &Continue) -> Result<Option<(Choice, Message)>, Error> {
        let mut store = self.store()?;
        let Some(decision) = store.atomically(|store| store.accepted(c))? else {
            return Ok(None);
        };
        let message = store
            .get(decision.message)?
            .ok_or_else(|| Error::internal("an accepted decision lost its Message"))?;
        Ok(Some((decision, message)))
    }

    /// The decision a retried `request` names, with its Message; other bytes under it are refused.
    pub fn requested_decision(
        &self,
        agent: &str,
        request: &str,
        payload: &str,
    ) -> Result<Option<(Choice, Message)>, Error> {
        let store = self.store()?;
        let Some(decision) = store.requested(agent, request, payload)? else {
            return Ok(None);
        };
        let message = store
            .get(decision.message)?
            .ok_or_else(|| Error::internal("an accepted decision lost its Message"))?;
        Ok(Some((decision, message)))
    }

    /// The Messages made by accepted decisions for `agent`.
    pub fn continuation_messages(&self, agent: &str) -> Result<Vec<u32>, Error> {
        self.store()?
            .db
            .prepare("SELECT message FROM continuation_decisions WHERE agent = ?1")
            .map_err(Error::internal)?
            .query_map(params![agent], |r| r.get(0))
            .and_then(|rows| rows.collect())
            .map_err(Error::internal)
    }

    /// Where `action` was already accepted, if anywhere.
    pub fn continuation_of(&self, action: &str) -> Result<Option<Covered>, Error> {
        self.store()?.covered(action)
    }

    /// The decision that accepted `action` and the Message it made.
    pub fn decision_of(&self, action: &str) -> Result<Option<(Choice, Message)>, Error> {
        let store = self.store()?;
        let Some(decision) = store.decision_of(action)? else {
            return Ok(None);
        };
        let message = store
            .get(decision.message)?
            .ok_or_else(|| Error::internal("an accepted decision lost its Message"))?;
        Ok(Some((decision, message)))
    }
}
