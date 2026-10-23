//! A4: what an Agent's Claude Code is started with: a per-Agent settings file and a trusted cwd.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use agents::claude_code::{Launcher, Role};
use rpc::code;
use serde_json::{Value, json};

const EVENTS: [&str; 9] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

fn read(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// `path` with `suffix` appended to its last component.
fn beside(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    name.into()
}

/// A Project folder `<root>/proj` with its `.roundup` directory, and a `rup` to point hooks at.
struct Setup {
    root: tempfile::TempDir,
    dir: PathBuf,
    cwd: PathBuf,
    rup: PathBuf,
    claude_json: PathBuf,
}

fn setup() -> Setup {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("proj");
    let dir = project.join(".roundup");
    let cwd = project.join("work");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::create_dir(&cwd).unwrap();
    let rup = root.path().join("bin dir").join("rup");
    std::fs::create_dir_all(rup.parent().unwrap()).unwrap();
    std::fs::write(&rup, "").unwrap();
    let claude_json = root.path().join("claude.json");
    Setup {
        root,
        dir,
        cwd,
        rup,
        claude_json,
    }
}

/// The Project folder is the data folder's parent, as it was when `.roundup/` held both.
fn folders(dir: &Path) -> agents::claude_code::Folders<'_> {
    agents::claude_code::Folders {
        project: dir.parent().unwrap_or(dir),
        data: dir,
    }
}

impl Setup {
    fn launcher(&self) -> Launcher {
        Launcher::new(
            "fake-claude",
            self.claude_json.clone(),
            self.rup.clone(),
            None,
        )
    }

    fn prepare(&self, id: &str) -> Result<Vec<String>, rpc::RpcError> {
        self.prepare_as(id, Role::Agent)
    }

    fn prepare_as(&self, id: &str, role: Role) -> Result<Vec<String>, rpc::RpcError> {
        self.launcher()
            .prepare(folders(&self.dir), id, "1", &self.cwd, None, role)
    }

    fn real(&self, path: &Path) -> String {
        path.canonicalize().unwrap().to_string_lossy().into_owned()
    }
}

#[test]
fn a4_the_argv_runs_claude_with_a_per_agent_settings_file() {
    let s = setup();
    let argv = s.prepare("7").unwrap();
    assert_eq!(argv[..2], ["fake-claude", "--settings"]);
    assert_eq!(argv[3], "--mcp-config");
    assert_eq!(argv.len(), 9);
    for file in [&argv[2], &argv[4]] {
        assert!(Path::new(file).starts_with(s.dir.canonicalize().unwrap()));
    }
    // B50: the socket a note arrives on is per Agent, and the mode is the one a note names.
    assert_eq!(argv[7], "--messaging-socket-path");
    assert!(argv[8].ends_with("/7.sock"), "{}", argv[8]);
    assert!(!argv.contains(&"--permission-mode".to_owned()));
    let other = s.prepare("8").unwrap();
    assert_ne!((&argv[2], &argv[4]), (&other[2], &other[4]));
}

#[test]
fn a11_the_mcp_config_declares_one_stdio_server_that_runs_rup_mcp_for_the_agent() {
    let s = setup();
    let argv = s.prepare("7").unwrap();
    let config = read(Path::new(&argv[4]));
    assert_eq!(
        config,
        json!({"mcpServers": {"roundup": {
            "type": "stdio",
            "command": s.rup.to_string_lossy(),
            "args": ["mcp", "7"],
        }}})
    );
    assert_eq!(Path::new(&argv[4]).file_name().unwrap(), "7.mcp.json");
}

#[test]
fn a11_the_users_own_mcp_servers_stay_for_an_agent_the_user_started() {
    let s = setup();
    assert!(
        !s.prepare("7")
            .unwrap()
            .iter()
            .any(|arg| arg == "--strict-mcp-config")
    );
}

#[test]
fn a11_the_settings_allow_every_roundup_tool_so_none_raises_a_dialog() {
    let s = setup();
    let settings = read(Path::new(&s.prepare("7").unwrap()[2]));
    assert_eq!(
        settings["permissions"],
        json!({"allow": ["mcp__roundup__*"]})
    );
}

#[test]
fn a11_the_daemons_socket_is_in_neither_file() {
    let s = setup();
    let argv = s.prepare("7").unwrap();
    for file in [&argv[2], &argv[4]] {
        assert!(
            !std::fs::read_to_string(file)
                .unwrap()
                .contains("RUPD_SOCKET")
        );
    }
}

