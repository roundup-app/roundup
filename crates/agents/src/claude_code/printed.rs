//! U7889a: the shell commands an Agent printed, read from its conversation record. Claude Code
//! prints a fenced block without its fences, so the screen cannot say which lines were a block.

use serde_json::Value;

use super::Launcher;
use rpc::RpcError;
use std::path::Path;

const LABELS: [&str; 4] = ["sh", "bash", "zsh", "shell"];

/// The commands of every shell block in one text, in order: a leading `$ ` dropped, a line
/// ending in `\` joined with the next.
fn commands_of(text: &str, out: &mut Vec<String>) {
    let mut shell = None;
    let mut pending: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(label) = trimmed.strip_prefix("```") {
            if shell.is_none() {
                shell = Some(
                    LABELS
                        .iter()
                        .any(|known| known.eq_ignore_ascii_case(label.trim())),
                );
            } else {
                shell = None;
            }
            out.extend(pending.take());
            continue;
        }
        if shell != Some(true) {
            continue;
        }
        let line = trimmed.strip_prefix("$ ").unwrap_or(trimmed);
        let joined = match pending.take() {
            Some(before) => format!("{before} {line}"),
            None => line.to_owned(),
        };
        match joined.strip_suffix('\\') {
            Some(open) => pending = Some(open.trim_end().to_owned()),
            None if joined.is_empty() => {}
            None => out.push(joined),
        }
    }
    out.extend(pending);
}

/// Every shell command the assistant's text records of a JSONL conversation hold, each once.
pub(super) fn shell_commands(record: &[u8]) -> Vec<String> {
    let mut found = Vec::new();
    for line in record.split(|byte| *byte == b'\n') {
        let Ok(entry) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let content = entry.pointer("/message/content").and_then(Value::as_array);
        for part in content.into_iter().flatten() {
            let is_text = part.get("type").and_then(Value::as_str) == Some("text");
            if let Some(text) = part.get("text").and_then(Value::as_str).filter(|_| is_text) {
                commands_of(text, &mut found);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|command| seen.insert(command.clone()));
    found
}

impl Launcher {
    /// The shell commands the conversation `id` printed; a missing record is an error, as for
    /// every read of a saved conversation.
    pub fn printed_commands(&self, cwd: &Path, id: &str) -> Result<Vec<String>, RpcError> {
        Ok(shell_commands(&self.record_conversation(cwd, id)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(text: &str) -> Vec<u8> {
        let entry = serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":text}]}});
        format!("{entry}\n").into_bytes()
    }

    #[test]
    fn u7889a_only_shell_blocks_give_commands_with_the_dollar_dropped_and_continuations_joined() {
        let text = "Run:\n```bash\n$ brew upgrade ollama && brew services restart ollama\n\nollama run inkling-2-mini\n```\nthen `ls` and\n```ts\nconst x = 1;\n```\n```sh\ncargo build \\\n  --release\n```\nprose line";
        assert_eq!(
            shell_commands(&record(text)),
            [
                "brew upgrade ollama && brew services restart ollama",
                "ollama run inkling-2-mini",
                "cargo build --release",
            ]
        );
    }
}
