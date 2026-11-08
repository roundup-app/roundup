//! LC19–LC20: exercise the launch artifacts and the same hook handler the command runs.
use super::*;

fn guard(settings: &Value) -> Option<&Value> {
    settings["hooks"]["PreToolUse"]
        .as_array()?
        .iter()
        .find(|hook| hook["matcher"] == "Write|Edit")
}

#[test]
fn lc19_lean_starts_include_memory_tools_and_guard() {
    for (row, role, pair) in lean_children().into_iter().take(2) {
        for mcp_off in [false, true] {
            for yolo in [false, true] {
                for resume in [None, Some("saved-conversation")] {
                    let s = setup();
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
                    let tools: Vec<_> =
                        Setup::after(&argv, "--tools").unwrap().split(',').collect();
                    assert!(
                        tools.contains(&"Write") && tools.contains(&"Edit"),
                        "{row:?}"
                    );
                    let settings = read(Path::new(Setup::after(&argv, "--settings").unwrap()));
                    let hook = &guard(&settings).expect("memory guard")["hooks"][0];
                    assert_eq!(hook["type"], "command");
                    assert_eq!(hook["onFailure"], "block");
                    assert_ne!(hook["async"], true);
                    let brief = std::fs::read_to_string(
                        Setup::after(&argv, "--append-system-prompt-file").unwrap(),
                    )
                    .unwrap();
                    assert!(brief.contains("Memory is the only files you write yourself"));
                    assert!(brief.contains("child Agent"));
                }
            }
        }
    }
}

fn call(root: &Path, cwd: &Path, path: &str, tool: &str, mode: &str) -> Value {
    agents::claude_code::memory_guard(root, cwd, &serde_json::to_vec(&json!({
        "hook_event_name":"PreToolUse", "tool_name":tool,
        "permission_mode":mode, "cwd":cwd,
        "tool_input":{"file_path":path,"content":"replacement","old_string":"old","new_string":"new"}
    })).unwrap())
}

