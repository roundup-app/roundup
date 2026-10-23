//! LC1–LC14: lean launch profiles and extras.
use super::*;

use agents::claude_code::{Lean, Pair};
use contracts::agent::Extras;

fn lean_pair(scout: bool, extras: Extras) -> Pair {
    Pair {
        lean: Some(Lean {
            scout,
            extras,
            fresh_brief: false,
        }),
        ..Pair::default()
    }
}

impl Setup {
    fn prepare_lean(
        &self,
        id: &str,
        role: Role,
        pair: &Pair,
        resume: Option<&str>,
    ) -> Result<Vec<String>, rpc::RpcError> {
        self.launcher()
            .prepare_on(folders(&self.dir), id, "1", &self.cwd, resume, role, pair)
    }

    /// The word after `flag`, or `None` when it is absent.
    fn after<'a>(argv: &'a [String], flag: &str) -> Option<&'a str> {
        let at = argv.iter().position(|arg| arg == flag)?;
        argv.get(at + 1).map(String::as_str)
    }

    fn user_file(&self, name: &str, text: &str) {
        let path = self.root.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }
}

fn has(argv: &[String], flag: &str) -> bool {
    argv.iter().any(|arg| arg == flag)
}

/// The three lean children of the LC1 table: a Door, a scout and a worker.
fn lean_children() -> [(Role, Role, Pair); 3] {
    [
        (Role::Door, Role::Door, Pair::default()),
        (Role::Scout, Role::Agent, lean_pair(true, Extras::default())),
        (
            Role::Agent,
            Role::Agent,
            lean_pair(false, Extras::default()),
        ),
    ]
}

#[test]
fn lc1_each_role_launches_as_its_row() {
    for (row, role, pair) in lean_children() {
        for mcp in [true, false] {
            let s = setup();
            std::fs::write(
                s.dir.parent().unwrap().join("CLAUDE.md"),
                "PROJECT_INSTRUCTION_MARKER",
            )
            .unwrap();
            let pair = Pair {
                mcp_off: !mcp,
                ..pair.clone()
            };
            let argv = s.prepare_lean("7", role, &pair, None).unwrap();
            let tools = match (row, mcp) {
                (Role::Door, true) => Some("Read,Grep,Glob,ToolSearch,Skill"),
                (Role::Door, false) => Some("Read,Grep,Glob,Skill"),
                (Role::Scout, true) => Some("Read,Grep,Glob,Bash,ToolSearch"),
                (Role::Scout, false) => Some("Read,Grep,Glob,Bash"),
                _ => None,
            };
            assert_eq!(Setup::after(&argv, "--tools"), tools, "{row:?} mcp={mcp}");
            assert_eq!(
                has(&argv, "--disable-slash-commands"),
                row == Role::Scout,
                "{row:?}"
            );
            let brief = std::fs::read_to_string(
                Setup::after(&argv, "--append-system-prompt-file").unwrap(),
            )
            .unwrap();
            assert!(brief.contains("PROJECT_INSTRUCTION_MARKER"), "{row:?}");
            assert_eq!(
                brief.contains(&asset("hold-plain.md")),
                row == Role::Agent,
                "{row:?}: the vendored Plain body is the worker's"
            );
        }
    }
}

