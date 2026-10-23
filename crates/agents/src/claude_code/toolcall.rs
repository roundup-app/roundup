//! U3780a: an Agent's current or last tool call, folded from the `PreToolUse`, `PostToolUse` and
//! `PostToolUseFailure` Signals. Vendor payload names stay in this file.

use contracts::agent::{ToolCall, ToolCallState};
use serde_json::Value;

/// The longest `arguments` or `result` on the wire, in bytes, mark included.
pub const PAYLOAD_MAX: usize = 4096;
/// The longest one-line summary, in characters.
pub const SUMMARY_MAX: usize = 200;
/// Room kept for the mark of a cut payload: `… (cut, N bytes more)` with any `usize` N.
const MARK_ROOM: usize = 48;

/// A call and the vendor id its finishing Signal must carry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tracked {
    id: String,
    pub call: ToolCall,
}

/// Fold `payload`, which arrived at `now` (milliseconds), into `current`. `root` is the directory
/// that paths are shown relative to. Returns whether `current` changed.
pub fn fold(current: &mut Option<Tracked>, payload: &Value, root: &str, now: i64) -> bool {
    let id = payload["tool_use_id"].as_str().unwrap_or_default();
    match payload["hook_event_name"].as_str() {
        Some("PreToolUse") => {
            let Some(tool) = payload["tool_name"].as_str() else {
                return false;
            };
            let input = &payload["tool_input"];
            *current = Some(Tracked {
                id: id.to_owned(),
                call: ToolCall {
                    tool: clean(tool),
                    summary: summary(tool, input, root),
                    arguments: cut(&clean(&text_of(input)), PAYLOAD_MAX),
                    result: None,
                    state: ToolCallState::Running,
                    started: now,
                    duration_ms: None,
                },
            });
            true
        }
        Some(event @ ("PostToolUse" | "PostToolUseFailure")) => {
            let Some(tracked) = current else {
                return false;
            };
            if tracked.id != id || tracked.call.state != ToolCallState::Running {
                return false;
            }
            let failed = event == "PostToolUseFailure";
            let result = if failed {
                payload["error"]
                    .as_str()
                    .map_or_else(|| text_of(&payload["tool_response"]), str::to_owned)
            } else {
                text_of(&payload["tool_response"])
            };
            let call = &mut tracked.call;
            call.state = if failed {
                ToolCallState::Failed
            } else {
                ToolCallState::Done
            };
            call.result = Some(cut(&clean(&result), PAYLOAD_MAX));
            call.duration_ms = Some(
                payload["duration_ms"]
                    .as_u64()
                    .unwrap_or_else(|| u64::try_from((now - call.started).max(0)).unwrap_or(0)),
            );
            true
        }
        _ => false,
    }
}

fn text_of(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    }
}

fn summary(tool: &str, input: &Value, root: &str) -> Option<String> {
    let field = |names: &[&str]| names.iter().find_map(|name| input[*name].as_str());
    let line = match tool {
        "Bash" => field(&["command"])?.to_owned(),
        "Read" | "Edit" | "Write" => relative(field(&["file_path"])?, root),
        "Grep" | "Glob" => field(&["pattern"])?.to_owned(),
        "WebSearch" => field(&["query"])?.to_owned(),
        "WebFetch" => field(&["url", "query"])?.to_owned(),
        _ => return None,
    };
    let line = clean(&line)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!line.is_empty()).then(|| line.chars().take(SUMMARY_MAX).collect())
}

fn relative(path: &str, root: &str) -> String {
    let root = root.trim_end_matches('/');
    match path.strip_prefix(root) {
        Some(rest) if !root.is_empty() && rest.starts_with('/') => rest[1..].to_owned(),
        _ => path.to_owned(),
    }
}

