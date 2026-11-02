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
                    let pair = Pair {
                        mcp_off,
                        yolo,
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
                    let command = shlex::split(hook["command"].as_str().unwrap()).unwrap();
                    assert_eq!(Path::new(&command[0]), s.rup);
                    assert_eq!(command[1], "claude-memory");
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
    PathBuf::from(&shlex::split(command).unwrap()[2])
}

#[test]
fn lc19_memory_guard_extends_user_settings() {
    for (row, role, pair) in
        lean_children()
            .into_iter()
            .chain([(Role::Agent, Role::Agent, Pair::default())])
    {
        let s = setup();
        let memory = s.root.path().join("local-memory");
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
        assert_eq!(settings["autoMemoryEnabled"], false);
        assert_eq!(settings["env"]["CLAUDE_CODE_DISABLE_AUTO_MEMORY"], "1");
        assert_eq!(settings["autoMemoryDirectory"], json!(memory));
        assert_eq!(settings["permissions"]["ask"], json!(["Edit(*)"]));
        assert_eq!(
            settings["permissions"]["deny"],
            json!(["Write(**/secret.md)", "Read(local-secret)"])
        );
        assert_eq!(settings["permissions"]["defaultMode"], "plan");
        for allow in ["Read(user)", "Read(project)"] {
            assert!(
                settings["permissions"]["allow"]
                    .as_array()
                    .unwrap()
                    .contains(&json!(allow))
            );
        }
        let hooks = settings["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            hooks
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
            let root = PathBuf::from(
                &shlex::split(ours["hooks"][0]["command"].as_str().unwrap()).unwrap()[2],
            );
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
    let project = s.dir.parent().unwrap();
    let repo = git2::Repository::init(project).unwrap();
    let signature =
        git2::Signature::new("test", "test@example.com", &git2::Time::new(0, 0)).unwrap();
    let tree_id = repo.index().unwrap().write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
        .unwrap();
    let default = launch_root(&s.prepare_as("7", Role::Door).unwrap());
    assert!(default.starts_with(s.root.path().join("projects")));
    assert_eq!(default.file_name().unwrap(), "memory");
    assert!(
        default
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with("-proj")
    );
    // The linked worktree must use the main repository's memory, not its own cwd's slug.
    let linked = project.join("linked");
    repo.worktree("linked", &linked, None).unwrap();
    let argv = s
        .launcher()
        .prepare(folders(&s.dir), "8", "1", &linked, None, Role::Door)
        .unwrap();
    assert_eq!(launch_root(&argv), default);
    let cwd_memory = s.root.path().join("worktree-memory");
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

    let config = s.root.path().join("custom-config");
    std::fs::create_dir(&config).unwrap();
    let launcher = Launcher::new(
        "fake",
        config.join(".claude.json"),
        s.rup.clone(),
        Some(s.root.path().to_owned()),
    );
    let argv = launcher
        .prepare(folders(&s.dir), "9", "1", &s.cwd, None, Role::Door)
        .unwrap();
    let custom = launch_root(&argv);
    assert!(custom.starts_with(config.join("projects")));
    assert_eq!(custom.file_name().unwrap(), "memory");
    std::fs::write(
        config.join("settings.json"),
        r#"{"autoMemoryDirectory":"~/relocated"}"#,
    )
    .unwrap();
    let argv = launcher
        .prepare(folders(&s.dir), "9", "1", &s.cwd, None, Role::Door)
        .unwrap();
    let relocated = launch_root(&argv);
    assert_eq!(relocated, s.root.path().join("relocated"));
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
        }
    }
}
