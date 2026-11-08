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
                    tool: cleaned(tool, 64, false),
                    summary: summary(tool, input, root),
                    arguments: preview(input),
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
            let result = if failed && payload["error"].is_string() {
                &payload["error"]
            } else {
                &payload["tool_response"]
            };
            let call = &mut tracked.call;
            call.state = if failed {
                ToolCallState::Failed
            } else {
                ToolCallState::Done
            };
            call.result = Some(preview(result));
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

fn preview(value: &Value) -> String {
    let mut sink = Cleaned::new(Limit::Preview, false);
    match value {
        Value::Null => {}
        Value::String(text) => sink.push_bytes(text.as_bytes()),
        other => sink.push_bytes(format!("{other:#}").as_bytes()),
    }
    sink.finish_preview()
}

fn summary(tool: &str, input: &Value, root: &str) -> Option<String> {
    let field = |names: &[&str]| names.iter().find_map(|name| input[*name].as_str());
    let line = match tool {
        "Bash" => field(&["command"])?,
        "Read" | "Edit" | "Write" => relative(field(&["file_path"])?, root),
        "Grep" | "Glob" => field(&["pattern"])?,
        "WebSearch" => field(&["query"])?,
        "WebFetch" => field(&["url", "query"])?,
        _ => return None,
    };
    let mut line = cleaned(line, SUMMARY_MAX, true);
    line.truncate(line.trim_end().len());
    (!line.is_empty()).then_some(line)
}

fn relative<'a>(path: &'a str, root: &str) -> &'a str {
    let root = root.trim_end_matches('/');
    match path.strip_prefix(root) {
        Some(rest) if !root.is_empty() && rest.starts_with('/') => &rest[1..],
        _ => path,
    }
}

fn cleaned(text: &str, max: usize, whitespace: bool) -> String {
    let mut sink = Cleaned::new(Limit::Characters(max), whitespace);
    sink.push_bytes(text.as_bytes());
    sink.text
}

/// B5635b: retain only the wire prefix while scanning discarded bytes for the exact cut mark.
/// The UTF-8 and escape states survive Serde writer chunk boundaries.
enum Limit {
    Preview,
    Characters(usize),
}

struct Cleaned {
    text: String,
    total: usize,
    chars: usize,
    limit: Limit,
    whitespace: bool,
    space: bool,
    escape: u8,
    utf8: [u8; 4],
    used: usize,
}

impl Cleaned {
    fn new(limit: Limit, whitespace: bool) -> Self {
        let capacity = match limit {
            Limit::Preview => PAYLOAD_MAX,
            Limit::Characters(max) => max,
        };
        Self {
            text: String::with_capacity(capacity),
            total: 0,
            chars: 0,
            limit,
            whitespace,
            space: false,
            escape: 0,
            utf8: [0; 4],
            used: 0,
        }
    }

    fn character(&mut self, c: char) {
        match self.escape {
            1 => {
                self.escape = match c {
                    '[' => 2,
                    ']' | 'P' | '_' | '^' | 'X' => 3,
                    _ => 0,
                };
                return;
            }
            2 => {
                if ('@'..='~').contains(&c) {
                    self.escape = 0;
                }
                return;
            }
            3 => {
                if c == '\u{7}' {
                    self.escape = 0;
                } else if c == '\u{1b}' {
                    self.escape = 4;
                }
                return;
            }
            4 => {
                self.escape = 0;
                if c == '\\' {
                    return;
                }
            }
            _ => {}
        }
        if c == '\u{1b}' {
            self.escape = 1;
            return;
        }
        if c.is_control() && c != '\n' && c != '\t' {
            return;
        }
        self.total += c.len_utf8();
        if self.whitespace {
            if c.is_whitespace() {
                self.space = self.chars > 0;
                return;
            }
            if self.space && self.chars < SUMMARY_MAX {
                self.text.push(' ');
                self.chars += 1;
            }
            self.space = false;
        }
        match self.limit {
            Limit::Characters(max) if self.chars < max => {
                self.text.push(c);
                self.chars += 1;
            }
            Limit::Preview if self.total <= PAYLOAD_MAX => self.text.push(c),
            _ => {}
        }
    }

