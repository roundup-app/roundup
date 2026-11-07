//! User settings, native permissions, gateway and renderer preservation across profiles.
use super::*;

#[test]
fn a3507b_settings_extend_the_user_setup() {
    let s = setup();
    let config = s.root.path().join("custom-config");
    std::fs::create_dir_all(&config).unwrap();
    let user = config.join("settings.json");
    let project = folders(&s.dir).project.join(".claude");
    std::fs::create_dir_all(&project).unwrap();
    let hook = json!({"matcher":"", "hooks":[{"type":"command", "command":"user-hook"}]});
    let files = [
        (
            user,
            json!({
                "unknownFuture": {"nested": {"user": true}},
                "model":"user-model", "apiKeyHelper":"user-helper",
                "env":{"ENABLE_TOOL_SEARCH":"user-choice", "USER_ONLY":"yes", "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS":"user-hooks", "CLAUDE_CODE_PLUGIN_DIR_WATCH":"user-watch"},
                "permissions":{"allow":["Read(user)", "mcp__roundup__*"], "ask":["Bash(*)"], "deny":["Read(secret)"], "defaultMode":"plan", "future":{"kept":true}},
                "hooks":{"Stop":[hook], "FutureEvent":[{"hooks":[{"type":"command", "command":"future-hook"}]}]}
            }),
        ),
        (
            project.join("settings.json"),
            json!({"env":{"LAYER":"project"}, "unknownFuture":{"nested":{"project":true}}, "model":"project-model"}),
        ),
        (
            project.join("settings.local.json"),
            json!({"env":{"LAYER":"local"}, "unknownFuture":{"nested":{"local":true}}, "model":"local-model"}),
        ),
    ];
    for (path, value) in &files {
        std::fs::write(path, value.to_string()).unwrap();
    }
    let before: Vec<_> = files
        .iter()
        .map(|(path, _)| std::fs::read(path).unwrap())
        .collect();
    for shell_default in [None, Some("shell-choice")] {
        let launcher = Launcher::from_vars(
            |name| match name {
                "CLAUDE_CONFIG_DIR" => Some(config.as_os_str().to_owned()),
                "ROUNDUP_RUP_BIN" => Some(s.rup.as_os_str().to_owned()),
                "ENABLE_TOOL_SEARCH" => shell_default.map(OsString::from),
                _ => None,
            },
            &s.rup,
        )
        .unwrap();
        for (_, role, pair) in
            lean_children()
                .into_iter()
                .chain([(Role::Agent, Role::Agent, LaunchFacts::default())])
        {
            for resume in [None, Some("saved")] {
                let command = launcher
                    .command_on(&agents::claude_code::Request {
                        folders: folders(&s.dir),
                        id: "7",
                        attempt: "1",
                        cwd: &s.cwd,
                        resume,
                        role,
                        facts: &pair,
                    })
                    .unwrap();
                let argv: Vec<_> = std::iter::once(command.get_program())
                    .chain(command.get_args())
                    .map(|arg| arg.to_str().unwrap().to_owned())
                    .collect();
                let env: std::collections::BTreeMap<_, _> = command.get_envs().collect();
                // A user default is Claude Code's to load: neither the process environment nor
                // the settings file names it.
                for key in [
                    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS",
                    "CLAUDE_CODE_PLUGIN_DIR_WATCH",
                ] {
                    assert_eq!(env.get(std::ffi::OsStr::new(key)), None, "{key}");
                }
                let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                for key in ["unknownFuture", "model", "apiKeyHelper"] {
                    assert!(settings.get(key).is_none(), "{key} copied");
                }
                let own_env = settings["env"].as_object().unwrap();
                for key in ["LAYER", "USER_ONLY", "ENABLE_TOOL_SEARCH"] {
                    assert!(!own_env.contains_key(key), "{key} copied");
                }
                assert_eq!(
                    settings["permissions"]
                        .as_object()
                        .unwrap()
                        .keys()
                        .filter(|key| *key != "allow")
                        .count(),
                    0
                );
                assert!(
                    !settings["permissions"]["allow"]
                        .to_string()
                        .contains("Read(user)")
                );
                let stop = settings["hooks"]["Stop"].as_array().unwrap();
                assert_eq!(stop.len(), 1);
                assert!(
                    stop[0]["hooks"][0]["command"]
                        .as_str()
                        .unwrap()
                        .contains("signal")
                );
                assert!(settings["hooks"].get("FutureEvent").is_none());
            }
        }
    }
    for ((path, _), original) in files.iter().zip(before) {
        assert_eq!(std::fs::read(path).unwrap(), original);
    }
}

