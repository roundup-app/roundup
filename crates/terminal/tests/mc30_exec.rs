//! MC30, MC31: `herdr::Conn::exec` runs a program where the core is and answers its stdout, stderr
//! and exit code apart, against the test-support core on a real PTY.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]
use std::time::Duration;

use herdr::Conn;
use tokio::process::Command;

const T: Duration = Duration::from_secs(10);

async fn core() -> Conn {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    cmd.arg("connect");
    Conn::spawn(cmd, T).await.unwrap()
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|p| (*p).to_owned()).collect()
}

#[tokio::test]
async fn mc30_exec_answers_stdout_stderr_and_code_apart_in_the_cwd() {
    let conn = core().await;
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().canonicalize().unwrap();
    let out = conn
        .exec(
            &argv(&["sh", "-c", "pwd; echo noise >&2; exit 3"]),
            cwd.to_str().unwrap(),
            T,
        )
        .await
        .unwrap();
    assert_eq!(out.code, Some(3));
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        format!("{}\n", cwd.display())
    );
    assert_eq!(String::from_utf8(out.stderr).unwrap(), "noise\n");
}

#[tokio::test]
async fn mc30_exec_of_a_missing_cwd_is_the_cores_coded_error() {
    let conn = core().await;
    let err = conn
        .exec(&argv(&["true"]), "/nonexistent-roundup-dir", T)
        .await
        .unwrap_err();
    assert!(matches!(err, herdr::Error::Rpc(_)), "{err:?}");
}
