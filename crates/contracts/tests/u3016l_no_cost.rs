//! U3016l: roundup computes and shows no cost, price or token counts (P14).
use std::path::{Path, PathBuf};

const NAMES: [&str; 12] = [
    "MeasurementCost",
    "ReferenceEstimate",
    "ReportedMoney",
    "WeeklyLimit",
    "currency",
    "cacheRead",
    "cacheWrite",
    "cache_read",
    "cache_write",
    "inputTokens",
    "outputTokens",
    "input_tokens",
];

/// The vendor's context-window fill (LC13) reads the last record's input counts; it is not a
/// cost, a sum or a stored figure, and `scenarios/lean-child-start.md` and `awareness.md` keep it.
const CONTEXT_FILL: [&str; 2] = [
    "crates/agents/src/claude_code/mod.rs",
    "crates/agents/src/claude_code/conversation.rs",
];

fn files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.map(|e| e.unwrap().path()) {
        let name = entry.file_name().unwrap().to_string_lossy().into_owned();
        if name == "node_modules" || name == "target" {
            continue;
        }
        if entry.is_dir() {
            files(&entry, out);
        } else {
            out.push(entry);
        }
    }
}

/// A whole identifier: `cache_read_input_tokens` (the vendor's context fill) is not `cache_read`.
fn has_word(text: &str, word: &str) -> bool {
    let ident = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    text.match_indices(word).any(|(at, _)| {
        !ident(text[..at].chars().next_back()) && !ident(text[at + word.len()..].chars().next())
    })
}

#[test]
fn u3016l_no_cost_or_token_names_remain() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut all = Vec::new();
    files(&root.join("apps/desktop/src"), &mut all);
    files(&root.join("crates/contracts"), &mut all);
    for krate in std::fs::read_dir(root.join("crates")).unwrap() {
        files(&krate.unwrap().path().join("src"), &mut all);
    }
    let mut found = Vec::new();
    for path in all {
        if path.ends_with("u3016l_no_cost.rs") || CONTEXT_FILL.iter().any(|f| path.ends_with(f)) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for name in NAMES {
            if has_word(&text, name) {
                found.push(format!("{}: {name}", path.display()));
            }
        }
    }
    assert!(found.is_empty(), "{found:#?}");
}
