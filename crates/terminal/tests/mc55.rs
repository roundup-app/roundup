//! MC55: roundup reads the core only by its checked-in schema. Every reply the test-support core
//! sends validates against `crates/herdr/schema/herdr-core-<version>.json`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::time::Duration;

use herdr::Conn;
use serde_json::{Value, json};
use tokio::process::Command;

const T: Duration = Duration::from_secs(10);
const PINNED: &str = "0.1.20";

fn schema() -> Value {
    let path = format!(
        "{}/../herdr/schema/herdr-core-{PINNED}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn check(schema: &Value, method: &str, reply: &Value) {
    let result = &schema["methods"][method]["result"];
    assert!(result.is_object(), "the schema holds no reply for {method}");
    let validator = jsonschema::validator_for(result).unwrap();
    let errors: Vec<String> = validator
        .iter_errors(reply)
        .map(|e| e.to_string())
        .collect();
    assert!(
        errors.is_empty(),
        "{method} reply {reply} breaks the schema: {errors:?}"
    );
}

#[tokio::test]
async fn mc55_every_fake_reply_matches_the_schema() {
    let schema = schema();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    cmd.arg("connect");
    let conn = Conn::spawn(cmd, T).await.unwrap();
    let hello = json!({
        "generation": conn.hello.generation,
        "version": conn.hello.version,
        "framed": true,
        "methods": conn.hello.methods,
    });
    check(&schema, "hello", &hello);
    let cwd = std::env::temp_dir();
    let params =
        json!({"argv":["/bin/sh","-c","sleep 30"],"cwd":cwd,"env":{},"size":{"cols":80,"rows":24}});
    let run = conn.call("terminal.run", params).await.unwrap();
    check(&schema, "terminal.run", &run);
    let address = run["address"].as_str().unwrap();
    let got = conn
        .call("terminal.get", json!({"terminal": address}))
        .await
        .unwrap();
    check(&schema, "terminal.get", &got);
    let attach = conn
        .call(
            "terminal.attach",
            json!({"terminal": address, "cols": 80, "rows": 24}),
        )
        .await
        .unwrap();
    check(&schema, "terminal.attach", &attach);
    let kill = conn
        .call("terminal.kill", json!({"terminal": address}))
        .await
        .unwrap();
    check(&schema, "terminal.kill", &kill);
    for method in conn.hello.methods.iter().filter_map(Value::as_str) {
        assert!(
            schema["methods"][method].is_object(),
            "{method} is answered but the schema lacks it"
        );
    }
}

#[test]
fn mc55_schema_file_is_the_pinned_version_output() {
    assert_eq!(schema()["version"], PINNED);
}