fn refused(reply: &Value) {
    assert_eq!(
        reply["hookSpecificOutput"]["permissionDecision"], "deny",
        "{reply}"
    );
    assert!(
        reply["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap()
            .contains("child Agent")
    );
}

#[test]
fn lc20_memory_files_pass_the_guard() {
    let s = setup();
    let memory = s.root.path().join("memory");
    for tool in ["Write", "Edit"] {
        for mode in ["default", "bypassPermissions"] {
            for file in ["new/topic.md", "existing.md", "MEMORY.md"] {
                let target = memory.join(file);
                assert_eq!(
                    call(&memory, &s.cwd, target.to_str().unwrap(), tool, mode),
                    json!({})
                );
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(target, "existing memory").unwrap();
            }
        }
    }
}

#[test]
fn lc20_other_files_are_refused_even_in_bypass() {
    let s = setup();
    let memory = s.root.path().join("memory");
    let existing = s.cwd.join("existing.md");
    std::fs::write(&existing, "keep").unwrap();
    for tool in ["Write", "Edit"] {
        for mode in ["default", "bypassPermissions"] {
            for target in [
                &existing,
                &s.cwd.join("new.md"),
                &s.root.path().join("outside.md"),
            ] {
                refused(&call(&memory, &s.cwd, target.to_str().unwrap(), tool, mode));
            }
        }
    }
    assert_eq!(std::fs::read_to_string(existing).unwrap(), "keep");
    assert!(!s.cwd.join("new.md").exists());
}

#[test]
fn lc20_path_aliases_do_not_escape_memory() {
    let s = setup();
    let memory = s.root.path().join("memory");
    std::fs::create_dir(&memory).unwrap();
    std::os::unix::fs::symlink(&s.cwd, memory.join("escape")).unwrap();
    for tool in ["Write", "Edit"] {
        for mode in ["default", "bypassPermissions"] {
            for target in [
                memory.join("../outside.md"),
                memory.join("escape/new.md"),
                s.root.path().join("memory-sibling/topic.md"),
            ] {
                refused(&call(&memory, &s.cwd, target.to_str().unwrap(), tool, mode));
            }
        }
    }
}

#[test]
fn lc20_unknown_paths_are_refused() {
    let s = setup();
    let memory = s.root.path().join("memory");
    std::fs::create_dir(&memory).unwrap();
    std::os::unix::fs::symlink("loop", memory.join("loop")).unwrap();
    for tool in ["Write", "Edit"] {
        for mode in ["default", "bypassPermissions"] {
            for target in [
                String::new(),
                "bad\0path".into(),
                memory.join("loop/topic.md").to_string_lossy().into_owned(),
            ] {
                refused(&call(&memory, &s.cwd, &target, tool, mode));
            }
            refused(&call(
                Path::new(""),
                &s.cwd,
                memory.join("topic.md").to_str().unwrap(),
                tool,
                mode,
            ));
            for input in [
                json!({"tool_name":tool,"tool_input":{}}),
                json!({"tool_name":tool,"tool_input":{"file_path":42},"permission_mode":mode}),
            ] {
                refused(&agents::claude_code::memory_guard(
                    &memory,
                    &s.cwd,
                    &serde_json::to_vec(&input).unwrap(),
                ));
            }
        }
    }
}

fn launch_root(argv: &[String]) -> PathBuf {
    let settings = read(Path::new(Setup::after(argv, "--settings").unwrap()));
    let command = guard(&settings).unwrap()["hooks"][0]["command"]
        .as_str()
        .unwrap();
    memory_command_root(command)
}

fn memory_command_root(command: &str) -> PathBuf {
    let words = shlex::split(command).unwrap();
    let at = words
        .iter()
        .position(|word| word == "claude-memory")
        .unwrap();
    PathBuf::from(&words[at + 1])
}

#[test]
fn lc19_memory_guard_extends_user_settings() {
    for (row, role, pair) in
        lean_children()
            .into_iter()
            .chain([(Role::Agent, Role::Agent, LaunchFacts::default())])
    {
        let s = setup();
        let memory = s.root.path().canonicalize().unwrap().join("local-memory");
        s.user_file("settings.json", &json!({
            "permissions":{"allow":["Read(user)"],"ask":["Edit(*)"],"deny":["Write(**/secret.md)"],"defaultMode":"plan"},
            "autoMemoryEnabled":false,"autoMemoryDirectory":"/user-memory",
            "env":{"CLAUDE_CODE_DISABLE_AUTO_MEMORY":"1"},
            "hooks":{"PreToolUse":[{"matcher":"Write|Edit","hooks":[{"type":"command","command":"user-guard"}]}]}
        }).to_string());
        std::fs::create_dir_all(s.dir.parent().unwrap().join(".claude")).unwrap();
        std::fs::write(s.dir.parent().unwrap().join(".claude/settings.json"), json!({"autoMemoryDirectory":"/project-memory","permissions":{"allow":["Read(project)"]}}).to_string()).unwrap();
        std::fs::write(
            s.dir.parent().unwrap().join(".claude/settings.local.json"),
            json!({"autoMemoryDirectory":memory,"permissions":{"deny":["Read(local-secret)"]}})
                .to_string(),
        )
        .unwrap();
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
        let _ = &memory;
        let hooks = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            !hooks
                .iter()
                .any(|hook| hook["hooks"][0]["command"] == "user-guard")
        );
        let ours = hooks.iter().find(|hook| {
            hook["hooks"][0]["command"]
                .as_str()
                .is_some_and(|command| command.contains(" claude-memory "))
        });
        assert_eq!(ours.is_some(), row != Role::Agent);
        if let Some(ours) = ours {
            let root = memory_command_root(ours["hooks"][0]["command"].as_str().unwrap());
            assert_eq!(root, memory);
            assert_eq!(
                call(
                    &root,
                    &s.cwd,
                    memory.join("secret.md").to_str().unwrap(),
                    "Write",
                    "default"
                ),
                json!({})
            );
        }
    }
}

