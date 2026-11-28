//! EP1: the secret rupd writes at start reaches only the App that started it.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::io::Read;
use std::path::Path;
use std::process::Stdio;

use serde_json::json;

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

struct Started {
    daemon: rupd_harness::Rupd,
    secret: String,
    _project: tempfile::TempDir,
}

fn start() -> Started {
    let project = tempfile::tempdir().unwrap();
    let mut daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        true,
        |command| {
            command.arg("--notify-bound").stdout(Stdio::piped());
        },
    );
    let mut line = [0u8; 76];
    daemon
        .child
        .stdout
        .as_mut()
        .unwrap()
        .read_exact(&mut line)
        .unwrap();
    let line = std::str::from_utf8(&line).unwrap();
    let secret = line
        .strip_prefix("rupd-bound ")
        .and_then(|rest| rest.strip_suffix('\n'))
        .unwrap();
    assert!(secret.len() == 64 && secret.bytes().all(|b| b.is_ascii_hexdigit()));
    Started {
        secret: secret.to_owned(),
        daemon,
        _project: project,
    }
}

async fn attest(started: &Started, secret: &str) -> Result<(), rpc::RpcError> {
    let client = rpc::Client::connect(&started.daemon.socket).await.unwrap();
    client
        .request("app.attest", json!({ "secret": secret }))
        .await
        .map(drop)
}

#[tokio::test]
async fn ep1_a_started_rupd_attests_only_its_own_secret() {
    let first = start();
    let second = start();
    assert_ne!(first.secret, second.secret);
    attest(&first, &first.secret).await.unwrap();
    for wrong in [String::new(), "0".repeat(64), second.secret.clone()] {
        let refused = attest(&first, &wrong).await.unwrap_err();
        assert_eq!(refused.code, rpc::code::FORBIDDEN, "{wrong:?}");
    }
}

#[tokio::test]
async fn ep1_the_secret_is_logged_nowhere_and_passed_to_no_child() {
    let mut started = start();
    attest(&started, &started.secret).await.unwrap();
    let pid = started.daemon.child.id();
    let environ = std::fs::read(format!("/proc/{pid}/environ")).unwrap_or_default();
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    started.daemon.child.kill().unwrap();
    started.daemon.child.wait().unwrap();
    let mut stderr = String::new();
    started
        .daemon
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    let secret = started.secret.as_bytes();
    let holds = |bytes: &[u8]| bytes.windows(secret.len()).any(|w| w == secret);
    assert!(!holds(stderr.as_bytes()), "stderr holds the secret");
    assert!(!holds(&environ) && !holds(&cmdline));
    let data = started.daemon.data.as_ref().unwrap().path().to_owned();
    let mut folders = vec![data];
    while let Some(folder) = folders.pop() {
        for entry in std::fs::read_dir(folder).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                folders.push(path);
            } else if let Ok(bytes) = std::fs::read(&path) {
                assert!(!holds(&bytes), "{} holds the secret", path.display());
            }
        }
    }
}
