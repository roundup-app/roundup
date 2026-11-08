//! MC45, MC46: the words that name an attention rule, a second surface or an interruption. A
//! Config file or an Extension call using one is refused, so no file changes when the user is
//! interrupted or what sits in the centre.

/// Words of an attention rule: the centre, who may ask the user, alerts, the shelf.
const ATTENTION: [&str; 11] = [
    "alert",
    "alerts",
    "alertlevel",
    "message",
    "messages",
    "route",
    "routes",
    "held",
    "centre",
    "center",
    "shelf",
];
/// Words of a second matter beside the centre or an interruption outside the user's alerts.
const SURFACE: [&str; 10] = [
    "panel",
    "sidebar",
    "bell",
    "notification",
    "notifications",
    "toast",
    "toasts",
    "badge",
    "sound",
    "sounds",
];

/// Why `name` (a key, an action name, a call path or a topic) is refused, or `None`. It is read
/// as words, split at punctuation and camelCase humps, so `alertLevel`, `rail.setAlertLevel` and
/// `pr-panel` match while `trail` or `todo.add` do not.
pub(crate) fn refusal(name: &str) -> Option<&'static str> {
    let mut words = Vec::new();
    let mut word = String::new();
    for c in name.chars() {
        if !c.is_alphanumeric() || (c.is_uppercase() && !word.is_empty()) {
            words.extend(Some(std::mem::take(&mut word)).filter(|w| !w.is_empty()));
        }
        if c.is_alphanumeric() {
            word.extend(c.to_lowercase());
        }
    }
    words.extend(Some(word).filter(|w| !w.is_empty()));
    let any = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
    let rail_level = words.iter().any(|w| w == "rail") && words.iter().any(|w| w == "level");
    if any(&ATTENTION) || rail_level || name.to_lowercase().contains("alertlevel") {
        Some("attention rules are not customisable")
    } else if any(&SURFACE) {
        Some("a second surface or an interruption is not customisable")
    } else {
        None
    }
}

/// The first key at any depth of `value` that is refused, as `key: cause`.
pub(crate) fn refused_key(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Object(map) => map.iter().find_map(|(key, inner)| {
            refusal(key)
                .map(|cause| format!("{key}: {cause}"))
                .or_else(|| refused_key(inner))
        }),
        serde_json::Value::Array(items) => items.iter().find_map(refused_key),
        _ => None,
    }
}
