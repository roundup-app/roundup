//! Permission choices at the Adapter launch seam.
use super::*;
use agents::claude_code::Pair;

#[test]
fn b2706_a_normal_start_passes_no_permission_mode() {
    let s = setup();
    let launcher = s.launcher();
    for setting in [Some("acceptEdits"), None] {
        if let Some(mode) = setting {
            let body = format!(r#"{{"permissions":{{"defaultMode":"{mode}"}}}}"#);
            std::fs::write(s.root.path().join("settings.json"), body).unwrap();
        }
        for resume in [None, Some("conv-1")] {
            let argv = launcher
                .prepare(folders(&s.dir), "7", "1", &s.cwd, resume, Role::Agent)
                .unwrap();
            assert!(!argv.iter().any(|a| a == "--permission-mode"), "{argv:?}");
            assert_eq!(argv.iter().any(|a| a == "--resume"), resume.is_some());
        }
    }
    let yolo = Pair {
        yolo: true,
        ..Pair::default()
    };
    let argv = launcher
        .prepare_on(folders(&s.dir), "7", "1", &s.cwd, None, Role::Agent, &yolo)
        .unwrap();
    let at = argv.iter().position(|a| a == "--permission-mode").unwrap();
    assert_eq!(argv[at + 1], "bypassPermissions");
    assert!(argv.iter().any(|a| a == "--dangerously-skip-permissions"));
}

#[test]
fn u3801_a_given_permission_mode_is_passed_to_claude_and_none_passes_nothing() {
    use contracts::agent::PermissionMode;
    let s = setup();
    let launcher = s.launcher();
    let modes = [
        (None, None),
        (Some(PermissionMode::Default), Some("default")),
        (Some(PermissionMode::AcceptEdits), Some("acceptEdits")),
        (Some(PermissionMode::Plan), Some("plan")),
        (Some(PermissionMode::Auto), Some("auto")),
    ];
    // Normal spawn, resume, and the fresh Door launch after a clear.
    for (role, resume) in [
        (Role::Agent, None),
        (Role::Agent, Some("conversation")),
        (Role::Door, None),
    ] {
        for (permission_mode, expected) in modes {
            for yolo in [false, true] {
                let pair = Pair {
                    permission_mode,
                    yolo,
                    ..Pair::default()
                };
                let argv = launcher
                    .prepare_on(folders(&s.dir), "7", "1", &s.cwd, resume, role, &pair)
                    .unwrap();
                let passed: Vec<_> = argv
                    .windows(2)
                    .filter(|a| a[0] == "--permission-mode")
                    .map(|a| a[1].as_str())
                    .collect();
                let expected: Vec<_> = if yolo {
                    Some("bypassPermissions")
                } else {
                    expected
                }
                .into_iter()
                .collect();
                assert_eq!(passed, expected, "{role:?} {resume:?} {pair:?}");
                assert_eq!(
                    argv.iter().any(|a| a == "--dangerously-skip-permissions"),
                    yolo
                );
                assert_eq!(argv.iter().any(|a| a == "--resume"), resume.is_some());
            }
        }
    }
}