#[test]
fn lc2_a_child_starts_from_its_own_settings() {
    for (row, role, pair) in lean_children() {
        let s = setup();
        s.user_file(
            "settings.json",
            &json!({
                "permissions": {"allow": ["Bash(git status)", "mcp__roundup__*"], "deny": ["Read(.env)"], "defaultMode": "plan"},
                "apiKeyHelper": "printf key",
                "env": {"ANTHROPIC_BASE_URL": "http://proxy.test", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "0"},
                "outputStyle": "Explanatory",
                "autoMemoryEnabled": true,
                "autoMemoryDirectory": "/user-memory",
                "enabledPlugins": {"x@y": true},
                "mcpServers": {"theirs": {"command": "x"}},
                "hooks": {"Stop": []}
            })
            .to_string(),
        );
        let argv = s.prepare_lean("7", role, &pair, None).unwrap();
        assert_eq!(
            Setup::after(&argv, "--setting-sources"),
            Some(""),
            "{row:?}"
        );
        assert!(has(&argv, "--strict-mcp-config") && has(&argv, "--mcp-config"));
        let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
        if row == Role::Door {
            assert!(
                settings["permissions"]["allow"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("mcp__roundup__agent_spawn"))
            );
        } else {
            assert_eq!(
                settings["permissions"]["allow"],
                json!(["Bash(git status)", "mcp__roundup__*"]),
                "a rule once"
            );
        }
        assert_eq!(settings["permissions"]["deny"], json!(["Read(.env)"]));
        // A3507b: every unnamed key carries over, including env and permission mode.
        assert_eq!(settings["permissions"]["defaultMode"], "plan");
        assert_eq!(settings["env"]["CLAUDE_CODE_DISABLE_AUTO_MEMORY"], "1");
        for dropped in [
            "outputStyle",
            "enabledPlugins",
            "mcpServers",
            "autoMemoryEnabled",
            "autoMemoryDirectory",
        ] {
            assert!(settings.get(dropped).is_none(), "{dropped}");
        }
        assert!(
            settings["hooks"]["Stop"][0]["hooks"][0]["command"]
                .as_str()
                .unwrap()
                .contains("signal")
        );
    }
}

#[tokio::test]
async fn lc2_the_users_output_style_shapes_a_child() {
    for output_style in [Some("Learning"), None] {
        for (row, role, pair) in
            lean_children()
                .into_iter()
                .chain([(Role::Agent, Role::Agent, Pair::default())])
        {
            let s = setup();
            s.user_file("CLAUDE.md", "USER GLOBAL RULE");
            let mut user = json!({"enabledPlugins":{"p@m":true},"mcpServers":{"a":{"command":"a"}},"autoMemoryEnabled":true,"autoMemoryDirectory":"/user-memory"});
            if let Some(style) = output_style {
                user["outputStyle"] = json!(style);
            }
            s.user_file("settings.json", &user.to_string());
            let (argv, env) = plugin_launcher(&s)
                .launch_on(folders(&s.dir), "7", "1", &s.cwd, None, role, &pair)
                .await
                .unwrap();
            for flag in [
                "--strict-mcp-config",
                "--setting-sources",
                "--disable-slash-commands",
            ] {
                assert!(!has(&argv, flag), "{row:?}: {flag}");
            }
            assert!(!env.contains_key("CLAUDE_CODE_DISABLE_AUTO_MEMORY"));
            assert_eq!(argv.iter().filter(|arg| *arg == "--plugin-dir").count(), 3);
            let tools = match row {
                Role::Door => Some("Read,Grep,Glob,ToolSearch,Skill"),
                Role::Scout => Some("Read,Grep,Glob,Bash,ToolSearch"),
                Role::Agent => None,
            };
            assert_eq!(Setup::after(&argv, "--tools"), tools);
            let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
            for (key, value) in user.as_object().unwrap() {
                assert_eq!(&settings[key], value, "{row:?}: {key}");
            }
            assert!(
                !settings["env"]
                    .as_object()
                    .unwrap()
                    .contains_key("CLAUDE_CODE_DISABLE_AUTO_MEMORY")
            );
            let brief = std::fs::read_to_string(
                Setup::after(&argv, "--append-system-prompt-file").unwrap(),
            )
            .unwrap();
            assert!(brief.contains("USER GLOBAL RULE"));
            assert_eq!(
                brief.contains("hold:Plain"),
                output_style.is_none(),
                "{row:?}"
            );
            assert_eq!(
                brief.contains(&asset("hold-plain.md")),
                output_style.is_none() && row == Role::Agent
            );
            if output_style.is_none() {
                assert!(settings.get("outputStyle").is_none());
            }
        }
    }
}

