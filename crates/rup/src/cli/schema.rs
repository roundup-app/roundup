//! The input schema of a tool, read as clap arguments: its fields and the kind of each.

use rmcp::model::JsonObject;
use serde_json::Value;

/// What a field of a tool's input schema holds.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Kind {
    Text(Vec<String>),
    Int,
    Number,
    Bool,
    Array(Box<Kind>),
    /// An object, or anything the schema leaves open: the value is JSON.
    Json,
}

#[derive(Clone, Debug)]
pub(super) struct Field {
    /// The schema's name, which the Daemon's params use.
    pub(super) name: String,
    pub(super) kind: Kind,
    pub(super) required: bool,
    /// A positional argument; any other field is `--<name>` in kebab-case.
    pub(super) positional: bool,
    pub(super) doc: String,
}

impl Field {
    pub(super) fn flag(&self) -> String {
        kebab(&self.name)
    }
}

pub(super) fn kebab(name: &str) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_uppercase() {
            out.push('-');
            out.push(ch.to_ascii_lowercase());
        } else if ch == '_' {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    out
}

pub(super) fn resolve<'a>(node: &'a Value, root: &'a Value) -> &'a Value {
    let target = node
        .get("$ref")
        .and_then(Value::as_str)
        .and_then(|reference| reference.strip_prefix('#'))
        .and_then(|pointer| root.pointer(pointer))
        .or_else(|| {
            node.get("allOf")
                .and_then(Value::as_array)
                .filter(|all| all.len() == 1)
                .map(|all| &all[0])
        });
    target.map_or(node, |target| resolve(target, root))
}

/// The kind of a schema node, and whether `null` is one of its values.
pub(super) fn kind_of(node: &Value, root: &Value) -> (Kind, bool) {
    let node = resolve(node, root);
    let mut nullable = false;
    for key in ["anyOf", "oneOf"] {
        let Some(branches) = node.get(key).and_then(Value::as_array) else {
            continue;
        };
        let (nulls, rest): (Vec<_>, Vec<_>) = branches
            .iter()
            .partition(|branch| branch.get("type").and_then(Value::as_str) == Some("null"));
        nullable |= !nulls.is_empty();
        if let [only] = rest[..] {
            return (kind_of(only, root).0, nullable);
        }
        let choices: Option<Vec<String>> = rest
            .iter()
            .map(|branch| {
                branch
                    .get("const")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .collect();
        return match choices {
            Some(choices) if !choices.is_empty() => (Kind::Text(choices), nullable),
            _ => (Kind::Json, nullable),
        };
    }
    if let Some(choices) = node.get("enum").and_then(Value::as_array) {
        let names: Vec<String> = choices
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        nullable |= choices.iter().any(Value::is_null);
        if !names.is_empty() {
            return (Kind::Text(names), nullable);
        }
    }
    let types: Vec<&str> = match node.get("type") {
        Some(Value::String(one)) => vec![one],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    };
    nullable |= types.contains(&"null");
    let types: Vec<&str> = types.into_iter().filter(|t| *t != "null").collect();
    let kind = match types[..] {
        ["string"] => Kind::Text(Vec::new()),
        ["integer"] => Kind::Int,
        ["number"] => Kind::Number,
        ["boolean"] => Kind::Bool,
        ["array"] => Kind::Array(Box::new(
            node.get("items")
                .map_or(Kind::Json, |items| kind_of(items, root).0),
        )),
        _ => Kind::Json,
    };
    (kind, nullable)
}

/// I1: a required string or integer is a positional argument in schema order; every other field is a flag.
pub(super) fn fields_of(schema: &JsonObject) -> Vec<Field> {
    let root = Value::Object(schema.clone());
    let required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let Some(Value::Object(properties)) = schema.get("properties") else {
        return Vec::new();
    };
    let mut fields: Vec<Field> = properties
        .iter()
        .map(|(name, node)| {
            let (kind, nullable) = kind_of(node, &root);
            let required = required.contains(&name.as_str()) && !nullable;
            let positional = required && matches!(kind, Kind::Text(_) | Kind::Int | Kind::Number);
            let doc = resolve(node, &root)
                .get("description")
                .or_else(|| node.get("description"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            Field {
                name: name.clone(),
                kind,
                required,
                positional,
                doc,
            }
        })
        .collect();
    // Positionals first, in the order `required` lists them.
    fields.sort_by_key(|field| {
        if field.positional {
            required.iter().position(|name| *name == field.name)
        } else {
            None
        }
        .map_or((1, 0), |at| (0, at))
    });
    fields
}
