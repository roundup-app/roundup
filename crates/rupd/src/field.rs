//! Reading a field of a JSON request without indexing: a missing key reads as `null`,
//! as `serde_json`'s own index does, so the caller's type check decides.

use serde_json::Value;

pub(crate) trait Field {
    fn field(&self, key: &str) -> &Value;
}

impl Field for Value {
    fn field(&self, key: &str) -> &Value {
        self.get(key).unwrap_or(&Value::Null)
    }
}
