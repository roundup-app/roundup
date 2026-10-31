//! SK7–SK9: `rup skill report` under a pty, and the three owner commands against a temporary
//! config folder. None starts `claude` or a Daemon.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Output};
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, PtySize, native_pty_system};

const RUP: &str = env!("CARGO_BIN_EXE_rup");

/// Run `rup skill report <args>` with the given extra env under a pty; the bytes the terminal got.
fn on_tty(args: &[&str], env: &[(&str, &str)]) -> (Vec<u8>, bool, Duration) {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = CommandBuilder::new(RUP);
    command.args(["skill", "report"]);
    command.args(args);
    command.env_remove("ROUNDUP_AGENT");
    command.env_remove("ROUNDUP_TERMINAL");
    for (name, value) in env {
        command.env(name, value);
    }
    let started = Instant::now();
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let status = child.wait().unwrap();
    let took = started.elapsed();
    drop(pair.master);
    let mut bytes = Vec::new();
    let _ = reader.read_to_end(&mut bytes);
    (bytes, status.success(), took)
}

fn str(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn sk7_each_state_writes_its_report_to_the_tty_only() {
    let marker = [("ROUNDUP_TERMINAL", "7")];
    for (args, wire) in [
        (&["--state", "working"][..], "state=working"),
        (
            &["--state", "blocked", "--kind", "permission"],
            "state=blocked:kind=permission",
        ),
        (
            &["--state", "blocked", "--kind", "question"],
            "state=blocked:kind=question",
        ),
        (&["--state", "done"], "state=done"),
        (&["--state", "clear"], "state=clear"),
        (&["--state", "idle"], "state=idle"),
    ] {
        let (tty, ok, _) = on_tty(args, &marker);
        assert!(ok);
        assert_eq!(str(&tty), format!("\x1b]7501;{wire}\x1b\\"), "{args:?}");
    }
    // stdout and stderr go to pipes: the report is on neither.
    let out = Command::new(RUP)
        .args(["skill", "report", "--state", "working"])
        .env("ROUNDUP_TERMINAL", "7")
        .env_remove("ROUNDUP_AGENT")
        .output()
        .unwrap();
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
}

#[test]
fn sk7_nothing_is_written_without_the_terminal_marker_or_a_tty() {
    let (tty, ok, _) = on_tty(&["--state", "working"], &[]);
    assert!(ok && tty.is_empty(), "{tty:?}");
}

#[test]
fn sk7_the_command_always_exits_0_and_is_fast() {
    let marker = [("ROUNDUP_TERMINAL", "7")];
    for args in [
        &[][..],
        &["--state", "nonsense"],
        &["--state"],
        &["--bogus"],
        &["--state", "blocked"],
        &["--state", "blocked", "--kind", "auth"],
    ] {
        let (tty, ok, took) = on_tty(args, &marker);
        assert!(ok, "{args:?}");
        assert!(tty.is_empty(), "{args:?}: {tty:?}");
        assert!(took < Duration::from_millis(1000), "{args:?}: {took:?}");
    }
}

#[test]
fn sk7_a_report_carries_only_state_and_kind() {
    let (tty, _, _) = on_tty(
        &[
            "--state",
            "blocked",
            "--kind",
            "question",
            "--prompt",
            "secret",
            "/etc/passwd",
        ],
        &[("ROUNDUP_TERMINAL", "7")],
    );
    assert_eq!(str(&tty), "\x1b]7501;state=blocked:kind=question\x1b\\");
}

#[test]
fn sk8_where_prints_one_line_in_a_roundup_terminal_and_nothing_elsewhere() {
    let run = |marker: Option<&str>| {
        let mut command = Command::new(RUP);
        command.args(["skill", "report", "--state", "idle", "--where"]);
        command
            .env_remove("ROUNDUP_AGENT")
            .env_remove("ROUNDUP_TERMINAL");
        if let Some(id) = marker {
            command.env("ROUNDUP_TERMINAL", id);
        }
        command.output().unwrap()
    };
    let inside = run(Some("42"));
    let text = str(&inside.stdout);
    assert_eq!(text.lines().count(), 1, "{text}");
    assert!(text.contains("roundup Terminal") && text.contains("42"));
    assert!(text.contains("run \"rup help\" to learn the commands"));
    assert!(run(None).stdout.is_empty());
}

#[test]
fn sk8_an_agent_environment_makes_every_form_silent() {
    for args in [&["--state", "idle", "--where"][..], &["--state", "working"]] {
        let out = Command::new(RUP)
            .args(["skill", "report"])
            .args(args)
            .env("ROUNDUP_AGENT", "a1")
            .env("ROUNDUP_TERMINAL", "42")
            .output()
            .unwrap();
        assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty());
        let (tty, ok, _) = on_tty(args, &[("ROUNDUP_AGENT", "a1"), ("ROUNDUP_TERMINAL", "42")]);
        assert!(ok && tty.is_empty());
    }
}

/// `rup skill <args>` with `HOME` and `CLAUDE_CONFIG_DIR` in `home`.
fn skill(home: &Path, args: &[&str]) -> Output {
    Command::new(RUP)
        .arg("skill")
        .args(args)
        .env("HOME", home)
        .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
        .env_remove("ROUNDUP_AGENT")
        .output()
        .unwrap()
}

