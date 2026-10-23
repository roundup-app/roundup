use super::*;

#[test]
fn a4_a_rup_that_is_not_there_fails_loudly() {
    let s = setup();
    std::fs::remove_file(&s.rup).unwrap();
    let err = s.prepare("7").unwrap_err();
    assert_eq!(err.code, code::INTERNAL);
    assert!(err.message.contains("rup"), "{}", err.message);
}

#[test]
fn a4_the_cwd_is_pre_trusted_and_nothing_else_in_the_config_changes() {
    let s = setup();
    let real = s.real(&s.cwd);
    std::fs::write(
        &s.claude_json,
        json!({"theme": "dark", "projects": {"/other": {"allowedTools": ["x"]}, real.clone(): {"allowedTools": ["y"]}}}).to_string(),
    )
    .unwrap();
    s.prepare("1").unwrap();
    let config = read(&s.claude_json);
    assert_eq!(config["theme"], "dark");
    assert_eq!(config["projects"]["/other"], json!({"allowedTools": ["x"]}));
    assert_eq!(
        config["projects"][&real],
        json!({"allowedTools": ["y"], "hasTrustDialogAccepted": true})
    );
}

#[test]
fn a4_a_missing_config_is_created_with_the_trust() {
    let s = setup();
    s.prepare("1").unwrap();
    let real = s.real(&s.cwd);
    assert_eq!(
        read(&s.claude_json)["projects"][&real]["hasTrustDialogAccepted"],
        true
    );
}

#[test]
fn a4_a_config_folder_that_does_not_exist_yet_is_created() {
    let s = setup();
    let config = s.root.path().join("config dir").join(".claude.json");
    let launcher = Launcher::new("fake-claude", config.clone(), s.rup.clone(), None);
    launcher
        .prepare(folders(&s.dir), "1", "1", &s.cwd, None, Role::Agent)
        .unwrap();
    assert_eq!(
        read(&config)["projects"][&s.real(&s.cwd)]["hasTrustDialogAccepted"],
        true
    );
}

