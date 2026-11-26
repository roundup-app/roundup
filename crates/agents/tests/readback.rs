//! A7686: the Readback call runs on its Role's pair, apart from Placement and the stop judge. A
//! fake `claude` records the argv, environment and stdin of each launch.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use agents::StopModel;
use agents::claude_code::Launcher;
use agents::placement::{Placement, Request};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

struct Fake {
    dir: tempfile::TempDir,
}

impl Fake {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("claude");
        let script = format!(
            "#!/bin/sh\n{{ printf 'ARG %s\\n' \"$@\"; env | sort | sed 's/^/ENV /'; echo STDIN; cat; }} > {}/launch.$$\n\
             echo '{{\"structured_output\":{{\"text\":\"read\",\"question\":\"\",\"parts\":[]}}}}'\n",
            dir.path().display()
        );
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        Self { dir }
    }
    fn launcher(&self) -> Launcher {
        Launcher::new(
            self.dir.path().join("claude").to_str().unwrap(),
            self.dir.path().join("config"),
            self.dir.path().join("rup"),
            None,
        )
    }
    fn launches(&self) -> Vec<String> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(self.dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("launch.")
            })
            .collect();
        found.sort();
        found
            .iter()
            .map(|path| std::fs::read_to_string(path).unwrap())
            .collect()
    }
}

fn argv(launch: &str) -> Vec<&str> {
    launch
        .lines()
        .filter_map(|line| line.strip_prefix("ARG "))
        .collect()
}

fn has(launch: &str, flag: &str, value: &str) -> bool {
    argv(launch).windows(2).any(|pair| pair == [flag, value])
}

fn env_names(launch: &str) -> Vec<&str> {
    launch
        .lines()
        .filter_map(|line| line.strip_prefix("ENV "))
        .filter_map(|line| line.split('=').next())
        .collect()
}

#[tokio::test]
async fn a7686_the_call_runs_on_the_roles_pair() {
    let fake = Fake::new();

    let text = fake
        .launcher()
        .readback_call(Some("opus".into()), Some("high".into()))
        .read("Read it.", None, b"the diff")
        .await
        .unwrap();

    assert_eq!(text, "read");
    let launches = fake.launches();
    assert_eq!(launches.len(), 1);
    assert!(has(&launches[0], "--model", "opus"));
    assert!(has(&launches[0], "--effort", "high"));
    let names = env_names(&launches[0]);
    assert!(!names.contains(&"ANTHROPIC_MODEL"));
    assert!(!names.contains(&"CLAUDE_CODE_EFFORT_LEVEL"));
}

#[tokio::test]
async fn a7686_unset_pair_passes_neither_flag_nor_variable() {
    let fake = Fake::new();

    fake.launcher()
        .readback_call(None, None)
        .read("Read it.", None, b"the diff")
        .await
        .unwrap();

    let launches = fake.launches();
    assert!(!argv(&launches[0]).contains(&"--model"));
    assert!(!argv(&launches[0]).contains(&"--effort"));
    assert!(!env_names(&launches[0]).contains(&"ANTHROPIC_MODEL"));
}

#[tokio::test]
async fn a7686_the_call_has_no_tools_no_session_and_only_its_input() {
    let fake = Fake::new();
    let conversation = "MARKER-ONLY-IN-THE-AGENTS-CONVERSATION";

    fake.launcher()
        .readback_call(None, None)
        .read("Read it.", None, b"the diff")
        .await
        .unwrap();

    let launch = &fake.launches()[0];
    assert!(has(launch, "--tools", ""));
    assert!(argv(launch).contains(&"--no-session-persistence"));
    assert!(argv(launch).contains(&"--strict-mcp-config"));
    assert!(launch.ends_with("STDIN\nthe diff"), "{launch}");
    assert!(!launch.contains(conversation));
    assert!(!any_file_holds(fake.dir.path(), conversation));
}

#[tokio::test]
async fn a7686_readback_is_no_agent_node() {
    let fake = Fake::new();

    let text = fake
        .launcher()
        .readback_call(Some("opus".into()), None)
        .read("Read it.", None, b"the diff")
        .await
        .unwrap();

    // The call is one process that returns text: no session to become a Rail node, no
    // Terminal, and no Write or Edit tool whose use would record a `wrote` Touch.
    assert_eq!(text, "read");
    let launches = fake.launches();
    assert_eq!(launches.len(), 1);
    assert!(has(&launches[0], "--tools", ""));
    assert!(argv(&launches[0]).contains(&"--no-session-persistence"));
    assert!(!argv(&launches[0]).contains(&"--session-id"));
}

fn any_file_holds(dir: &Path, needle: &str) -> bool {
    std::fs::read_dir(dir).unwrap().any(|entry| {
        let path = entry.unwrap().path();
        path.is_file()
            && !path.ends_with("claude")
            && std::fs::read_to_string(path).is_ok_and(|text| text.contains(needle))
    })
}

#[tokio::test]
async fn a7686_placement_and_the_stop_judge_stay_on_haiku_low() {
    let fake = Fake::new();
    let launcher = fake.launcher();

    let _ = launcher
        .placement()
        .call("ask", &Request::new("fix it".into(), vec![], vec![]))
        .await;
    let _ = launcher.stop_judge().question("all done").await;

    let launches = fake.launches();
    assert_eq!(launches.len(), 2);
    for launch in &launches {
        assert!(has(launch, "--model", "haiku"));
        assert!(has(launch, "--effort", "low"));
    }
}
