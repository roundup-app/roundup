//! I10: what the Daemon says about its own methods, from the declaration table and the types.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use specta::Type;

/// One declared method as the declaration table holds it.
pub(crate) struct Declared {
    pub name: &'static str,
    pub description: &'static str,
    pub params: fn() -> Value,
    pub result: fn() -> Value,
}

pub(crate) fn schema_of<T: JsonSchema>() -> Value {
    serde_json::to_value(schemars::schema_for!(T)).expect("a schema is JSON")
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MethodSummary {
    pub name: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MethodList {
    pub methods: Vec<MethodSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct DescribeParams {
    pub method: String,
}

/// A call that validates against the method's `params` schema and the reply that validates against its `result`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MethodExample {
    #[specta(type = specta_typescript::Unknown)]
    pub params: Value,
    #[specta(type = specta_typescript::Unknown)]
    pub result: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MethodDescription {
    pub name: String,
    pub summary: String,
    pub description: String,
    /// JSON Schema documents.
    #[specta(type = specta_typescript::Unknown)]
    pub params: Value,
    #[specta(type = specta_typescript::Unknown)]
    pub result: Value,
    pub example: MethodExample,
}

/// The first sentence of a description.
fn first_sentence(text: &str) -> &str {
    match text.find(". ") {
        Some(end) => &text[..=end],
        None => text,
    }
}

fn declared_methods() -> Vec<Declared> {
    let mut all = crate::declarations::declared();
    all.sort_by_key(|d| d.name);
    all
}

/// One entry per method the Daemon serves, sorted by name.
pub fn list() -> MethodList {
    let methods = declared_methods()
        .iter()
        .map(|d| MethodSummary {
            name: d.name.to_string(),
            summary: first_sentence(d.description).to_string(),
        })
        .collect();
    MethodList { methods }
}

/// `Err` holds the names of the listed methods closest to `method`, best first.
pub fn describe(method: &str) -> Result<MethodDescription, Option<String>> {
    let all = declared_methods();
    let Some(d) = all.iter().find(|d| d.name == method) else {
        let closest = all
            .iter()
            .map(|d| (distance(method, d.name), d.name))
            .min()
            .map(|(_, name)| name.to_string());
        return Err(closest);
    };
    let description = d.description;
    let (params, result) = ((d.params)(), (d.result)());
    let example = MethodExample {
        params: example_of(&params),
        result: example_of(&result),
    };
    Ok(MethodDescription {
        name: d.name.to_string(),
        summary: first_sentence(description).to_string(),
        description: description.to_string(),
        params,
        result,
        example,
    })
}

fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (diagonal + usize::from(ca != *cb))
                .min(above + 1)
                .min(row[j] + 1);
            diagonal = above;
        }
    }
    row[b.len()]
}

/// The smallest value a schema document accepts: required fields only, the first choice of each union.
pub fn example_of(schema: &Value) -> Value {
    sample(schema, schema, 0)
}

fn sample(node: &Value, root: &Value, depth: usize) -> Value {
    let Some(map) = node.as_object() else {
        return Value::Null;
    };
    if depth > 12 {
        return Value::Null;
    }
    if let Some(reference) = map.get("$ref").and_then(Value::as_str) {
        let target = reference
            .strip_prefix('#')
            .and_then(|pointer| root.pointer(pointer));
        return target.map_or(Value::Null, |t| sample(t, root, depth + 1));
    }
    if let Some(value) = map.get("const") {
        return value.clone();
    }
    if let Some(first) = map
        .get("enum")
        .and_then(Value::as_array)
        .and_then(|v| v.first())
    {
        return first.clone();
    }
    let mut value = sample_typed(map, root, depth);
    for key in ["allOf", "oneOf", "anyOf"] {
        let choices = map.get(key).and_then(Value::as_array);
        let used = if key == "allOf" {
            choices.map(Vec::len)
        } else {
            Some(1)
        };
        for choice in choices.into_iter().flatten().take(used.unwrap_or(0)) {
            match (&mut value, sample(choice, root, depth + 1)) {
                (Value::Object(have), Value::Object(more)) => have.extend(more),
                (have, more) if have.is_null() => *have = more,
                _ => {}
            }
        }
    }
    value
}

fn sample_typed(map: &Map<String, Value>, root: &Value, depth: usize) -> Value {
    let kind = match map.get("type") {
        Some(Value::String(kind)) => kind.as_str(),
        Some(Value::Array(kinds)) => kinds
            .iter()
            .filter_map(Value::as_str)
            .find(|k| *k != "null")
            .unwrap_or("null"),
        _ => "null",
    };
    match kind {
        "object" => {
            let required: Vec<&str> = map
                .get("required")
                .and_then(Value::as_array)
                .map(|r| r.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            let properties = map.get("properties").and_then(Value::as_object);
            let mut out = Map::new();
            for name in required {
                let property = properties.and_then(|p| p.get(name));
                out.insert(
                    name.to_string(),
                    property.map_or(Value::Null, |p| sample(p, root, depth + 1)),
                );
            }
            Value::Object(out)
        }
        "array" => {
            let count = map.get("minItems").and_then(Value::as_u64).unwrap_or(0);
            let items = map
                .get("items")
                .map_or(Value::Null, |i| sample(i, root, depth + 1));
            Value::Array((0..count).map(|_| items.clone()).collect())
        }
        "string" => match map.get("format").and_then(Value::as_str) {
            Some("uuid") => json!("00000000-0000-0000-0000-000000000000"),
            Some("date-time") => json!("2026-01-01T00:00:00Z"),
            _ => json!(
                "x".repeat(map.get("minLength").and_then(Value::as_u64).unwrap_or(1) as usize)
            ),
        },
        "integer" | "number" => map.get("minimum").cloned().unwrap_or(json!(0)),
        "boolean" => json!(false),
        _ => Value::Null,
    }
}
