//! MC32: a file read or written where a core is, through the file methods its `hello` lists
//! (`file.read`, `file.write`, `file.edit` on 0.1.20), never through an exec of `cat` or `tee`.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use crate::conn::Conn;
use crate::error::{Error, Result};

/// One edit of `file.edit`: `old` is found exactly once in the file as it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Edit {
    pub old: String,
    pub new: String,
}

impl Conn {
    /// Call `method` once the core's `hello` has listed it; a core that lists none is `NoMethod`.
    async fn file_call(&self, method: &str, params: Value) -> Result<Value> {
        if !self
            .hello
            .methods
            .iter()
            .any(|m| m.as_str() == Some(method))
        {
            return Err(Error::NoMethod(method.to_owned()));
        }
        self.call(method, params).await
    }

    /// `file.read`: the whole file at `path` (absolute, or from `cwd`) as the core reads it, line
    /// ends kept. A file that is not UTF-8 text is the core's `not_text`.
    pub async fn file_read(&self, path: &str, cwd: Option<&str>) -> Result<String> {
        let reply = self
            .file_call("file.read", json!({"path": path, "cwd": cwd}))
            .await?;
        match reply.get("text").and_then(Value::as_str) {
            Some(text) => Ok(text.to_owned()),
            None => Err(Error::Protocol("file.read: no text".into())),
        }
    }

    /// `file.write`: `bytes` become the file at `path`, missing folders made. Returns the bytes written.
    pub async fn file_write(&self, path: &str, cwd: Option<&str>, bytes: &[u8]) -> Result<u64> {
        let data = STANDARD.encode(bytes);
        let reply = self
            .file_call(
                "file.write",
                json!({"path": path, "cwd": cwd, "data": data}),
            )
            .await?;
        written(&reply, "file.write")
    }

    /// `file.edit`: every edit made, or none. Returns the bytes the file now holds.
    pub async fn file_edit(&self, path: &str, cwd: Option<&str>, edits: &[Edit]) -> Result<u64> {
        let edits: Vec<Value> = edits
            .iter()
            .map(|e| json!({"old": e.old, "new": e.new}))
            .collect();
        let reply = self
            .file_call(
                "file.edit",
                json!({"path": path, "cwd": cwd, "edits": edits}),
            )
            .await?;
        written(&reply, "file.edit")
    }
}

fn written(reply: &Value, method: &str) -> Result<u64> {
    reply
        .get("bytes")
        .and_then(Value::as_u64)
        .ok_or_else(|| Error::Protocol(format!("{method}: no bytes")))
}
