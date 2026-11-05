//! Readers of what the Daemon and Claude Code wrote under a test's project and config directories.
use std::path::Path;

use serde_json::Value;

pub fn snapshots(project: &Path) -> Vec<Value> {
    std::fs::read_to_string(project.join("comparisons"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

// The burst's Todos only accumulate, so its newest complete comparison acknowledges every
// earlier Todo too. Parsing the full history for each input repeatedly decodes all earlier Todos.
pub fn latest_snapshot(project: &Path) -> Option<Value> {
    std::fs::read_to_string(project.join("comparisons"))
        .unwrap_or_default()
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
}

/// Whether Claude Code, configured in `config`, has written a conversation whose user message
/// holds `prompt`.
pub fn written(config: &Path, prompt: &str) -> bool {
    std::fs::read_dir(config.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|project| {
            std::fs::read_dir(project.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .filter(|file| file.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|file| std::fs::read_to_string(file.path()).ok())
        .any(|conversation| {
            conversation
                .lines()
                .any(|line| line.contains(r#""type":"user""#) && line.contains(prompt))
        })
}

/// Conversation entries of type `user` that carry `text`; Claude Code also logs the same request as an `api-request-blob` entry.
pub fn user_turns_with(written: &str, text: &str) -> usize {
    written
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["type"] == "user" && entry.to_string().contains(text))
        .count()
}

/// The conversation file of the Door, the one that holds the retained Messages.
pub fn transcript(config: &Path) -> String {
    std::fs::read_dir(config.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|p| std::fs::read_dir(p.path()).into_iter().flatten().flatten())
        .filter(|f| f.path().extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|f| std::fs::read_to_string(f.path()).ok())
        .filter(|written| written.contains("first retained"))
        .collect()
}
