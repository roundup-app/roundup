//! ST1, ST5: the settings a starter sends ride the `--settings` file and the argv.
use super::*;
use agents::claude_code::{LaunchFacts, Permission, Request, start_settings};
use contracts::agent::PermissionMode;
use std::os::unix::fs::PermissionsExt;

fn launch(s: &Setup, facts: &LaunchFacts, resume: Option<&str>) -> (Value, Vec<String>) {
    let argv = s
        .launcher()
        .prepare_on(&Request {
            folders: folders(&s.dir),
            id: "7",
            attempt: "1",
            cwd: &s.cwd,
            resume,
            role: Role::Agent,
            facts,
        })
        .unwrap();
    (read(Path::new(&argv[2])), argv)
}

fn sent(settings: Value, permission: Permission) -> LaunchFacts {
    LaunchFacts {
        permission,
        start_settings: Some(settings),
        ..LaunchFacts::default()
    }
}

fn mode_args(argv: &[String]) -> Vec<&str> {
    argv.windows(2)
        .filter(|pair| pair[0] == "--permission-mode")
        .map(|pair| pair[1].as_str())
        .collect()
}

#[test]
fn st1_settings_join_roundups_keys_and_roundup_wins() {
    let s = setup();
    let (plain, _) = launch(&s, &LaunchFacts::default(), None);
    let theirs = json!({
        "env": {"ROUNDUP_AGENT_ID": "x", "PATH": "/evil", "TOKEN": "t"},
        "permissions": {"deny": ["Bash(rm:*)"], "allow": ["mcp__roundup__*", "Read"]},
        "enabledPlugins": {"p@m": true},
        "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]},
        "outputStyle": "theirs",
    });
    let (file, _) = launch(&s, &sent(theirs, Permission::Inherit), None);
    assert_eq!(
        file["env"]["ROUNDUP_AGENT_ID"],
        plain["env"]["ROUNDUP_AGENT_ID"]
    );
    assert_eq!(file["env"]["PATH"], plain["env"]["PATH"]);
    assert_eq!(file["env"]["TOKEN"], "t");
    assert_eq!(file["permissions"]["deny"], json!(["Bash(rm:*)"]));
    assert_eq!(
        file["permissions"]["allow"],
        json!(["mcp__roundup__*", "Read"])
    );
    assert_eq!(file["enabledPlugins"], json!({"p@m": true}));
    assert_eq!(file["outputStyle"], plain["outputStyle"]);
    let stop = file["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(stop[0], plain["hooks"]["Stop"][0]);
    assert_eq!(stop[1]["hooks"][0]["command"], "mine");
    for event in EVENTS {
        assert!(file["hooks"][event].is_array(), "{event}");
    }
}

#[test]
fn st1_a_non_object_or_oversize_settings_is_invalid_and_writes_nothing() {
    for bad in [
        json!([1]),
        json!("x"),
        json!({"env": {"A": "x".repeat(70_000)}}),
        json!({"permissions": {"defaultMode": "everything"}}),
    ] {
        let err = start_settings::check(&bad).unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(!err.message.contains("xxxx"), "{}", err.message);
    }
    start_settings::check(&json!({})).unwrap();
}

#[test]
fn st1_no_user_key_enters_the_file() {
    let s = setup();
    std::fs::write(
        s.root.path().join("settings.json"),
        r#"{"model":"user-model","env":{"USER_VAR":"1"},"permissions":{"deny":["Bash"]}}"#,
    )
    .unwrap();
    let (file, _) = launch(
        &s,
        &sent(json!({"env": {"MINE": "1"}}), Permission::Inherit),
        None,
    );
    assert!(file.get("model").is_none());
    assert!(file["env"].get("USER_VAR").is_none());
    assert_eq!(file["env"]["MINE"], "1");
    assert!(file["permissions"].get("deny").is_none());
}

#[test]
fn st1_the_file_is_private_and_no_value_is_logged() {
    let s = setup();
    let (_, argv) = launch(
        &s,
        &sent(json!({"env": {"SECRET": "hunter2"}}), Permission::Inherit),
        None,
    );
    let mode = std::fs::metadata(&argv[2]).unwrap().permissions().mode();
    assert_eq!(mode & 0o077, 0, "{mode:o}");
    assert!(
        !argv.iter().any(|word| word.contains("hunter2")),
        "{argv:?}"
    );
    let err =
        start_settings::check(&json!({"permissions": {"defaultMode": "hunter2"}})).unwrap_err();
    assert!(!err.message.contains("hunter2"));
}

#[test]
fn st5_a_settings_mode_rides_the_file_and_the_argv() {
    let s = setup();
    for mode in [
        "default",
        "acceptEdits",
        "plan",
        "auto",
        "bypassPermissions",
    ] {
        let facts = sent(
            json!({"permissions": {"defaultMode": mode}}),
            Permission::Inherit,
        );
        let (file, argv) = launch(&s, &facts, None);
        assert_eq!(file["permissions"]["defaultMode"], mode);
        assert_eq!(mode_args(&argv), [mode]);
    }
}

#[test]
fn st5_the_users_field_wins_over_settings_and_the_file_agrees() {
    let s = setup();
    let facts = sent(
        json!({"permissions": {"defaultMode": "auto"}}),
        Permission::Selected(PermissionMode::Plan),
    );
    let (file, argv) = launch(&s, &facts, None);
    assert_eq!(file["permissions"]["defaultMode"], "plan");
    assert_eq!(mode_args(&argv), ["plan"]);
}

#[test]
fn st5_a_resume_keeps_the_stored_mode() {
    let s = setup();
    let facts = sent(
        json!({"permissions": {"defaultMode": "acceptEdits"}}),
        Permission::Inherit,
    );
    let (first, _) = launch(&s, &facts, None);
    let (again, argv) = launch(&s, &facts, Some("conv"));
    assert_eq!(first, again);
    assert_eq!(mode_args(&argv), ["acceptEdits"]);
    let own = sent(
        json!({"permissions": {"defaultMode": "acceptEdits"}}),
        Permission::Selected(PermissionMode::Default),
    );
    assert_eq!(mode_args(&launch(&s, &own, Some("conv")).1), ["default"]);
}

#[test]
fn st5_yolo_ignores_settings_mode() {
    let s = setup();
    let facts = sent(
        json!({"permissions": {"defaultMode": "plan"}}),
        Permission::Bypass,
    );
    let (file, argv) = launch(&s, &facts, None);
    assert_eq!(mode_args(&argv), ["bypassPermissions"]);
    assert_eq!(file["permissions"]["defaultMode"], "bypassPermissions");
    assert_eq!(file["skipDangerousModePermissionPrompt"], true);
}
