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
                (Role::Door, true) => Some("Read,Grep,Glob,ToolSearch,Skill,AskUserQuestion"),
                (Role::Door, false) => Some("Read,Grep,Glob,Skill,AskUserQuestion"),
                (Role::Scout, true) => Some("Read,Grep,Glob,Bash,ToolSearch,AskUserQuestion"),
                (Role::Scout, false) => Some("Read,Grep,Glob,Bash,AskUserQuestion"),
                _ => None,
            };
            assert_eq!(Setup::after(&argv, "--tools"), tools, "{row:?} mcp={mcp}");
            assert!(!has(&argv, "--disable-slash-commands"), "{row:?}");
            let brief = std::fs::read_to_string(
                Setup::after(&argv, "--append-system-prompt-file").unwrap(),
            )
            .unwrap();
            assert!(brief.contains("PROJECT_INSTRUCTION_MARKER"), "{row:?}");
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
        assert!(!has(&argv, "--setting-sources"));
        assert!(!has(&argv, "--strict-mcp-config") && has(&argv, "--mcp-config"));
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
        assert_eq!(settings["env"]["CLAUDE_CODE_DISABLE_AUTO_MEMORY"], "0");
        for kept in [
            "outputStyle",
            "enabledPlugins",
            "mcpServers",
            "autoMemoryEnabled",
            "autoMemoryDirectory",
        ] {
            assert!(settings.get(kept).is_some(), "{kept}");
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
            let launcher = plugin_launcher(&s);
            let (argv, env) = launcher
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
                Role::Door => Some("Read,Grep,Glob,ToolSearch,Skill,AskUserQuestion"),
                Role::Scout => Some("Read,Grep,Glob,Bash,ToolSearch,AskUserQuestion"),
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
            let brief = std::fs::read_to_string(s.dir.join("agents/7.brief.md")).unwrap();
            assert!(brief.contains("USER GLOBAL RULE"));
        }
    }
}

#[tokio::test]
async fn lc3_the_door_launches_with_the_users_setup_and_its_brief_omits_the_plain_body() {
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
            Role::Door,
            &Pair::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        Setup::after(&argv, "--tools"),
        Some("Read,Grep,Glob,ToolSearch,Skill,AskUserQuestion")
    );
    assert!(!has(&argv, "--disable-slash-commands"));
    assert!(!has(&argv, "--setting-sources"));
    assert_eq!(argv.iter().filter(|arg| *arg == "--plugin-dir").count(), 3);
    let text = std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
        .unwrap();
    assert!(text.contains("USER GLOBAL RULE"));
}

#[test]
fn lc4_a_scout_launches_with_read_tools_and_the_users_setup() {
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
        Some("Read,Grep,Glob,Bash,ToolSearch,AskUserQuestion")
    );
    assert!(!has(&argv, "--disable-slash-commands"));
    assert_eq!(Setup::after(&argv, "--model"), Some("haiku"));
    assert_eq!(Setup::after(&argv, "--effort"), Some("low"));
    let text = std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
        .unwrap();
    assert!(text.contains("USER GLOBAL RULE"));
    let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
    assert_eq!(settings["env"]["CLAUDE_CODE_DISABLE_CLAUDE_MDS"], "1");
    let old: contracts::agent::SpawnParams =
        serde_json::from_value(json!({"cwd": "/x", "prompt": null, "parent": null})).unwrap();
    assert_eq!(old.scout, None);
}

#[tokio::test]
async fn lc5_every_child_gets_the_plugins_and_global_instructions() {
    for (row, role, pair) in lean_children() {
        let s = setup();
        s.user_file("CLAUDE.md", "USER GLOBAL RULE");
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
        assert_eq!(json!(names), json!(["hope", "hunch", "hold"]), "{row:?}");
        let brief =
            std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
                .unwrap();
        assert!(
            brief.contains("## The user's global instructions (read-only)\n\nUSER GLOBAL RULE")
        );
        assert_eq!(brief.contains("hope:intent"), row == Role::Door, "{row:?}");
        assert!(!env.contains_key("CLAUDE_CODE_DISABLE_AUTO_MEMORY"));
    }
}

