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

/// The checkout the live App runs from: its slot under `$ROUNDUP_HOME`, else the working folder.
pub(crate) fn checkout() -> PathBuf {
    match (std::env::var("ROUNDUP_SLOT"), crate::update::home()) {
        (Ok(slot), Some(home)) => home.join("slots").join(slot),
        _ => std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
    }
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
    let slug = slug.trim_matches('-');
    let forks = home.join("forks");

    (1..)
        .map(|n| {
            forks.join(if n == 1 {
                slug.to_string()
            } else {
                format!("{slug}-{n}")
            })
        })
        .find(|path| !path.exists())
        .expect("an unused folder name")
}

/// Starts the branch's App on the Fork, from the source checkout, opening the first picked Project.
pub(crate) fn open(checkout: &Path, fork: &Path, project: &str) -> Result<(), RpcError> {
    Command::new("just")
        .arg("app")
        .arg(project)
        .current_dir(checkout)
        .env("ROUNDUP_DATA_DIR", fork)
        .env_remove("ROUNDUP_SLOT")
        .stdin(Stdio::null())
        .spawn()
        .map(drop)
        .map_err(|error| RpcError::internal(format!("start the branch's App: {error}")))
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
}
