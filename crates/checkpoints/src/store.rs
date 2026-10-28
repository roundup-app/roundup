//! Checkpoint store construction, card writes and reads.

use std::path::Path;
use std::sync::Mutex;

use contracts::checkpoint::{Block, Checkpoint, ListParams, WriteParams};
use contracts::{ActorKind, EventData, Verb};
use rpc::{Ctx, OpenError, RpcError, reply};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::{Checkpoints, RecordMarks, check, objects};

impl Checkpoints {
    /// `dir` is the Project's data folder (N1).
    pub fn open(dir: &Path) -> Result<Self, OpenError> {
        let path = dir.join(if dir.join("project.db").exists() {
            "project.db"
        } else {
            "checkpoints.db"
        });
        let mut db = Connection::open(&path)?;
        // The Daemon initializes Project WAL; repeating the pragma eagerly loads its whole schema.
        if path.file_name().is_none_or(|name| name != "project.db") {
            db.pragma_update(None, "journal_mode", "WAL")?;
        }
        crate::schema::open(&mut db, &path)?;
        Ok(Self {
            db: Mutex::new(db),
            objects: objects::Objects::new(dir)?,
            recorder: None,
        })
    }

    /// The Daemon supplies the Rail and Adapter that record Marks.
    pub fn with_marks(mut self, recorder: std::sync::Arc<dyn RecordMarks>) -> Self {
        self.recorder = Some(recorder);
        self
    }

    pub(super) fn db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, RpcError> {
        self.db
            .lock()
            .map_err(|_| RpcError::internal("checkpoint store poisoned"))
    }

    pub(super) async fn write(&self, ctx: &Ctx, p: WriteParams) -> Result<Value, RpcError> {
        if ctx.actor.kind != ActorKind::Agent {
            return Err(RpcError::forbidden("only a Door writes a Checkpoint"));
        }
        check::write(&p)?;
        let workstream = ctx.actor.id.clone();
        let at = i64::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000)
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
        // The card stays on a recording failure, but never claims it can be rewound.
        let rewindable = if let Some(recorder) = &self.recorder {
            if let Some(marks) = recorder.record(&workstream).await? {
                self.save_marks(&workstream, id, &marks)?;
                true
            } else {
                false
            }
        } else {
            false
        };
        let checkpoint = Checkpoint {
            id,
            workstream,
            at,
            rewindable,
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

    pub(super) fn list(&self, p: ListParams) -> Result<Value, RpcError> {
        let iteration = self
            .recorder
            .as_ref()
            .map(|recorder| recorder.iteration(&p.workstream))
            .transpose()?;
        let db = self.db()?;
        let mut statement = db
            .prepare(
                "SELECT c.id, c.at, c.title, c.blocks,
                        EXISTS(SELECT 1 FROM marks m WHERE m.workstream = c.workstream
                            AND m.checkpoint = c.id AND m.usable = 1 AND m.iteration = ?2)
                 FROM checkpoints c WHERE c.workstream = ?1 ORDER BY c.id",
            )
            .map_err(RpcError::internal)?;
        let rows = statement
            .query_map(params![p.workstream, iteration], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            })
            .map_err(RpcError::internal)?;
        let mut listed = Vec::new();
        for row in rows {
            let (id, at, title, blocks, rewindable) = row.map_err(RpcError::internal)?;
            listed.push(Checkpoint {
                id,
                workstream: p.workstream.clone(),
                at,
                rewindable,
                title,
                blocks: serde_json::from_str::<Vec<Block>>(&blocks).map_err(RpcError::internal)?,
            });
        }
        reply(&listed)
    }
}
