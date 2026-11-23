//! X15: a shell the user opens prints shell marks and still runs the user's startup files.

use std::collections::BTreeMap;
use std::path::Path;

use terminal::OutputStream;

use crate::common::{PATIENCE, open, sh, until_exit};

/// Everything a Terminal printed so far; `until` waits for `needle` past what earlier waits saw.
struct Output<'a> {
    stream: &'a mut OutputStream,
    printed: String,
    seen: usize,
}

impl Output<'_> {
    async fn until(&mut self, needle: &str) {
        tokio::time::timeout(PATIENCE, async {
            loop {
                if let Some(at) = self.printed[self.seen..].find(needle) {
                    self.seen += at + needle.len();
                    return;
                }
                if let terminal::Output::Bytes { bytes, .. } =
                    self.stream.next().await.expect("the output stays open")
                {
                    self.printed.push_str(&String::from_utf8_lossy(&bytes));
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{needle:?} was not printed in time: {:?}", self.printed));
    }
}

/// A HOME whose startup files for each shell print `user-<shell>-ran`.
fn home(root: &Path) -> BTreeMap<String, String> {
    let home = root.join("home");
    std::fs::create_dir_all(home.join(".config/fish")).unwrap();
    std::fs::write(
        home.join(".zshenv"),
        "setopt no_global_rcs\necho user-zshenv-ran\n",
    )
    .unwrap();
    std::fs::write(home.join(".zshrc"), "echo user-zsh-ran\nPS1='$ '\n").unwrap();
    std::fs::write(home.join(".bash_profile"), "echo user-bash-ran\nPS1='$ '\n").unwrap();
    std::fs::write(
        home.join(".config/fish/config.fish"),
        "echo user-fish-ran\nfunction fish_prompt; printf '$ '; end\n",
    )
    .unwrap();
    BTreeMap::from([
        ("HOME".to_owned(), home.to_string_lossy().into_owned()),
        (
            "XDG_CONFIG_HOME".to_owned(),
            home.join(".config").to_string_lossy().into_owned(),
        ),
        (
            "XDG_DATA_HOME".to_owned(),
            home.join(".local").to_string_lossy().into_owned(),
        ),
        ("TERM".to_owned(), "xterm-256color".to_owned()),
    ])
}

fn shell_path(name: &str) -> Option<String> {
    ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]
        .iter()
        .map(|dir| format!("{dir}/{name}"))
        .find(|path| Path::new(path).exists())
}

#[tokio::test]
async fn x15_zsh_bash_and_fish_get_the_integration_and_keep_the_users_startup_files() {
    for name in ["zsh", "bash", "fish"] {
        let Some(shell) = shell_path(name) else {
            println!("skipped: {name} not installed");
            continue;
        };
        let dir = tempfile::tempdir().unwrap();
        let (terminals, _) = open(&dir);
        let mut spawned = terminals
            .spawn_shell_owned(
                &dir.path().to_string_lossy(),
                &shell,
                "w",
                home(dir.path()),
                (80, 24),
            )
            .await
            .unwrap();
        let mut out = Output {
            stream: &mut spawned.output,
            printed: String::new(),
            seen: 0,
        };

        out.until(&format!("user-{name}-ran")).await;
        out.until("\x1b]133;B\x07").await;
        terminals.write(&spawned.id, b"echo hi\r").await.unwrap();
        out.until("\x1b]133;C\x07").await;
        out.until("\x1b]133;D;0\x07").await;
        terminals.write(&spawned.id, b"exit\r").await.unwrap();
        let (rest, _) = until_exit(&mut spawned).await;
        drop(rest);
    }
}

#[tokio::test]
async fn x15_a_command_prints_the_four_marks_with_its_exit_code_and_the_directory() {
    for name in ["zsh", "bash", "fish"] {
        let Some(shell) = shell_path(name) else {
            println!("skipped: {name} not installed");
            continue;
        };
        let dir = tempfile::tempdir().unwrap();
        let (terminals, _) = open(&dir);
        let mut spawned = terminals
            .spawn_shell_owned(
                &dir.path().to_string_lossy(),
                &shell,
                "w",
                home(dir.path()),
                (80, 24),
            )
            .await
            .unwrap();
        let mut out = Output {
            stream: &mut spawned.output,
            printed: String::new(),
            seen: 0,
        };
        out.until("\x1b]133;B\x07").await;
        for (line, code) in [("true", 0), ("false", 1)] {
            terminals
                .write(&spawned.id, format!("{line}\r").as_bytes())
                .await
                .unwrap();
            out.until("\x1b]133;C\x07").await;
            out.until(&format!("\x1b]133;D;{code}\x07")).await;
            out.until("\x1b]133;A\x07").await;
            out.until("\x1b]133;B\x07").await;
        }
        terminals.write(&spawned.id, b"cd /\r").await.unwrap();
        out.until("\x1b]7;file://").await;
        out.until("/\x07").await;
        terminals.write(&spawned.id, b"exit\r").await.unwrap();
        until_exit(&mut spawned).await;
    }
}

#[tokio::test]
async fn x15_other_shells_and_spawned_programs_get_no_injection() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn_shell_owned(
            &dir.path().to_string_lossy(),
            "/bin/sh",
            "w",
            BTreeMap::new(),
            (80, 24),
        )
        .await
        .unwrap();
    terminals
        .write(
            &spawned.id,
            b"echo z=${ZDOTDIR:-none} x=${XDG_DATA_DIRS:-none}\rexit\r",
        )
        .await
        .unwrap();
    let (printed, _) = until_exit(&mut spawned).await;
    assert!(printed.contains("z=none"), "{printed:?}");
    assert!(!printed.contains("133;"), "{printed:?}");
    assert!(!dir.path().join("shell-integration").exists());

    // terminal.spawn of a shell: no environment change, no mark.
    let mut params = sh(dir.path(), "echo z=${ZDOTDIR:-none}; echo p=${PS0:-none}");
    params.command = Some(vec![
        "/bin/bash".into(),
        "-c".into(),
        "echo z=${ZDOTDIR:-none}".into(),
    ]);
    let mut spawned = terminals.spawn(params).await.unwrap();
    let (printed, _) = until_exit(&mut spawned).await;
    assert!(
        printed.contains("z=none") && !printed.contains("133;"),
        "{printed:?}"
    );
}

/// What `agent.runPrinted` does for one click: claim a free shell of `owner` or open one, then type the line.
/// Returns the Terminal the line went to and, when it opened one, that shell's output.
async fn click(
    terminals: &terminal::Terminals,
    dir: &Path,
    shell: &str,
    line: &str,
) -> (String, Option<terminal::Spawned>) {
    let (id, opened) = match terminals.claim_free_shell("agent") {
        Some(free) => (free, None),
        None => {
            let opened = terminals
                .spawn_shell_owned(&dir.to_string_lossy(), shell, "agent", home(dir), (80, 24))
                .await
                .unwrap();
            (opened.id.clone(), Some(opened))
        }
    };
    terminals
        .write(&id, format!("{line}\r").as_bytes())
        .await
        .unwrap();
    (id, opened)
}

async fn owned_by_agent(terminals: &terminal::Terminals) -> usize {
    terminals
        .list()
        .await
        .iter()
        .filter(|info| info.owner.as_deref() == Some("agent"))
        .count()
}

#[tokio::test]
async fn u7889c_twenty_quick_clicks_leave_one_shell() {
    let Some(shell) = shell_path("bash") else {
        println!("skipped: bash not installed");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let (first, opened) = click(&terminals, dir.path(), &shell, "true").await;
    let mut spawned = opened.expect("the first click opens the shell");
    let mut out = Output {
        stream: &mut spawned.output,
        printed: String::new(),
        seen: 0,
    };

    for _ in 0..19 {
        out.until("\x1b]133;D;0\x07").await;
        out.until("\x1b]133;B\x07").await;
        let (id, opened) = click(&terminals, dir.path(), &shell, "true").await;
        assert!(opened.is_none(), "a free shell is reused");
        assert_eq!(id, first);
    }
    assert_eq!(owned_by_agent(&terminals).await, 1);
}

#[tokio::test]
async fn u7889c_click_while_sleep_runs_opens_a_second_then_reuses_a_free_one() {
    let Some(shell) = shell_path("bash") else {
        println!("skipped: bash not installed");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let (first, opened) = click(&terminals, dir.path(), &shell, "sleep 1").await;
    let mut spawned = opened.expect("the first click opens the shell");
    let mut out = Output {
        stream: &mut spawned.output,
        printed: String::new(),
        seen: 0,
    };

    out.until("\x1b]133;C").await;
    let (second, opened) = click(&terminals, dir.path(), &shell, "true").await;
    let mut second_shell = opened.expect("every shell is busy, so one more opens");
    assert_ne!(second, first);
    assert_eq!(owned_by_agent(&terminals).await, 2);

    out.until("\x1b]133;D;0\x07").await;
    out.until("\x1b]133;B\x07").await;
    let mut second_out = Output {
        stream: &mut second_shell.output,
        printed: String::new(),
        seen: 0,
    };
    second_out.until("\x1b]133;D;0\x07").await;
    let (third, opened) = click(&terminals, dir.path(), &shell, "true").await;
    assert!(opened.is_none(), "a shell is free again");
    assert_eq!(third, first, "the oldest free shell is reused");
    assert_eq!(owned_by_agent(&terminals).await, 2);
}
