//! LC22, LC24: the memory command and the launch environment.
use super::*;

#[tokio::test]
async fn lc22_a_failed_memory_command_blocks() {
    use std::os::unix::fs::PermissionsExt;
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    for (_, role, pair) in lean_children().into_iter().take(2) {
        for mcp_off in [false, true] {
            for yolo in [false, true] {
                for resume in [None, Some("saved-conversation")] {
                    let mut s = setup();
                    s.dir = s.root.path().join("Project's checkout/.roundup");
                    s.cwd = s.dir.parent().unwrap().join("work");
                    std::fs::create_dir_all(&s.dir).unwrap();
                    s.rup = s.root.path().join("rup's program");
                    std::fs::write(&s.rup, "").unwrap();
                    std::fs::create_dir(&s.cwd).unwrap();
                    let memory = s.root.path().join("Claude's memory");
                    s.user_file(
                        "settings.json",
                        &json!({"autoMemoryDirectory":memory}).to_string(),
                    );
                    let pair = LaunchFacts {
                        mcp_off,
                        permission: if yolo {
                            agents::claude_code::Permission::Bypass
                        } else {
                            agents::claude_code::Permission::Inherit
                        },
                        ..pair.clone()
                    };
                    let argv = s.prepare_lean("7", role, &pair, resume).unwrap();
                    let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                    let hook = settings["hooks"]["PreToolUse"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|hook| hook["matcher"] == "Write|Edit")
                        .unwrap();
                    let command = hook["hooks"][0]["command"].as_str().unwrap();
                    for tool in ["Write", "Edit"] {
                        for failure in [
                            "panic",
                            "nonzero",
                            "allow-then-fail",
                            "TERM",
                            "KILL",
                            "missing",
                            "not-executable",
                        ] {
                            let script = match failure {
                                "panic" => "exit 101",
                                "nonzero" => "exit 1",
                                "allow-then-fail" => {
                                    "printf '%s\\n' '{\"hookSpecificOutput\":{\"permissionDecision\":\"allow\"}}'; exit 1"
                                }
                                "TERM" | "KILL" => "printf '%s\\n' \"$$\" >&2; exec sleep 3",
                                _ => "exit 0",
                            };
                            std::fs::write(&s.rup, format!("#!/bin/sh\n{script}\n")).unwrap();
                            std::fs::set_permissions(
                                &s.rup,
                                std::fs::Permissions::from_mode(if failure == "not-executable" {
                                    0o600
                                } else {
                                    0o700
                                }),
                            )
                            .unwrap();
                            if failure == "missing" {
                                std::fs::remove_file(&s.rup).unwrap();
                            }
                            let input = s.root.path().join("input.json");
                            std::fs::write(&input, serde_json::to_vec(&json!({
                                "tool_name":tool, "tool_input":{"file_path":s.cwd.join("source.rs")},
                                "permission_mode":if yolo { "bypassPermissions" } else { "default" }
                            })).unwrap()).unwrap();
                            let mut child = tokio::process::Command::new("bash")
                                .args(["-c", command])
                                .stdin(std::fs::File::open(&input).unwrap())
                                .stdout(Stdio::piped())
                                .stderr(Stdio::piped())
                                .kill_on_drop(true)
                                .spawn()
                                .unwrap();
                            if matches!(failure, "TERM" | "KILL") {
                                let mut text = String::new();
                                tokio::time::timeout(
                                    Duration::from_secs(2),
                                    BufReader::new(child.stderr.as_mut().unwrap())
                                        .read_line(&mut text),
                                )
                                .await
                                .expect("memory fixture announced readiness")
                                .unwrap();
                                let pid =
                                    rustix::process::Pid::from_raw(text.trim().parse().unwrap())
                                        .unwrap();
                                rustix::process::kill_process(
                                    pid,
                                    if failure == "TERM" {
                                        rustix::process::Signal::TERM
                                    } else {
                                        rustix::process::Signal::KILL
                                    },
                                )
                                .unwrap();
                            }
                            let output = tokio::time::timeout(
                                Duration::from_secs(4),
                                child.wait_with_output(),
                            )
                            .await
                            .expect("hook ended")
                            .unwrap();
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            assert_eq!(
                                output.status.code(),
                                Some(2),
                                "{role:?} {mcp_off} {yolo} {resume:?} {tool} {failure}: {stderr}"
                            );
                            assert!(
                                output.stdout.is_empty(),
                                "failed guard forwarded {:?}",
                                output.stdout
                            );
                            assert!(
                                stderr.contains("Memory guard failed")
                                    && stderr.contains("child Agent"),
                                "{failure}: {stderr}"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn lc24_the_launch_adds_only_its_listed_keys() {
    const LISTED: [&str; 9] = [
        "ROUNDUP_AGENT",
        "ROUNDUP_AGENT_ID",
        "ROUNDUP_TERMINAL",
        "PATH",
        "CLAUDE_CODE_FORCE_SYNC_OUTPUT",
        "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS",
        "CLAUDE_CODE_PLUGIN_DIR_WATCH",
        "ENABLE_TOOL_SEARCH",
        "", // A15's removed markers: `get_envs` reports a key with no value
    ];
    let user = json!({
        "env": {"USER_SECRET": "x", "ANTHROPIC_BASE_URL": "http://proxy.test"},
        "apiKeyHelper": "printf key", "model": "user-model", "enabledPlugins": {"x@y": true},
        "permissions": {"allow": ["Read(x)"], "deny": ["Read(.env)"], "defaultMode": "plan"},
        "hooks": {"Stop": []}, "mcpServers": {"theirs": {"command": "x"}},
    });
    let roles = lean_children()
        .into_iter()
        .map(|(_, role, pair)| (role, pair))
        .chain([(Role::Agent, LaunchFacts::default())]);
    for (role, pair) in roles {
        for pinned in [false, true] {
            let s = setup();
            s.user_file("settings.json", &user.to_string());
            let pair = LaunchFacts {
                model: pinned.then(|| "haiku".to_owned()),
                effort: pinned.then(|| "low".to_owned()),
                ..pair.clone()
            };
            let command = s
                .launcher()
                .command_on(&agents::claude_code::Request {
                    folders: folders(&s.dir),
                    id: "7",
                    attempt: "1",
                    cwd: &s.cwd,
                    resume: None,
                    role,
                    facts: &pair,
                })
                .unwrap();
            let label = format!("{role:?} pinned={pinned}");
            let argv: Vec<_> = command
                .get_args()
                .map(|arg| arg.to_str().unwrap().to_owned())
                .collect();
            assert_eq!(Setup::after(&argv, "--model").is_some(), pinned, "{label}");
            let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
            let launched = command
                .get_envs()
                .filter(|(_, value)| value.is_some())
                .map(|(key, _)| key.to_str().unwrap().to_owned());
            let in_settings = settings["env"].as_object().unwrap().keys().cloned();
            for key in launched.chain(in_settings) {
                assert!(LISTED.contains(&key.as_str()), "{label}: {key}");
            }
            for key in ["apiKeyHelper", "model", "enabledPlugins", "mcpServers"] {
                assert!(settings.get(key).is_none(), "{label}: {key} copied");
            }
            for key in ["deny", "defaultMode"] {
                assert!(settings["permissions"].get(key).is_none(), "{label}: {key}");
            }
            assert!(
                !settings["permissions"]["allow"]
                    .to_string()
                    .contains("Read(x)")
            );
            assert_eq!(
                settings["hooks"]["Stop"].as_array().unwrap().len(),
                1,
                "{label}"
            );
            let path = settings["env"]["PATH"].as_str().unwrap();
            let shim = std::env::split_paths(path).any(|d| d.ends_with("7.bin"));
            assert!(!shim, "{label}: no shim");
        }
    }
}
