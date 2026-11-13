//! MC59, MC60, MC61: a test core never runs in the owner's HOME or session, a holder's environment
//! never decides a program's, and a run leaves the real herdr-core state untouched.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use contracts::terminal::SpawnParams;
use rpc::Bus;
use terminal::Terminals;

/// A core that records its `HOME` and argv, then runs the test core with `exports` set as a holder
/// started by another run would have them.
fn core(dir: &Path, exports: &str) -> std::path::PathBuf {
    let wrapper = dir.join("core");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho \"$HOME\" > '{d}/home'\necho \"$@\" > '{d}/argv'\n{exports}\nexec '{bin}' \"$@\"\n",
            d = dir.display(),
            bin = env!("CARGO_BIN_EXE_herdr-core-test")
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    wrapper
}

/// Prints the config dir, then every `ROUNDUP_*` and `FAKE_CLAUDE_*` name, then `END`.
const LIST: [&str; 3] = [
    "sh",
    "-c",
    "echo CFG=[$CLAUDE_CONFIG_DIR]; env | grep -E '^(ROUNDUP|FAKE_CLAUDE)_'; echo END",
];

fn params(dir: &Path, command: &[&str], env: &[(&str, &str)]) -> SpawnParams {
    SpawnParams {
        cwd: dir.to_string_lossy().into_owned(),
        command: Some(command.iter().map(|c| (*c).to_owned()).collect()),
        env: env
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect::<BTreeMap<_, _>>(),
        unset: Vec::new(),
        cols: 200,
        rows: 24,
        machine: None,
    }
}

/// The screen's text once `needle` shows, or what it held at the bound.
async fn screen_with(terminals: &Terminals, id: &str, needle: &str) -> String {
    let screen = || terminals.read_screen(id, None).unwrap().lines.join("\n");
    // Subscribe first, then read: output before the subscription is on the screen already.
    let Ok(mut output) = terminals.subscribe_output(id) else {
        return screen();
    };
    let wait = async {
        while !screen().contains(needle) {
            if output.next().await.is_none() {
                break;
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
    screen()
}

#[tokio::test]
async fn mc59_test_core_uses_scratch_home_and_own_session() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new())
        .unwrap()
        .with_core(core(dir.path(), ""));
    let started = terminals
        .spawn_owned(params(dir.path(), &["cat"], &[]), "t")
        .await
        .unwrap();
    let home = std::fs::read_to_string(dir.path().join("home")).unwrap();
    let real = std::env::var("HOME").unwrap_or_default();
    assert_ne!(home.trim(), real);
    assert!(home.trim().contains("roundup-core-"), "{home}");
    let argv = std::fs::read_to_string(dir.path().join("argv")).unwrap();
    let session = argv.split("--session").nth(1).unwrap().trim();
    assert_ne!(session, "roundup");
    terminals.close_owned_by("t").await.unwrap();
    let _ = started;
}

#[tokio::test]
async fn mc60_launch_overrides_holder_config_dir() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new())
        .unwrap()
        .with_core(core(dir.path(), "export CLAUDE_CONFIG_DIR=/foreign"));
    let env = [("CLAUDE_CONFIG_DIR", "/app-config")];
    let started = terminals
        .spawn(params(dir.path(), &LIST, &env))
        .await
        .unwrap();
    let text = screen_with(&terminals, &started.id, "END").await;
    assert!(text.contains("CFG=[/app-config]"), "{text}");
    assert!(!text.contains("/foreign"), "{text}");
}

#[tokio::test]
async fn mc60_launch_removes_holder_test_variables() {
    let dir = tempfile::tempdir().unwrap();
    let exports = "export ROUNDUP_HOLDER=1 FAKE_CLAUDE_HOLDER=1 CLAUDE_CONFIG_DIR=/foreign";
    let terminals = Terminals::open(dir.path(), Bus::new())
        .unwrap()
        .with_core(core(dir.path(), exports));
    let env = [("ROUNDUP_AGENT", "7")];
    let started = terminals
        .spawn(params(dir.path(), &LIST, &env))
        .await
        .unwrap();
    let text = screen_with(&terminals, &started.id, "END").await;
    assert!(text.contains("ROUNDUP_AGENT=7"), "{text}");
    for name in ["ROUNDUP_HOLDER", "FAKE_CLAUDE_HOLDER", "/foreign"] {
        assert!(!text.contains(name), "{name} in {text}");
    }
}

#[tokio::test]
async fn mc60_resume_on_a_polluted_holder_acks() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("config");
    std::fs::create_dir(&app).unwrap();
    std::fs::write(app.join("conversation"), "x").unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new())
        .unwrap()
        .with_core(core(dir.path(), "export CLAUDE_CONFIG_DIR=/foreign"));
    let env = [("CLAUDE_CONFIG_DIR", app.to_str().unwrap())];
    let resume = r#"test -f "$CLAUDE_CONFIG_DIR/conversation" && echo RESUMED || exit 1"#;
    let started = terminals
        .spawn(params(dir.path(), &["sh", "-c", resume], &env))
        .await
        .unwrap();
    let text = screen_with(&terminals, &started.id, "RESUMED").await;
    assert!(text.contains("RESUMED"), "{text}");
}

fn entries(dir: &Path) -> Vec<(String, std::time::SystemTime)> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut all: Vec<_> = read
        .flatten()
        .map(|e| {
            (
                e.file_name().to_string_lossy().into_owned(),
                e.metadata().and_then(|m| m.modified()).unwrap(),
            )
        })
        .collect();
    all.sort();
    all
}

#[tokio::test]
async fn mc61_test_core_run_leaves_real_state_untouched() {
    let real = std::env::var_os("HOME")
        .map(|home| Path::new(&home).join(".local/state/herdr-core"))
        .unwrap();
    if !real.exists() {
        println!("no {} here: nothing to touch", real.display());
    }
    let before = entries(&real);
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
    let started = terminals
        .spawn_owned(params(dir.path(), &["cat"], &[]), "t")
        .await
        .unwrap();
    let _ = started;
    terminals.close_owned_by("t").await.unwrap();
    drop(terminals);
    assert_eq!(entries(&real), before);
}