#[test]
fn a11_discarding_an_agent_deletes_both_of_its_files() {
    let s = setup();
    let argv = s.prepare("7").unwrap();
    Launcher::discard(&s.dir, "7").unwrap();
    assert!(
        ![&argv[2], &argv[4], &argv[6]]
            .iter()
            .any(|file| Path::new(file).exists())
    );
}

#[test]
fn a4_the_settings_hold_one_command_per_state_event_and_two_at_start() {
    let s = setup();
    let mut settings = read(Path::new(&s.prepare("7").unwrap()[2]));
    settings.as_object_mut().unwrap().remove("permissions");
    assert!(s.rup.is_absolute() && s.rup.exists());
    let command = format!("ROUNDUP_ATTEMPT='1' '{}' signal '7'", s.rup.display());
    let signal = json!({"type": "command", "command": command, "timeout": 5});
    let entry = json!([{"hooks": [signal]}]);
    // E3: `SessionStart` has a second command, `rup context`, beside the Signal.
    let context = format!("'{}' context '7'", s.rup.display());
    let at_start =
        json!([{"hooks": [signal, {"type": "command", "command": context, "timeout": 5}]}]);
    let expected: serde_json::Map<String, Value> = EVENTS
        .iter()
        .filter(|event| **event != "PermissionRequest")
        .map(|event| {
            let hook = if **event == *"SessionStart" {
                &at_start
            } else {
                &entry
            };
            ((*event).to_owned(), hook.clone())
        })
        .collect();
    // The late Notification and the spurious SubagentStop are not among the events.
    assert_eq!(settings["hooks"].as_object().unwrap().len(), EVENTS.len());
    for (event, hook) in &expected {
        assert_eq!(&settings["hooks"][event], hook, "{event}");
    }
}

#[test]
fn h9_the_permission_request_hook_runs_rup_permission_with_a_day_long_timeout() {
    let s = setup();
    let settings = read(Path::new(&s.prepare("7").unwrap()[2]));
    let command = format!("'{}' permission '7'", s.rup.display());
    assert_eq!(
        settings["hooks"]["PermissionRequest"],
        json!([{"hooks": [{"type": "command", "command": command, "timeout": 86400}]}])
    );
}

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

fn vars<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
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

fn brief(s: &Setup, id: &str, role: Role) -> String {
    let argv = s.prepare_as(id, role).unwrap();
    assert_eq!(argv[5], "--append-system-prompt-file");
    assert_eq!(
        Path::new(&argv[6]).file_name().unwrap(),
        format!("{id}.brief.md").as_str()
    );
    std::fs::read_to_string(&argv[6]).unwrap()
}

#[test]
fn e9_two_agents_of_one_role_get_equal_brief_bytes() {
    let s = setup();
    assert_eq!(
        brief(&s, "7013", Role::Agent),
        brief(&s, "7014", Role::Agent)
    );
    assert_eq!(brief(&s, "7013", Role::Door), brief(&s, "7014", Role::Door));
}

#[test]
fn e9_the_brief_holds_no_id() {
    let s = setup();
    let text = brief(&s, "7013", Role::Agent);
    assert!(!text.contains("7013") && !text.contains("Agent id"));
    assert!(text.contains("Context you get at start"));
}

#[test]
fn e9_a_door_and_an_ordinary_agent_still_differ() {
    let s = setup();
    assert_ne!(brief(&s, "7", Role::Agent), brief(&s, "8", Role::Door));
}

#[test]
fn e1_the_brief_names_the_tools_and_holds_nothing_mutable() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(!text.contains("Agent id is 7"));
    assert!(text.contains("supervises you"));
    for tool in [
        "todo_create",
        "todo_update",
        "pad_write",
        "pad_append",
        "message_send",
        "ask_user",
        "agent_context",
    ] {
        assert!(text.contains(&format!("`{tool}`")), "{tool}");
    }
    assert!(text.contains("`agent_spawn`"), "agent_spawn");
    assert!(!text.contains(&s.cwd.to_string_lossy().into_owned()));
}

#[test]
fn e1_the_flag_adds_to_the_argv_and_leaves_the_users_files_alone() {
    let s = setup();
    std::fs::write(s.cwd.join("CLAUDE.md"), "mine").unwrap();
    for role in [Role::Agent, Role::Door] {
        let argv = s.prepare_as("7", role).unwrap();
        assert_eq!(argv[..5], s.prepare_as("7", role).unwrap()[..5]);
        assert_eq!(
            std::fs::read_to_string(s.cwd.join("CLAUDE.md")).unwrap(),
            "mine"
        );
        assert!(!s.cwd.join(".claude").exists());
    }
}

