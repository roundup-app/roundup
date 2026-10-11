//! Checkpoints (M10): the cards of facts a Door writes, in SQLite. A Checkpoint is not a Message.
//! The Daemon decides who is a Door; the Checkpoint is written to the Workstream of the calling Actor.

mod check;

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use contracts::checkpoint::{Block, Checkpoint, ListParams, WriteParams};
use contracts::{ActorKind, EventData, Verb};
use rpc::{Ctx, Module, OpenError, RpcError, params, reply};
use rusqlite::{Connection, params};
use serde_json::Value;

pub struct Checkpoints {
    db: Mutex<Connection>,
}

impl Checkpoints {
    /// `dir` is the Project's data folder (N1).
    pub fn open(dir: &Path) -> Result<Self, OpenError> {
        let db = Connection::open(dir.join("checkpoints.db"))?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS checkpoints (
                workstream TEXT NOT NULL,
                id INTEGER NOT NULL,
                at INTEGER NOT NULL,
                title TEXT NOT NULL,
                blocks TEXT NOT NULL,
                PRIMARY KEY (workstream, id)
            );",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, RpcError> {
        self.db
            .lock()
            .map_err(|_| RpcError::internal("checkpoint store poisoned"))
    }

    fn write(&self, ctx: &Ctx, p: WriteParams) -> Result<Value, RpcError> {
        if ctx.actor.kind != ActorKind::Agent {
            return Err(RpcError::forbidden("only a Door writes a Checkpoint"));
        }
        check::write(&p)?;
        let workstream = ctx.actor.id.clone();
        let at = i64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
        )
        .map_err(RpcError::internal)?;
        let blocks = serde_json::to_string(&p.blocks).map_err(RpcError::internal)?;
        let id: u32 = {
            let db = self.db()?;
            db.query_row(
                "INSERT INTO checkpoints (workstream, id, at, title, blocks)
                 VALUES (?1, (SELECT COALESCE(MAX(id), 0) + 1 FROM checkpoints WHERE workstream = ?1), ?2, ?3, ?4)
                 RETURNING id",
                params![workstream, at, p.title, blocks],
                |row| row.get(0),
            )
            .map_err(RpcError::internal)?
        };
        let checkpoint = Checkpoint {
            id,
            workstream,
            at,
            title: p.title,
            blocks: p.blocks,
        };
        ctx.touch(
            Verb::Wrote,
            &format!("checkpoint:{}:{id}", checkpoint.workstream),
        )?;
        ctx.emit(EventData::CheckpointWritten(checkpoint.clone()));
        reply(&checkpoint)
    }

    fn list(&self, p: ListParams) -> Result<Value, RpcError> {
        let db = self.db()?;
        let mut statement = db
            .prepare(
                "SELECT id, at, title, blocks FROM checkpoints WHERE workstream = ?1 ORDER BY id",
            )
            .map_err(RpcError::internal)?;
        let rows = statement
            .query_map(params![p.workstream], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(RpcError::internal)?;
        let mut listed = Vec::new();
        for row in rows {
            let (id, at, title, blocks) = row.map_err(RpcError::internal)?;
            listed.push(Checkpoint {
                id,
                workstream: p.workstream.clone(),
                at,
                title,
                blocks: serde_json::from_str::<Vec<Block>>(&blocks).map_err(RpcError::internal)?,
            });
        }
        reply(&listed)
    }
}

#[async_trait]
impl Module for Checkpoints {
    fn namespaces(&self) -> &'static [&'static str] {
        &["checkpoint"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        match method {
            "checkpoint.write" => self.write(ctx, params(value)?),
            "checkpoint.list" => self.list(params(value)?),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}
