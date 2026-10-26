//! D1 attached: the Daemon exits with its stdin, and takes its Terminals' programs with it.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use contracts::terminal::{SpawnParams, TerminalId};
use serde_json::json;

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

/// How long the Daemon has to stop its programs and exit after its stdin closes.
const EXIT_BOUND: Duration = Duration::from_secs(15);

/// Start `rupd` on a temp Project through the shared harness.
fn start(attached: bool, stdin: impl FnOnce(&mut Command)) -> Running {
    let dir = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        attached,
        stdin,
    );
    Running { daemon, _dir: dir }
}

struct Running {
    daemon: rupd_harness::Rupd,
    _dir: tempfile::TempDir,
}

/// Kills the program on drop, so a failing test leaks no `sleep`.
struct Program(u32);

impl Drop for Program {
    fn drop(&mut self) {
        let _ = Command::new("kill")
            .args(["-9", &self.0.to_string()])
            .stderr(Stdio::null())
            .status();
    }
}

fn piped(command: &mut Command) {
    command.stdin(Stdio::piped());
}

fn wait_for_exit(daemon: &mut Child) -> bool {
    let deadline = Instant::now() + EXIT_BOUND;
    while Instant::now() < deadline {
        if daemon.try_wait().unwrap().is_some() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

fn is_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success()
}

/// Start a program that ignores SIGHUP, so only a SIGKILL ends it; return its pid.
async fn spawn_stubborn_program(client: &mut rpc::Client, cwd: &Path) -> Program {
    let mut output = client.take_output().unwrap();
    let params = SpawnParams {
        cwd: cwd.to_string_lossy().into_owned(),
        command: Some(vec![
            "/bin/sh".into(),
            "-c".into(),
            "trap '' HUP; read go; echo pid=$$; exec sleep 1000".into(),
        ]),
        env: BTreeMap::new(),
        cols: 80,
        rows: 24,
    };
    let reply = client.request("terminal.spawn", params).await.unwrap();
    let TerminalId { id } = serde_json::from_value(reply).unwrap();
    client
        .request("terminal.output", TerminalId { id: id.clone() })
        .await
        .unwrap();
    // The program waits for this line, so no output precedes the selection.
    client
        .request(
            "terminal.write",
            json!({ "id": id, "data": STANDARD.encode("\n") }),
        )
        .await
        .unwrap();
    let mut printed = String::new();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let rpc::OutputFrame::Bytes(out) = output.recv().await.expect("output stays open") {
                printed.push_str(&String::from_utf8_lossy(
                    &STANDARD.decode(out.data).unwrap(),
                ));
                if let Some(pid) = printed
                    .lines()
                    .find_map(|line| line.trim().strip_prefix("pid="))
                    .and_then(|pid| pid.parse().ok())
                {
                    return Program(pid);
                }
            }
        }
    })
    .await
    .expect("the program prints its pid")
}

#[tokio::test]
async fn d1_attached_daemon_exits_when_stdin_closes_and_its_programs_are_gone() {
    let mut running = start(true, piped);
    let mut client = rpc::Client::connect(&running.daemon.socket).await.unwrap();
    let program = spawn_stubborn_program(&mut client, running._dir.path()).await;
    assert!(is_alive(program.0));

    // The App's death closes both pipes at once.
    drop(running.daemon.stdin.take());
    drop(running.daemon.stderr.take());

    assert!(
        wait_for_exit(&mut running.daemon.child),
        "the Daemon did not exit"
    );
    assert!(!is_alive(program.0), "the program outlived the Daemon");
}

#[tokio::test]
async fn d1_attached_daemon_exits_cleanly_when_programs_end_by_themselves_during_shutdown() {
    let mut running = start(true, piped);
    let mut client = rpc::Client::connect(&running.daemon.socket).await.unwrap();
    let program = spawn_stubborn_program(&mut client, running._dir.path()).await;
    for _ in 0..30 {
        let params = SpawnParams {
            cwd: running._dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["/bin/sh".into(), "-c".into(), "sleep 0.3".into()]),
            env: BTreeMap::new(),
            cols: 80,
            rows: 24,
        };
        client.request("terminal.spawn", params).await.unwrap();
    }
    // Close stdin just as the programs reach their end, so some finish between list and kill.
    tokio::time::sleep(Duration::from_millis(250)).await;

    drop(running.daemon.stdin.take());

    assert!(
        wait_for_exit(&mut running.daemon.child),
        "the Daemon did not exit"
    );
    let status = running.daemon.child.wait().unwrap();
    assert!(status.success(), "the Daemon exited with {status}");
    assert!(!is_alive(program.0), "the program outlived the Daemon");
}

#[tokio::test]
async fn d1_attached_daemon_exits_when_stdin_is_already_closed() {
    // The handshake `start` writes is all there is: stdin then ends (a null stdin never completes one, H18).
    let mut running = start(true, piped);
    drop(running.daemon.stdin.take());

    assert!(
        wait_for_exit(&mut running.daemon.child),
        "the Daemon did not exit"
    );
}

#[tokio::test]
async fn d1_without_attached_a_closed_stdin_changes_nothing() {
    let mut running = start(false, piped);
    drop(running.daemon.stdin.take());
    tokio::time::sleep(Duration::from_millis(500)).await;

    let client = rpc::Client::connect(&running.daemon.socket).await.unwrap();
    let pong = client.request("daemon.ping", ()).await.unwrap();

    assert_eq!(pong["pong"], true);
}

// Startup notification observers share the attached-Daemon process seam.
mod startup {
    use std::path::Path;
    use std::process::Stdio;
    use std::time::Duration;

    use tokio::io::AsyncReadExt;
    use tokio::net::unix::pipe::Receiver;
    use tokio::time::timeout;

    use super::rupd_harness;

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
        let mut stdout =
            Receiver::from_owned_fd(daemon.child.stdout.take().unwrap().into()).unwrap();
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
        let mut stdout =
            Receiver::from_owned_fd(daemon.child.stdout.take().unwrap().into()).unwrap();
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
        let mut stdout =
            Receiver::from_owned_fd(daemon.child.stdout.take().unwrap().into()).unwrap();
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
}