#[test]
fn b24_only_a_door_brief_carries_the_role_guidance() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);
    assert!(door.contains("coordinating Door"));
    assert!(door.contains("ask directly in your Terminal"));
    assert!(
        !door
            .split("## Your role")
            .nth(1)
            .unwrap()
            .contains("ask_user")
    );
    assert!(door.contains("Report the outcome directly in your Terminal"));
    // M9: the tool list names `rail_startDoor`; no other line of an Agent's Brief speaks of a Door.
    assert!(
        agent
            .lines()
            .filter(|line| !line.starts_with("- `"))
            .all(|line| !line.contains("Door"))
    );
    assert!(!agent.contains("Your role"));
}

#[test]
fn f8_the_door_brief_delegates_and_uses_its_terminal() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    let role = text.split("## Your role").nth(1).unwrap();
    for instruction in [
        "The user types to you in your own Terminal",
        "Delegate implementation to children with `agent_spawn`",
        "You cannot execute commands or open or write to a Terminal",
        "Report the outcome directly in your Terminal",
        "ask directly in your Terminal",
        "`checkpoint_write`",
        "`order`",
        "`prompt`",
        "You write orders only for the Agents you spawn",
    ] {
        assert!(role.contains(instruction), "missing {instruction}: {role}");
    }
    assert!(!text.contains("Thread"));
    assert!(!text.contains("`message_send` to `you`"));
    assert!(!role.contains("only through `terminal_spawn`"));
    let messaging = text
        .lines()
        .find(|line| line.starts_with("- `message_send`:"))
        .unwrap();
    assert!(!messaging.contains("another Agent or the user"));
    assert!(messaging.contains("speak to the user directly in your own Terminal"));
}

#[test]
fn f8_each_brief_terminal_description_states_the_bubble_rule() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    for tool in ["agent_run", "terminal_spawn", "terminal_open"] {
        assert!(
            !door.contains(&format!("- `{tool}`:")),
            "M16: the Door has {tool}"
        );
    }
    for role in [Role::Agent] {
        let text = brief(&s, "7", role);
        for tool in ["agent_run", "terminal_spawn", "terminal_open"] {
            let prefix = format!("- `{tool}`:");
            let entry = text.lines().find(|line| line.starts_with(&prefix)).unwrap();
            for rule in [
                "use your own tools for commands",
                "open a Bubble only when the user needs to see its output or will interactively type into it",
                "Routine builds, tests and inspection use your own tools",
            ] {
                assert!(entry.contains(rule), "{tool} missing {rule}: {entry}");
            }
        }
    }
}

#[test]
fn a28_a_doors_brief_says_to_name_each_child() {
    let s = setup();
    assert!(brief(&s, "7", Role::Door).contains("Give each child a `name` after its task."));
}

#[test]
fn e1_preparing_the_same_id_and_role_twice_writes_the_same_text() {
    let s = setup();
    assert_eq!(brief(&s, "7", Role::Door), brief(&s, "7", Role::Door));
}

#[test]
fn e3_the_signal_stays_first_and_the_context_command_follows_with_five_seconds() {
    let s = setup();
    let settings = read(Path::new(&s.prepare("7").unwrap()[2]));
    let at_start = settings["hooks"]["SessionStart"][0]["hooks"]
        .as_array()
        .unwrap();
    assert_eq!(at_start.len(), 2);
    assert!(
        at_start[0]["command"]
            .as_str()
            .unwrap()
            .contains(" signal '7'")
    );
    assert_eq!(at_start[1]["timeout"], 5);
    assert!(
        at_start[1]["command"]
            .as_str()
            .unwrap()
            .ends_with(" context '7'")
    );
}

/// A fake `claude` prints `9.9.9`; `dir` holds it.
fn fake_claude_dir(root: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let dir = root.join("real-bin");
    std::fs::create_dir_all(&dir).unwrap();
    let claude = dir.join("claude");
    std::fs::write(&claude, "#!/bin/sh\necho 9.9.9\n").unwrap();
    std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).unwrap();
    dir
}

fn run_sh(path: &std::ffi::OsStr, command: &str) -> std::process::Output {
    std::process::Command::new("sh")
        .args(["-c", command])
        .env("PATH", path)
        .output()
        .unwrap()
}

#[test]
fn f2_a_door_starts_with_the_tool_allowlist_once_and_an_agent_without_it() {
    let s = setup();

    let door = s.prepare_as("7", Role::Door).unwrap();
    let agent = s.prepare("8").unwrap();

    let at = door.iter().position(|arg| arg == "--tools").unwrap();
    assert_eq!(door[at + 1], "Read,Grep,Glob,ToolSearch,Skill");
    assert_eq!(door.iter().filter(|arg| *arg == "--tools").count(), 1);
    assert_eq!(agent.len(), 9);
    assert!(!agent.iter().any(|arg| arg == "--tools"));
    assert_eq!(
        agents::claude_code::DOOR_TOOLS,
        "Read,Grep,Glob,ToolSearch,Skill"
    );
}

