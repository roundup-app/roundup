use contracts::agent::SpawnParams;
use serde_json::json;

#[test]
fn a36_spawn_deserializes_omitted_null_and_id_pairs() {
    for (fields, expected) in [
        (json!({}), (None, None)),
        (json!({"model": null, "effort": null}), (None, None)),
        (
            json!({"model": "model-id", "effort": "effort-id"}),
            (Some("model-id"), Some("effort-id")),
        ),
    ] {
        let mut params = json!({"cwd": "/project", "prompt": null, "parent": null});
        params
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        let spawn: SpawnParams = serde_json::from_value(params).unwrap();
        assert_eq!((spawn.model.as_deref(), spawn.effort.as_deref()), expected);
    }
}

#[test]
fn u378_spawn_calls_compile_with_project_defaults() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = std::process::Command::new("pnpm")
        .current_dir(root)
        .args([
            "exec",
            "tsc",
            "--ignoreConfig",
            "--strict",
            "--exactOptionalPropertyTypes",
            "--noEmit",
            "crates/contracts/tests/spawn.ts",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