#[test]
fn lc3_the_door_launches_lean_and_its_brief_omits_the_plain_body() {
    let s = setup();
    s.user_file("CLAUDE.md", "USER GLOBAL RULE");
    let argv = s.prepare_as("7", Role::Door).unwrap();
    assert_eq!(
        Setup::after(&argv, "--tools"),
        Some("Read,Grep,Glob,ToolSearch,Skill")
    );
    assert!(!has(&argv, "--disable-slash-commands"));
    assert_eq!(Setup::after(&argv, "--setting-sources"), Some(""));
    assert!(!has(&argv, "--plugin-dir"));
    let text = std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
        .unwrap();
    assert!(!text.contains(&asset("hold-plain.md")));
    assert!(!text.contains("USER GLOBAL RULE"));
    assert!(text.contains("Where the Project's `CLAUDE.md` asks for something else, follow it."));
    assert!(!text.contains("hold:Plain"));
}

#[test]
fn lc4_a_scout_launches_with_read_tools_and_no_user_instructions() {
    let s = setup();
    s.user_file("CLAUDE.md", "USER GLOBAL RULE");
    let pair = Pair {
        model: Some("haiku".into()),
        effort: Some("low".into()),
        ..lean_pair(true, Extras::default())
    };
    let argv = s.prepare_lean("7", Role::Agent, &pair, None).unwrap();
    assert_eq!(
        Setup::after(&argv, "--tools"),
        Some("Read,Grep,Glob,Bash,ToolSearch")
    );
    assert!(has(&argv, "--disable-slash-commands"));
    assert_eq!(Setup::after(&argv, "--model"), Some("haiku"));
    assert_eq!(Setup::after(&argv, "--effort"), Some("low"));
    let text = std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
        .unwrap();
    assert!(!text.contains("USER GLOBAL RULE"));
    let old: contracts::agent::SpawnParams =
        serde_json::from_value(json!({"cwd": "/x", "prompt": null, "parent": null})).unwrap();
    assert_eq!(old.scout, None);
}

#[tokio::test]
async fn lc5_a_worker_gets_the_plugins_and_global_instructions() {
    let s = setup();
    s.user_file("CLAUDE.md", "USER GLOBAL RULE");
    let launcher = plugin_launcher(&s);
    let (argv, _) = launcher
        .launch_on(
            folders(&s.dir),
            "7",
            "1",
            &s.cwd,
            None,
            Role::Agent,
            &lean_pair(false, Extras::default()),
        )
        .await
        .unwrap();
    assert!(!has(&argv, "--disable-slash-commands"));
    assert!(!has(&argv, "--tools"));
    assert_eq!(argv.iter().filter(|arg| *arg == "--plugin-dir").count(), 3);
    let text = std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
        .unwrap();
    assert!(text.contains("## The user's global instructions (read-only)\n\nUSER GLOBAL RULE"));
}

#[tokio::test]
async fn lc5_only_the_door_among_lean_children_gets_hope() {
    for (row, role, pair) in lean_children().into_iter().take(2) {
        let s = setup();
        let launcher = plugin_launcher(&s);
        let (argv, env) = launcher
            .launch_on(folders(&s.dir), "7", "1", &s.cwd, None, role, &pair)
            .await
            .unwrap();
        let names: Vec<_> = argv
            .windows(2)
            .filter(|pair| pair[0] == "--plugin-dir")
            .map(|pair| {
                read(&Path::new(&pair[1]).join(".claude-plugin/plugin.json"))["name"].clone()
            })
            .collect();
        let want = match row {
            Role::Door => json!(["hope"]),
            _ => json!([]),
        };
        assert_eq!(json!(names), want, "{row:?}");
        let brief =
            std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
                .unwrap();
        assert_eq!(brief.contains("hope:intent"), row == Role::Door, "{row:?}");
        assert_eq!(env["CLAUDE_CODE_DISABLE_AUTO_MEMORY"], "1");
    }
}

