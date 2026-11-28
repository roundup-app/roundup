//! EP3: the Extension contract only grows. The generated schema equals the newest snapshot of
//! `contracts/extension/history/`, and each snapshot extends the one before by the rules of its
//! direction. A PR that edits an old snapshot is refused in review: this test cannot see it.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod ext_accretion {
    use serde_json::{Value, json};
    use std::path::PathBuf;

    const FROM: &str = "fromExtension.schema.json";
    const TO: &str = "toExtension.schema.json";

    #[derive(Clone, Copy, PartialEq)]
    enum Direction {
        /// Extension to roundup: roundup reads, so what an Extension may send only widens.
        ToRoundup,
        /// Roundup to Extension: old Extensions read, so what they read is never taken away.
        ToExtension,
    }

    impl Direction {
        fn name(self) -> &'static str {
            match self {
                Self::ToRoundup => "Extension → roundup",
                Self::ToExtension => "roundup → Extension",
            }
        }
    }

    fn root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    fn read(path: PathBuf) -> Value {
        serde_json::from_str(
            &std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}")),
        )
        .unwrap()
    }

    /// The snapshot directories, oldest first.
    fn history() -> Vec<PathBuf> {
        let mut dirs: Vec<_> = std::fs::read_dir(root().join("contracts/extension/history"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.is_dir())
            .collect();
        dirs.sort();
        dirs
    }

    fn resolve<'a>(root: &'a Value, mut schema: &'a Value) -> &'a Value {
        while let Some(target) = schema["$ref"].as_str() {
            let name = target.trim_start_matches("#/$defs/");
            schema = &root["$defs"][name];
        }
        schema
    }

    /// The schema with `null` taken out of its type: an optional field is a matter of `required`.
    fn without_null(schema: &Value) -> Value {
        let mut schema = schema.clone();
        if let Some(any) = schema["anyOf"].as_array() {
            let rest: Vec<_> = any.iter().filter(|s| s["type"] != "null").collect();
            if let [one] = rest.as_slice() {
                return (*one).clone();
            }
        }
        if let Some(types) = schema["type"].as_array() {
            let rest: Vec<_> = types.iter().filter(|t| *t != "null").cloned().collect();
            schema["type"] = if rest.len() == 1 {
                rest[0].clone()
            } else {
                json!(rest)
            };
        }
        schema
    }

    /// What names one variant of a union: its `const`, or the property that holds one.
    fn variant_key(variant: &Value) -> String {
        if let Some(value) = variant.get("const") {
            return value.to_string();
        }
        if let Some(properties) = variant["properties"].as_object() {
            for (name, property) in properties {
                if let Some(value) = property.get("const") {
                    return format!("{name}={value}");
                }
            }
        }
        variant.to_string()
    }

    fn max_length(schema: &Value) -> Option<u64> {
        schema["maxLength"].as_u64()
    }

    struct Walk<'a> {
        old: &'a Value,
        new: &'a Value,
        direction: Direction,
        problems: Vec<String>,
    }

    impl Walk<'_> {
        fn refuse(&mut self, path: &str, what: String) {
            self.problems
                .push(format!("{}: {path}: {what}", self.direction.name()));
        }

        fn walk(&mut self, path: &str, old: &Value, new: &Value) {
            let old = without_null(resolve(self.old, old));
            let new = without_null(resolve(self.new, new));
            if old == new {
                return;
            }
            if let (Some(before), Some(after)) = (old["oneOf"].as_array(), new["oneOf"].as_array())
            {
                for variant in before {
                    let key = variant_key(resolve(self.old, variant));
                    match after
                        .iter()
                        .find(|v| variant_key(resolve(self.new, v)) == key)
                    {
                        Some(found) => self.walk(&format!("{path}{{{key}}}"), variant, found),
                        None => self.refuse(path, format!("`{key}` is removed or renamed")),
                    }
                }
            } else if let (Some(before), Some(after)) =
                (old["enum"].as_array(), new["enum"].as_array())
            {
                for value in before.iter().filter(|v| !after.contains(v)) {
                    self.refuse(path, format!("value {value} is removed or renamed"));
                }
            } else if old["properties"].is_object() && new["properties"].is_object() {
                self.object(path, &old, &new);
            } else if old["type"] != new["type"] || old["format"] != new["format"] {
                self.refuse(
                    path,
                    format!("its type changes from {} to {}", old["type"], new["type"]),
                );
            } else if old["type"] == "array" {
                self.walk(&format!("{path}[]"), &old["items"], &new["items"]);
            } else if let (Some(_), Some(_)) = (
                old["additionalProperties"].as_object(),
                new["additionalProperties"].as_object(),
            ) {
                self.walk(
                    &format!("{path}{{}}"),
                    &old["additionalProperties"],
                    &new["additionalProperties"],
                );
            }
            if self.direction == Direction::ToRoundup {
                let narrowed = match (max_length(&old), max_length(&new)) {
                    (None, Some(_)) => true,
                    (Some(before), Some(after)) => after < before,
                    _ => false,
                };
                if narrowed {
                    self.refuse(path, "its length cap narrows".into());
                }
            }
        }

        fn object(&mut self, path: &str, old: &Value, new: &Value) {
            let required = |schema: &Value, name: &str| {
                schema["required"]
                    .as_array()
                    .is_some_and(|names| names.iter().any(|n| n == name))
            };
            for (name, before) in old["properties"].as_object().unwrap() {
                let field = format!("{path}.{name}");
                let Some(after) = new["properties"].get(name) else {
                    self.refuse(&field, "the field is removed or renamed".into());
                    continue;
                };
                if self.direction == Direction::ToRoundup
                    && !required(old, name)
                    && required(new, name)
                {
                    self.refuse(&field, "the field turns from optional to required".into());
                }
                self.walk(&field, before, after);
            }
            if self.direction == Direction::ToRoundup {
                for name in new["properties"].as_object().unwrap().keys() {
                    if old["properties"].get(name).is_none() && required(new, name) {
                        self.refuse(
                            &format!("{path}.{name}"),
                            "a new field must be optional".into(),
                        );
                    }
                }
            }
        }
    }

    /// Every way `new` fails to extend `old` in `direction`, each naming the field.
    fn extension_problems(old: &Value, new: &Value, direction: Direction) -> Vec<String> {
        let mut walk = Walk {
            old,
            new,
            direction,
            problems: Vec::new(),
        };
        walk.walk("frame", old, new);
        walk.problems
    }

    fn snapshot(dir: &std::path::Path) -> (Value, Value) {
        (read(dir.join(FROM)), read(dir.join(TO)))
    }

    #[test]
    fn ep3_the_generated_schema_equals_the_newest_snapshot() {
        let newest = history().pop().expect("a first snapshot");
        let (from, to) = contracts::extension::schemas();
        assert_eq!(from, read(newest.join(FROM)), "{newest:?}");
        assert_eq!(to, read(newest.join(TO)), "{newest:?}");
    }

    #[test]
    fn ep3_each_snapshot_extends_the_one_before() {
        let dirs = history();
        for pair in dirs.windows(2) {
            let (old, new) = (snapshot(&pair[0]), snapshot(&pair[1]));
            let mut problems = extension_problems(&old.0, &new.0, Direction::ToRoundup);
            problems.extend(extension_problems(&old.1, &new.1, Direction::ToExtension));
            assert!(problems.is_empty(), "{:?}: {problems:#?}", pair[1]);
        }
    }

    #[test]
    fn ep3_a_snapshot_that_drops_a_field_fails_naming_the_field_and_direction() {
        let (from, to) = snapshot(&history().pop().unwrap());
        let drop_field = |schema: &Value, frame: &str, field: &str| {
            let mut copy = schema.clone();
            let variants = copy["oneOf"].as_array_mut().unwrap();
            let variant = variants
                .iter_mut()
                .find(|v| v["properties"]["t"]["const"] == frame)
                .unwrap();
            variant["properties"].as_object_mut().unwrap().remove(field);
            copy
        };
        let problems = extension_problems(
            &from,
            &drop_field(&from, "show", "ask"),
            Direction::ToRoundup,
        );
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(
            problems[0].contains("Extension → roundup") && problems[0].contains(".ask"),
            "{problems:?}"
        );
        let problems = extension_problems(
            &to,
            &drop_field(&to, "shown", "render"),
            Direction::ToExtension,
        );
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert!(
            problems[0].contains("roundup → Extension") && problems[0].contains(".render"),
            "{problems:?}"
        );
    }

    #[test]
    fn ep3_a_snapshot_that_adds_an_optional_field_passes() {
        let (from, to) = snapshot(&history().pop().unwrap());
        for (schema, direction) in [(&from, Direction::ToRoundup), (&to, Direction::ToExtension)] {
            let mut copy = schema.clone();
            copy["oneOf"][0]["properties"]["later"] = json!({"type": "string"});
            assert_eq!(
                extension_problems(schema, &copy, direction),
                Vec::<String>::new()
            );
        }
    }
}
