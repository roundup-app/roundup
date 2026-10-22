//! A2681: retained conversation overview facts.

use agents::claude_code::Launcher;
use serde_json::{Value, json};

fn conversation_overview(records: &[Value]) -> Value {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().canonicalize().unwrap();
    let project: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let id = "11111111-1111-1111-1111-111111111111";
    let path = dir
        .path()
        .join("projects")
        .join(project)
        .join(format!("{id}.jsonl"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let text: String = records.iter().map(|v| format!("{v}\n")).collect();
    std::fs::write(path, text).unwrap();
    let launcher = Launcher::new(
        "unused",
        dir.path().join("claude.json"),
        dir.path().join("rup"),
        None,
    );
    serde_json::to_value(launcher.read_overview(&cwd, id).unwrap()).unwrap()
}

#[test]
fn a2681b_last_reply_context_sums_three_counts() {
    let overview = conversation_overview(&[
        json!({"type":"assistant", "message":{"usage":{"input_tokens":90000}, "model":"claude-haiku-4-5-20251001"}}),
        json!({"type":"assistant", "message":{"usage":{"input_tokens":1000, "cache_read_input_tokens":2000, "cache_creation_input_tokens":3000, "output_tokens":9999}, "model":"claude-haiku-4-5-20251001"}}),
        json!({"type":"user", "message":{"usage":{"input_tokens":70000}}}),
    ]);
    assert_eq!(overview["used"], 6000);
}

#[test]
fn a2681b_context_limit_comes_from_reply_model() {
    // Claude Code model-config#extended-context (2026-10-18): 4.6 needs [1m];
    // Opus >=4.7, Sonnet >=5, Fable and Haiku 5.5 have native 1M windows.
    for (model, limit) in [
        ("claude-haiku-4-5-20251001", Some(200000)),
        ("claude-haiku-4-5", Some(200000)),
        ("claude-sonnet-4-5-20250929", Some(200000)),
        ("claude-sonnet-4-5", Some(200000)),
        ("claude-opus-4-5-20251101", Some(200000)),
        ("claude-opus-4-5", Some(200000)),
        ("claude-opus-4-6", Some(200000)),
        ("claude-sonnet-4-6", Some(200000)),
        ("claude-opus-4-6[1m]", Some(1000000)),
        ("claude-sonnet-4-6[1m]", Some(1000000)),
        ("claude-opus-4-7", Some(1000000)),
        ("claude-opus-4-8", Some(1000000)),
        ("claude-opus-5", Some(1000000)),
        ("claude-opus-5-5", Some(1000000)),
        ("claude-sonnet-5", Some(1000000)),
        ("claude-sonnet-5-5", Some(1000000)),
        ("claude-haiku-5-5", Some(1000000)),
        ("claude-fable-5", Some(1000000)),
        ("claude-fable-5-1", Some(1000000)),
        ("unknown", None),
        ("claude-future[1m]", None),
    ] {
        let overview = conversation_overview(&[
            json!({"type":"assistant", "message":{"model":"claude-haiku-4-5", "usage":{"input_tokens":90000}}}),
            json!({"type":"assistant", "message":{"model":model}}),
        ]);
        assert_eq!(
            overview.get("limit").and_then(Value::as_u64),
            limit,
            "{model}"
        );
        assert!(
            overview.get("used").is_none(),
            "missing usage must not become zero"
        );
    }
}

#[test]
fn a2681b_explicit_name_then_latest_ai_title() {
    let explicit: Value =
        serde_json::from_str(include_str!("fixtures/overview/2.1.296-name.jsonl")).unwrap();
    for (records, name) in [
        (
            vec![explicit, json!({"type":"ai-title","aiTitle":"Automatic"})],
            Some("Overview fixture"),
        ),
        (
            vec![
                json!({"type":"ai-title","aiTitle":"First"}),
                json!({"type":"ai-title","aiTitle":"Latest"}),
                json!({"type":"ai-title","aiTitle":" "}),
            ],
            Some("Latest"),
        ),
        (vec![], None),
    ] {
        assert_eq!(
            conversation_overview(&records)
                .get("name")
                .and_then(Value::as_str),
            name
        );
    }
}

fn used_reply(input: u64) -> Value {
    json!({"type":"assistant", "message":{"usage":{"input_tokens":input}}})
}

#[test]
fn a2681d_split_comes_from_the_latest_context_record_and_other_takes_the_rest() {
    let context: Value =
        serde_json::from_str(include_str!("fixtures/overview/2.1.296-context.jsonl")).unwrap();
    let overview = conversation_overview(&[used_reply(20000), context.clone()]);
    assert_eq!(
        overview["context_parts"],
        json!([
            {"kind":"system","tokens":1867},
            {"kind":"tools","tokens":11881},
            {"kind":"files","tokens":3},
            {"kind":"conversation","tokens":3415},
            {"kind":"other","tokens":2834},
        ])
    );
    // No remainder: no `other`. A category the record omits is omitted, never zero.
    let mut exact = context.clone();
    exact["contextUsage"]["categories"]
        .as_array_mut()
        .unwrap()
        .retain(|c| c["name"] != "Memory files");
    let overview = conversation_overview(&[used_reply(17163), exact.clone()]);
    assert_eq!(overview["context_parts"].as_array().unwrap().len(), 3);
    // The latest record wins.
    let mut later = exact;
    later["contextUsage"]["categories"][0]["tokens"] = json!(1);
    let overview = conversation_overview(&[used_reply(20000), context, later]);
    assert_eq!(overview["context_parts"][0]["tokens"], 1);
    // Parts above the used total are unreliable.
    let big: Value =
        serde_json::from_str(include_str!("fixtures/overview/2.1.296-context.jsonl")).unwrap();
    assert!(
        conversation_overview(&[used_reply(100), big])
            .get("context_parts")
            .is_none()
    );
}

#[test]
fn a2681d_no_measured_split_gives_no_parts() {
    let context: Value =
        serde_json::from_str(include_str!("fixtures/overview/2.1.296-context.jsonl")).unwrap();
    let garbled =
        json!({"type":"system","subtype":"local_command","contextUsage":{"categories":"x"}});
    for records in [
        vec![used_reply(20000)],
        vec![used_reply(20000), garbled],
        vec![context],
    ] {
        let overview = conversation_overview(&records);
        assert!(overview.get("context_parts").is_none());
        assert_eq!(
            overview.get("used").is_some(),
            records.len() == 2 || records[0]["type"] == "assistant"
        );
    }
}

fn assistant_card(text: &str) -> Value {
    json!({"type":"assistant", "message":{"content":[{"type":"text", "text":text}]}})
}

#[test]
fn a2681c_newest_key_wins_and_missing_key_survives() {
    let overview = conversation_overview(&[
        assistant_card("```card\n{\"intent\":\"old\",\"shape\":\"keep\"}\n```"),
        assistant_card(
            "```card\n{\"intent\":\"middle\",\"outcome\":\"settled\"}\n```\n```card\n{\"intent\":\"new\"}\n```",
        ),
    ]);
    assert_eq!(
        overview["card"],
        json!({"intent":"new", "shape":"keep", "outcome":"settled"})
    );
}

#[test]
fn a2681c_empty_list_clears_older_facts() {
    let overview = conversation_overview(&[
        assistant_card("```card\n{\"facts\":[\"old\"]}\n```"),
        assistant_card("```card\n{\"facts\":[]}\n```"),
    ]);
    assert!(overview.get("card").is_none());
}

#[test]
fn a2681c_invalid_values_do_not_become_parts() {
    let overview = conversation_overview(&[
        assistant_card("```card\n{\"intent\":\"keep\",\"shape\":\"old\"}\n```"),
        assistant_card(
            "```card\n{\"intent\":42,\"shape\":\"  \",\"outcome\":null,\"facts\":[\"fact\",42,\"\",\" \",false],\"questions\":[\"ignored\"]}\n```",
        ),
    ]);
    assert_eq!(
        overview["card"],
        json!({"intent":"keep", "shape":"old", "facts":["fact"]})
    );
}

#[test]
fn a2681c_only_complete_assistant_card_objects_count() {
    for ignored in [
        "> ```card\n{\"intent\":\"wrong\"}\n```",
        "````card\n{\"intent\":\"wrong\"}\n```",
        " ```card\n{\"intent\":\"wrong\"}\n```",
        "```card\n{\"intent\":\"wrong\"}",
        "```card\nnot JSON\n```",
        "```card\n[ {\"intent\":\"wrong\"} ]\n```",
        "```card\nnull\n```",
    ] {
        assert!(
            conversation_overview(&[assistant_card(ignored)])
                .get("card")
                .is_none(),
            "{ignored}"
        );
    }
    let fence = "```card\t \n{\"intent\":\"right\"}\n```\t \n";
    let overview = conversation_overview(&[
        json!({"type":"user", "message":{"content":fence}}),
        json!({"type":"assistant", "message":{"content":[{"type":"tool_result", "text":fence}]}}),
    ]);
    assert!(overview.get("card").is_none());
    assert_eq!(
        conversation_overview(&[assistant_card(fence)])["card"],
        json!({"intent":"right"})
    );
}