/// `text` without terminal escape sequences and control characters other than newline and tab.
fn clean(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.next() {
                // CSI: parameters, then a final byte in `@` to `~`.
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                // OSC, DCS, APC, PM, SOS: up to BEL or ESC `\`.
                Some(']' | 'P' | '_' | '^' | 'X') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' {
                            chars.next_if_eq(&'\\');
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\n' | '\t' => out.push(c),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// `text` within `max` bytes, cut at a character boundary and ended by the mark when cut.
fn cut(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max - MARK_ROOM;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… (cut, {} bytes more)", &text[..end], text.len() - end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pre(id: &str, tool: &str, input: Value) -> Value {
        json!({"hook_event_name": "PreToolUse", "tool_use_id": id, "tool_name": tool, "tool_input": input})
    }

    #[test]
    fn u3780a_pre_tool_use_starts_the_call_with_tool_summary_and_arguments() {
        let mut current = None;
        let cases = [
            (
                "Bash",
                json!({"command": "just  check\n--all"}),
                Some("just check --all"),
            ),
            (
                "Read",
                json!({"file_path": "/p/src/a.rs"}),
                Some("src/a.rs"),
            ),
            (
                "Edit",
                json!({"file_path": "/elsewhere/a.rs"}),
                Some("/elsewhere/a.rs"),
            ),
            ("Grep", json!({"pattern": "fn main"}), Some("fn main")),
            ("WebSearch", json!({"query": "solid"}), Some("solid")),
            ("TodoWrite", json!({"todos": []}), None),
        ];
        for (tool, input, want) in cases {
            assert!(fold(&mut current, &pre("t", tool, input.clone()), "/p", 7));
            let call = current.clone().unwrap().call;
            assert_eq!(call.tool, tool);
            assert_eq!(call.summary.as_deref(), want);
            assert_eq!(call.state, ToolCallState::Running);
            assert_eq!((call.started, call.result), (7, None));
            assert!(call.arguments.contains(&text_of(&input)[..2]));
        }
    }

    #[test]
    fn u3780a_post_tool_use_finishes_only_its_own_call() {
        let mut current = None;
        fold(
            &mut current,
            &pre("a", "Bash", json!({"command": "ls"})),
            "/p",
            100,
        );
        let other =
            json!({"hook_event_name": "PostToolUse", "tool_use_id": "b", "tool_response": "x"});
        assert!(!fold(&mut current, &other, "/p", 150));
        assert_eq!(current.as_ref().unwrap().call.state, ToolCallState::Running);

        let done = json!({"hook_event_name": "PostToolUse", "tool_use_id": "a", "tool_response": {"stdout": "ok"}, "duration_ms": 42});
        assert!(fold(&mut current, &done, "/p", 150));
        let call = current.clone().unwrap().call;
        assert_eq!(
            (call.state, call.duration_ms),
            (ToolCallState::Done, Some(42))
        );
        assert!(call.result.unwrap().contains("ok"));

        fold(
            &mut current,
            &pre("c", "Read", json!({"file_path": "/p/x"})),
            "/p",
            200,
        );
        let failed = json!({"hook_event_name": "PostToolUseFailure", "tool_use_id": "c", "error": "no such file"});
        fold(&mut current, &failed, "/p", 260);
        let call = current.unwrap().call;
        assert_eq!(
            (call.state, call.duration_ms),
            (ToolCallState::Failed, Some(60))
        );
        assert_eq!(call.result.as_deref(), Some("no such file"));
    }

    #[test]
    fn u3780a_long_arguments_and_results_are_cut_with_a_mark() {
        let mut current = None;
        let big = "é".repeat(2_500_000);
        fold(
            &mut current,
            &pre("a", "Bash", json!({"command": big})),
            "/p",
            0,
        );
        let done = json!({"hook_event_name": "PostToolUse", "tool_use_id": "a", "tool_response": "\u{1b}[31m".to_owned() + &big});
        fold(&mut current, &done, "/p", 1);
        let call = current.unwrap().call;
        assert_eq!(call.summary.unwrap().chars().count(), SUMMARY_MAX);
        for text in [call.arguments, call.result.unwrap()] {
            assert!(text.len() <= PAYLOAD_MAX);
            assert!(text.ends_with(" bytes more)") && text.contains("… (cut, "));
            assert!(!text.contains('\u{1b}'));
        }
    }
}