    fn finish_preview(mut self) -> String {
        if self.total > PAYLOAD_MAX {
            let mut end = PAYLOAD_MAX - MARK_ROOM;
            while !self.text.is_char_boundary(end) {
                end -= 1;
            }
            self.text.truncate(end);
            let more = self.total - end;
            self.text.push_str(&format!("… (cut, {more} bytes more)"));
        }
        self.text
    }
}

impl Cleaned {
    fn push_bytes(&mut self, bytes: &[u8]) {
        if self.used == 0
            && self.escape == 0
            && matches!(self.limit, Limit::Preview)
            && bytes
                .iter()
                .all(|b| matches!(b, b'\n' | b'\t' | 0x20..=0x7e))
        {
            let keep = bytes.len().min(PAYLOAD_MAX.saturating_sub(self.total));
            self.text
                .extend(bytes.iter().take(keep).map(|&b| char::from(b)));
            self.total += bytes.len();
            return;
        }
        if self.used == 0
            && let Ok(text) = std::str::from_utf8(bytes)
        {
            for c in text.chars() {
                self.character(c);
                if matches!(self.limit, Limit::Characters(max) if self.chars >= max) {
                    break;
                }
            }
            return;
        }
        for &byte in bytes {
            let Some(slot) = self.utf8.get_mut(self.used) else {
                self.used = 0;
                continue;
            };
            *slot = byte;
            self.used += 1;
            if let Some(Ok(text)) = self.utf8.get(..self.used).map(std::str::from_utf8)
                && let Some(c) = text.chars().next()
            {
                self.used = 0;
                self.character(c);
            }
        }
    }
}