#[tokio::test]
async fn lc14_a_door_without_the_intent_skill_starts_and_says_so() {
    let s = setup();
    let launcher = plugin_launcher(&s).without_intent_skill();
    let (argv, _) = launcher
        .launch_on(
            folders(&s.dir),
            "7",
            "1",
            &s.cwd,
            None,
            Role::Door,
            &Default::default(),
        )
        .await
        .expect("a missing skill never fails the start");
    let status_line = |argv: &[String]| {
        read(Path::new(Setup::after(argv, "--settings").unwrap()))["statusLine"]["command"]
            .as_str()
            .map(str::to_owned)
    };
    let shown = std::process::Command::new("sh")
        .args(["-c", &status_line(&argv).unwrap()])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(shown.stdout).unwrap(),
        agents::claude_code::INTENT_MISSING
    );
    let names: Vec<_> = argv
        .windows(2)
        .filter(|pair| pair[0] == "--plugin-dir")
        .map(|pair| read(&Path::new(&pair[1]).join(".claude-plugin/plugin.json"))["name"].clone())
        .collect();
    assert_eq!(json!(names), json!([]));
    let brief =
        std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
            .unwrap();
    assert!(!brief.contains("hope:intent"));
    // Only a Door says so; a worker's start is the same.
    let (worker, _) = launcher
        .launch_on(
            folders(&s.dir),
            "8",
            "1",
            &s.cwd,
            None,
            Role::Agent,
            &lean_pair(false, Extras::default()),
        )
        .await
        .unwrap();
    assert_eq!(status_line(&worker), None);
}

#[tokio::test]
async fn lc6_a_user_started_agent_keeps_the_users_setup() {
    let s = setup();
    s.user_file("settings.json", r#"{"permissions":{"allow":["Read(x)"]}}"#);
    let launcher = plugin_launcher(&s);
    let (argv, env) = launcher
        .launch_on(
            folders(&s.dir),
            "7",
            "1",
            &s.cwd,
            None,
            Role::Agent,
            &Pair::default(),
        )
        .await
        .unwrap();
    for flag in [
        "--setting-sources",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--tools",
    ] {
        assert!(!has(&argv, flag), "{flag}");
    }
    assert!(!env.contains_key("CLAUDE_CODE_DISABLE_AUTO_MEMORY"));
    assert!(has(&argv, "--settings") && has(&argv, "--mcp-config"));
    let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
    assert_eq!(
        settings["permissions"]["allow"],
        json!(["Read(x)", "mcp__roundup__*"])
    );
    assert_eq!(argv.iter().filter(|arg| *arg == "--plugin-dir").count(), 3);
}

/// A Project skill, a user plugin and a user MCP server, for LC7 and LC8.
fn with_extras(s: &Setup) {
    let skill = s.dir.parent().unwrap().join(".claude/skills/zzskill");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("SKILL.md"), "---\nname: zzskill\n---\n").unwrap();
    let plugin = s.root.path().join("cache/zzplug");
    std::fs::create_dir_all(&plugin).unwrap();
    s.user_file(
        "plugins/installed_plugins.json",
        &json!({"version": 2, "plugins": {"zzplug@market": [{"installPath": plugin}]}}).to_string(),
    );
    std::fs::write(
        &s.claude_json,
        json!({"mcpServers": {"zzserver": {"type": "http", "url": "https://x"}}}).to_string(),
    )
    .unwrap();
}

#[test]
fn lc7_a_known_extra_joins_the_start() {
    let s = setup();
    with_extras(&s);
    let extras = Extras {
        skills: vec!["zzskill".into()],
        plugins: vec!["zzplug".into()],
        mcp: vec!["zzserver".into()],
    };
    let argv = s
        .prepare_lean("7", Role::Agent, &lean_pair(true, extras), None)
        .unwrap();
    // A listed skill needs slash commands on.
    assert!(!has(&argv, "--disable-slash-commands"));
    let dirs: Vec<&str> = argv
        .windows(2)
        .filter(|pair| pair[0] == "--plugin-dir")
        .map(|pair| pair[1].as_str())
        .collect();
    assert_eq!(dirs.len(), 2);
    assert!(Path::new(dirs[0]).join("skills/zzskill/SKILL.md").is_file());
    assert!(dirs[1].ends_with("cache/zzplug"));
    let config = read(Path::new(Setup::after(&argv, "--mcp-config").unwrap()));
    assert_eq!(config["mcpServers"]["zzserver"]["url"], "https://x");
    assert!(config["mcpServers"]["roundup"].is_object());
}

