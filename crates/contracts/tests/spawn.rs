#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
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
        assert_eq!(
            (
                spawn.launch.model.as_deref(),
                spawn.launch.effort.as_deref()
            ),
            expected
        );
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
            "contracts/spawn.test.ts",
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

#[test]
fn g13_spawn_and_adopt_share_launch_params() {
    let launch = json!({
        "parent": "7", "order": null, "model": "m", "effort": "e",
        "settings": {"env": {"A": "1"}}, "visibility": "internal"
    });
    let mut spawn = json!({"cwd": "/p", "prompt": null});
    let mut adopt = json!({"path": "/p/w", "branch": "b"});
    for params in [&mut spawn, &mut adopt] {
        params
            .as_object_mut()
            .unwrap()
            .extend(launch.as_object().unwrap().clone());
    }
    let spawn: SpawnParams = serde_json::from_value(spawn).unwrap();
    let adopt: contracts::agent::AdoptParams = serde_json::from_value(adopt).unwrap();
    assert_eq!(
        serde_json::to_value(&spawn.launch).unwrap(),
        serde_json::to_value(&adopt.launch).unwrap()
    );
}
