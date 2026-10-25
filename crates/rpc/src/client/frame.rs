use std::fmt;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

pub(super) struct Parsed(pub(super) Value);

impl<'de> Deserialize<'de> for Parsed {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Values;
        impl<'de> Visitor<'de> for Values {
            type Value = Parsed;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON value")
            }
            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Parsed, E> {
                Ok(Parsed(Value::Bool(value)))
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Parsed, E> {
                Ok(Parsed(value.into()))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Parsed, E> {
                Ok(Parsed(value.into()))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Parsed, E> {
                Ok(Parsed(value.into()))
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Parsed, E> {
                Ok(Parsed(Value::String(value.to_owned())))
            }
            fn visit_string<E: de::Error>(self, value: String) -> Result<Parsed, E> {
                Ok(Parsed(Value::String(value)))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Parsed, E> {
                Ok(Parsed(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Parsed, A::Error> {
                let mut values = Vec::new();
                while let Some(Parsed(value)) = sequence.next_element::<Parsed>()? {
                    values.push(value);
                }
                Ok(Parsed(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Parsed, A::Error> {
                // R16 staging/candidates-growth.jsonl: complete rows parse in 64 vs 77 µs.
                // Stage a bounded prefix so small objects reserve only their actual size.
                let mut staged = std::array::from_fn::<_, 8, _>(|_| None);
                let mut count = 0;
                while count < staged.len() {
                    let Some((key, Parsed(value))) = map.next_entry::<String, Parsed>()? else {
                        let mut values = serde_json::Map::with_capacity(count);
                        for (key, value) in staged.into_iter().flatten() {
                            values.insert(key, value);
                        }
                        return Ok(Parsed(Value::Object(values)));
                    };
                    staged[count] = Some((key, value));
                    count += 1;
                }
                let next = map.next_entry::<String, Parsed>()?;
                let mut values =
                    serde_json::Map::with_capacity(if next.is_some() { count * 2 } else { count });
                for (key, value) in staged.into_iter().flatten() {
                    values.insert(key, value);
                }
                if let Some((key, Parsed(value))) = next {
                    values.insert(key, value);
                }
                while let Some((key, Parsed(value))) = map.next_entry::<String, Parsed>()? {
                    values.insert(key, value);
                }
                Ok(Parsed(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(Values)
    }
}

#[cfg(test)]
mod tests {
    use super::Parsed;
    use proptest::prelude::*;
    use serde_json::Value;

    fn json() -> impl Strategy<Value = Value> {
        let text = prop::collection::vec(any::<char>(), 0..24)
            .prop_map(|chars| chars.into_iter().collect::<String>());
        prop_oneof![
            Just(Value::Null),
            any::<bool>().prop_map(Value::Bool),
            any::<i64>().prop_map(Value::from),
            any::<u64>().prop_map(Value::from),
            (-1.0e6_f64..1.0e6_f64).prop_map(Value::from),
            text.clone().prop_map(Value::String),
        ]
        .prop_recursive(3, 64, 12, move |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..13).prop_map(Value::Array),
                prop::collection::vec((text.clone(), inner), 0..13)
                    .prop_map(|entries| Value::Object(entries.into_iter().collect())),
            ]
        })
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]

        #[test]
        fn z3802g_frame_parser_matches_json(value in json()) {
            // Unique keys force both sides of the eight-entry staging boundary on every run.
            let mut inputs = vec![value.clone()];
            for count in [7, 8, 9, 12] {
                inputs.push(Value::Object((0..count).map(|id| {
                    (format!("鍵🦀{id}"), serde_json::json!({ "nested": [value.clone(), "é\n零"] }))
                }).collect()));
            }
            for input in inputs {
                let wire = serde_json::to_vec(&input).unwrap();
                let expected: Value = serde_json::from_slice(&wire).unwrap();
                let actual: Parsed = serde_json::from_slice(&wire).unwrap();
                prop_assert_eq!(actual.0, expected);
            }
        }
    }
}