#[test]
fn f2_no_shim_directory_exists_for_an_agent() {
    let s = setup();

    s.prepare("8").unwrap();

    assert!(!s.dir.join("agents/8.bin").exists());
}

#[test]
fn f4_a_doors_settings_put_its_shim_directory_before_the_daemons_path() {
    let s = setup();

    let argv = s.prepare_as("7", Role::Door).unwrap();

    let path = read(Path::new(&argv[2]))["env"]["PATH"]
        .as_str()
        .unwrap()
        .to_owned();
    let shims = s.real(&s.dir.join("agents/7.bin"));
    let inherited = std::env::var("PATH").unwrap();
    assert_eq!(
        path,
        format!("{}:{shims}:{inherited}", s.rup.parent().unwrap().display())
    );
}

#[test]
fn f4_the_shim_for_claude_prints_the_message_and_exits_1_where_the_real_one_would_run() {
    let s = setup();
    let real = fake_claude_dir(s.root.path());
    s.prepare_as("7", Role::Door).unwrap();
    let shims = s.real(&s.dir.join("agents/7.bin"));
    let path = std::env::join_paths([
        PathBuf::from(&shims),
        real,
        PathBuf::from("/bin"),
        PathBuf::from("/usr/bin"),
    ])
    .unwrap();

    let direct = run_sh(&path, "claude --version");
    let nested = run_sh(&path, "sh -c 'claude --version'");

    for out in [direct, nested] {
        assert_eq!(out.status.code(), Some(1));
        assert_eq!(
            String::from_utf8_lossy(&out.stderr),
            "roundup: start an agent with agent_spawn (a Door) or ask the user\n"
        );
        assert!(out.stdout.is_empty());
    }
}

#[test]
fn f4_the_shim_leaves_other_programs_alone() {
    let s = setup();
    s.prepare_as("7", Role::Door).unwrap();
    let shims = s.real(&s.dir.join("agents/7.bin"));
    let path =
        std::env::join_paths([PathBuf::from(&shims), "/bin".into(), "/usr/bin".into()]).unwrap();

    let echo = std::process::Command::new("/bin/echo")
        .arg("hi")
        .output()
        .unwrap();
    let git = run_sh(&path, "git --version");

    assert_eq!(String::from_utf8_lossy(&echo.stdout), "hi\n");
    assert!(git.status.success(), "{git:?}");
    let names: Vec<_> = std::fs::read_dir(&shims)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["claude"]);
}

#[test]
fn f4_discarding_a_door_deletes_its_shim_directory() {
    let s = setup();
    s.prepare_as("7", Role::Door).unwrap();

    Launcher::discard(&s.dir, "7").unwrap();

    assert!(!s.dir.join("agents/7.bin").exists());
}

#[test]
fn f4_a_symlinked_shim_directory_is_refused() {
    let s = setup();
    let elsewhere = s.root.path().join("elsewhere");
    std::fs::create_dir(&elsewhere).unwrap();
    std::fs::create_dir_all(s.dir.join("agents")).unwrap();
    std::os::unix::fs::symlink(&elsewhere, s.dir.join("agents/7.bin")).unwrap();

    let err = s.prepare_as("7", Role::Door).unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);
}

#[test]
fn f3_every_agents_mcp_server_is_started_the_same_way() {
    let s = setup();

    let door = s.prepare_as("7", Role::Door).unwrap();
    let agent = s.prepare("8").unwrap();

    assert_eq!(
        read(Path::new(&door[4]))["mcpServers"]["roundup"]["args"],
        json!(["mcp", "7"])
    );
    assert_eq!(
        read(Path::new(&agent[4]))["mcpServers"]["roundup"]["args"],
        json!(["mcp", "8"])
    );
}

#[test]
fn f3_every_brief_names_agent_spawn_and_only_a_doors_says_it_has_no_shell() {
    let s = setup();

    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);

    assert!(door.contains("- `agent_spawn`:"));
    assert!(door.contains("`message_send`"));
    assert!(door.contains("You cannot execute commands or open or write to a Terminal"));
    assert!(agent.contains("- `agent_spawn`:"));
    assert!(!agent.contains("You cannot execute commands or open or write to a Terminal"));
}