#[test]
fn lc20_memory_root_matches_the_launch() {
    let s = setup();
    let root = s.root.path().canonicalize().unwrap();
    // Settings override the runner's environment without changing other tests' launches.
    let mut settings = json!({"env": {
        "CLAUDE_CONFIG_DIR": "",
        "CLAUDE_CODE_PROJECT_DIR_NAME": "",
        "CLAUDE_CODE_REMOTE_MEMORY_DIR": "",
        "CLAUDE_COWORK_MEMORY_PATH_OVERRIDE": ""
    }});
    std::fs::write(root.join("settings.json"), settings.to_string()).unwrap();
    let project = s.dir.parent().unwrap();
    let repo = git2::Repository::init(project).unwrap();
    let signature =
        git2::Signature::new("test", "test@example.com", &git2::Time::new(0, 0)).unwrap();
    let tree_id = repo.index().unwrap().write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
        .unwrap();
    let default = launch_root(&s.prepare_as("7", Role::Door).unwrap());
    assert_eq!(
        default.parent().unwrap().parent().unwrap(),
        root.join("projects")
    );
    assert_eq!(default.file_name().unwrap(), "memory");
    // Compare repository identity: long temporary paths can truncate/hash the slug.
    let argv = s
        .launcher()
        .prepare(folders(&s.dir), "8", "1", project, None, Role::Door)
        .unwrap();
    assert_eq!(launch_root(&argv), default);
    let separate = project.join("separate");
    std::fs::create_dir(&separate).unwrap();
    git2::Repository::init(&separate).unwrap();
    let argv = s
        .launcher()
        .prepare(folders(&s.dir), "8", "1", &separate, None, Role::Door)
        .unwrap();
    assert_ne!(launch_root(&argv), default);
    // The linked worktree must use the main repository's memory, not its own cwd's slug.
    let linked = project.join("linked");
    repo.worktree("linked", &linked, None).unwrap();
    let argv = s
        .launcher()
        .prepare(folders(&s.dir), "8", "1", &linked, None, Role::Door)
        .unwrap();
    assert_eq!(launch_root(&argv), default);
    let cwd_memory = root.join("worktree-memory");
    std::fs::create_dir_all(linked.join(".claude")).unwrap();
    std::fs::write(
        linked.join(".claude/settings.local.json"),
        json!({"autoMemoryDirectory":cwd_memory}).to_string(),
    )
    .unwrap();
    let argv = s
        .launcher()
        .prepare(folders(&s.dir), "8", "1", &linked, None, Role::Door)
        .unwrap();
    assert_eq!(launch_root(&argv), cwd_memory);

    let config = root.join("custom-config");
    std::fs::create_dir(&config).unwrap();
    std::fs::write(config.join("settings.json"), settings.to_string()).unwrap();
    let launcher = Launcher::new(
        "fake",
        config.join(".claude.json"),
        s.rup.clone(),
        Some(root.clone()),
    );
    let argv = launcher
        .prepare(folders(&s.dir), "9", "1", &s.cwd, None, Role::Door)
        .unwrap();
    let custom = launch_root(&argv);
    assert!(custom.starts_with(config.join("projects")));
    assert_eq!(custom.file_name().unwrap(), "memory");
    settings["env"]["CLAUDE_CONFIG_DIR"] = json!(config);
    settings["env"]["CLAUDE_CODE_PROJECT_DIR_NAME"] = json!("named-project");
    std::fs::write(config.join("settings.json"), settings.to_string()).unwrap();
    let argv = launcher
        .prepare(folders(&s.dir), "9", "1", &s.cwd, None, Role::Door)
        .unwrap();
    let named = launch_root(&argv);
    assert_eq!(named, config.join("projects/named-project/memory"));
    settings["autoMemoryDirectory"] = json!("~/relocated");
    std::fs::write(config.join("settings.json"), settings.to_string()).unwrap();
    let argv = launcher
        .prepare(folders(&s.dir), "9", "1", &s.cwd, None, Role::Door)
        .unwrap();
    let relocated = launch_root(&argv);
    assert_eq!(relocated, root.join("relocated"));
    for tool in ["Write", "Edit"] {
        for mode in ["default", "bypassPermissions"] {
            assert_eq!(
                call(
                    &relocated,
                    &s.cwd,
                    relocated.join("MEMORY.md").to_str().unwrap(),
                    tool,
                    mode
                ),
                json!({})
            );
            refused(&call(
                &relocated,
                &s.cwd,
                custom.join("MEMORY.md").to_str().unwrap(),
                tool,
                mode,
            ));
            refused(&call(
                &relocated,
                &s.cwd,
                default.join("MEMORY.md").to_str().unwrap(),
                tool,
                mode,
            ));
            refused(&call(
                &relocated,
                &s.cwd,
                named.join("MEMORY.md").to_str().unwrap(),
                tool,
                mode,
            ));
        }
    }
}