#[test]
fn lc7_an_unknown_extra_fails_the_start_and_is_named() {
    let s = setup();
    with_extras(&s);
    let extras = Extras {
        skills: vec!["nope".into()],
        plugins: vec!["zzplug".into(), "ghost".into()],
        mcp: vec!["slack".into()],
    };
    let err = s
        .prepare_lean("7", Role::Agent, &lean_pair(false, extras), None)
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    for named in ["skill nope", "plugin ghost", "mcp server slack"] {
        assert!(err.message.contains(named), "{}", err.message);
    }
    assert!(!err.message.contains("plugin zzplug"));
    assert!(
        !s.dir.join("agents/7.settings.json").exists(),
        "nothing starts"
    );
    let listed = agents::claude_code::extras::available(
        &s.launcher().extras_sources(s.dir.parent().unwrap()),
    );
    assert_eq!(listed.skills, ["zzskill"]);
    assert_eq!(listed.plugins, ["zzplug@market"]);
    assert_eq!(listed.mcp, ["zzserver"]);
}

#[test]
fn lc7_the_extras_are_in_no_start_text() {
    let s = setup();
    with_extras(&s);
    let brief = brief(&s, "7", Role::Door);
    let argv = s.prepare_as("7", Role::Door).unwrap();
    let settings = std::fs::read_to_string(Setup::after(&argv, "--settings").unwrap()).unwrap();
    for name in ["zzskill", "zzplug", "zzserver"] {
        assert!(!brief.contains(name) && !settings.contains(name), "{name}");
    }
}

#[test]
fn lc8_a_missing_extra_relaunches_with_resume_and_snapshot_off() {
    let s = setup();
    let fresh = Lean {
        fresh_brief: true,
        ..Lean::default()
    };
    let pair = Pair {
        lean: Some(fresh),
        ..Pair::default()
    };
    let resumed = s
        .prepare_lean("7", Role::Agent, &pair, Some("conv-1"))
        .unwrap();
    assert_eq!(
        Setup::after(&resumed, "--system-prompt-snapshot"),
        Some("off")
    );
    assert_eq!(Setup::after(&resumed, "--resume"), Some("conv-1"));
    for other in [
        s.prepare_lean(
            "7",
            Role::Agent,
            &lean_pair(false, Extras::default()),
            Some("conv-1"),
        )
        .unwrap(),
        s.prepare_lean("7", Role::Agent, &pair, None).unwrap(),
    ] {
        assert!(!has(&other, "--system-prompt-snapshot"));
    }
    // The kept profile survives a Daemon restart and is cleared once applied.
    let dir = s.dir.canonicalize().unwrap();
    Launcher::save_lean(&dir, "7", pair.lean.as_ref().unwrap()).unwrap();
    assert_eq!(Launcher::load_lean(&dir, "7"), pair.lean);
    Launcher::discard(&dir, "7").unwrap();
    assert_eq!(Launcher::load_lean(&dir, "7"), None);
}

#[test]
fn lc10_no_launch_uses_bare_safe_mode_or_agent() {
    for (_, role, pair) in
        lean_children()
            .into_iter()
            .chain([(Role::Agent, Role::Agent, Pair::default())])
    {
        let s = setup();
        let argv = s.prepare_lean("7", role, &pair, Some("c")).unwrap();
        for flag in ["--bare", "--safe-mode", "--agent"] {
            assert!(!has(&argv, flag), "{flag}");
        }
    }
}

#[test]
fn lc11_the_doors_start_allows_no_shell_or_terminal_start() {
    for (mcp, carry_user_rules) in [(true, false), (true, true), (false, false), (false, true)] {
        let s = setup();
        if carry_user_rules {
            s.user_file("settings.json", &json!({"permissions":{"allow":["Bash(*)","PowerShell","mcp__roundup__terminal_spawn","mcp__roundup__terminal_open","mcp__roundup__terminal_write","mcp__roundup__agent_run","mcp__roundup__*","Read(*)"]}}).to_string());
        }
        let argv = s
            .prepare_lean(
                "7",
                Role::Door,
                &Pair {
                    mcp_off: !mcp,
                    ..Pair::default()
                },
                None,
            )
            .unwrap();
        let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
        let allowed = settings["permissions"]["allow"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for forbidden in [
            "Bash",
            "PowerShell",
            "terminal_spawn",
            "terminal_open",
            "terminal_write",
        ] {
            assert!(!Setup::after(&argv, "--tools").unwrap().contains(forbidden));
            assert_eq!(
                allowed
                    .iter()
                    .any(|rule| rule.as_str().unwrap().contains(forbidden)),
                carry_user_rules,
                "only user rules may name {forbidden}"
            );
        }
        assert_eq!(
            allowed.contains(&json!("mcp__roundup__*")),
            carry_user_rules
        );
        assert_eq!(allowed.contains(&json!("Read(*)")), carry_user_rules);
    }
}

#[test]
fn lc11_the_brief_names_a_standing_specialist_and_a_job_sized_child() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    for token in ["standing specialist", "job-sized"] {
        assert!(text.contains(token), "{token}");
    }
}