#[test]
fn a4_a_symlinked_cwd_is_trusted_under_its_resolved_path() {
    let s = setup();
    let link = s.cwd.parent().unwrap().join("link");
    std::os::unix::fs::symlink(&s.cwd, &link).unwrap();
    s.launcher()
        .prepare(folders(&s.dir), "1", "1", &link, None, Role::Agent)
        .unwrap();
    let config = read(&s.claude_json);
    let keys: Vec<_> = config["projects"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    assert_eq!(keys, [s.real(&s.cwd)]);
}

#[test]
fn a4_a_symlinked_config_is_written_through_and_stays_a_link() {
    let s = setup();
    let target = s.root.path().join("dotfiles-claude.json");
    std::fs::write(&target, r#"{"theme": "dark"}"#).unwrap();
    std::os::unix::fs::symlink(&target, &s.claude_json).unwrap();
    s.prepare("1").unwrap();
    assert!(
        s.claude_json
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(read(&target)["theme"], "dark");
    assert_eq!(
        read(&target)["projects"][&s.real(&s.cwd)]["hasTrustDialogAccepted"],
        true
    );
}

#[test]
fn a13_a_symlinked_agents_directory_is_refused() {
    let s = setup();
    let elsewhere = s.root.path().join("elsewhere");
    std::fs::create_dir(&elsewhere).unwrap();
    let agents = s.dir.join("agents");
    std::os::unix::fs::symlink(&elsewhere, &agents).unwrap();

    let err = s.prepare("1").unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    let real_agents = s.dir.canonicalize().unwrap().join("agents");
    assert!(
        err.message
            .contains(&real_agents.to_string_lossy().into_owned()),
        "{}",
        err.message
    );
    assert!(agents.symlink_metadata().unwrap().file_type().is_symlink());
    assert!(std::fs::read_dir(&elsewhere).unwrap().next().is_none());
    assert!(!s.dir.join("1.settings.json").exists());
    assert!(!s.dir.join("1.mcp.json").exists());
    assert!(!s.claude_json.exists());
}

#[test]
fn a13_a_real_agents_directory_works_as_before() {
    let s = setup();
    let agents = s.dir.join("agents");
    std::fs::create_dir(&agents).unwrap();

    let argv = s.prepare("1").unwrap();

    let real_agents = s.real(&agents);
    assert!(Path::new(&argv[2]).starts_with(&real_agents));
    assert!(Path::new(&argv[4]).starts_with(&real_agents));
}

#[test]
fn a13_a_missing_agents_directory_is_created_as_before() {
    let s = setup();
    let agents = s.dir.join("agents");
    assert!(!agents.exists());

    s.prepare("1").unwrap();

    assert!(agents.is_dir());
}

#[test]
fn a4_concurrent_spawns_each_get_their_cwd_trusted() {
    let s = setup();
    let launcher = Arc::new(s.launcher());
    let gate = Arc::new(std::sync::Barrier::new(8));
    let cwds: Vec<Vec<PathBuf>> = (0..8)
        .map(|spawner| {
            (0..5)
                .map(|n| s.dir.parent().unwrap().join(format!("w{spawner}-{n}")))
                .collect()
        })
        .collect();
    cwds.iter()
        .flatten()
        .for_each(|cwd| std::fs::create_dir(cwd).unwrap());
    let threads: Vec<_> = cwds
        .iter()
        .cloned()
        .enumerate()
        .map(|(spawner, mine)| {
            let (launcher, gate, dir) = (Arc::clone(&launcher), Arc::clone(&gate), s.dir.clone());
            std::thread::spawn(move || {
                gate.wait();
                for (n, cwd) in mine.iter().enumerate() {
                    launcher
                        .prepare(
                            folders(&dir),
                            &(spawner * 10 + n).to_string(),
                            "1",
                            cwd,
                            None,
                            Role::Agent,
                        )
                        .unwrap();
                }
            })
        })
        .collect();
    threads.into_iter().for_each(|t| t.join().unwrap());
    let config = read(&s.claude_json);
    for cwd in cwds.iter().flatten() {
        assert_eq!(
            config["projects"][&s.real(cwd)]["hasTrustDialogAccepted"],
            true
        );
    }
}

#[test]
fn a4_only_a_cwd_inside_the_project_folder_is_trusted() {
    let s = setup();
    let elsewhere = s.root.path().join("elsewhere");
    std::fs::create_dir(&elsewhere).unwrap();
    let err = s
        .launcher()
        .prepare(folders(&s.dir), "1", "1", &elsewhere, None, Role::Agent)
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(!s.claude_json.exists());
    assert!(!s.dir.join("agents").exists());
}

#[test]
fn a4_an_unreadable_config_fails_loudly_and_is_left_as_it_was() {
    let s = setup();
    std::fs::write(&s.claude_json, "{ not json").unwrap();
    let err = s.prepare("1").unwrap_err();
    assert_eq!(err.code, code::INTERNAL);
    assert_eq!(
        std::fs::read_to_string(&s.claude_json).unwrap(),
        "{ not json"
    );
}

#[test]
fn a4_a_cwd_that_is_a_file_is_the_callers_error() {
    let s = setup();
    let file = s.cwd.join("notes.txt");
    std::fs::write(&file, "").unwrap();
    let err = s
        .launcher()
        .prepare(folders(&s.dir), "1", "1", &file, None, Role::Agent)
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(!s.claude_json.exists());
}

#[test]
fn a4_a_relative_project_dir_still_gives_claude_an_absolute_settings_path() {
    let here = std::env::current_dir().unwrap();
    let root = tempfile::tempdir_in(&here).unwrap();
    let dir = root.path().join("proj").join(".roundup");
    let cwd = root.path().join("proj");
    std::fs::create_dir_all(&dir).unwrap();
    let rup = root.path().join("rup");
    std::fs::write(&rup, "").unwrap();
    let launcher = Launcher::new("fake-claude", root.path().join("claude.json"), rup, None);

    let argv = launcher
        .prepare(
            folders(dir.strip_prefix(&here).unwrap()),
            "1",
            "1",
            &cwd,
            None,
            Role::Agent,
        )
        .unwrap();

    assert!(Path::new(&argv[2]).is_absolute(), "{}", argv[2]);
}

#[test]
fn a4_an_agent_id_that_is_not_a_node_id_is_refused_before_anything_is_written() {
    let s = setup();
    for id in ["1;touch pwned", "../1", "01", "+1", ""] {
        let err = s.prepare(id).unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{id:?}");
    }
    assert!(!s.dir.join("agents").exists());
    assert!(!s.claude_json.exists());
}

#[test]
fn a4_discarding_an_id_that_is_not_a_node_id_deletes_nothing() {
    let s = setup();
    s.prepare("1").unwrap();
    let outside = s.dir.join("x.settings.json");
    std::fs::write(&outside, "").unwrap();
    Launcher::discard(&s.dir, "../x").unwrap();
    assert!(outside.exists());
}

#[test]
fn a4_a_symlinked_config_whose_target_is_missing_stays_a_link() {
    let s = setup();
    std::os::unix::fs::symlink("dotfiles/claude.json", &s.claude_json).unwrap();
    s.prepare("1").unwrap();
    assert!(
        s.claude_json
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink()
    );
    let target = s.root.path().join("dotfiles").join("claude.json");
    assert_eq!(
        read(&target)["projects"][&s.real(&s.cwd)]["hasTrustDialogAccepted"],
        true
    );
}

#[test]
fn a4_a_leftover_at_the_old_fixed_temp_path_does_not_stop_trust() {
    let s = setup();
    std::fs::create_dir(beside(&s.claude_json, ".roundup-tmp")).unwrap();
    s.prepare("1").unwrap();
    assert_eq!(
        read(&s.claude_json)["projects"][&s.real(&s.cwd)]["hasTrustDialogAccepted"],
        true
    );
}

/// Claude Code 2.1.286 saves its config holding the directory `<config>.lock` and re-reads the
/// config under it; a trust written meanwhile would be lost to that save.
#[test]
fn a4_trust_waits_while_claude_holds_its_config_lock() {
    let s = setup();
    std::fs::write(&s.claude_json, "{}").unwrap();
    let lock = beside(&s.claude_json, ".lock");
    std::fs::create_dir(&lock).unwrap();
    let mut saving = read(&s.claude_json);
    let trusting = {
        let (launcher, dir, cwd) = (s.launcher(), s.dir.clone(), s.cwd.clone());
        std::thread::spawn(move || {
            launcher.prepare(folders(&dir), "1", "1", &cwd, None, Role::Agent)
        })
    };

    // An observation window: while the lock is held, trust must not write.
    std::thread::sleep(Duration::from_millis(300));
    saving["theme"] = "dark".into();
    std::fs::write(&s.claude_json, saving.to_string()).unwrap();
    std::fs::remove_dir(&lock).unwrap();

    trusting.join().unwrap().unwrap();
    let config = read(&s.claude_json);
    assert_eq!(config["theme"], "dark");
    assert_eq!(
        config["projects"][&s.real(&s.cwd)]["hasTrustDialogAccepted"],
        true
    );
}

#[test]
fn a4_a_config_lock_its_holder_left_behind_is_broken_once_stale() {
    let s = setup();
    let lock = beside(&s.claude_json, ".lock");
    std::fs::create_dir(&lock).unwrap();
    let minute_ago = SystemTime::now() - Duration::from_secs(60);
    std::fs::File::open(&lock)
        .unwrap()
        .set_modified(minute_ago)
        .unwrap();

    s.prepare("1").unwrap();

    assert!(!lock.exists());
    assert_eq!(
        read(&s.claude_json)["projects"][&s.real(&s.cwd)]["hasTrustDialogAccepted"],
        true
    );
}

#[test]
fn a4_a_cwd_that_does_not_exist_is_the_callers_error() {
    let s = setup();
    let err = s
        .launcher()
        .prepare(
            folders(&s.dir),
            "1",
            "1",
            &s.cwd.join("missing"),
            None,
            Role::Agent,
        )
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
}

pub(super) fn vars<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
    move |name| {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| OsString::from(value))
    }
}

#[test]
fn a4_the_binary_and_config_location_come_from_the_environment() {
    let exe = Path::new("/e/rupd");
    let launcher = Launcher::from_vars(
        vars(&[("ROUNDUP_CLAUDE_BIN", "/x/fake"), ("HOME", "/h")]),
        exe,
    )
    .unwrap();
    assert_eq!(
        launcher,
        Launcher::new(
            "/x/fake",
            "/h/.claude.json".into(),
            "/e/rup".into(),
            Some("/h".into())
        )
    );

    let launcher =
        Launcher::from_vars(vars(&[("CLAUDE_CONFIG_DIR", "/c"), ("HOME", "/h")]), exe).unwrap();
    assert_eq!(
        launcher,
        Launcher::new(
            "claude",
            "/c/.claude.json".into(),
            "/e/rup".into(),
            Some("/h".into())
        )
    );

    assert!(Launcher::from_vars(vars(&[]), exe).is_err());
}

#[test]
fn a4_rup_is_the_one_beside_the_running_daemon_unless_the_environment_says_otherwise() {
    let exe = Path::new("/e/rupd");
    let beside = Launcher::from_vars(vars(&[("HOME", "/h")]), exe).unwrap();
    let named =
        Launcher::from_vars(vars(&[("HOME", "/h"), ("ROUNDUP_RUP_BIN", "/r/rup")]), exe).unwrap();
    assert_eq!(
        beside,
        Launcher::new(
            "claude",
            "/h/.claude.json".into(),
            "/e/rup".into(),
            Some("/h".into())
        )
    );
    assert_eq!(
        named,
        Launcher::new(
            "claude",
            "/h/.claude.json".into(),
            "/r/rup".into(),
            Some("/h".into())
        )
    );
}

#[test]
fn a4_an_empty_variable_counts_as_unset() {
    let exe = Path::new("/e/rupd");
    let launcher = Launcher::from_vars(
        vars(&[
            ("CLAUDE_CONFIG_DIR", ""),
            ("HOME", "/h"),
            ("ROUNDUP_RUP_BIN", ""),
        ]),
        exe,
    )
    .unwrap();
    assert_eq!(
        launcher,
        Launcher::new(
            "claude",
            "/h/.claude.json".into(),
            "/e/rup".into(),
            Some("/h".into())
        )
    );
    assert!(Launcher::from_vars(vars(&[("HOME", "")]), exe).is_err());
}

#[test]
fn a4_a_cwd_that_is_not_in_nfc_is_trusted_under_its_nfc_name() {
    let s = setup();
    let decomposed = s.cwd.parent().unwrap().join("cafe\u{301}");
    std::fs::create_dir(&decomposed).unwrap();

    s.launcher()
        .prepare(folders(&s.dir), "1", "1", &decomposed, None, Role::Agent)
        .unwrap();

    let config = read(&s.claude_json);
    let keys: Vec<_> = config["projects"].as_object().unwrap().keys().collect();
    assert_eq!(keys.len(), 1);
    assert!(keys[0].ends_with("caf\u{e9}"), "{}", keys[0]);
}

#[test]
fn a4_the_home_folder_is_refused_and_never_trusted() {
    let s = setup();
    let project = s.dir.parent().unwrap();
    let launcher = Launcher::new(
        "fake-claude",
        s.claude_json.clone(),
        s.rup.clone(),
        Some(project.to_owned()),
    );

    let err = launcher
        .prepare(folders(&s.dir), "1", "1", project, None, Role::Agent)
        .unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(!s.claude_json.exists());
    assert!(!s.dir.join("agents").exists());
    launcher
        .prepare(folders(&s.dir), "1", "1", &s.cwd, None, Role::Agent)
        .unwrap();
}

#[test]
fn a4_a_symlink_planted_where_a_file_goes_is_replaced_not_written_through() {
    let s = setup();
    let agents = s.dir.join("agents");
    std::fs::create_dir(&agents).unwrap();
    for name in ["1.settings.json", "1.mcp.json"] {
        let victim = s.root.path().join(format!("victim-{name}"));
        std::fs::write(&victim, "export KEEP=1\n").unwrap();
        std::os::unix::fs::symlink(&victim, agents.join(name)).unwrap();
    }

    s.prepare("1").unwrap();

    for name in ["1.settings.json", "1.mcp.json"] {
        let victim = s.root.path().join(format!("victim-{name}"));
        let planted = agents.join(name);
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "export KEEP=1\n");
        assert!(!planted.symlink_metadata().unwrap().file_type().is_symlink());
    }
    assert!(read(&agents.join("1.settings.json"))["hooks"]["Stop"].is_array());
    assert!(read(&agents.join("1.mcp.json"))["mcpServers"]["roundup"].is_object());
}

