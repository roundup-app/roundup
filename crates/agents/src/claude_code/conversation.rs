//! A35: vendor storage stays here. A Mark freezes complete JSONL records, not a mutable file offset.

use std::io::Write;
use std::path::{Path, PathBuf};

use rpc::RpcError;
use serde_json::Value;

use super::{Launcher, is_uuid};

impl Launcher {
    fn conversation_path(&self, cwd: &Path, id: &str) -> Result<PathBuf, RpcError> {
        if !is_uuid(id) {
            return Err(RpcError::internal("invalid saved conversation id"));
        }
        let cwd = cwd.canonicalize().map_err(RpcError::internal)?;
        let project: String = cwd
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        Ok(self
            .conversation_dir
            .join("projects")
            .join(project)
            .join(format!("{id}.jsonl")))
    }

    /// A saved id whose file is missing is an error, never an empty conversation.
    pub fn record_conversation(&self, cwd: &Path, id: &str) -> Result<Vec<u8>, RpcError> {
        let path = self.conversation_path(cwd, id)?;
        let mut bytes = std::fs::read(&path)
            .map_err(|err| RpcError::internal(format!("cannot read saved conversation: {err}")))?;
        // Claude appends records. A concurrent incomplete last record belongs to a later Mark.
        let end = bytes
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |end| end + 1);
        if end == 0 {
            return Err(RpcError::internal(
                "saved conversation has no complete records",
            ));
        }
        bytes.truncate(end);
        for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            let record: Value = serde_json::from_slice(line).map_err(RpcError::internal)?;
            if !record.is_object() {
                return Err(RpcError::internal("conversation record is not an object"));
            }
        }
        Ok(bytes)
    }

    /// Create a new conversation from the frozen end, without opening the original for writing.
    /// Returns the id A22's launcher can resume; nothing starts or changes the Rail here.
    pub fn copy_conversation(&self, cwd: &Path, mark: &[u8]) -> Result<String, RpcError> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(RpcError::internal)?;
        random[6] = (random[6] & 0x0f) | 0x40;
        random[8] = (random[8] & 0x3f) | 0x80;
        let hex: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let id = format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        );
        let path = self.conversation_path(cwd, &id)?;
        let dir = path
            .parent()
            .ok_or_else(|| RpcError::internal("missing conversation directory"))?;
        std::fs::create_dir_all(dir).map_err(RpcError::internal)?;
        let mut copy = tempfile::NamedTempFile::new_in(dir).map_err(RpcError::internal)?;
        for line in mark.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            let mut record: Value = serde_json::from_slice(line).map_err(RpcError::internal)?;
            if let Some(fields) = record.as_object_mut() {
                if fields.contains_key("sessionId") {
                    fields.insert("sessionId".into(), Value::String(id.clone()));
                }
            } else {
                return Err(RpcError::internal("conversation record is not an object"));
            }
            serde_json::to_writer(&mut copy, &record).map_err(RpcError::internal)?;
            copy.write_all(b"\n").map_err(RpcError::internal)?;
        }
        copy.as_file().sync_all().map_err(RpcError::internal)?;
        copy.persist_noclobber(path).map_err(RpcError::internal)?;
        Ok(id)
    }
}
