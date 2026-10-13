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
                // R16 staging/candidates.jsonl: 40 complete rows parse in 60 vs 76 µs.
                // Stage a bounded prefix so small objects reserve only their actual size.
                let mut staged = std::array::from_fn::<_, 16, _>(|_| None);
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
                let mut values = serde_json::Map::with_capacity(count);
                for (key, value) in staged.into_iter().flatten() {
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
