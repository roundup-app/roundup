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

/// A35: what the Daemon keeps for a Checkpoint beyond its card, which makes it `rewindable`.
#[async_trait]
pub trait Marker: Send + Sync {
    /// Record the Marks of the Checkpoint just written to `workstream`.
    async fn record(&self, workstream: &str, checkpoint: u32) -> Result<(), RpcError>;
    /// The ids of the Checkpoints of `workstream` that can be rewound to.
    fn rewindable(&self, workstream: &str) -> Result<Vec<u32>, RpcError>;
}

pub struct Checkpoints {
    db: Mutex<Connection>,
    marker: Option<std::sync::Arc<dyn Marker>>,
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
        Ok(Self {
            db: Mutex::new(db),
            marker: None,
        })
    }

    /// A35: Checkpoints written from now on get Marks from `marker`.
    #[must_use]
    pub fn with_marker(mut self, marker: std::sync::Arc<dyn Marker>) -> Self {
        self.marker = Some(marker);
        self
    }

    fn db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, RpcError> {
        self.db
            .lock()
            .map_err(|_| RpcError::internal("checkpoint store poisoned"))
    }

    async fn write(&self, ctx: &Ctx, p: WriteParams) -> Result<Value, RpcError> {
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
            rewindable: false,
        };
        let mut checkpoint = checkpoint;
        if let Some(marker) = &self.marker {
            match marker.record(&checkpoint.workstream, id).await {
                Ok(()) => checkpoint.rewindable = true,
                Err(error) => eprintln!(
                    "checkpoints: no Marks for {}:{id}: {}",
                    checkpoint.workstream, error.message
                ),
            }
        }
        ctx.touch(
            Verb::Wrote,
            &format!("checkpoint:{}:{id}", checkpoint.workstream),
        )?;
        ctx.emit(EventData::CheckpointWritten(checkpoint.clone()));
        reply(&checkpoint)
    }

    fn list(&self, p: ListParams) -> Result<Value, RpcError> {
        let marked = match &self.marker {
            Some(marker) => marker.rewindable(&p.workstream)?,
            None => Vec::new(),
        };
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
                rewindable: marked.contains(&id),
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
            "checkpoint.write" => self.write(ctx, params(value)?).await,
            "checkpoint.list" => self.list(params(value)?),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use contracts::Actor;
    use contracts::checkpoint::{Block, Checkpoint};
    use provenance::Touches;
    use rpc::Bus;
    use serde_json::json;

    use super::*;

    struct Marks(Result<Vec<u32>, ()>);

    #[async_trait]
    impl Marker for Marks {
        async fn record(&self, _: &str, _: u32) -> Result<(), RpcError> {
            self.0
                .as_ref()
                .map(drop)
                .map_err(|()| RpcError::internal("no marks"))
        }

        fn rewindable(&self, _: &str) -> Result<Vec<u32>, RpcError> {
            Ok(self.0.clone().unwrap_or_default())
        }
    }

    fn door() -> Ctx {
        Ctx {
            actor: Actor {
                kind: ActorKind::Agent,
                id: "1".into(),
                parent: None,
            },
            bus: Bus::new(),
            touches: Arc::new(Touches::in_memory().unwrap()),
        }
    }

    async fn written(marker: Marks) -> (Checkpoint, Vec<Checkpoint>) {
        let dir = tempfile::tempdir().unwrap();
        let checkpoints = Checkpoints::open(dir.path())
            .unwrap()
            .with_marker(Arc::new(marker));
        let card = json!({"title": "t", "blocks": [{"kind": "text", "text": "x"}]});
        let made = checkpoints
            .call(&door(), "checkpoint.write", card)
            .await
            .unwrap();
        let listed = checkpoints
            .call(&door(), "checkpoint.list", json!({"workstream": "1"}))
            .await
            .unwrap();
        (
            serde_json::from_value(made).unwrap(),
            serde_json::from_value(listed).unwrap(),
        )
    }

    #[tokio::test]
    async fn a35_a_written_checkpoint_with_marks_is_rewindable() {
        let (made, listed) = written(Marks(Ok(vec![1]))).await;

        assert!(made.rewindable && listed[0].rewindable);
        assert!(matches!(made.blocks[0], Block::Text { .. }));
    }

    #[tokio::test]
    async fn a35_a_failed_mark_leaves_the_checkpoint_written_and_not_rewindable() {
        let (made, listed) = written(Marks(Err(()))).await;

        assert!(!made.rewindable);
        assert_eq!(listed.len(), 1);
        assert!(!listed[0].rewindable);
    }
}
