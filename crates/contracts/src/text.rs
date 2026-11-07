//! A bounded string that refuses at parse: the bound belongs to the type that parses the field.

use std::fmt;
use std::ops::Deref;

use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Refuse a string with no non-whitespace character.
pub const TRIMMED: u8 = 0;
/// Refuse only the empty string.
pub const NONEMPTY: u8 = 1;
/// Refuse neither; only the length bound holds.
pub const BLANK: u8 = 2;

/// A string of at most `MAX` bytes; `RULE` (`TRIMMED`, `NONEMPTY` or `BLANK`) says which blank
/// strings it refuses. It is a `string` on the wire and in the generated TypeScript.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Text<const MAX: usize, const RULE: u8 = TRIMMED>(String);

impl<const MAX: usize, const RULE: u8> Text<MAX, RULE> {
    /// The text, or the refusal the wire reports as INVALID_PARAMS.
    pub fn new(text: impl Into<String>) -> Result<Self, String> {
        let text = text.into();
        let blank = match RULE {
            TRIMMED => text.trim().is_empty(),
            NONEMPTY => text.is_empty(),
            _ => false,
        };
        if blank {
            return Err("must not be empty".into());
        }
        if text.len() > MAX {
            return Err(format!("must be at most {MAX} bytes"));
        }
        Ok(Self(text))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<const MAX: usize, const RULE: u8> TryFrom<String> for Text<MAX, RULE> {
    type Error = String;
    fn try_from(text: String) -> Result<Self, String> {
        Self::new(text)
    }
}

impl<const MAX: usize, const RULE: u8> From<Text<MAX, RULE>> for String {
    fn from(text: Text<MAX, RULE>) -> String {
        text.0
    }
}

impl<const MAX: usize, const RULE: u8> Deref for Text<MAX, RULE> {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}

impl<const MAX: usize, const RULE: u8> AsRef<str> for Text<MAX, RULE> {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl<const MAX: usize, const RULE: u8> fmt::Display for Text<MAX, RULE> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl<const MAX: usize, const RULE: u8> PartialEq<str> for Text<MAX, RULE> {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl<const MAX: usize, const RULE: u8> PartialEq<&str> for Text<MAX, RULE> {
    fn eq(&self, other: &&str) -> bool {
        self.0 == *other
    }
}

impl<const MAX: usize, const RULE: u8> PartialEq<String> for Text<MAX, RULE> {
    fn eq(&self, other: &String) -> bool {
        &self.0 == other
    }
}

impl<const MAX: usize, const RULE: u8> Type for Text<MAX, RULE> {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        String::definition(types)
    }
}

impl<const MAX: usize, const RULE: u8> JsonSchema for Text<MAX, RULE> {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> std::borrow::Cow<'static, str> {
        format!("Text{MAX}").into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({"type": "string", "maxLength": MAX})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// C5459c: each bound refuses blank and N+1 bytes at parse and accepts N.
    #[test]
    fn c5459c_each_bound_refuses_blank_and_over_n_and_accepts_n() {
        fn probe<const MAX: usize, const RULE: u8>(blank_refused: [bool; 2]) {
            let parse = |s: &str| serde_json::from_value::<Text<MAX, RULE>>(s.into());
            assert!(parse(&"a".repeat(MAX)).is_ok(), "{MAX} accepts N");
            assert!(parse(&"a".repeat(MAX + 1)).is_err(), "{MAX} refuses N+1");
            assert_eq!(parse("").is_err(), blank_refused[0], "{MAX} empty");
            assert_eq!(parse("  ").is_err(), blank_refused[1], "{MAX} spaces");
        }
        let trimmed = [true, true];
        let nonempty = [true, false];
        let blank = [false, false];
        probe::<256, TRIMMED>(trimmed);
        probe::<1024, TRIMMED>(trimmed);
        probe::<4096, TRIMMED>(trimmed);
        probe::<8192, TRIMMED>(trimmed);
        probe::<96, NONEMPTY>(nonempty);
        probe::<128, NONEMPTY>(nonempty);
        probe::<256, NONEMPTY>(nonempty);
        probe::<8192, BLANK>(blank);
    }

    #[test]
    fn c5459c_schema_states_max_length() {
        let schema = schemars::schema_for!(Text<256>);
        assert_eq!(schema.as_value()["maxLength"], 256);
        assert_eq!(schema.as_value()["type"], "string");
    }
}
