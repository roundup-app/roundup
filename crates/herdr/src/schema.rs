//! MC72: what a test build checks every request against: the `params` that the pinned schema names
//! for the request's method. A request with a key the schema lacks, without a key it requires, or
//! for a method it holds no params for fails as the core's own `invalid_params` would, so a fake
//! core that reads other keys cannot make it pass. Only keys are checked: the pinned params use
//! `properties`, `required` and an `anyOf` of `required` lists, and no other keyword.

use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::error::{Error, RpcError};

const PINNED: &str = include_str!("../schema/herdr-core-0.1.21.json");

/// JSON-RPC's code for params the method does not take.
const INVALID_PARAMS: i64 = -32602;

fn pinned() -> &'static Value {
    static SCHEMA: OnceLock<Value> = OnceLock::new();
    SCHEMA.get_or_init(|| serde_json::from_str(PINNED).unwrap_or(Value::Null))
}

/// The key names in a `required` list; none when `list` is absent.
fn names(list: Option<&Value>) -> impl Iterator<Item = &str> {
    list.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

/// `Ok` when the pinned schema lets `method` take `params`.
pub(crate) fn check(method: &str, params: &Value) -> Result<(), Error> {
    let refuse = |why: String| {
        Error::Rpc(RpcError {
            code: INVALID_PARAMS,
            message: format!("{method}: {why}"),
            kind: "invalid_params".into(),
            hint: "see params of the method in crates/herdr/schema".into(),
        })
    };
    let Some(allowed) = pinned().pointer(&format!("/methods/{method}/params")) else {
        return Err(refuse("the pinned schema holds no params for it".into()));
    };
    let Some(given) = params.as_object() else {
        return Err(refuse("params are not an object".into()));
    };
    let has = |key: &str| given.contains_key(key);
    let known: Option<&Map<String, Value>> = allowed.get("properties").and_then(Value::as_object);
    let missing: Vec<&str> = names(allowed.get("required"))
        .filter(|key| !has(key))
        .collect();
    let unknown: Vec<&str> = given
        .keys()
        .map(String::as_str)
        .filter(|key| !known.is_some_and(|known| known.contains_key(*key)))
        .collect();
    let alternatives = allowed.get("anyOf").and_then(Value::as_array);
    let unmet =
        alternatives.is_some_and(|all| !all.iter().any(|one| names(one.get("required")).all(has)));
    if missing.is_empty() && unknown.is_empty() && !unmet {
        return Ok(());
    }
    let mut why = Vec::new();
    if !missing.is_empty() {
        why.push(format!("missing {}", missing.join(", ")));
    }
    if !unknown.is_empty() {
        why.push(format!("unknown {}", unknown.join(", ")));
    }
    if unmet {
        let wanted: Vec<&str> = alternatives
            .into_iter()
            .flatten()
            .flat_map(|one| names(one.get("required")))
            .collect();
        why.push(format!("needs one of {}", wanted.join(", ")));
    }
    Err(refuse(why.join("; ")))
}
