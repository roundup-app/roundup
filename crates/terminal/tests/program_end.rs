//! Z3799b: program completion is independent of a descendant's PTY lifetime.

// Linux retains the PTY until descendants close it; macOS may report EOF at leader exit.
#![cfg(target_os = "linux")]

use std::collections::BTreeMap;
use std::time::Duration;

use contracts::terminal::SpawnParams;
use rpc::Bus;
use terminal::Terminals;

#[tokio::test]
async fn z3799b_program_end_wakes_waiters_while_a_descendant_holds_the_pty() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
    let socket = dir.path().join("holder.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    // The child retains the PTY until this test drops its socket. Its timeout also bounds
    // cleanup if the observer fails; no unrelated process is signalled.
    let script = r#"
import os, signal, socket, sys
signal.signal(signal.SIGHUP, signal.SIG_IGN)
if os.fork() == 0:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(4)
    connection.connect(sys.argv[1])
    try:
        connection.recv(1)
    finally:
        os._exit(0)
signal.alarm(4)
sys.stdin.readline()
sys.exit(7)
"#;
    let mut spawned = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec![
                "python3".into(),
                "-c".into(),
                script.into(),
                socket.to_string_lossy().into_owned(),
            ]),
            env: BTreeMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();
    let observation = tokio::time::timeout(Duration::from_secs(2), async {
        let (holder, _) = listener.accept().await.unwrap();
        let first = terminals.wait_program_ended(&spawned.id);
        let second = terminals.wait_program_ended(&spawned.id);
        tokio::pin!(first, second);
        tokio::select! {
            biased;
            () = &mut first => panic!("the original program still awaits input"),
            () = &mut second => panic!("the original program still awaits input"),
            result = terminals.write(&spawned.id, b"exit\n") => result.unwrap(),
        }
        tokio::join!(first, second);
        terminals.wait_program_ended(&spawned.id).await;
        assert!(terminals.program_ended(&spawned.id).await);
        assert!(terminals.list().await[0].running, "PTY completion remains separate");
        assert!(spawned.events.try_recv().is_err(), "no premature exit event");
        drop(holder);
        while spawned.output.next().await.is_some() {}
        let event = spawned.events.recv().await.unwrap();
        assert!(matches!(event.as_ref(), contracts::EventData::TerminalExited(done) if done.code == Some(7)));
        terminals.wait_program_ended("999").await;
    })
    .await;
    if observation.is_err() {
        let _ = terminals.kill(&spawned.id).await;
    }
    observation.expect("program completion and PTY cleanup finish within the observer bound");
}
