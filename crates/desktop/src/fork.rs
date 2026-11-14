//! FS5979: the host side of `fork_branch` and `fork_make`.

use contracts::data::{ForkAgents, ForkColour, ForkParams, ForkProject};
use rpc::{RpcError, code};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// One pick as the sheet sends it: `key` is the Project's folder, which the host turns into the data key.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pick {
    pub key: String,
    pub agents: ForkAgents,
}

/// The branch the source checkout is on, or `fork` when it has none.
pub(crate) fn branch(checkout: &Path) -> String {
    Command::new("git")
        .arg("-C")
        .arg(checkout)
        .args(["branch", "--show-current"])
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "fork".into())
}

/// The checkout the live App runs from: the working folder.
pub(crate) fn checkout() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// FS5979f: the folder must hold a source checkout (a `.git` and the `justfile` with `app`) before `just app` runs in it.
pub(crate) fn require_checkout(folder: &Path) -> Result<(), RpcError> {
    if folder.join(".git").exists() && folder.join("justfile").is_file() {
        return Ok(());
    }
    Err(RpcError::internal(format!(
        "{}: no source checkout (a git folder with a justfile) to start the branch's App from; start the App from a checkout with `just app`",
        folder.display()
    )))
}

/// Where Forks live: `$ROUNDUP_HOME`, or `~/.roundup`, from the variables `var` reads.
pub(crate) fn home(var: impl Fn(&str) -> Option<std::ffi::OsString>) -> Option<PathBuf> {
    var("ROUNDUP_HOME")
        .map(PathBuf::from)
        .or_else(|| var("HOME").map(|home| Path::new(&home).join(".roundup")))
}

/// `data.fork`'s key of the Project folder `path`: its data folder's name.
fn data_key(path: &str) -> Result<String, RpcError> {
    rupd::data::project_data(Path::new(""), Path::new(path))
        .ok()
        .and_then(|dir| {
            dir.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .ok_or_else(|| {
            RpcError::new(
                code::INVALID_PARAMS,
                format!("{path}: not a Project folder"),
            )
        })
}

/// The `data.fork` params for the sheet's picks, with the Fork in `folder`.
pub(crate) fn params(
    name: String,
    colour: ForkColour,
    picks: &[Pick],
    folder: &Path,
) -> Result<ForkParams, RpcError> {
    let projects = picks
        .iter()
        .map(|pick| {
            Ok(ForkProject {
                key: data_key(&pick.key)?,
                agents: pick.agents.clone(),
                todos: true,
                pads: true,
                messages: true,
                history: true,
            })
        })
        .collect::<Result<Vec<_>, RpcError>>()?;

    Ok(ForkParams {
        name,
        colour,
        path: folder.to_string_lossy().into_owned(),
        projects: Some(projects),
    })
}

/// A new folder name for the Fork under `$ROUNDUP_HOME/forks`.
pub(crate) fn fork_path(home: &Path, name: &str) -> PathBuf {
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let slug = match slug.trim_matches('-') {
        "" => "fork",
        slug => slug,
    };
    let forks = home.join("forks");

    let mut n = 1;
    loop {
        let path = forks.join(if n == 1 {
            slug.to_string()
        } else {
            format!("{slug}-{n}")
        });
        if !path.exists() {
            return path;
        }
        n += 1;
    }
}

/// The line `just app` prints once everything is built and only the App's launch is left.
pub(crate) const STARTED: &str = "roundup: starting the App";

/// The live App's per-instance variables: the Fork's App takes its own, never these.
const LIVE_ONLY: [&str; 2] = ["ROUNDUP_DEV_PORT", "ROUNDUP_RUPD_BIN"];

/// U6266a: the command that starts the branch's App on the Fork from the source checkout, with an
/// environment of its own: the Fork's data folder and none of the live App's per-instance variables.
fn command(checkout: &Path, fork: &Path, project: &str) -> Command {
    let mut command = Command::new("just");
    command
        .args(["--quiet", "app"])
        .arg(project)
        .current_dir(checkout)
        .env("ROUNDUP_DATA_DIR", fork);
    for name in LIVE_ONLY {
        command.env_remove(name);
    }
    command
}

/// Runs `command` until it prints `STARTED`; it fails with the last line it wrote to stderr
/// when it exits non-zero first. The child keeps running after a start.
fn start(mut command: Command) -> Result<(), RpcError> {
    use std::io::{BufRead, BufReader};
    use std::sync::mpsc;

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| RpcError::internal(format!("just: {error}")))?;
    let (tx, rx) = mpsc::channel();
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(RpcError::internal("just: its pipes are missing"));
    };
    let started = tx.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.trim() == STARTED {
                let _ = started.send(Event::Started);
            }
        }
    });
    let errors = std::thread::spawn(move || {
        BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
            .filter(|line| !line.trim().is_empty())
            .last()
    });
    std::thread::spawn(move || {
        let status = child.wait();
        let last = errors.join().ok().flatten();
        let _ = tx.send(Event::Exited(
            status.map(|s| s.success()).unwrap_or(false),
            last,
        ));
    });
    match rx.recv() {
        Ok(Event::Started) | Ok(Event::Exited(true, _)) => Ok(()),
        Ok(Event::Exited(false, last)) => {
            Err(RpcError::internal(last.unwrap_or_else(|| {
                "the App exited before it started".into()
            })))
        }
        Err(error) => Err(RpcError::internal(error)),
    }
}

