use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ActorKind {
    User,
    Agent,
    Ext,
}

/// Who makes a call. `parent` is the Agent that started it, if any.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
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

/// Generate the shared Agent time rule from its Rust definition.
pub fn render_agent_time_typescript() -> String {
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
    text
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Status {
    pub kind: Kind,
    pub label: String,
    /// Milliseconds since the Unix epoch.
    #[specta(type = specta_typescript::Number)]
    pub since: i64,
    /// U3566c: a canonical nonnegative decimal counting the Agent's published finishes (direct
    /// `working` to `idle` or `done` transitions); `"0"` for a Workstream aggregate.
    pub finished: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum Verb {
    Read,
    Wrote,
}

/// One logged read or write of a Todo, Pad or Agent order. `item` is `todo:<id>`, `pad:<name>` or `agent:<id>`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Touch {
    pub actor: Actor,
    pub verb: Verb,
    pub item: String,
    #[specta(type = specta_typescript::Number)]
    pub at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct IdentifyParams {
    pub actor: Actor,
}

/// `events.subscribe`'s answer: the highest Event number saved when it was accepted, 0 for an empty log (I9).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct SubscribeResult {
    #[specta(type = specta_typescript::Number)]
    pub head: u64,
}

/// `events.subscribe`: with `after`, replay every saved Event numbered above it, then stream live (D11).
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type, JsonSchema)]
pub struct SubscribeParams {
    #[serde(default)]
    #[specta(optional, type = specta_typescript::Number)]
    pub after: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct HistoryParams {
    pub item: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct TouchedParams {
    pub actor_id: String,
}

/// The existing daemon.ping reply; its literal true marker never changes the wire boolean.
#[derive(Serialize, Deserialize, Type)]
pub struct Ping {
    #[specta(type = Pong)]
    pub pong: bool,
    pub pid: u32,
    pub project: String,
    #[serde(rename = "projectKey")]
    pub project_key: String,
    pub contract: ContractFingerprint,
}

#[derive(Serialize, Deserialize, Type)]
pub struct ContractFingerprint {
    pub fingerprint: String,
}

struct Pong;
impl Type for Pong {
    fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
        specta::datatype::DataType::Reference(specta_typescript::define("true"))
    }
}

/// Structured JSON-RPC error data a caller acts on: Event replay recovery, or a link another Project owns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RpcErrorData {
    EventsExpired {
        /// The oldest Event number the authoritative log still retains.
        #[specta(type = specta_typescript::Number)]
        oldest: u64,
    },
    /// `link.read` names an object of another Project; the Daemon of the link's Project answers it.
    OtherProject,
}
