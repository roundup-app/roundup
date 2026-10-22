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

use contracts::agent::Extras;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A36: the Model and Effort an Agent is started on; `None` is passed to nothing, so the user's
/// own Claude Code default applies.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Pair {
    pub yolo: bool,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// M2219: launch with no roundup MCP server; false (the default) keeps it.
    pub mcp_off: bool,
    /// LC2, LC4, LC7: a child a Door or an Agent started launches lean; `None` is an Agent the
    /// user started, which keeps the user's full setup (LC6). A Door is always lean.
    pub lean: Option<Lean>,
}

/// What distinguishes a lean child within its Role, kept in the Project's data folder beside its
/// settings so that every resume launches the same.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lean {
    /// LC4: a scout, not a worker.
    #[serde(default)]
    pub scout: bool,
    /// LC7, LC8: the extras its Door named.
    #[serde(default)]
    pub extras: Extras,
    /// LC8: the next launch applies a changed Brief, so it passes `--system-prompt-snapshot off`.
    #[serde(default)]
    pub fresh_brief: bool,
}

impl Pair {
    /// A36: the variables that pin a set value above whatever the Daemon's environment holds,
    /// since Claude Code reads them before the flag and before the settings `model`.
    pub fn env(&self) -> BTreeMap<String, String> {
        [
            (super::models::MODEL_VARIABLE, &self.model),
            (super::models::EFFORT_VARIABLE, &self.effort),
        ]
        .into_iter()
        .filter_map(|(name, value)| Some((name.to_owned(), value.clone()?)))
        .collect()
    }
}