#[test]
fn m10_a_doors_brief_names_checkpoint_write_and_no_other_does() {
    let s = setup();

    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);

    assert!(door.contains("- `checkpoint_write`:"));
    assert!(door.contains("`reduce`") && door.contains("`show-me`"));
    assert!(door.contains("facts needed to understand that point in the work"));
    assert!(!agent.contains("checkpoint_write"));
    assert!(agent.contains("- `checkpoint_list`:"));
}

#[test]
fn q1_pin() {
    use sha2::{Digest, Sha256};
    let bytes =
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/hold-plain.md")).unwrap();
    let hex: String = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(
        hex,
        "0f2c26f0cea8ba39af771d2fdb09db6ae4a7a90c64c272a0a0e967f420e9af1e"
    );
}

#[test]
fn q1_brief() {
    let s = setup();
    let body =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/hold-plain.md"))
            .unwrap();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains(&body));
    assert!(text.contains("Digest and Pad reply"));
    assert!(text.contains("Write each limit of a Work order as a rule that reads on its own"));
}

#[test]
fn m11_the_roundup_server_is_not_always_loaded() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let argv = s.prepare_as("7", role).unwrap();
        let config = read(Path::new(&argv[4]));
        assert!(config["mcpServers"]["roundup"].get("alwaysLoad").is_none());
        let settings = read(Path::new(&argv[2]));
        assert_ne!(settings["env"]["ENABLE_TOOL_SEARCH"], "false");
        assert_eq!(
            argv.iter().any(|arg| arg == "--strict-mcp-config"),
            role == Role::Door,
            "LC2: a Door starts lean, an Agent the user started does not"
        );
    }
}

#[test]
fn m11_settings_ask_for_tool_search_unless_the_user_set_it() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let argv = s.prepare_as("7", role).unwrap();
        assert_eq!(
            read(Path::new(&argv[2]))["env"]["ENABLE_TOOL_SEARCH"],
            "true"
        );
    }
    let user = Launcher::from_vars(
        vars(&[
            ("ENABLE_TOOL_SEARCH", "auto"),
            ("CLAUDE_CONFIG_DIR", s.root.path().to_str().unwrap()),
            ("ROUNDUP_RUP_BIN", s.rup.to_str().unwrap()),
        ]),
        Path::new("/e/rupd"),
    )
    .unwrap();
    let argv = user
        .prepare(folders(&s.dir), "8", "1", &s.cwd, None, Role::Door)
        .unwrap();
    let settings = read(Path::new(&argv[2]));
    assert!(settings["env"].get("ENABLE_TOOL_SEARCH").is_none());
    assert!(settings["env"]["PATH"].is_string());
}

#[test]
fn m11_permission_for_roundup_tools_is_still_allowed() {
    let s = setup();
    let settings = read(Path::new(&s.prepare_as("7", Role::Door).unwrap()[2]));
    assert!(
        settings["permissions"]["allow"]
            .as_array()
            .unwrap()
            .contains(&json!("mcp__roundup__agent_spawn"))
    );
}

#[test]
fn m11_the_brief_names_how_to_load_and_the_first_turn_tools() {
    let s = setup();
    for (role, first) in [
        (Role::Agent, "Load `agent_context` and `todo_list` together"),
        (
            Role::Door,
            "Load `agent_context`, `message_list`, `agent_digest` and `ask_user` together",
        ),
    ] {
        let text = brief(&s, "7", role);
        assert!(text.contains("`ToolSearch`") && text.contains("select:mcp__roundup__<name>"));
        assert!(text.contains(first), "{first}");
    }
}

#[test]
fn m11_a_role_told_to_use_tool_search_has_it() {
    let s = setup();
    let door = s.prepare_as("7", Role::Door).unwrap();
    let at = door.iter().position(|arg| arg == "--tools").unwrap();
    assert!(door[at + 1].split(',').any(|tool| tool == "ToolSearch"));
    assert!(brief(&s, "7", Role::Door).contains("`ToolSearch`"));
    let agent = s.prepare("8").unwrap();
    assert!(!agent.iter().any(|arg| arg == "--tools"));
}

fn asset(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("assets")
            .join(name),
    )
    .unwrap()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn q6_pin() {
    assert_eq!(
        sha256_hex(asset("reduce.md").as_bytes()),
        "c0397f941ee2db71ab1ba870b6f53987e38f0b7b0cbfec23a780f5c393f3703f"
    );
    assert_eq!(
        sha256_hex(asset("show-me.md").as_bytes()),
        "434a2346cc95e313b0d367d477dda2e23ba642dd2181757415a09500664af100"
    );
}

