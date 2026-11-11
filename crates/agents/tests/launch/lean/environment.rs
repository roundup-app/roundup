//! LC24, LC26: the launch environment and the settings the user keeps.
use super::*;

#[test]
fn lc26_the_users_hooks_and_permissions_pass_through() {
    for (row, role, pair) in
        lean_children()
            .into_iter()
            .chain([(Role::Agent, Role::Agent, LaunchFacts::default())])
    {
        let s = setup();
        s.user_file("settings.json", &json!({
            "permissions":{"allow":["Read(user)"],"ask":["Edit(*)"],"deny":["Write(**/secret.md)"],"defaultMode":"plan"},
            "autoMemoryEnabled":false,"autoMemoryDirectory":"/user-memory",
            "env":{"CLAUDE_CODE_DISABLE_AUTO_MEMORY":"1"},
            "hooks":{"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"user-guard"}]}]}
        }).to_string());
        let argv = s.prepare_lean("7", role, &pair, None).unwrap();
        let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
        for key in ["autoMemoryEnabled", "autoMemoryDirectory"] {
            assert!(settings.get(key).is_none(), "{row:?}: {key}");
        }
        assert!(
            settings["env"]
                .get("CLAUDE_CODE_DISABLE_AUTO_MEMORY")
                .is_none()
        );
        for key in ["ask", "deny", "defaultMode"] {
            assert!(settings["permissions"].get(key).is_none(), "{row:?}: {key}");
        }
        let allow = settings["permissions"]["allow"].to_string();
        assert!(
            !allow.contains("Write") && !allow.contains("Edit"),
            "{row:?}"
        );
        let hooks = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            hooks.iter().all(|hook| hook["matcher"] != "Write|Edit"),
            "{row:?}"
        );
        assert!(!settings.to_string().contains("claude-memory"), "{row:?}");
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
