use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ActorKind {
    User,
    Agent,
    Ext,
}

/// Who makes a call. `parent` is the Agent that started it, if any.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export)]
pub struct Actor {
    pub kind: ActorKind,
    pub id: String,
    pub parent: Option<String>,
}

impl Actor {
    pub fn user() -> Self {
        Self {
            kind: ActorKind::User,
            id: "you".into(),
            parent: None,
        }
    }

    /// The Daemon itself, for events no client call caused.
    pub fn daemon() -> Self {
        Self {
            kind: ActorKind::Ext,
            id: "rupd".into(),
            parent: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum Kind {
    Error,
    NeedsYou,
    Blocked,
    Working,
    Idle,
    Done,
}

impl Kind {
    /// U3768b/U3016c: only an unended Attempt outside idle/done contributes Agent time.
    pub fn counts_time(self, ended: bool) -> bool {
        !ended && !matches!(self, Self::Idle | Self::Done)
    }
}

#[cfg(test)]
mod time_contract {
    #[test]
    fn writes_agent_time_typescript() {
        use super::Kind;
        let kinds = [
            Kind::Error,
            Kind::NeedsYou,
            Kind::Blocked,
            Kind::Working,
            Kind::Idle,
            Kind::Done,
        ];
        let rows: Vec<_> = kinds
            .iter()
            .map(|kind| {
                format!(
                    "  {}: [{}, {}]",
                    serde_json::to_string(kind).unwrap(),
                    kind.counts_time(false),
                    kind.counts_time(true)
                )
            })
            .collect();
        let text = format!(
            "// Generated from contracts::Kind::counts_time; do not edit.\nimport type {{ Kind }} from './Kind';\n\nconst counts = {{\n{}\n}};\n\nexport const countsTime = (kind: Kind, ended: boolean): boolean => counts[kind][ended ? 1 : 0]!;\n",
            rows.join(",\n")
        );
        std::fs::write(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../contracts/generated/agentTime.ts"
            ),
            text,
        )
        .unwrap();
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Status {
    pub kind: Kind,
    pub label: String,
    /// Milliseconds since the Unix epoch.
    #[ts(type = "number")]
    pub since: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum Verb {
    Read,
    Wrote,
}

/// One logged read or write of a Todo, Pad or Agent order. `item` is `todo:<id>`, `pad:<name>` or `agent:<id>`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Touch {
    pub actor: Actor,
    pub verb: Verb,
    pub item: String,
    #[ts(type = "number")]
    pub at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IdentifyParams {
    pub actor: Actor,
}

/// `events.subscribe`'s answer: the highest Event number saved when it was accepted, 0 for an empty log (I9).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SubscribeResult {
    #[ts(type = "number")]
    pub head: u64,
}

/// `events.subscribe`: with `after`, replay every saved Event numbered above it, then stream live (D11).
#[derive(Clone, Debug, Default, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export)]
pub struct SubscribeParams {
    #[serde(default)]
    #[ts(optional, type = "number")]
    pub after: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export)]
pub struct HistoryParams {
    pub item: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export)]
pub struct TouchedParams {
    pub actor_id: String,
}