#[test]
fn q6_brief() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let text = brief(&s, "7", role);
        assert!(text.contains(&asset("reduce.md")), "{role:?}");
        assert!(text.contains(&asset("show-me.md")), "{role:?}");
        assert!(text.contains(
            "Run `reduce` on every Work order, Message to `you`, `ask_user` question, Digest, Pad reply and Todo title"
        ));
        assert_eq!(text, brief(&s, "7", role));
    }
}

#[test]
fn q7_brief_names_each_view_and_its_place() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    for view in ["a table", "code-shape sketch", "`diff`", "Mermaid diagram"] {
        assert!(text.contains(view), "{view}");
    }
    assert!(text.contains("only in a Pad"));
    assert!(text.contains("write the diagram in a Pad and send the Pad's name"));
}

#[test]
fn q7_brief_forbids_html() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains("write no HTML file and never `open` one"));
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/reduce")
            .join(name),
    )
    .unwrap()
}

fn lines(name: &str) -> Vec<String> {
    fixture(name).lines().map(str::to_owned).collect()
}

/// Q8 (b): the facts missing from `text`.
fn missing_facts(text: &str) -> Vec<String> {
    lines("door-question.facts")
        .into_iter()
        .filter(|fact| !text.contains(fact.as_str()))
        .collect()
}

#[test]
fn q8_reduced_is_shorter() {
    assert!(
        fixture("door-question.reduced.md").chars().count()
            < fixture("door-question.md").chars().count()
    );
}

#[test]
fn q8_every_fact_survives() {
    assert!(missing_facts(&fixture("door-question.md")).is_empty());
    assert!(missing_facts(&fixture("door-question.reduced.md")).is_empty());
}

#[test]
fn q8_no_padding_phrase_survives() {
    let original = fixture("door-question.md");
    let reduced = fixture("door-question.reduced.md");
    let padding = lines("door-question.padding");
    assert_eq!(padding.len(), 4);
    for phrase in padding {
        assert!(original.contains(&phrase), "{phrase}");
        assert!(!reduced.contains(&phrase), "{phrase}");
    }
}

#[test]
fn q8_the_check_rejects_a_dropped_fact() {
    let dropped = fixture("door-question.reduced.md").replace("Friday 14 Nov", "");
    assert_eq!(missing_facts(&dropped), ["Friday 14 Nov"]);
}

#[test]
fn q9_door_guidance_names_the_four_paddings() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    for rule in [
        "Open a question with the question.",
        "State a guess once, as a choice to confirm.",
        "Write a list as the choices and nothing around them.",
        "Leave out an acknowledgment such as \"On it.\", a connective such as \"Separately:\" and a list item that restates its question.",
    ] {
        assert!(text.contains(rule), "{rule}");
    }
}

#[test]
fn h14b_the_brief_carries_the_ask_user_rules() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let text = brief(&s, "7", role);
        for rule in [
            "The question is one line: the decision.",
            "The context is at most 3 lines, only what the pick turns on, and you run `reduce` on it.",
            "The answers are 2 to 4, the recommended one first and its label ending ` (recommended)`.",
            "A label is at most 5 words.",
            "A description is the tradeoff: what the pick gains and what it costs.",
            "A preview is the smallest `show-me` sketch of what the pick builds, and is required when the user has not met its terms.",
            "An open question the user answers in their own words takes no answers.",
            "Never ask what you can answer by looking, and never ask `you` in a Message what `ask_user` asks.",
        ] {
            assert!(text.contains(rule), "{rule}");
        }
    }
}

#[test]
fn q9_ordinary_brief_has_no_door_guidance() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(!text.contains("Open a question with the question."));
    assert!(!text.contains("a connective such as"));
}

#[test]
fn m9_a_doors_brief_names_the_workstream_and_project_tools() {
    let s = setup();
    let door = brief(&s, "7", Role::Door);
    let agent = brief(&s, "8", Role::Agent);

    for needle in [
        "`rail_createWorkstream`",
        "`rail_startDoor`",
        "`project_open`",
        "`agent_stop`",
        "`agent_prompt`",
        "`decision_list`",
        "`decision_answer`",
        "`[decision <id>]`",
        "Reach",
    ] {
        assert!(door.contains(needle), "{needle}");
    }
    assert!(door.contains("never nested"));
    assert!(agent.contains("`rail_createWorkstream`"));
    assert!(!agent.contains("coordinating Door"));
}

#[test]
fn q11_a_worker_gets_plain_for_every_reply() {
    let s = setup();
    let text = brief(&s, "7", Role::Agent);
    assert!(text.contains("Write every reply, including direct Terminal prose, in hold:Plain regardless of recipient or tool."));
    assert!(text.contains(&asset("hold-plain.md")));
}

