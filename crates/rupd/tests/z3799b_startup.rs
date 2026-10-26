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
