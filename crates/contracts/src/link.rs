//! Links (LK1–LK3, `scenarios/rup-ext.md`): `link.read` returns the object a `roundup://` URL names.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agent::{Digest, RailNode};
use crate::pad::Pad;
use crate::terminal::Screen;
use crate::todo::Todo;

/// `roundup://<kind>/<id>?project=<key>`, `<kind>` one of `pad`, `todo`, `agent`, `workstream`, `terminal`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "link/")]
pub struct LinkUrl {
    pub url: String,
}

/// LK2: the object's content now, composed from the method that reads that kind. A Door's
/// `digest` is `null` for an Agent that is no Door.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "link/")]
pub enum LinkContent {
    Pad {
        id: String,
        pad: Pad,
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