#[tokio::test]
async fn i5_launch_sets_roundup_agent_in_the_claude_environment() {
    let s = setup();
    let launcher = plugin_launcher(&s);
    let (_, env) = launcher
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
    assert_eq!(env["ROUNDUP_AGENT"], "7");
}


fn env_of(argv: &[String]) -> Value {
    read(Path::new(&argv[2]))["env"].clone()
}

fn rup_dir(s: &Setup) -> String {
    s.rup.parent().unwrap().to_string_lossy().into_owned()
}

#[test]
fn a43_an_agents_settings_set_its_id_and_put_the_rup_folder_first_on_path() {
    let s = setup();
    let env = env_of(&s.prepare("7").unwrap());
    assert_eq!(env["ROUNDUP_AGENT_ID"], "7");
    assert_eq!(
        env["PATH"].as_str().unwrap(),
        format!("{}:{}", rup_dir(&s), std::env::var("PATH").unwrap())
    );
    assert_eq!(env["CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"], "1");
}

#[test]
fn a43_a_doors_path_is_the_rup_folder_then_its_shims_then_the_daemons() {
    let s = setup();
    let env = env_of(&s.prepare_as("7", Role::Door).unwrap());
    assert_eq!(env["ROUNDUP_AGENT_ID"], "7");
    assert_eq!(
        env["PATH"].as_str().unwrap(),
        format!(
            "{}:{}:{}",
            rup_dir(&s),
            s.real(&s.dir.join("agents/7.bin")),
            std::env::var("PATH").unwrap()
        )
    );
}

#[test]
fn a43_an_empty_daemon_path_leaves_no_empty_entry() {
    if std::env::var_os("A43_CHILD").is_none() {
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "a43_an_empty_daemon_path_leaves_no_empty_entry"])
            .env("A43_CHILD", "1")
            .env("PATH", "")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stdout)
        );
        return;
    }
    let s = setup();
    assert_eq!(env_of(&s.prepare("7").unwrap())["PATH"], rup_dir(&s));
}

#[test]
fn a43_a_resumed_agents_settings_hold_the_same_env() {
    let s = setup();
    let first = env_of(&s.prepare("7").unwrap());
    let argv = s
        .launcher()
        .prepare(
            folders(&s.dir),
            "7",
            "2",
            &s.cwd,
            Some("saved"),
            Role::Agent,
        )
        .unwrap();
    assert_eq!(env_of(&argv), first);
}

#[test]
fn a43_the_brief_names_the_id_variable_and_rup_help() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let argv = s.prepare_as("7", role).unwrap();
        let at = argv
            .iter()
            .position(|a| a == "--append-system-prompt-file")
            .unwrap();
        let brief = std::fs::read_to_string(&argv[at + 1]).unwrap();
        assert!(brief.contains("ROUNDUP_AGENT_ID") && brief.contains("rup help"));
    }
}

impl Setup {
    /// M2219: prepare Agent `id` with the roundup MCP server off.
    fn prepare_off(&self, id: &str, role: Role) -> Vec<String> {
        let pair = agents::claude_code::Pair {
            mcp_off: true,
            ..Default::default()
        };
        self.launcher()
            .prepare_on(folders(&self.dir), id, "1", &self.cwd, None, role, &pair)
            .unwrap()
    }
}

fn off_brief(s: &Setup, id: &str, role: Role) -> String {
    let argv = s.prepare_off(id, role);
    let at = argv
        .iter()
        .position(|arg| arg == "--append-system-prompt-file")
        .unwrap();
    std::fs::read_to_string(&argv[at + 1]).unwrap()
}

#[test]
fn m2219_off_launches_without_a_roundup_server_or_allow_rule() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        let argv = s.prepare_off("7", role);
        assert!(!argv.iter().any(|arg| arg == "--mcp-config"), "{argv:?}");
        assert!(!s.dir.join("agents/7.mcp.json").exists());
        let settings = read(Path::new(&argv[2]));
        assert!(settings.get("permissions").is_none(), "{settings}");
        assert!(!settings.to_string().contains("mcp__roundup__"));
    }
    // A config left by an earlier launch with MCP on is gone.
    s.prepare("8").unwrap();
    assert!(s.dir.join("agents/8.mcp.json").exists());
    s.prepare_off("8", Role::Agent);
    assert!(!s.dir.join("agents/8.mcp.json").exists());
}

