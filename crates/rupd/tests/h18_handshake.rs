//! H18: the attached handshake on `rupd`'s stdin. A bad one fails with a diagnostic that never
//! holds the bytes it was sent; an unattached Daemon needs none and refuses every answer.

use std::io::{Cursor, Read, Write};
use std::process::Stdio;
use std::time::{Duration, Instant};

use rupd::{HandshakeError, read_handshake};

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

const PROOF: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn line(proof: &str) -> Vec<u8> {
    format!("roundup-proof 1 {proof}\n").into_bytes()
}

#[test]
fn h18_a_well_formed_handshake_yields_its_proof_and_leaves_later_bytes() {
    let mut input = Cursor::new([line(PROOF), b"later".to_vec()].concat());

    let handshake = read_handshake(&mut input).unwrap();

    assert_eq!(handshake.into_proof(), PROOF);
    let mut rest = String::new();
    input.read_to_string(&mut rest).unwrap();
    assert_eq!(rest, "later");
}

#[test]
fn h18_malformed_oversized_and_incomplete_handshakes_are_refused() {
    let cases: [(Vec<u8>, HandshakeError); 7] = [
        (b"".to_vec(), HandshakeError::Incomplete),
        (line(PROOF)[..30].to_vec(), HandshakeError::Incomplete),
        (PROOF.as_bytes().to_vec(), HandshakeError::Incomplete),
        (line(&PROOF[..63]), HandshakeError::Malformed),
        (line(&PROOF.to_uppercase()), HandshakeError::Malformed),
        (
            format!("roundup-proof 2 {PROOF}\n").into_bytes(),
            HandshakeError::Malformed,
        ),
        (
            [vec![b'x'; 4096], b"\n".to_vec()].concat(),
            HandshakeError::Oversized,
        ),
    ];
    for (bytes, expected) in cases {
        assert_eq!(
            read_handshake(&mut Cursor::new(bytes)).unwrap_err(),
            expected
        );
    }
}

#[test]
fn h18_an_error_and_a_handshake_never_print_the_proof() {
    let handshake = read_handshake(&mut Cursor::new(line(PROOF))).unwrap();
    assert!(!format!("{handshake:?}").contains(PROOF));
    let err = read_handshake(&mut Cursor::new(line(&PROOF[..63]))).unwrap_err();
    assert!(!err.to_string().contains(&PROOF[..63]));
}

/// Launches without waiting for ping: a bad handshake exits before the Daemon can answer.
/// Writes `bytes` and closes stdin; returns the exit status and stderr.
fn attached_with(bytes: &[u8]) -> (std::process::ExitStatus, String) {
    attached_with_observer(bytes, |_| {})
}

fn attached_with_observer(
    bytes: &[u8],
    observe: impl FnOnce(&rupd_harness::Rupd),
) -> (std::process::ExitStatus, String) {
    let dir = tempfile::tempdir().unwrap();
    let mut daemon = rupd_harness::spawn(
        std::path::Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        true,
        |_| {},
    );
    observe(&daemon);
    let mut stdin = daemon.stdin.take().unwrap();
    stdin.write_all(bytes).unwrap();
    drop(stdin);
    let started = Instant::now();
    let status = loop {
        if let Some(status) = daemon.child.try_wait().unwrap() {
            break status;
        }
        if started.elapsed() > Duration::from_secs(15) {
            daemon.child.kill().unwrap();
            daemon.child.wait().unwrap();
            panic!("the Daemon never exited");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut stderr = String::new();
    daemon
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    (status, stderr)
}

#[test]
fn h18_an_attached_daemon_given_a_bad_handshake_exits_with_a_diagnostic_without_the_proof() {
    for bytes in [
        line(&PROOF[..63]),
        line(&PROOF.to_uppercase()),
        [vec![b'x'; 4096], b"\n".to_vec()].concat(),
        line(PROOF)[..30].to_vec(),
        Vec::new(),
    ] {
        let (status, stderr) = attached_with(&bytes);

        assert_eq!(status.code(), Some(1));
        assert!(stderr.contains("refusing to start"), "{stderr}");
        assert!(!stderr.contains(&PROOF[..40]), "{stderr}");
    }
}

#[tokio::test]
async fn h18_a_daemon_without_a_handshake_rejects_every_answer() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        std::path::Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        false,
        |command| {
            command.stderr(Stdio::null());
        },
    );
    let client = rpc::Client::connect(&daemon.socket).await.unwrap();

    let err = client
        .request(
            "decision.answer",
            serde_json::json!({"id": "d1", "answer": "allow", "proof": PROOF}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, rpc::code::FORBIDDEN);
}

#[path = "support/n7_data.rs"]
mod n7_data;

#[test]
fn n7_launch_sites_clean_on_success_and_failure_handshake() {
    if n7_data::isolated("n7_launch_sites_clean_on_success_and_failure_handshake") {
        return;
    }
    // The same direct-launch path as H18, including valid and refused handshakes.
    for bytes in [line(PROOF), line(&PROOF[..63])] {
        let mut launched = None;
        let (status, _) = attached_with_observer(&bytes, |daemon| {
            let data = daemon.data.as_ref().unwrap().path().to_owned();
            assert!(data.is_absolute());
            assert!(!data.starts_with(std::env::var_os("N7_APP_DATA").unwrap()));
            launched = Some((data, daemon.child.id()));
        });
        assert_eq!(status.success(), bytes == line(PROOF));
        let (data, pid) = launched.unwrap();
        n7_data::assert_exited(pid);
        assert!(!data.exists());
    }
}
