//! R16 exploratory parser profile; complete values, no Daemon or socket work.
use std::fmt;
use std::hint::black_box;
use std::time::Instant;

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};

struct Parsed<const CAPACITY: usize>(Value);

impl<'de, const CAPACITY: usize> Deserialize<'de> for Parsed<CAPACITY> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Values<const CAPACITY: usize>;
        impl<'de, const CAPACITY: usize> Visitor<'de> for Values<CAPACITY> {
            type Value = Parsed<CAPACITY>;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON value")
            }
            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(Value::Bool(value)))
            }
            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(value.into()))
            }
            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(value.into()))
            }
            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(value.into()))
            }
            fn visit_str<E: de::Error>(self, value: &str) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(Value::String(value.to_owned())))
            }
            fn visit_string<E: de::Error>(self, value: String) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(Value::String(value)))
            }
            fn visit_unit<E: de::Error>(self) -> Result<Parsed<CAPACITY>, E> {
                Ok(Parsed(Value::Null))
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Parsed<CAPACITY>, A::Error> {
                let mut values = Vec::new();
                while let Some(Parsed(value)) = sequence.next_element::<Parsed<CAPACITY>>()? {
                    values.push(value);
                }
                Ok(Parsed(Value::Array(values)))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Parsed<CAPACITY>, A::Error> {
                let mut values = serde_json::Map::with_capacity(CAPACITY);
                let mut entries = Vec::new();
                let mut staged = std::array::from_fn::<_, 8, _>(|_| None);
                let mut count = 0;
                while let Some((key, Parsed(value))) =
                    map.next_entry::<String, Parsed<CAPACITY>>()?
                {
                    if CAPACITY == 1 {
                        if count < staged.len() {
                            staged[count] = Some((key, value));
                            count += 1;
                            continue;
                        }
                        if values.is_empty() {
                            values = serde_json::Map::with_capacity(staged.len() * 2);
                            for (key, value) in staged.iter_mut().filter_map(Option::take) {
                                values.insert(key, value);
                            }
                        }
                        values.insert(key, value);
                    } else if CAPACITY != 0 {
                        values.insert(key, value);
                    } else {
                        entries.push((key, value));
                    }
                }
                if CAPACITY == 1 && values.is_empty() {
                    values = serde_json::Map::with_capacity(count);
                    for (key, value) in staged.into_iter().flatten() {
                        values.insert(key, value);
                    }
                }
                Ok(Parsed(Value::Object(if CAPACITY != 0 {
                    values
                } else {
                    entries.into_iter().collect()
                })))
            }
        }
        deserializer.deserialize_any(Values::<CAPACITY>)
    }
}

fn measure<T>(name: &str, mut operation: impl FnMut() -> T) {
    for _ in 0..100 {
        black_box(operation());
    }
    let mut samples = Vec::with_capacity(3300);
    for _ in 0..3300 {
        let start = Instant::now();
        let output = black_box(operation());
        samples.push(start.elapsed().as_secs_f64() * 1e6);
        drop(output);
    }
    samples.sort_by(f64::total_cmp);
    println!(
        "{name}: median_us={} p95_us={}",
        (samples[1649] + samples[1650]) / 2.0,
        samples[3134]
    );
}

fn main() {
    let rows: Vec<Value> = (0..40).map(|i| json!({
        "id": format!("workstream-{i}"), "kind": "workstream", "name": format!("Workstream {i}"),
        "parent": null, "order": i, "status": null, "attempt": null,
        "status_revision": null, "terminal_id": null, "worktree": null,
        "can_resume": false, "channel": null, "work": null, "stray": [],
        "model": null, "effort": null
    })).collect();
    let frame = json!({"jsonrpc": "2.0", "id": 1, "result": rows});
    let input = frame.to_string();
    assert_eq!(serde_json::from_str::<Parsed<0>>(&input).unwrap().0, frame);
    assert_eq!(serde_json::from_str::<Parsed<1>>(&input).unwrap().0, frame);
    println!("frame_bytes={}", input.len());
    measure("value_from_str", || {
        serde_json::from_str::<Value>(black_box(&input)).unwrap()
    });
    measure("staged_maps_from_str", || {
        serde_json::from_str::<Parsed<1>>(black_box(&input)).unwrap()
    });
    measure("capacity_4_maps_from_str", || {
        serde_json::from_str::<Parsed<4>>(black_box(&input)).unwrap()
    });
    measure("reserved_maps_from_str", || {
        serde_json::from_str::<Parsed<16>>(black_box(&input)).unwrap()
    });
    measure("collected_maps_from_str", || {
        serde_json::from_str::<Parsed<0>>(black_box(&input)).unwrap()
    });
}
