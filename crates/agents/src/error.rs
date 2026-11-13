//! The one failure type of the Agent library's public functions that do not answer an RPC call (RB3798c).

use std::path::PathBuf;

/// Each message reads as it did when these were strings.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A3516b: the Brief the start hook names cannot be read.
    #[error("cannot read Brief {}: {source}", path.display())]
    BriefUnreadable {
        path: PathBuf,
        source: std::io::Error,
    },
    /// E3: the Daemon's start Context is not the JSON the hook expects.
    #[error("cannot read start Context: {0}")]
    StartContextMalformed(#[from] serde_json::Error),
    /// E3: the start Context holds no `additionalContext` to extend.
    #[error("start Context has no additionalContext")]
    StartContextEmpty,
    /// SK1: no config folder can be chosen.
    #[error("neither CLAUDE_CONFIG_DIR nor HOME is set")]
    NoConfigDir,
}
