//! I10: what the Daemon says about its own methods, from the declaration table and the types.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use specta::Type;

/// One declared method as the declaration table holds it.
pub(crate) struct Declared {
    pub name: &'static str,
    pub tool_summary: Option<&'static str>,
    pub params: fn() -> Value,
    pub result: fn() -> Value,
}

/// The description a method's tool declaration already holds; `None` for a method with no tool or a custom one.
macro_rules! role_summary {
    ($role:ident(schema($t:ty, $d:expr))) => {
        Some($d)
    };
    ($role:ident(empty($d:expr))) => {
        Some($d)
    };
    ($role:ident($($tool:tt)*)) => {
        None
    };
}
pub(crate) use role_summary;

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

/// What the tool declaration does not hold: methods with no tool, and tools built in the CLI.
fn extra_text(method: &str) -> Option<&'static str> {
    Some(match method {
        "agent.spawn" => {
            "Start a child Agent in a folder of this Project, with its order and prompt."
        }
        "agent.extras" => "Read the names a Door may give a child, by kind.",
        "agent.extras_add" => "Add a name a Door may give a child.",
        "agent.changedFiles" => "List the files a Worktree changed.",
        "agent.compareFile" => "Compare one changed file of a Worktree with its Base.",
        "agent.spawnPrompt" => "Read the prompt an Agent's spawn gave.",
        "agent.setOrder" => "Set the order of an Agent in your Reach.",
        "agent.channelUp" => "Tell the Daemon an Agent's channel is up.",
        "agent.signal" => "Deliver a hook signal from an Agent's Claude Code session.",
        "rail.list" => "List every node of the Rail.",
        "workstream.setAuto" => "Turn a Workstream's automatic mode on or off.",
        "workstream.setOpeningPrompt" => "Set the opening prompt of a Workstream's Door.",
        "agent.run" => "Run a program for an Agent in a Terminal.",
        "project.setMcp" => "Set the Project's MCP settings.",
        "project.setPrepared" => "Save the Project's prepared directory settings.",
        "project.getPrepared" => "Read the Project's prepared directory settings.",
        "project.importDiscover" => "Find Claude Code sessions that can be imported.",
        "project.importCommit" => "Import the approved Claude Code sessions.",
        "project.prepareDirectory" => "Prepare a directory for the Project.",
        "project.setModels" => "Set the Project's models.",
        "models.list" => "List the models an Agent can use.",
        "agent.setModel" => "Change the model of an Agent.",
        "todo.listHanded" => "List the Todos handed to Agents.",
        "todo.getHistory" => "Read the history of a Todo.",
        "todo.readHistory" => "Mark a Todo's history read.",
        "todo.hand" => "Hand a Todo to an Agent.",
        "todo.deletion" => "Read a Todo deletion.",
        "todo.redo" => "Redo a restored Todo deletion.",
        "todo.restore" => "Restore a deleted Todo.",
        "todo.unread" => "List the unread Todo comments.",
        "todo.markCommentsRead" => "Mark the comments of a Todo read.",
        "pad.reorder" => "Reorder the Pads.",
        "message.drop" => "Drop a queued Message.",
        "terminal.measure" => "Record a keystroke timing probe for a Terminal.",
        "terminal.scheme" => "Tell the Daemon the colour scheme of the App.",
        "terminal.show" => "Ask the App to show a Terminal.",
        "terminal.list" => "List the Terminals.",
        "terminal.catchUp" => "Read the bytes a Terminal's emulator needs to catch up.",
        "terminal.snapshot" => "Read a snapshot of a Terminal's emulator.",
        "terminal.read" => "Read a Terminal's output from an offset.",
        "checkpoint.write" => "Write a Checkpoint of a Workstream.",
        "ask.send" => "Send an Ask to the user.",
        "ask.list" => "List the Asks.",
        "ask.pick" => "Answer an Ask by picking one of its choices.",
        "daemon.getNaming" => "Read the automatic naming settings.",
        "daemon.setNaming" => "Save the automatic naming settings.",
        "rail.deletion" => "Read a Rail node deletion.",
        "rail.redo" => "Redo a restored Rail node deletion.",
        "rail.restore" => "Restore a removed Rail node.",
        "daemon.ping" => "Read the Daemon's process, Project and contract fingerprint.",
        "daemon.methods" => "List the names of the methods the Daemon serves.",
        "daemon.identify" => "Tell the Daemon who this connection acts as.",
        "events.subscribe" => {
            "Follow the Event log from a given number; the answer holds the head."
        }
        "terminal.output" => "Start the byte stream of a Terminal.",
        "terminal.outputStop" => "Stop the byte stream of a Terminal.",
        "todo.refs" => "List what refers to a Todo.",
        "agent.context" => "Read the context of an Agent.",
        "agent.brief" => "Read the Brief of an Agent.",
        "agent.skills" => "List the skills of an Agent.",
        "agent.digest" => "Read the digest of an Agent's work.",
        "agent.wake" => "Wake an Agent that is waiting.",
        "project.resources" => "Read the resources of the Project.",
        "attachment.save" => "Save the bytes of an attachment.",
        "workstream.restart" => "Restart a Workstream's Door.",
        "workstream.rewindPlan" => "Read what a rewind of a Workstream would change.",
        "workstream.rewind" => "Rewind a Workstream to a Checkpoint.",
        "todo.startWorkstream" => "Start a Workstream from a Todo.",
        "workstream.queue" => "Queue a Workstream to start.",
        "workstream.dequeue" => "Take a Workstream out of the start queue.",
        "workstream.queueMove" => "Move a Workstream in the start queue.",
        "workstream.startNow" => "Start a queued Workstream now.",
        "project.setWorkstreamCap" => "Set how many Workstreams run at once.",
        "api.list" => "List every method the Daemon serves with a one-line summary.",
        "api.describe" => {
            "Describe one method: its summary, params and result schemas and an example."
        }
        _ => return None,
    })
}

fn text_of(d: &Declared) -> Option<&'static str> {
    d.tool_summary.or_else(|| extra_text(d.name))
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
            summary: first_sentence(text_of(d).unwrap_or_default()).to_string(),
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
    let description = text_of(d).unwrap_or_default();
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