enum Event {
    Started,
    Exited(bool, Option<String>),
}

/// Starts the branch's App on the Fork, opening the first picked Project; returns once it has started.
pub(crate) fn open(checkout: &Path, fork: &Path, project: &str) -> Result<(), RpcError> {
    start(command(checkout, fork, project))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fs5979_a_checkout_without_a_branch_is_named_fork() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(branch(tmp.path()), "fork");
    }

    #[test]
    fn fs5979f_a_folder_without_a_checkout_is_refused_naming_what_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let message = require_checkout(tmp.path()).unwrap_err().message;
        assert!(message.contains("no source checkout") && message.contains("justfile"));
        std::fs::create_dir(tmp.path().join(".git")).unwrap();
        assert!(require_checkout(tmp.path()).is_err());
        std::fs::write(tmp.path().join("justfile"), "app:\n").unwrap();
        assert!(require_checkout(tmp.path()).is_ok());
    }

    #[test]
    fn fs5979_picks_become_data_keys_and_the_folder_is_the_forks() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("app");
        std::fs::create_dir(&project).unwrap();
        let picks = [Pick {
            key: project.to_string_lossy().into_owned(),
            agents: serde_json::from_str("\"none\"").unwrap(),
        }];
        let made = params("x".into(), ForkColour::Teal, &picks, tmp.path()).unwrap();
        let key = &made.projects.unwrap()[0].key;
        assert!(key.starts_with("app-") && key.len() == "app-".len() + 16);
        assert!(
            params(
                "x".into(),
                ForkColour::Teal,
                &[Pick {
                    key: "/nowhere".into(),
                    agents: serde_json::from_str("\"all\"").unwrap()
                }],
                tmp.path()
            )
            .is_err()
        );
    }

    #[test]
    fn fs6102a_a_name_without_ascii_letters_still_gets_its_own_subfolder() {
        let tmp = tempfile::tempdir().unwrap();
        let forks = tmp.path().join("forks");
        let first = fork_path(tmp.path(), "日本");
        assert_eq!(first, forks.join("fork"));
        std::fs::create_dir_all(&first).unwrap();
        assert_eq!(fork_path(tmp.path(), "日本"), forks.join("fork-2"));
        assert_eq!(fork_path(tmp.path(), "my fix"), forks.join("my-fix"));
    }

    #[test]
    fn u6266a_the_forks_command_carries_none_of_the_live_apps_variables() {
        let command = command(Path::new("/src"), Path::new("/fork"), "/proj");
        let envs: Vec<_> = command.get_envs().collect();
        for name in LIVE_ONLY {
            assert!(envs.contains(&(std::ffi::OsStr::new(name), None)), "{name}");
        }
        assert!(envs.contains(&(
            std::ffi::OsStr::new("ROUNDUP_DATA_DIR"),
            Some(std::ffi::OsStr::new("/fork"))
        )));
    }

    #[test]
    fn u6266a_a_start_that_fails_names_the_last_error_line() {
        let mut failing = Command::new("sh");
        failing.args(["-c", "echo noise >&2; echo 'port is taken' >&2; exit 1"]);
        assert_eq!(start(failing).unwrap_err().message, "port is taken");
        let mut up = Command::new("sh");
        up.args(["-c", &format!("echo '{STARTED}'; sleep 1")]);
        assert!(start(up).is_ok());
    }
}
