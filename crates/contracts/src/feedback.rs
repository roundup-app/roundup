//! U7210c to U7210e (`scenarios/send-feedback.md`): Send feedback… files an Issue through the
//! owner's `gh`; the dialog asks first whether `gh` can.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// U7210c: the owner's text, the shot and the versions line as the dialog showed them.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SendParams {
    pub text: String,
    /// The PNG, base64; absent when the owner turned it off or the capture failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub shot: Option<String>,
    /// The versions line: roundup, herdr-core and macOS.
    pub versions: String,
}

/// U7210c: the Issue `gh` filed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Filed {
    pub number: u32,
    pub url: String,
}

/// U7210e: whether the owner's `gh` can file an Issue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Gh {
    Ready,
    Missing,
    SignedOut,
}

/// U7210d, U7210e: what the dialog needs before it offers Send.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Check {
    pub gh: Gh,
    /// `gh` is 2.103 or newer, so `gh issue create --attach` exists.
    pub attach: bool,
    /// herdr-core's version from its `hello`; absent when no core answered.
    #[serde(rename = "herdrCore", default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub herdr_core: Option<String>,
}