// A3564b: a native question or permission prompt is the vendor's; no role's launch intercepts,
// answers or auto-allows it, and the user's own rules and hook survive.
#[test]
fn a3564b_native_questions_preserve_each_roles_setup() {
    let s = setup();
    let user = json!({
        "permissions": {
            "defaultMode": "auto",
            "allow": ["Bash(git status)", "Read(shared)"],
            "ask": ["Read(shared)", "Bash(*)"],
            "deny": ["Read(shared)", "Read(.env)"]
        },
        "hooks": {"PermissionRequest": [{"matcher":"", "hooks":[{"type":"command","command":"user-permission-hook"}]}]}
    });
    s.user_file("settings.json", &user.to_string());
    let source = std::fs::read(s.root.path().join("settings.json")).unwrap();
    let roles = lean_children()
        .into_iter()
        .map(|(row, role, pair)| (Some(row), role, pair))
        .chain([(None, Role::Agent, LaunchFacts::default())]);
    for (row, role, pair) in roles {
        for mcp in [true, false] {
            for resume in [None, Some("saved")] {
                let pair = LaunchFacts {
                    mcp_off: !mcp,
                    ..pair.clone()
                };
                let argv = s.prepare_lean("7", role, &pair, resume).unwrap();
                let label = format!("{row:?} mcp={mcp} resume={resume:?}");
                for flag in [
                    "--permission-mode",
                    "--dangerously-skip-permissions",
                    "--allow-dangerously-skip-permissions",
                    "--allowedTools",
                    "--disallowedTools",
                    "--permission-prompt-tool",
                ] {
                    assert!(!has(&argv, flag), "{label}: {flag}");
                }
                let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                // Claude Code loads the user's rules and hook itself; the file adds none.
                let rules = &settings["permissions"];
                for key in ["defaultMode", "ask", "deny"] {
                    assert!(rules.get(key).is_none(), "{label}: {key} copied");
                }
                for rule in rules["allow"].as_array().into_iter().flatten() {
                    let rule = rule.as_str().unwrap();
                    assert!(rule.starts_with("mcp__roundup__"), "{label}: added {rule}");
                }
                // Routine state hooks observe the request and no roundup command answers.
                let groups = settings["hooks"]["PermissionRequest"].as_array().unwrap();
                for group in groups {
                    let command = group["hooks"][0]["command"].as_str().unwrap();
                    assert!(command.contains("signal"), "{label}: {command}");
                    assert!(!command.contains("permission"), "{label}: {command}");
                }
                if let Some(tools) = Setup::after(&argv, "--tools") {
                    assert!(tools.split(',').any(|t| t == "AskUserQuestion"), "{label}");
                }
            }
        }
    }
    assert_eq!(
        std::fs::read(s.root.path().join("settings.json")).unwrap(),
        source,
        "the user's source settings changed"
    );
}

