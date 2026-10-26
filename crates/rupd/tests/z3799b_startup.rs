//! Producer observers through the existing real-Daemon process seam.
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::net::unix::pipe::Receiver;
use tokio::time::timeout;

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

const BOUND: Duration = Duration::from_secs(5);

#[tokio::test]
async fn z3799b_bound_notification_allows_ping_and_stdin_close_still_stops() {
    let project = tempfile::tempdir().unwrap();
    let mut daemon = rupd_harness::spawn(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        true,
        |command| {
            command.arg("--notify-bound").stdout(Stdio::piped());
        },
    );
    let mut stdout = Receiver::from_owned_fd(daemon.child.stdout.take().unwrap().into()).unwrap();
    let mut signal = [0; 11];
    timeout(BOUND, stdout.read_exact(&mut signal))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&signal, b"rupd-bound\n");
    let client = timeout(BOUND, rpc::Client::connect(&daemon.socket))
        .await
        .unwrap()
        .unwrap();
    let pong = timeout(BOUND, client.request("daemon.ping", ()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pong["pong"], true);

    drop(daemon.stdin.take());
    let mut rest = Vec::new();
    timeout(BOUND, stdout.read_to_end(&mut rest))
        .await
        .unwrap()
        .unwrap();
    assert!(daemon.child.wait().unwrap().success());
    assert!(rest.is_empty(), "only one notification is published");
}

#[tokio::test]
async fn z3799b_startup_refusal_publishes_no_notification() {
    let project = tempfile::tempdir().unwrap();
    // A live listener refuses the second bind. It belongs to this test, never a real App.
    let _listener =
        std::os::unix::net::UnixListener::bind(project.path().join("rupd.sock")).unwrap();
    let mut daemon = rupd_harness::spawn(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        true,
        |command| {
            command.arg("--notify-bound").stdout(Stdio::piped());
        },
    );
    let mut stdout = Receiver::from_owned_fd(daemon.child.stdout.take().unwrap().into()).unwrap();
    let mut bytes = Vec::new();
    timeout(BOUND, stdout.read_to_end(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert!(!daemon.child.wait().unwrap().success());
    assert!(bytes.is_empty(), "bind refusal must not publish success");
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut daemon.stderr.take().unwrap(), &mut stderr).unwrap();
    assert!(stderr.contains("Address already in use"), "{stderr}");
}

#[tokio::test]
async fn z3799b_closed_notification_reader_stops_even_with_stdin_open() {
    let project = tempfile::tempdir().unwrap();
    let (writer, reader) = tokio::net::unix::pipe::pipe().unwrap();
    drop(reader);
    let mut daemon = rupd_harness::spawn(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        true,
        |command| {
            command
                .arg("--notify-bound")
                .stdout(writer.into_blocking_fd().unwrap());
        },
    );
    // Keep stdin open throughout: a blocking stdin task started before notification failure
    // would prevent runtime shutdown. EOF on stderr must arrive within the observer bound.
    let mut stderr = Receiver::from_owned_fd(daemon.stderr.take().unwrap().into()).unwrap();
    let mut diagnostics = String::new();
    timeout(BOUND, stderr.read_to_string(&mut diagnostics))
        .await
        .unwrap()
        .unwrap();
    assert!(!daemon.child.wait().unwrap().success());
    assert!(diagnostics.contains("rupd: stopping"), "{diagnostics}");
    assert!(diagnostics.contains("Broken pipe"), "{diagnostics}");
}

#[tokio::test]
async fn z3799b_project_open_refusal_publishes_no_notification() {
    let project = tempfile::tempdir().unwrap();
    let mut daemon = rupd_harness::spawn(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        &project.path().join("missing"),
        true,
        |command| {
            command.arg("--notify-bound").stdout(Stdio::piped());
        },
    );
    let mut stdout = Receiver::from_owned_fd(daemon.child.stdout.take().unwrap().into()).unwrap();
    let mut bytes = Vec::new();
    timeout(BOUND, stdout.read_to_end(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert!(!daemon.child.wait().unwrap().success());
    assert!(bytes.is_empty(), "Project refusal must not publish success");
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut daemon.stderr.take().unwrap(), &mut stderr).unwrap();
    assert!(stderr.contains("rupd: refusing to start:"), "{stderr}");
}
