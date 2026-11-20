//! CP1 to CP4: what `agent.callPaths` returns, read from the project's language server.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::CompareTarget;

/// `agent.callPaths` params (CP1): without `language` the reply lists the languages.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CallPathsParams {
    pub id: String,
    #[serde(default)]
    #[specta(optional, type = CompareTarget)]
    pub to: CompareTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub language: Option<String>,
}

/// The server found for a language: `name` and `version` when `found`, else `cause`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ServerLookup {
    pub found: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = CallPathCause)]
    pub cause: Option<CallPathCause>,
}

/// Why a language has no answer: `kind` is `notInstalled`, `predates`, `noCallHierarchy`,
/// `timeout` or `error`; `detail` says it in words.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct CallPathCause {
    pub kind: String,
    pub detail: String,
}

/// One language the changed files hold (CP1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct LanguageRow {
    pub language: String,
    pub files: u32,
    pub server: ServerLookup,
}

/// Lines `start` to `end` of a file, 1-based and inclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct LineSpan {
    pub start: u32,
    pub end: u32,
}

/// `added` (new side only), `removed` (old side only), `changed` (both sides) or, for a call,
/// `unchanged` (both sides, off a changed line).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CallStatus {
    Added,
    Removed,
    Changed,
    Unchanged,
}

/// A changed symbol (CP2). `key` is `path#containers#name#kind`, never a line.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ChangedSymbol {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub old: Option<LineSpan>,
    pub new: Option<LineSpan>,
    pub status: CallStatus,
    pub callable: bool,
}

/// One call of a changed function (CP3), keyed by the other function's symbol key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Call {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub status: CallStatus,
}

/// The calls of one changed function: `outgoing` in call-site order, `incoming` without its
/// unchanged calls, which `incoming_unchanged` counts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct FunctionCalls {
    pub key: String,
    pub outgoing: Vec<Call>,
    pub incoming: Vec<Call>,
    pub incoming_unchanged: u32,
}

/// A node of a flow's tree (CP4): a changed function a call reaches, `cycle` when it repeats
/// an ancestor and so ends there.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct FlowNode {
    pub key: String,
    pub status: CallStatus,
    pub cycle: bool,
    pub calls: Vec<FlowNode>,
}

/// One entry point (a changed function with no changed caller) and what it calls (CP4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Flow {
    pub entry: String,
    pub tree: FlowNode,
    pub capped: bool,
}

/// What `agent.callPaths` returns (CP1): the languages, or one language's answer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(untagged)]
pub enum CallPaths {
    Languages(Languages),
    Answer(CallPathsAnswer),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Languages {
    pub languages: Vec<LanguageRow>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum CallPathsAnswer {
    #[serde(rename_all = "camelCase")]
    Done {
        symbols: Vec<ChangedSymbol>,
        calls: Vec<FunctionCalls>,
        flows: Vec<Flow>,
        capped: bool,
        old_side_resolved_through_new_dependencies: bool,
    },
    NoServer {
        cause: CallPathCause,
    },
    Failed {
        cause: CallPathCause,
    },
}
