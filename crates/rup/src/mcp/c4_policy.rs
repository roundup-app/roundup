use super::*;
use std::collections::BTreeMap;

#[test]
fn c4_declarations_preserve_mcp_policy() {
    // Captured from main 09f5f6611: descriptions, names, schemas, reshaping, injection and role sets.
    let before: Value = serde_json::from_str(include_str!("fixtures/c4-before.json")).unwrap();
    {
        let rows: BTreeMap<_, _> = commands(true)
            .into_iter()
            .map(|offer| {
                let params = offer.params(
                    "fixture-agent",
                    Some(JsonObject::from_iter([
                        ("id".into(), "supplied-id".into()),
                        ("reader".into(), "supplied-reader".into()),
                    ])),
                );
                (
                    offer.method,
                    serde_json::json!({
                        "tool": offer.tool, "params": params,
                        "takes_params": offer.takes_params, "own_id": offer.own_id,
                        "own_reader": offer.own_reader, "waits_for_user": offer.waits_for_user,
                        "door_only": offer.door_only, "stream": offer.stream,
                    }),
                )
            })
            .collect();
        for (method, expected) in before["commands"].as_object().unwrap() {
            assert_eq!(rows.get(method.as_str()), Some(expected), "{method}");
        }
        for (role, list) in [("agents", tools(false)), ("doors", door_tools())] {
            let mut methods: Vec<_> = list.iter().map(|offer| offer.method).collect();
            methods.sort_unstable();
            for method in before[role].as_array().unwrap() {
                assert!(
                    methods.contains(&method.as_str().unwrap()),
                    "{role}: {method}"
                );
            }
        }
    }
}

#[test]
fn a5168a_only_a_door_is_offered_the_tools() {
    let names = |door| -> Vec<String> {
        tools(door)
            .into_iter()
            .map(|offer| offer.tool.name.to_string())
            .filter(|name| name.starts_with("github_"))
            .collect()
    };
    assert!(names(false).is_empty());
    assert_eq!(names(true).len(), 5);
}
