//! U7208c, U7208d: the version of the local herdr-core, the newest one its release feed names, and
//! its own `update`. Nothing here runs `update` unless the caller asks.

use std::process::{Output, Stdio};
use std::time::Duration;

use semver::Version;
use serde::Deserialize;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::config::Config;

/// Includes the `PATH` lookup, spawning and waiting; a silent program cannot hold a read open.
const VERSION_BOUND: Duration = Duration::from_secs(2);

/// A feed read, connection and body included.
const FEED_BOUND: Duration = Duration::from_secs(10);

/// `herdr-core update` downloads a program and swaps it in.
const UPDATE_BOUND: Duration = Duration::from_secs(10 * 60);

/// A feed is a few hundred bytes; more than this is not one.
const FEED_LIMIT: u64 = 64 * 1024;

const PROGRAM: &str = "herdr-core";

/// Where herdr-core reads releases when `HERDR_RELEASES_URL` is unset.
const RELEASES: &str = "https://releases.herdr.dev";

/// The feed `herdr-core update` reads, so a version found here is one the update installs.
pub(crate) fn feed(releases: Option<&str>) -> String {
    let releases = releases.filter(|url| !url.is_empty()).unwrap_or(RELEASES);
    format!("{}/core/latest.json", releases.trim_end_matches('/'))
}

/// `herdr-core --version`: the word after the program's name, `hc 0.1.21` naming `0.1.21`.
pub(crate) async fn installed(config: &Config) -> Option<Version> {
    let output = run(config, &["--version"], VERSION_BOUND).await.ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    Version::parse(text.split_whitespace().last()?).ok()
}

/// The `version` the feed at `url` names.
pub(crate) async fn newest(url: &str) -> Result<Version, String> {
    #[derive(Deserialize)]
    struct Feed {
        version: String,
    }
    let body = get(url).await?;
    let feed: Feed = serde_json::from_slice(&body)
        .map_err(|_| "the herdr-core release feed names no version".to_owned())?;
    Version::parse(&feed.version)
        .map_err(|_| "the herdr-core release feed names a version that is not one".to_owned())
}

/// The version the feed names when it is newer, by semantic versioning, than the one installed.
pub(crate) fn ready(installed: &Version, newest: Option<&Version>) -> Option<Version> {
    newest.filter(|newest| *newest > installed).cloned()
}

/// `herdr-core update`. A failure is the last line the program printed on its error output, or
/// its exit status when it printed none.
pub(crate) async fn update(config: &Config) -> Result<(), String> {
    let output = run(config, &["update"], UPDATE_BOUND).await?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(stderr
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map_or_else(
            || format!("herdr-core update exited with {}", output.status),
            str::to_owned,
        ))
}

async fn run(config: &Config, args: &[&str], bound: Duration) -> Result<Output, String> {
    let search_path = config.search_path.clone();
    let program = tokio::task::spawn_blocking(move || {
        which::which_in(PROGRAM, Some(search_path), std::env::current_dir().ok()?).ok()
    })
    .await
    .ok()
    .flatten()
    .ok_or_else(|| "herdr-core was not found".to_owned())?;
    let command = Command::new(program)
        .args(args)
        .env("PATH", &config.search_path)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    tokio::time::timeout(bound, command)
        .await
        .map_err(|_| format!("herdr-core {} did not finish in time", args.join(" ")))?
        .map_err(|error| format!("herdr-core could not run: {:?}", error.kind()))
}

/// The platform's `curl` makes the one GET, as herdr-core's own installer does: the user's
/// proxies and certificates apply, redirects are followed, and a non-success status fails.
async fn get(url: &str) -> Result<Vec<u8>, String> {
    let mut child = Command::new("curl")
        .args([
            "-q",
            "--silent",
            "--fail",
            "--location",
            "--proto",
            "=http,https",
        ])
        .args([
            "--max-time",
            &FEED_BOUND.as_secs().to_string(),
            "--url",
            url,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("the herdr-core release feed reader could not start: {error}"))?;
    eprintln!("U7208 DIAG curl spawned {:?}", child.id());
    let mut body = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        let _ = stdout.take(FEED_LIMIT + 1).read_to_end(&mut body).await;
    }
    if body.len() as u64 > FEED_LIMIT {
        let _ = child.kill().await;
        return Err("the herdr-core release feed is too long to be one".to_owned());
    }
    if !child.wait().await.is_ok_and(|status| status.success()) {
        return Err("the herdr-core release feed did not answer".to_owned());
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    /// A `herdr-core` that is `script`, alone on the `PATH` of the config it returns.
    fn config_with(dir: &Path, script: &str) -> Config {
        let program = dir.join(PROGRAM);
        std::fs::write(&program, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut config = Config::locate(None, Path::new("/unused/roundup"), dir, 1).unwrap();
        config.search_path = dir.as_os_str().to_owned();
        config
    }

    /// A feed that answers every request with `body`; its URL. A `TcpListener` stands in for
    /// herdr's release host, so the real `curl` makes a real GET.
    fn serve(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/core/latest.json", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let _ = stream.read(&mut [0; 1024]);
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        url
    }

    fn version(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[tokio::test]
    async fn u7208c_a_failed_update_names_the_last_line_the_program_printed() {
        let dir = tempfile::tempdir().unwrap();
        for (script, failure) in [
            (
                "echo fetching >&2; echo 'no space left on device' >&2; echo >&2; exit 3",
                "no space left on device",
            ),
            ("exit 7", "herdr-core update exited with exit status: 7"),
        ] {
            let config = config_with(dir.path(), script);
            assert_eq!(update(&config).await, Err(failure.to_owned()));
        }
        let config = config_with(dir.path(), "exit 0");
        assert_eq!(update(&config).await, Ok(()));
        let mut none = Config::locate(None, Path::new("/unused/roundup"), dir.path(), 1).unwrap();
        none.search_path = dir.path().join("empty").into_os_string();
        assert_eq!(
            update(&none).await,
            Err("herdr-core was not found".to_owned())
        );
    }

    #[tokio::test]
    async fn u7208d_the_installed_version_is_the_one_the_program_prints() {
        let dir = tempfile::tempdir().unwrap();
        for (script, printed) in [
            ("echo 'hc 0.1.21'", Some("0.1.21")),
            ("echo 'hc nightly'", None),
            ("echo 'hc 0.1.21'; exit 1", None),
            ("", None),
        ] {
            let config = config_with(dir.path(), script);
            assert_eq!(
                installed(&config).await.map(|version| version.to_string()),
                printed.map(str::to_owned),
                "script {script:?}"
            );
        }
    }

    #[tokio::test]
    async fn u7208d_a_newer_core_version_in_the_feed_is_ready() {
        let installed = version("0.1.21");
        for (feed, expected) in [
            (r#"{"version":"0.1.22","generation":3}"#, Some("0.1.22")),
            (r#"{"version":"0.2.0"}"#, Some("0.2.0")),
            (r#"{"version":"0.1.21"}"#, None),
            (r#"{"version":"0.1.9"}"#, None),
        ] {
            let named = newest(&serve(feed)).await.unwrap();
            assert_eq!(
                ready(&installed, Some(&named)).map(|ready| ready.to_string()),
                expected.map(str::to_owned),
                "feed {feed} against {installed}"
            );
        }
        assert!(newest(&serve(r#"{"generation":3}"#)).await.is_err());
        assert!(newest(&serve(r#"{"version":"latest"}"#)).await.is_err());
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/core/latest.json", closed.local_addr().unwrap());
        drop(closed);
        assert!(newest(&url).await.is_err());
    }
}
