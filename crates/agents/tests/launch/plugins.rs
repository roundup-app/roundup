//! Q11: pinned plugin delivery and runtime support.
use super::*;

#[tokio::test]
async fn q11_each_launch_loads_all_three_pinned_plugins() {
    let s = setup();
    let launcher = plugin_launcher(&s);
    for role in [Role::Door, Role::Scout, Role::Agent] {
        for resume in [None, Some("saved-conversation"), None] {
            let (argv, env) = launcher
                .launch_on(
                    folders(&s.dir),
                    "7",
                    "1",
                    &s.cwd,
                    resume,
                    role,
                    &Default::default(),
                )
                .await
                .unwrap();
            let paths: Vec<_> = argv
                .windows(2)
                .filter(|pair| pair[0] == "--plugin-dir")
                .map(|pair| Path::new(&pair[1]))
                .collect();
            assert_eq!(paths.len(), 3);
            for (path, name, version) in paths
                .iter()
                .zip([("hope", "13.1.0"), ("hunch", "0.9.4"), ("hold", "0.0.9")])
                .map(|(path, (name, version))| (path, name, version))
            {
                assert!(path.starts_with(s.dir.canonicalize().unwrap()));
                let manifest = read(&path.join(".claude-plugin/plugin.json"));
                assert_eq!(manifest["name"], name);
                assert_eq!(manifest["version"], version);
            }
            assert!(paths[0].join("hooks/judge.sh").is_file());
            assert!(paths[1].join("hooks/memory.tsx").is_file());
            assert_eq!(env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"], "1");
            assert_eq!(env["CLAUDE_CODE_PLUGIN_DIR_WATCH"], "0");
        }
    }
    assert_eq!(
        std::fs::read_to_string(s.root.path().join("claude.probes"))
            .unwrap()
            .lines()
            .count(),
        1
    );
}

#[tokio::test]
#[ignore = "requires real Claude; set ROUNDUP_CLAUDE to its executable"]
async fn q11_real_claude_loads_three_plugins() {
    let s = setup();
    let executable = std::env::var("ROUNDUP_CLAUDE").unwrap();
    let launcher = Launcher::new(executable, s.claude_json.clone(), s.rup.clone(), None);
    for role in [Role::Door, Role::Agent] {
        let (argv, env) = launcher
            .launch_on(
                folders(&s.dir),
                "7",
                "1",
                &s.cwd,
                None,
                role,
                &Default::default(),
            )
            .await
            .unwrap();
        let mut command = tokio::process::Command::new(&argv[0]);
        command
            .args(&argv[1..])
            .args(["plugin", "list", "--json"])
            .envs(env)
            .env("CLAUDE_CONFIG_DIR", s.root.path().join("isolated-config"))
            .current_dir(&s.cwd)
            .kill_on_drop(true);
        for marker in agents::claude_code::MARKERS {
            command.env_remove(marker);
        }
        let output = tokio::time::timeout(Duration::from_secs(20), command.output())
            .await
            .unwrap()
            .unwrap();
        let report = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        eprintln!("{role:?}: {report}");
        assert!(output.status.success(), "{report}");
        let inventory: Vec<Value> = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(inventory.len(), 3, "{report}");
        for (plugin, (name, version)) in
            inventory
                .iter()
                .zip([("hope", "13.1.0"), ("hunch", "0.9.4"), ("hold", "0.0.9")])
        {
            assert_eq!(plugin["id"], format!("{name}@inline"));
            assert_eq!(plugin["version"], version);
            assert_eq!(plugin["scope"], "session");
            assert_eq!(plugin["enabled"], true);
            assert!(
                Path::new(plugin["installPath"].as_str().unwrap())
                    .join(".claude-plugin/plugin.json")
                    .is_file()
            );
        }
    }
}

pub(super) fn plugin_launcher(s: &Setup) -> Launcher {
    use std::os::unix::fs::PermissionsExt;
    let fake = s.root.path().join("claude");
    std::fs::write(
        &fake,
        "#!/bin/sh\necho probe >> \"$0.probes\"\necho 'Q11 runtime hook closure: 1 pass'\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    Launcher::new(
        fake.to_string_lossy(),
        s.claude_json.clone(),
        s.rup.clone(),
        None,
    )
}

#[tokio::test]
async fn q11_missing_plugin_is_a_launch_error() {
    for corrupt in [false, true] {
        let s = setup();
        let launcher = plugin_launcher(&s);
        let (argv, _) = launcher
            .launch_on(
                folders(&s.dir),
                "7",
                "1",
                &s.cwd,
                None,
                Role::Agent,
                &Default::default(),
            )
            .await
            .unwrap();
        let path = Path::new(&argv[argv.iter().position(|arg| arg == "--plugin-dir").unwrap() + 1])
            .join("hooks/judge.sh");
        if corrupt {
            std::fs::write(&path, "corrupt").unwrap();
        } else {
            std::fs::remove_file(&path).unwrap();
        }
        for role in [Role::Door, Role::Agent] {
            for resume in [None, Some("saved-conversation")] {
                let error = launcher
                    .launch_on(
                        folders(&s.dir),
                        "8",
                        "2",
                        &s.cwd,
                        resume,
                        role,
                        &Default::default(),
                    )
                    .await
                    .unwrap_err();
                assert!(error.message.contains("missing or corrupt"), "{error:?}");
                assert!(
                    error.message.contains("reinstall roundup's pinned bundle"),
                    "{error:?}"
                );
            }
        }
    }
}

#[tokio::test]
async fn q11_plugin_delivery_keeps_user_files_unchanged() {
    for preexisting in [false, true] {
        let s = setup();
        let files = [
            ("CLAUDE.md", "user instructions\n"),
            (".claude/settings.json", "{\"outputStyle\":\"mine\"}\n"),
            (".claude/output-styles/mine.md", "user style\n"),
        ];
        if preexisting {
            std::fs::create_dir_all(s.cwd.join(".claude/output-styles")).unwrap();
            for (path, bytes) in files {
                std::fs::write(s.cwd.join(path), bytes).unwrap();
            }
        }
        let before = user_files(&s.cwd);
        let launcher = plugin_launcher(&s);
        for role in [Role::Door, Role::Agent] {
            for resume in [None, Some("saved-conversation"), None] {
                launcher
                    .launch_on(
                        folders(&s.dir),
                        "7",
                        "1",
                        &s.cwd,
                        resume,
                        role,
                        &Default::default(),
                    )
                    .await
                    .unwrap();
                assert_eq!(user_files(&s.cwd), before);
                for (path, bytes) in files {
                    if preexisting {
                        assert_eq!(std::fs::read(s.cwd.join(path)).unwrap(), bytes.as_bytes());
                    } else {
                        assert!(!s.cwd.join(path).exists());
                    }
                }
            }
        }
        if !preexisting {
            assert_eq!(std::fs::read_dir(&s.cwd).unwrap().count(), 0);
        }
    }
}

#[tokio::test]
async fn q11_unsupported_runtime_is_a_launch_error() {
    let s = setup();
    let launcher = plugin_launcher(&s);
    std::fs::write(
        s.root.path().join("claude"),
        "#!/bin/sh\necho 'no function hooks'\n",
    )
    .unwrap();
    for role in [Role::Door, Role::Agent] {
        let error = launcher
            .launch_on(
                folders(&s.dir),
                "7",
                "1",
                &s.cwd,
                None,
                role,
                &Default::default(),
            )
            .await
            .unwrap_err();
        assert!(
            error.message.contains("unsupported Claude runtime"),
            "{error:?}"
        );
        assert!(error.message.contains("claude-code.update"), "{error:?}");
    }
}

fn user_files(root: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
    fn visit(root: &Path, dir: &Path, files: &mut std::collections::BTreeMap<PathBuf, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root).unwrap().to_owned(),
                    std::fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = std::collections::BTreeMap::new();
    visit(root, root, &mut files);
    files
}
