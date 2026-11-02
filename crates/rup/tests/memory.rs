//! LC20: the generated command reaches the real handler through stdin/stdout.
use agents::claude_code::{Folders, Launcher, Role};
use serde_json::{Value, json};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

#[test]
fn lc20_generated_memory_command_uses_the_hook_protocol() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    let data = dir.path().join("data");
    let memory = dir.path().join("memory");
    std::fs::create_dir(&project).unwrap();
    std::fs::create_dir(&data).unwrap();
    std::fs::write(
        dir.path().join("settings.json"),
        json!({"autoMemoryDirectory":memory}).to_string(),
    )
    .unwrap();
    let launcher = Launcher::new(
        "fake-claude",
        dir.path().join("config.json"),
        Path::new(env!("CARGO_BIN_EXE_rup")).to_owned(),
        None,
    );
    let argv = launcher
        .prepare(
            Folders {
                project: &project,
                data: &data,
            },
            "7",
            "1",
            &project,
            None,
            Role::Door,
        )
        .unwrap();
    let settings: Value = serde_json::from_slice(&std::fs::read(&argv[2]).unwrap()).unwrap();
    let hook = settings["hooks"]["PreToolUse"]
        .as_array()
        .unwrap()
        .iter()
        .find(|hook| hook["matcher"] == "Write|Edit")
        .unwrap();
    for target in [memory.join("MEMORY.md"), project.join("source.rs")] {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg(hook["hooks"][0]["command"].as_str().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(json!({"tool_name":"Write","tool_input":{"file_path":target},"permission_mode":"bypassPermissions"}).to_string().as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
        if target.starts_with(&memory) {
            assert_eq!(reply, json!({}));
        } else {
            assert_eq!(reply["hookSpecificOutput"]["permissionDecision"], "deny");
            assert!(
                reply["hookSpecificOutput"]["permissionDecisionReason"]
                    .as_str()
                    .unwrap()
                    .contains("child Agent")
            );
        }
    }
}
