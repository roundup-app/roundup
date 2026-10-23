//! F2, F4: Door tool restrictions and shell shims.
use super::*;

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