#[test]
fn m2219_off_keeps_the_hooks_and_the_tools_without_toolsearch() {
    let s = setup();
    let door = s.prepare_off("7", Role::Door);
    let at = door.iter().position(|arg| arg == "--tools").unwrap();
    assert_eq!(door[at + 1], "Read,Grep,Glob,Skill");
    let hooks = &read(Path::new(&door[2]))["hooks"];
    for event in EVENTS {
        assert!(hooks[event].is_array(), "{event}");
    }
}

#[test]
fn m2219_off_brief_names_rup_commands_and_no_mcp_tool() {
    let s = setup();
    for (role, first) in [
        (
            Role::Agent,
            "Run `rup agent context` and `rup todo list` first.",
        ),
        (
            Role::Door,
            "Run `rup agent context`, `rup message list`, `rup agent digest` and `rup agent ask` first.",
        ),
    ] {
        let text = off_brief(&s, "7", role);
        for banned in [
            "mcp__roundup__",
            "ToolSearch",
            "MCP server",
            "agent_context",
        ] {
            assert!(!text.contains(banned), "{role:?} names {banned}");
        }
        assert!(text.contains("run `rup help`"));
        assert!(text.contains(first), "{first}");
        assert!(text.contains("`rup todo set-blockers`"));
        assert!(text.contains("`rup pad append-section`"));
        assert_eq!(text, off_brief(&s, "8", role));
        assert!(!text.contains("\n7\n"));
    }
}

#[test]
fn m2219_on_brief_is_unchanged() {
    let s = setup();
    let golden = |name: &str| {
        std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/fixtures/brief/{name}.md")),
        )
        .unwrap()
    };
    assert_eq!(brief(&s, "7", Role::Agent), golden("agent"));
    assert_eq!(brief(&s, "7", Role::Door), golden("door"));
}

#[test]
fn b53_the_door_brief_says_to_show_not_read() {
    let s = setup();
    let text = brief(&s, "7", Role::Door);
    assert!(
        text.contains("- `terminal_show`:"),
        "the Door is offered terminal_show"
    );
    let rule = text
        .lines()
        .flat_map(|line| line.split(". "))
        .find(|sentence| sentence.contains("asks to see a child's output"))
        .expect("the Door brief says what to do when asked to see output");
    for word in ["`terminal_show`", "read nothing"] {
        assert!(rule.contains(word), "{rule}");
    }
    // E9: a role's bytes do not depend on the id.
    assert_eq!(text, brief(&s, "8", Role::Door));
    assert!(!brief(&s, "7", Role::Agent).contains("terminal_show"));
    assert!(off_brief(&s, "7", Role::Door).contains("`rup terminal show`"));
}

#[test]
fn b45_the_brief_says_to_wake_not_poll() {
    let s = setup();
    for role in [Role::Agent, Role::Door] {
        for (text, ask) in [
            (brief(&s, "7", role), "`agent_wake`"),
            (off_brief(&s, "7", role), "`rup agent wake`"),
        ] {
            let line = text
                .lines()
                .find(|line| line.starts_with(&format!("- {ask}")))
                .unwrap_or_else(|| panic!("{role:?} brief names no {ask}"));
            assert!(
                line.contains("end your turn instead of polling `terminal_read` or `rail_tree`")
                    || line.contains(
                        "end your turn instead of polling `rup terminal read` or `rup rail tree`"
                    ),
                "{line}"
            );
            assert!(line.contains("tells you without asking"), "{line}");
        }
    }
}

/// `rup help`, from the `rup` that `cargo build -p rup` left beside the test binaries.
fn rup_help() -> String {
    let rup = std::env::current_exe()
        .unwrap()
        .parent()
        .and_then(Path::parent)
        .unwrap()
        .join("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    let out = std::process::Command::new(rup)
        .arg("help")
        .output()
        .unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap()
}

#[test]
fn b45_every_command_the_brief_names_is_in_rup_help() {
    let s = setup();
    let help = rup_help();
    for role in [Role::Agent, Role::Door] {
        let text = off_brief(&s, "7", role);
        let named: Vec<&str> = text
            .lines()
            .filter(|line| line.starts_with("- `rup "))
            .filter_map(|line| line.strip_prefix("- `")?.split('`').next())
            .collect();
        assert!(named.contains(&"rup agent wake"), "{named:?}");
        for command in named {
            assert!(
                help.contains(&format!("    {command} "))
                    || help.contains(&format!("    {command}\n")),
                "{command} is in no line of `rup help`"
            );
        }
    }
}

// LC1–LC10: the lean child start.

#[path = "launch/lean.rs"]
mod lean;

#[path = "launch/choices.rs"]
mod choices;

#[path = "launch/plugins.rs"]
mod plugins;
use plugins::plugin_launcher;
