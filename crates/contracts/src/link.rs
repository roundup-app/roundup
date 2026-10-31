//! Links (LK1–LK3, `scenarios/rup-ext.md`): `link.read` returns the object a `roundup://` URL names.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::agent::{Digest, RailNode};
use crate::deliverable::{Deliverable, Resolution};
use crate::pad::Pad;
use crate::terminal::Screen;
use crate::todo::Todo;

/// `roundup://<kind>/<id>?project=<key>`, `<kind>` one of `pad`, `todo`, `agent`, `workstream`, `terminal`, `deliverable`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct LinkUrl {
    pub url: String,
}

/// LK4: a Pad heading as the Pad writes it and the text under it.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct Section {
    pub heading: String,
    pub text: String,
}

/// LK2: the object's content now, composed from the method that reads that kind. A Door's
/// `digest` is `null` for an Agent that is no Door. DV6 publication links resolve the recorded
/// revision or explicit current external target, rather than the mutable authoring source.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LinkContent {
    Deliverable {
        record: Deliverable,
        resolution: Resolution,
    },
    Pad {
        id: String,
        pad: Pad,
        /// LK4: the section a `#<heading>` link names; absent for a link to the whole Pad.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = Section)]
        section: Option<Section>,
    },
    Todo {
        id: String,
        todo: Todo,
    },
    Agent {
        id: String,
        node: RailNode,
        digest: Option<Digest>,
    },
    Workstream {
        id: String,
        node: RailNode,
        children: Vec<String>,
    },
    Terminal {
        id: String,
        screen: Screen,
    },
}
