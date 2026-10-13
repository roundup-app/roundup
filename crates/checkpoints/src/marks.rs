//! A35's durable Marks, kept separately from the M10 card and never returned by RPC.

use rpc::RpcError;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::Checkpoints;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileContent {
    Regular { bytes: Vec<u8>, executable: bool },
    Symlink { target: Vec<u8> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct File {
    /// Relative path bytes preserve non-UTF8 names and newline characters.
    pub path: Vec<u8>,
    pub content: FileContent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mark {
    pub agent: String,
    pub cwd: String,
    pub worktree: String,
    /// Opaque Adapter data, frozen at the conversation’s recorded end.
    pub conversation: Vec<u8>,
    pub files: Vec<File>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marks {
    pub iteration: u32,
    pub agents: Vec<Mark>,
}

#[async_trait::async_trait]
pub trait RecordMarks: Send + Sync {
    /// None until every Agent has a saved conversation; a missing saved file is an error.
    async fn record(&self, workstream: &str) -> Result<Option<Marks>, RpcError>;
    fn iteration(&self, workstream: &str) -> Result<u32, RpcError>;
}

impl Checkpoints {
    pub(crate) fn save_marks(
        &self,
        workstream: &str,
        id: u32,
        marks: &Marks,
    ) -> Result<(), RpcError> {
        let content = serde_json::to_string(marks).map_err(RpcError::internal)?;
        self.db()?.execute(
            "INSERT INTO marks (workstream, checkpoint, iteration, content) VALUES (?1, ?2, ?3, ?4)",
            params![workstream, id, marks.iteration, content],
        ).map_err(RpcError::internal)?;
        Ok(())
    }

    /// Usable Marks only; historical, earlier-Iteration and invalidated Checkpoints conflict.
    /// The caller supplies the current Rail Iteration, including after a Daemon restart.
    pub fn marks(&self, workstream: &str, id: u32, iteration: u32) -> Result<Marks, RpcError> {
        let content: Option<String> = self.db()?.query_row(
            "SELECT content FROM marks WHERE workstream = ?1 AND checkpoint = ?2 AND iteration = ?3 AND usable = 1",
            params![workstream, id, iteration], |row| row.get(0),
        ).optional().map_err(RpcError::internal)?;
        let content = content
            .ok_or_else(|| RpcError::new(rpc::code::CONFLICT, "Checkpoint has no usable Marks"))?;
        serde_json::from_str(&content).map_err(RpcError::internal)
    }

    /// #808's rewind invalidates later Marks without deleting their cards or saved data.
    pub fn invalidate_after(&self, workstream: &str, id: u32) -> Result<(), RpcError> {
        self.db()?
            .execute(
                "UPDATE marks SET usable = 0 WHERE workstream = ?1 AND checkpoint > ?2",
                params![workstream, id],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }
}
