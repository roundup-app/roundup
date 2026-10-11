//! A36: the Models and Efforts Claude Code takes as `--model` and `--effort`. Outside this
//! module an id is opaque (P4); only the tables below know what it means. Read on
//! `claude --version` 2.1.296 from `claude --help` and https://code.claude.com/docs/en/model-config.

/// `(id, label)`: an alias Claude Code resolves to the latest Model of its family.
const MODELS: [(&str, &str); 4] = [
    ("fable", "Fable"),
    ("opus", "Opus"),
    ("sonnet", "Sonnet"),
    ("haiku", "Haiku"),
];

/// `(id, label)`: `claude --help` lists these for `--effort`.
const EFFORTS: [(&str, &str); 5] = [
    ("low", "Low"),
    ("medium", "Medium"),
    ("high", "High"),
    ("xhigh", "Extra high"),
    ("max", "Max"),
];

/// A36: the Models this Adapter offers, as `(id, label)`.
pub fn models() -> &'static [(&'static str, &'static str)] {
    &MODELS
}

/// A36: the Efforts this Adapter offers, as `(id, label)`.
pub fn efforts() -> &'static [(&'static str, &'static str)] {
    &EFFORTS
}

/// A36: the variable Claude Code reads before the settings `model`, and the one it reads before
/// `--effort`. A set value is pinned in both places.
pub const MODEL_VARIABLE: &str = "ANTHROPIC_MODEL";
pub const EFFORT_VARIABLE: &str = "CLAUDE_CODE_EFFORT_LEVEL";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_never_empty() {
        for table in [models(), efforts()] {
            let mut ids: Vec<_> = table.iter().map(|(id, _)| *id).collect();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), table.len());
            assert!(
                table
                    .iter()
                    .all(|(id, label)| !id.is_empty() && !label.is_empty())
            );
        }
    }
}