impl std::io::Write for Cleaned {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.push_bytes(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn measured<T>(operation: impl FnOnce() -> T) -> (T, usize) {
        // Require process-per-test isolation: global counters must never include other tests.
        assert!(
            std::env::var_os("NEXTEST").is_some(),
            "run allocation observers with cargo nextest"
        );
        let region = stats_alloc::Region::new(crate::ALLOCATOR);
        let result = operation();
        (result, region.change().bytes_allocated)
    }

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
    fn b5635b_preview_allocations_stay_bounded() {
        for size in [4096, 65536, 1048576, 5242880] {
            for input in [
                json!("x".repeat(size)),
                json!({"command": "é ".repeat(size / 3)}),
            ] {
                let payload = pre("a", "Bash", input);
                let mut current = None;
                let (_, bytes) = measured(|| fold(&mut current, &payload, "/p", 0));
                assert!(
                    bytes <= 128 * 1024,
                    "pre {size}: allocated {bytes}, bound 128 KiB"
                );
                let response = payload["tool_input"].clone();
                for (event, field) in [
                    ("PostToolUse", "tool_response"),
                    ("PostToolUseFailure", "error"),
                    ("PostToolUseFailure", "tool_response"),
                ] {
                    let mut payload = json!({"hook_event_name": event, "tool_use_id": "a"});
                    payload[field] = if field == "error" {
                        json!("x".repeat(size))
                    } else {
                        response.clone()
                    };
                    fold(&mut current, &pre("a", "Bash", json!(null)), "/p", 0);
                    let (_, bytes) = measured(|| fold(&mut current, &payload, "/p", 1));
                    assert!(
                        bytes <= 128 * 1024,
                        "{event}/{field} {size}: allocated {bytes}, bound 128 KiB"
                    );
                }
            }
        }
    }

    #[test]
    fn b5635b_truncated_summaries_have_no_trailing_whitespace() {
        for character in ["x", "é"] {
            let prefix = character.repeat(199);
            let mut current = None;
            fold(
                &mut current,
                &pre("a", "Bash", json!({"command": format!("{prefix} y")})),
                "/p",
                0,
            );
            assert_eq!(current.unwrap().call.summary, Some(prefix));
        }
    }

    #[test]
    fn b5635b_preview_preserves_cleaned_serialization() {
        for (input, expected) in [
            (json!(null), ""),
            (json!("é\n\t\r\u{0}x"), "é\n\tx"),
            (
                json!({"a":[1,true]}),
                "{\n  \"a\": [\n    1,\n    true\n  ]\n}",
            ),
            (json!(["é", null]), "[\n  \"é\",\n  null\n]"),
            (
                json!("a\u{1b}[31mb\u{1b}]title\u{7}c\u{1b}Pdata\u{1b}\\d"),
                "abcd",
            ),
            (json!("a\u{1b}_hidden\u{1b}xb\u{1b}[31"), "axb"),
        ] {
            assert_eq!(preview(&input), expected);
        }
        for text in [
            "é\u{1b}[31m好\u{1b}]hide\u{1b}\\x",
            "a\u{1b}Pgone\u{1b}xb\n\t",
            " a  \n 好 ",
        ] {
            let expected = preview(&json!(text));
            for split in 0..=text.len() {
                let mut sink = Cleaned::new(Limit::Preview, false);
                use std::io::Write;
                sink.write_all(&text.as_bytes()[..split]).unwrap();
                sink.write_all(&text.as_bytes()[split..]).unwrap();
                assert_eq!(sink.finish_preview(), expected);
            }
            let mut sink = Cleaned::new(Limit::Preview, false);
            for byte in text.as_bytes() {
                std::io::Write::write_all(&mut sink, &[*byte]).unwrap();
            }
            assert_eq!(sink.finish_preview(), expected);
        }
        assert_eq!(
            summary("Bash", &json!({"command":"  é \t 好\n x "}), "/"),
            Some("é 好 x".into())
        );
        assert_eq!(
            summary("Read", &json!({"file_path":"/a"}), "/"),
            Some("/a".into())
        );
        assert_eq!(
            summary("Read", &json!({"file_path":"/p/a"}), "/p/"),
            Some("a".into())
        );
        for split in 0..="  é \n\t 好  x ".len() {
            let bytes = "  é \n\t 好  x ".as_bytes();
            let mut sink = Cleaned::new(Limit::Characters(SUMMARY_MAX), true);
            std::io::Write::write_all(&mut sink, &bytes[..split]).unwrap();
            std::io::Write::write_all(&mut sink, &bytes[split..]).unwrap();
            assert_eq!(sink.text, "é 好 x");
        }
        assert_eq!(
            preview(&json!(
                "a\u{1b}^hidden\u{7}b\u{1b}Xhidden\u{1b}\\c\u{1b}]unfinished"
            )),
            "abc"
        );
        let text = "é".repeat(3000);
        assert_eq!(
            preview(&json!(text)),
            format!("{}… (cut, 1952 bytes more)", "é".repeat(2024))
        );
        for chunk in [1, 3, 4047, 4096] {
            let raw = "\u{1b}[31m".to_owned() + &"é".repeat(3000);
            let mut sink = Cleaned::new(Limit::Preview, false);
            for bytes in raw.as_bytes().chunks(chunk) {
                std::io::Write::write_all(&mut sink, bytes).unwrap();
            }
            assert_eq!(
                sink.finish_preview(),
                format!("{}… (cut, 1952 bytes more)", "é".repeat(2024))
            );
        }
        let mut current = None;
        fold(
            &mut current,
            &pre(
                "name",
                &("\u{1b}[31m".to_owned() + &"é".repeat(100)),
                json!(null),
            ),
            "/p",
            0,
        );
        assert_eq!(current.unwrap().call.tool, "é".repeat(64));
        assert_eq!(preview(&json!("uncut é")), "uncut é");
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
        assert_eq!(
            call.arguments,
            format!(
                "{{\n  \"command\": \"{}… (cut, 4995971 bytes more)",
                "é".repeat(2016)
            )
        );
        assert_eq!(
            call.result.unwrap(),
            format!("{}… (cut, 4995952 bytes more)", "é".repeat(2024))
        );
    }
}