#[test]
fn a3507a_every_launch_keeps_the_users_gateway() {
    use agents::claude_code::{LaunchFacts, Lean, PROFILES};
    let s = setup();
    let headers = "x-wise-llm-gateway-team: fixture\nx-wise-llm-gateway-use-case: test";
    std::fs::write(s.root.path().join("settings.json"), json!({
        "env": {"ANTHROPIC_CUSTOM_HEADERS": headers, "ANTHROPIC_BASE_URL": "https://gateway.invalid"},
        "apiKeyHelper": "fixture-helper"
    }).to_string()).unwrap();
    let inherited = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "ANTHROPIC_PROFILE",
        "ANTHROPIC_FEDERATION_RULE_ID",
        "ANTHROPIC_ORGANIZATION_ID",
        "ANTHROPIC_BASE_URL",
    ]
    .map(|name| (name.to_owned(), "fixture-shell-value".to_owned()));
    let inspect = |command: &std::process::Command| {
        let argv: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        let selected = argv
            .windows(2)
            .find(|pair| pair[0] == "--settings")
            .unwrap()[1];
        let settings: Value = if selected.starts_with('{') {
            serde_json::from_str(selected).unwrap()
        } else {
            read(Path::new(selected))
        };
        // An Agent's Claude Code loads the gateway from the user's file; only the placement
        // call, which reads no user file, carries it in its settings.
        let carried = argv.contains(&"--no-session-persistence");
        if carried {
            assert_eq!(settings["apiKeyHelper"], "fixture-helper", "{argv:?}");
            assert_eq!(
                settings["env"]["ANTHROPIC_BASE_URL"],
                "https://gateway.invalid"
            );
            assert_eq!(settings["env"]["ANTHROPIC_CUSTOM_HEADERS"], headers);
        } else {
            assert!(settings.get("apiKeyHelper").is_none(), "{argv:?}");
            for key in ["ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS"] {
                assert!(settings["env"].get(key).is_none(), "{argv:?}");
            }
        }
        // Apply the actual command's additions/removals to the inherited shell fixture.
        let mut effective: std::collections::BTreeMap<_, _> =
            inherited.clone().into_iter().collect();
        for (key, value) in command.get_envs() {
            let key = key.to_str().unwrap();
            match value {
                Some(value) => {
                    effective.insert(key.into(), value.to_str().unwrap().into());
                }
                None => {
                    effective.remove(key);
                }
            }
        }
        for (key, value) in &inherited {
            assert_eq!(effective.get(key), Some(value), "{key}: {argv:?}");
        }
    };
    let launcher = s.launcher();
    let rows = std::iter::once((Role::Agent, LaunchFacts::default())).chain(PROFILES.iter().map(
        |(role, _)| {
            (
                *role,
                LaunchFacts {
                    lean: Some(Lean {
                        scout: *role == Role::Scout,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
        },
    ));
    for (role, pair) in rows {
        for resume in [None, Some("saved")] {
            inspect(
                &launcher
                    .command_on(&agents::claude_code::Request {
                        folders: folders(&s.dir),
                        id: "7",
                        attempt: "1",
                        cwd: &s.cwd,
                        resume,
                        role,
                        facts: &pair,
                    })
                    .unwrap(),
            );
        }
    }
    let empty = tempfile::tempdir().unwrap();
    inspect(
        launcher
            .placement()
            .in_project(folders(&s.dir).project)
            .command(empty.path())
            .unwrap()
            .0
            .as_std(),
    );
}

#[test]
fn a3516c_all_profiles_keep_the_renderer_choice() {
    let s = setup();
    let config = s.root.path().join("chosen-config");
    std::fs::create_dir_all(&config).unwrap();
    let config_text = config.to_str().unwrap();
    let launcher = Launcher::from_vars(
        vars(&[
            ("CLAUDE_CONFIG_DIR", config_text),
            ("ROUNDUP_RUP_BIN", s.rup.to_str().unwrap()),
            ("HOME", s.root.path().to_str().unwrap()),
        ]),
        &s.rup.with_file_name("fake-daemon"),
    )
    .unwrap();
    for tui in [Some("fullscreen"), Some("default"), None] {
        for overrides in [false, true] {
            let mut source = json!({});
            if let Some(tui) = tui {
                source["tui"] = json!(tui);
            }
            if overrides {
                source["env"] = json!({
                    "CLAUDE_CODE_NO_FLICKER": "0",
                    "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN": "1"
                });
            }
            std::fs::write(config.join("settings.json"), source.to_string()).unwrap();
            for (_, role, pair) in
                std::iter::once((Role::Agent, Role::Agent, LaunchFacts::default()))
                    .chain(lean_children())
            {
                for resume in [None, Some("saved-conversation")] {
                    let command = launcher
                        .command_on(&agents::claude_code::Request {
                            folders: folders(&s.dir),
                            id: "7",
                            attempt: "1",
                            cwd: &s.cwd,
                            resume,
                            role,
                            facts: &pair,
                        })
                        .unwrap();
                    let argv: Vec<String> = std::iter::once(command.get_program())
                        .chain(command.get_args())
                        .map(|arg| arg.to_str().unwrap().to_owned())
                        .collect();
                    let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                    assert!(settings.get("tui").is_none());
                    for name in [
                        "CLAUDE_CODE_NO_FLICKER",
                        "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN",
                    ] {
                        assert!(settings["env"].get(name).is_none());
                        // Neither a shell override nor its inherited configuration directory is removed or overwritten.
                        assert!(
                            !command
                                .get_envs()
                                .any(|(key, _)| key == name || key == "CLAUDE_CONFIG_DIR")
                        );
                    }
                }
            }
        }
    }
}
