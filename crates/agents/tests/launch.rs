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

#[path = "launch/trust.rs"]
mod trust;

#[path = "launch/briefs.rs"]
mod briefs;

#[path = "launch/guidance.rs"]
mod guidance;

use trust::vars;

#[test]
fn a3507a_every_launch_keeps_the_users_gateway() {
    use agents::claude_code::{Lean, PROFILES, Pair};
    let s = setup();
    std::fs::write(s.root.path().join("settings.json"), json!({
        "env": {
            "ANTHROPIC_CUSTOM_HEADERS": "x-wise-llm-gateway-team: fixture\nx-wise-llm-gateway-use-case: test",
            "ANTHROPIC_BASE_URL": "https://gateway.invalid"
        },
        "apiKeyHelper": "fixture-helper"
    }).to_string()).unwrap();
    let rows = std::iter::once((Role::Agent, Pair::default())).chain(PROFILES.iter().map(|(role, _)| {
        (*role, Pair { lean: Some(Lean { scout: *role == Role::Scout, ..Default::default() }), ..Default::default() })
    }));
    for (role, pair) in rows {
        for resume in [None, Some("saved")] {
            let argv = s.launcher().prepare_on(folders(&s.dir), "7", "1", &s.cwd, resume, role, &pair).unwrap();
            let settings = read(Path::new(&argv[2]));
            assert_eq!(settings["apiKeyHelper"], "fixture-helper", "{role:?} {resume:?}");
            assert_eq!(settings["env"]["ANTHROPIC_BASE_URL"], "https://gateway.invalid");
            assert_eq!(settings["env"]["ANTHROPIC_CUSTOM_HEADERS"], "x-wise-llm-gateway-team: fixture\nx-wise-llm-gateway-use-case: test");
        }
    }
}