#[test]
fn lc12_the_brief_names_the_specialist_field() {
    assert!(brief(&setup(), "7", Role::Door).contains("`specialist: \"<name>\"`"));
}

#[test]
fn lc13_the_brief_sizes_a_job_under_160k() {
    let text = brief(&setup(), "7", Role::Door);
    for token in ["160k", "whole job"] {
        assert!(text.contains(token), "{token}");
    }
}

#[test]
fn a2703a_brief_teaches_rail_names() {
    let s = setup();
    for role in [Role::Door, Role::Agent] {
        let text = brief(&s, "7013", role);
        assert!(
            text.contains("Your Rail name and where you stand are in the Context you get at start")
        );
        assert!(text.contains("Refer to yourself and other Agents by Rail name, never by id"));
        assert!(!text.contains("7013") && !text.contains("the id never changes"));
    }
}

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
                .chain([(Role::Agent, Role::Agent, Pair::default())])
        {
            for resume in [None, Some("saved")] {
                let command = launcher
                    .command_on(folders(&s.dir), "7", "1", &s.cwd, resume, role, &pair)
                    .unwrap();
                let argv: Vec<_> = std::iter::once(command.get_program())
                    .chain(command.get_args())
                    .map(|arg| arg.to_str().unwrap().to_owned())
                    .collect();
                let env: std::collections::BTreeMap<_, _> = command.get_envs().collect();
                assert_eq!(
                    env.get(std::ffi::OsStr::new("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS")),
                    Some(&Some(std::ffi::OsStr::new("user-hooks")))
                );
                assert_eq!(
                    env.get(std::ffi::OsStr::new("CLAUDE_CODE_PLUGIN_DIR_WATCH")),
                    Some(&Some(std::ffi::OsStr::new("user-watch")))
                );
                let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                assert_eq!(
                    settings["unknownFuture"],
                    json!({"nested":{"user":true,"project":true,"local":true}})
                );
                assert_eq!(settings["model"], "local-model");
                assert_eq!(settings["env"]["LAYER"], "local");
                assert_eq!(settings["env"]["USER_ONLY"], "yes");
                assert_eq!(settings["env"]["ENABLE_TOOL_SEARCH"], "user-choice");
                assert_eq!(settings["permissions"]["ask"], json!(["Bash(*)"]));
                assert_eq!(settings["permissions"]["deny"], json!(["Read(secret)"]));
                assert_eq!(settings["permissions"]["defaultMode"], "plan");
                assert_eq!(settings["permissions"]["future"], json!({"kept":true}));
                let allow = settings["permissions"]["allow"].as_array().unwrap();
                assert!(allow.contains(&json!("Read(user)")));
                assert_eq!(
                    allow
                        .iter()
                        .filter(|v| **v == json!("mcp__roundup__*"))
                        .count(),
                    1
                );
                let stop = settings["hooks"]["Stop"].as_array().unwrap();
                assert!(stop.contains(&hook));
                assert_eq!(stop.len(), 2);
                assert!(stop.iter().any(|group| {
                    group["hooks"][0]["command"]
                        .as_str()
                        .unwrap()
                        .contains("signal")
                }));
                assert_eq!(
                    settings["hooks"]["FutureEvent"][0]["hooks"][0]["command"],
                    "future-hook"
                );
            }
        }
    }
    for ((path, _), original) in files.iter().zip(before) {
        assert_eq!(std::fs::read(path).unwrap(), original);
    }
}