fn folder() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".claude")).unwrap();
    dir
}

#[test]
fn sk8_setup_and_remove_leave_a_running_agents_files_alone() {
    let dir = folder();
    let data = dir.path().join("data/agents/a1");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(data.join("settings.json"), b"{\"hooks\":{}}").unwrap();
    std::fs::write(data.join("brief.md"), b"Brief").unwrap();
    let before = (
        std::fs::read(data.join("settings.json")).unwrap(),
        std::fs::read(data.join("brief.md")).unwrap(),
    );
    assert!(skill(dir.path(), &["setup"]).status.success());
    assert!(skill(dir.path(), &["remove"]).status.success());
    let after = (
        std::fs::read(data.join("settings.json")).unwrap(),
        std::fs::read(data.join("brief.md")).unwrap(),
    );
    assert_eq!(before, after);
}

#[test]
fn sk9_each_command_prints_one_line_per_item_and_json_prints_the_list() {
    let dir = folder();
    let claude = dir.path().join(".claude");
    let setup = skill(dir.path(), &["setup"]);
    let text = str(&setup.stdout);
    assert_eq!(
        text,
        format!(
            "installed skill {}\ninstalled hook {}\n",
            claude.join("skills/roundup/SKILL.md").display(),
            claude.join("settings.json").display()
        )
    );
    let status: serde_json::Value =
        serde_json::from_slice(&skill(dir.path(), &["status", "--json"]).stdout).unwrap();
    assert_eq!(status[0]["item"], "skill");
    assert_eq!(status[0]["outcome"], "current");
    assert_eq!(status[1]["item"], "hook");
    let remove = str(&skill(dir.path(), &["remove"]).stdout);
    assert!(remove.starts_with("removed skill ") && remove.contains("\nremoved hook "));
}

#[test]
fn sk9_dry_run_prints_would_lines_and_writes_nothing() {
    let dir = folder();
    let out = skill(dir.path(), &["setup", "--dry-run"]);
    assert!(out.status.success());
    let text = str(&out.stdout);
    assert!(text.starts_with("would installed skill ") && text.contains("\nwould installed hook "));
    assert_eq!(
        std::fs::read_dir(dir.path().join(".claude"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn sk9_force_only_belongs_to_setup() {
    let dir = folder();
    for verb in ["status", "remove"] {
        let out = skill(dir.path(), &[verb, "--force"]);
        assert_eq!(out.status.code(), Some(2), "{verb}");
    }
}

#[test]
fn sk9_exit_codes_are_0_1_and_2_with_the_cause_on_stderr() {
    let dir = folder();
    let foreign = dir.path().join(".claude/skills/roundup");
    std::fs::create_dir_all(&foreign).unwrap();
    std::fs::write(foreign.join("SKILL.md"), "mine").unwrap();
    let refused = skill(dir.path(), &["setup"]);
    assert_eq!(refused.status.code(), Some(1));
    let why = str(&refused.stderr);
    assert!(why.starts_with("rup: ") && why.contains("--force"), "{why}");
    assert_eq!(
        std::fs::read_to_string(foreign.join("SKILL.md")).unwrap(),
        "mine"
    );
    assert_eq!(skill(dir.path(), &["status"]).status.code(), Some(0));
    let forced = skill(dir.path(), &["setup", "--force"]);
    assert_eq!(forced.status.code(), Some(0));
    assert_eq!(skill(dir.path(), &["bogus"]).status.code(), Some(2));
    assert_eq!(skill(dir.path(), &[]).status.code(), Some(2));
}

#[test]
fn sk9_help_lists_the_skill_commands() {
    for args in [&["help", "skill"][..], &["skill", "--help"]] {
        let out = Command::new(RUP).args(args).output().unwrap();
        assert!(out.status.success());
        let text = str(&out.stdout);
        for line in [
            "rup skill setup",
            "rup skill status",
            "rup skill remove",
            "--dry-run",
            "--force",
        ] {
            assert!(text.contains(line), "{args:?}: {line}");
        }
    }
    let help = str(&Command::new(RUP).arg("help").output().unwrap().stdout);
    assert!(help.contains("rup skill <setup|status|remove>"));
}

/// SK12: stdout is `/dev/full`, so every write to it fails; the tty still gets the report.
#[test]
fn sk12_a_closed_stdout_still_exits_0_with_the_report_written() {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = CommandBuilder::new("sh");
    command.args([
        "-c",
        "exec \"$0\" skill report --state idle --where >/dev/full",
        RUP,
    ]);
    command.env_remove("ROUNDUP_AGENT");
    command.env("ROUNDUP_TERMINAL", "t1");
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let status = child.wait().unwrap();
    drop(pair.master);
    let mut bytes = Vec::new();
    let _ = reader.read_to_end(&mut bytes);
    let out = str(&bytes);
    assert!(status.success(), "{status:?} {out:?}");
    assert!(out.contains("\x1b]7501;state=idle\x1b\\"), "{out:?}");
    assert!(!out.contains("panicked"), "{out:?}");
}
