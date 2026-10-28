//! S6: native first-run executable discovery, independent of every Project and Daemon.
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::config::Config;

/// Includes PATH lookup, spawning, reading and waiting; a silent executable cannot hold first run open.
const BINARY_BOUND: Duration = Duration::from_secs(2);

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ClaudeBinary {
    path: PathBuf,
    version: String,
}

pub async fn claude_binary(config: &Config) -> Option<ClaudeBinary> {
    let name = config.claude_bin.clone().unwrap_or_else(|| "claude".into());
    let search_path = config.search_path.clone();
    tokio::time::timeout(BINARY_BOUND, async {
        let path = tokio::task::spawn_blocking(move || {
            which::which_in(name, Some(search_path), std::env::current_dir().ok()?).ok()
        })
        .await
        .ok()??;
        let mut child = Command::new(&path)
            .arg("--version")
            .env("PATH", &config.search_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .ok()?;
        let mut bytes = Vec::new();
        child
            .stdout
            .take()?
            .take(4097)
            .read_to_end(&mut bytes)
            .await
            .ok()?;
        if bytes.len() > 4096 {
            return None;
        }
        if !child.wait().await.ok()?.success() {
            return None;
        }
        let version = String::from_utf8(bytes).ok()?.trim().to_owned();
        if version.is_empty() {
            return None;
        }
        Some(ClaudeBinary { path, version })
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    fn config(dir: &Path) -> Config {
        Config::locate(None, Path::new("/unused/roundup"), dir, 1).unwrap()
    }

    fn executable(path: &Path, body: &str) {
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[tokio::test]
    async fn s6_binary_uses_configured_override_then_first_executable_on_fake_path() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        executable(&first.join("claude"), "printf 'first'");
        executable(&second.join("claude"), "printf 'second'");
        let search_path = std::env::join_paths([&first, &second]).unwrap();
        let cases = [
            (
                None,
                search_path.clone(),
                Some(ClaudeBinary {
                    path: first.join("claude"),
                    version: "first".into(),
                }),
            ),
            (
                Some(second.join("claude").into_os_string()),
                search_path.clone(),
                Some(ClaudeBinary {
                    path: second.join("claude"),
                    version: "second".into(),
                }),
            ),
            (
                Some(dir.path().join("absent").into_os_string()),
                search_path,
                None,
            ),
            (None, std::ffi::OsString::new(), None),
        ];
        for (binary, paths, expected) in cases {
            let mut config = config(dir.path());
            config.claude_bin = binary;
            config.search_path = paths;
            assert_eq!(claude_binary(&config).await, expected);
        }
    }

    #[tokio::test]
    async fn s6_a_binary_that_never_answers_is_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude");
        executable(&path, "while :; do :; done");
        let mut config = config(dir.path());
        config.claude_bin = Some(path.into_os_string());
        let started = std::time::Instant::now();
        let answer = tokio::time::timeout(
            BINARY_BOUND + Duration::from_secs(1),
            claude_binary(&config),
        )
        .await
        .expect("binary lookup exceeded its bound");
        assert_eq!(answer, None);
        assert!(started.elapsed() >= BINARY_BOUND);
    }
}
