use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// One machine as herdr-core lists it; fields beyond `name` are kept as sent.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Machine {
    pub name: String,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

/// A notification from the core (a message without an id).
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub method: String,
    pub params: Value,
}

/// What `hello` answered.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Hello {
    pub generation: u64,
    pub version: String,
    #[serde(default)]
    pub methods: Vec<Value>,
}

/// What arrives on an attached channel.
#[derive(Debug, Clone, PartialEq)]
pub enum Ev {
    /// Terminal bytes, cut wherever the core framed them, which may be inside a UTF-8 character.
    Data(Vec<u8>),
    /// The size another viewer set.
    Resize(u16, u16),
    /// The stream ended, with the core's reason object (`exit_code` when the program exited).
    Close(Value),
}
