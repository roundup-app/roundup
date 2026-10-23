//! A4, A13: trusted folders and safe launch-file paths.
use super::*;

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
