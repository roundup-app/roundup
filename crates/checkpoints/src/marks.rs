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
    pub agents: Vec<Mark>,
}

#[async_trait::async_trait]
pub trait RecordMarks: Send + Sync {
    /// None until every Agent has a saved conversation; a missing saved file is an error.
    async fn record(&self, workstream: &str) -> Result<Option<Marks>, RpcError>;
}

impl Checkpoints {
    pub(crate) fn save_marks(
        &self,
        workstream: &str,
        id: u32,
        marks: &Marks,
    ) -> Result<(), RpcError> {
        self.objects.init()?;
        let stored = ObjectMarks::write(&self.objects, marks)?;
        self.objects.retain(
            workstream,
            id,
            stored
                .agents
                .iter()
                .flat_map(|agent| agent.files.iter().map(|file| file.content.object()))
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter(),
        )?;
        let content = serde_json::to_string(&StoredMarks {
            git_objects: stored,
        })
        .map_err(RpcError::internal)?;
        self.db()?
            .execute(
                "INSERT INTO marks (workstream, checkpoint, content) VALUES (?1, ?2, ?3)",
                params![workstream, id, content],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    /// Usable Marks only; historical and invalidated Checkpoints conflict.
    pub fn marks(&self, workstream: &str, id: u32) -> Result<Marks, RpcError> {
        let content: Option<String> = self.db()?.query_row(
            "SELECT content FROM marks WHERE workstream = ?1 AND checkpoint = ?2 AND usable = 1",
            params![workstream, id], |row| row.get(0),
        ).optional().map_err(RpcError::internal)?;
        let content = content
            .ok_or_else(|| RpcError::new(rpc::code::CONFLICT, "Checkpoint has no usable Marks"))?;
        let decoded: Content = serde_json::from_str(&content).map_err(RpcError::internal)?;
        match decoded.git_objects {
            Some(marks) => marks.read(&self.objects),
            None => serde_json::from_str(&content).map_err(RpcError::internal),
        }
        .map_err(|error| RpcError::internal(format!("Checkpoint {workstream}:{id}: {error}")))
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

#[cfg(test)]
#[path = "marks_tests.rs"]
mod tests;

// The wrapper is the content-format discriminator; migration 1's TEXT column already holds it.
// Legacy payloads stay untouched, so conversion cannot strand old Marks on object-write failure.
#[derive(Deserialize)]
struct Content {
    // Skip legacy byte arrays while reading the discriminator, rather than buffering them
    // into serde's untagged representation before decoding the original Marks.
    git_objects: Option<ObjectMarks>,
}

#[derive(Serialize, Deserialize)]
struct StoredMarks {
    git_objects: ObjectMarks,
}

#[derive(Serialize, Deserialize)]
struct ObjectMarks {
    agents: Vec<ObjectMark>,
}

#[derive(Serialize, Deserialize)]
struct ObjectMark {
    agent: String,
    cwd: String,
    worktree: String,
    conversation: Vec<u8>,
    files: Vec<ObjectFile>,
}

#[derive(Serialize, Deserialize)]
struct ObjectFile {
    path: Vec<u8>,
    content: ObjectContent,
}

#[derive(Serialize, Deserialize)]
enum ObjectContent {
    Regular {
        object: crate::objects::Object,
        executable: bool,
    },
    Symlink {
        object: crate::objects::Object,
    },
}

impl ObjectContent {
    fn object(&self) -> &crate::objects::Object {
        match self {
            Self::Regular { object, .. } | Self::Symlink { object } => object,
        }
    }
}

impl ObjectMarks {
    fn write(objects: &crate::objects::Objects, marks: &Marks) -> Result<Self, RpcError> {
        let mut agents = Vec::new();
        for mark in &marks.agents {
            let mut files = Vec::new();
            for file in &mark.files {
                let content = match &file.content {
                    FileContent::Regular { bytes, executable } => ObjectContent::Regular {
                        object: objects.write(bytes)?,
                        executable: *executable,
                    },
                    FileContent::Symlink { target } => ObjectContent::Symlink {
                        object: objects.write(target)?,
                    },
                };
                files.push(ObjectFile {
                    path: file.path.clone(),
                    content,
                });
            }
            agents.push(ObjectMark {
                agent: mark.agent.clone(),
                cwd: mark.cwd.clone(),
                worktree: mark.worktree.clone(),
                conversation: mark.conversation.clone(),
                files,
            });
        }
        Ok(Self { agents })
    }

    fn read(self, objects: &crate::objects::Objects) -> Result<Marks, RpcError> {
        let mut agents = Vec::new();
        for mark in self.agents {
            let mut files = Vec::new();
            for file in mark.files {
                let bytes = objects.read(file.content.object())?;
                let content = match file.content {
                    ObjectContent::Regular { executable, .. } => {
                        FileContent::Regular { bytes, executable }
                    }
                    ObjectContent::Symlink { .. } => FileContent::Symlink { target: bytes },
                };
                files.push(File {
                    path: file.path,
                    content,
                });
            }
            agents.push(Mark {
                agent: mark.agent,
                cwd: mark.cwd,
                worktree: mark.worktree,
                conversation: mark.conversation,
                files,
            });
        }
        Ok(Marks { agents })
    }
}

#[cfg(test)]
#[path = "observer.rs"]
mod observer;
