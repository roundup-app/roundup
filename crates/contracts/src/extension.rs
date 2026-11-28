//! EP3: every frame between rupd and an Extension, and the `Panel`. One definition writes the JSON
//! schemas under `contracts/generated/extension/` (`schemas`) and, through specta, the App's
//! catalogue types. The interface only grows: `tests/ext_accretion.rs` holds it to the snapshots in
//! `contracts/extension/history/`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::collections::BTreeMap;

/// The most characters a `health` note holds.
pub const MAX_NOTE: u32 = 80;

/// The most characters a label, heading or text of a component holds.
pub const MAX_LABEL: u32 = 200;

/// The element kinds roundup draws, as `hello.components` names them.
pub const COMPONENTS: [&str; 7] = [
    "stack", "heading", "text", "row", "chip", "button", "input",
];

/// What an Extension declares it uses (`uses`) and roundup states it offers (`hello`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Type, JsonSchema)]
pub enum Capability {
    #[serde(rename = "panel")]
    Panel,
    #[serde(rename = "service")]
    Service,
    #[serde(rename = "agents.place")]
    AgentsPlace,
    #[serde(rename = "agents.settings")]
    AgentsSettings,
}

/// EP5: what one Extension folder asked (`uses`), what rupd granted it and what waits for the owner.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ExtensionCapabilities {
    pub folder: String,
    pub name: String,
    pub asked: Vec<Capability>,
    pub granted: Vec<Capability>,
    pub waiting: Vec<Capability>,
}

/// `extension.approve`'s params: what the owner's prompt showed, which must still be what the
/// folder's manifest says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ApproveParams {
    pub folder: String,
    pub name: String,
    pub uses: Vec<Capability>,
}

/// How a chip reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Neutral,
    Waiting,
    Fault,
}

/// What a button does when the user presses it: the Extension's action `name` with `args`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct PanelAction {
    #[schemars(length(max = 200))]
    pub name: String,
    #[serde(default)]
    #[specta(type = BTreeMap<String, specta_typescript::Unknown>)]
    pub args: Value,
}

/// One element of a `Panel`: plain text only, no markup, link or image. Children name other
/// elements by id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Element {
    Stack {
        #[serde(default)]
        children: Vec<String>,
    },
    Heading {
        #[schemars(length(max = 200))]
        text: String,
    },
    Text {
        #[schemars(length(max = 200))]
        text: String,
    },
    Row {
        #[schemars(length(max = 200))]
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        #[schemars(length(max = 200))]
        since: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        chip: Option<String>,
        #[serde(default)]
        children: Vec<String>,
    },
    Chip {
        #[schemars(length(max = 200))]
        text: String,
        tone: Tone,
    },
    Button {
        #[schemars(length(max = 200))]
        label: String,
        action: PanelAction,
    },
    Input {
        #[schemars(length(max = 200))]
        label: String,
        #[schemars(length(max = 200))]
        name: String,
    },
}

/// A panel is data: a `root` element id and the `elements` by id, drawn by roundup's own components.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Panel {
    pub root: String,
    pub elements: BTreeMap<String, Element>,
}

/// Why roundup did not draw a panel.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Refused {
    pub code: String,
    pub cause: String,
}

/// An error the host answers a `call` with.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct CallError {
    #[specta(type = specta_typescript::Number)]
    pub code: i64,
    pub message: String,
}

/// Why roundup stops an Extension.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum StopReason {
    User,
    Reload,
    Rupd,
}

/// Who pressed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum By {
    User,
}

/// Through what the press came.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    App,
}

/// A frame an Extension writes, one JSON line, `t` naming it. A reader ignores a `t` it does not know.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum FromExtension {
    /// `register` finished: the declared actions.
    Registered {
        #[serde(default)]
        #[specta(type = Vec<BTreeMap<String, specta_typescript::Unknown>>)]
        actions: Vec<Value>,
    },
    /// A `$` call for the host to answer.
    Call {
        #[specta(type = specta_typescript::Number)]
        id: u64,
        path: String,
        #[serde(default)]
        #[specta(type = specta_typescript::Unknown)]
        params: Value,
    },
    /// One run's end.
    Result {
        #[specta(type = specta_typescript::Number)]
        id: u64,
        #[serde(default)]
        #[specta(type = specta_typescript::Unknown)]
        answer: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        failure: Option<String>,
    },
    /// `register` threw.
    Failed {
        #[serde(default)]
        cause: String,
    },
    /// The panel to draw for Ask `ask`.
    Show { ask: u32, panel: Panel },
    /// A line of the Extension's own state.
    Health {
        #[schemars(length(max = 80))]
        note: String,
    },
}

/// A frame roundup writes to an Extension. An Extension ignores a `t` it does not know.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum ToExtension {
    /// What roundup offers, what this Extension is granted and the component kinds it draws.
    Hello {
        offers: Vec<Capability>,
        granted: Vec<Capability>,
        components: Vec<String>,
    },
    /// Run the action `name`.
    Run {
        #[specta(type = specta_typescript::Number)]
        id: u64,
        name: String,
        #[specta(type = BTreeMap<String, specta_typescript::Unknown>)]
        args: Value,
    },
    /// The answer of a `call`: `result`, or `error`.
    CallResult {
        #[specta(type = specta_typescript::Number)]
        id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = specta_typescript::Unknown)]
        result: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        error: Option<CallError>,
    },
    /// The answer of a `show`: `render`, or `refused`.
    Shown {
        ask: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        render: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        refused: Option<Refused>,
    },
    /// The user pressed a button of render `render`.
    Click {
        id: String,
        render: String,
        element: String,
        action: String,
        #[specta(type = BTreeMap<String, specta_typescript::Unknown>)]
        args: Value,
        #[specta(type = BTreeMap<String, specta_typescript::Unknown>)]
        inputs: Value,
        by: By,
        via: Via,
    },
    /// The Extension ends.
    Stop { reason: StopReason },
}

/// The schemas of both directions, `(from_extension, to_extension)`, as
/// `contracts/generated/extension/{fromExtension,toExtension}.schema.json` hold them. Prose is
/// left out, so editing a doc comment is no change of the interface.
#[must_use]
pub fn schemas() -> (Value, Value) {
    fn bare(mut schema: Value) -> Value {
        fn strip(value: &mut Value) {
            match value {
                Value::Object(map) => {
                    if map.get("description").is_some_and(Value::is_string) {
                        map.remove("description");
                    }
                    map.values_mut().for_each(strip);
                }
                Value::Array(items) => items.iter_mut().for_each(strip),
                _ => {}
            }
        }
        strip(&mut schema);
        schema
    }
    (
        bare(schemars::schema_for!(FromExtension).to_value()),
        bare(schemars::schema_for!(ToExtension).to_value()),
    )
}