#[tokio::test]
async fn lc5_a_users_installed_plugin_replaces_its_bundled_copy() {
    for (enabled, want) in [
        (
            json!({"hope@personal":true,"hunch@personal":true,"hold@personal":true}),
            json!([]),
        ),
        (
            json!({"hope@personal":false,"hunch@personal":false,"hold@personal":false}),
            json!(["hope", "hunch", "hold"]),
        ),
        (
            json!({"hope@personal":true,"hunch@personal":false,"hold@personal":true}),
            json!(["hunch"]),
        ),
    ] {
        for (row, role, pair) in lean_children() {
            let s = setup();
            let install = s.root.path().join("user-plugin");
            std::fs::create_dir_all(install.join("skills/intent")).unwrap();
            std::fs::write(install.join("skills/intent/SKILL.md"), "USER INTENT").unwrap();
            s.user_file(
                "settings.json",
                &json!({"enabledPlugins":enabled}).to_string(),
            );
            s.user_file(
                "plugins/installed_plugins.json",
                &json!({"version":2,"plugins":{
                    "hope@personal":[{"installPath":install}],
                    "hunch@personal":[{"installPath":install}],
                    "hold@personal":[{"installPath":install}]
                }})
                .to_string(),
            );
            let launcher = plugin_launcher(&s);
            let launcher = if row == Role::Door && enabled["hope@personal"] == true {
                launcher.without_intent_skill()
            } else {
                launcher
            };
            let (argv, _) = launcher
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
            assert_eq!(json!(names), want, "{row:?}: {enabled}");
            let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
            assert_eq!(settings["enabledPlugins"], enabled);
            if row == Role::Door && enabled["hope@personal"] == true {
                let brief = std::fs::read_to_string(
                    Setup::after(&argv, "--append-system-prompt-file").unwrap(),
                )
                .unwrap();
                assert!(
                    brief.contains("hope:intent"),
                    "the user's intent replaces the missing bundle"
                );
                assert!(settings.get("statusLine").is_none());
            }
        }
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
    assert_eq!(json!(names), json!(["hunch", "hold"]));
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
    assert!(!env.contains_key("CLAUDE_CODE_DISABLE_CLAUDE_MDS"));
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
    assert_eq!(listed.mcp, ["computer-use", "zzserver"]);
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
        s.user_file(
            "settings.json",
            &json!({"mcpServers":{"personal":{"command":"personal"}}}).to_string(),
        );
        if carry_user_rules {
            s.user_file("settings.json", &json!({"mcpServers":{"personal":{"command":"personal"}},"permissions":{"allow":["Bash(*)","PowerShell","mcp__roundup__terminal_spawn","mcp__roundup__terminal_open","mcp__roundup__terminal_write","mcp__roundup__agent_run","mcp__roundup__*","Read(*)"]}}).to_string());
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
        assert_eq!(settings["mcpServers"]["personal"]["command"], "personal");
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

#[tokio::test]
async fn lc17_a_lean_child_loads_no_claude_md_by_itself() {
    for (row, role, pair) in lean_children() {
        let s = setup();
        s.user_file("CLAUDE.md", "USER_GLOBAL_TOKEN");
        std::fs::write(s.dir.parent().unwrap().join("CLAUDE.md"), "PROJECT_TOKEN").unwrap();
        let launcher = plugin_launcher(&s);
        let (argv, env) = launcher
            .launch_on(folders(&s.dir), "7", "1", &s.cwd, None, role, &pair)
            .await
            .unwrap();
        assert_eq!(env["CLAUDE_CODE_DISABLE_CLAUDE_MDS"], "1", "{row:?}");
        let brief =
            std::fs::read_to_string(Setup::after(&argv, "--append-system-prompt-file").unwrap())
                .unwrap();
        assert_eq!(brief.matches("PROJECT_TOKEN").count(), 1, "{row:?}");
        assert_eq!(brief.matches("USER_GLOBAL_TOKEN").count(), 1, "{row:?}");
        if row == Role::Door {
            assert!(brief.find("two or more steps").unwrap() < brief.find("## Tools").unwrap());
        } else {
            assert!(
                !brief.contains("two or more steps"),
                "membership is delivered by E3, not the shared Brief"
            );
        }
    }
}

#[test]
fn lc16_no_role_hides_slash_commands() {
    let roles = agents::claude_code::PROFILES.iter().map(|(role, _)| *role);
    for role in roles.chain([Role::Agent]) {
        for pair in [
            Pair::default(),
            lean_pair(false, Extras::default()),
            lean_pair(true, Extras::default()),
        ] {
            let s = setup();
            let argv = s.prepare_lean("7", role, &pair, None).unwrap();
            assert!(!has(&argv, "--disable-slash-commands"), "{role:?}");
            assert!(
                !has(&argv, "--setting-sources")
                    || Setup::after(&argv, "--setting-sources") != Some(""),
                "{role:?}"
            );
        }
    }
}

#[path = "lean/user_setup.rs"]
mod user_setup;

#[test]
fn lc18_agent_extras_lists_computer_use() {
    let s = setup();
    with_extras(&s);
    std::fs::write(
        &s.claude_json,
        json!({"mcpServers": {
            "computer-use": {"type": "http", "url": "https://x"},
            "zzserver": {"type": "http", "url": "https://x"},
        }})
        .to_string(),
    )
    .unwrap();
    let listed = agents::claude_code::extras::available(
        &s.launcher().extras_sources(s.dir.parent().unwrap()),
    );
    assert_eq!(listed.mcp, ["computer-use", "zzserver"]);
    let extras = Extras {
        mcp: vec!["computer-use".into()],
        ..Extras::default()
    };
    let argv = s
        .prepare_lean("7", Role::Agent, &lean_pair(false, extras), None)
        .unwrap();
    let config = read(Path::new(Setup::after(&argv, "--mcp-config").unwrap()));
    assert!(config["mcpServers"]["computer-use"].is_null());
}

#[test]
fn lc18_choosing_computer_use_adds_the_switch() {
    let s = setup();
    let extras = Extras {
        mcp: vec!["computer-use".into()],
        ..Extras::default()
    };
    let argv = s
        .prepare_lean("7", Role::Agent, &lean_pair(false, extras), None)
        .unwrap();
    assert!(has(&argv, "--computer-use-mcp"));
}

#[test]
fn lc18_a_start_without_it_has_no_switch() {
    let s = setup();
    let argv = s
        .prepare_lean("7", Role::Agent, &lean_pair(false, Extras::default()), None)
        .unwrap();
    assert!(!has(&argv, "--computer-use-mcp"));
}

mod memory;
