//! A4, H8: `rup signal <agent-id>` turns one hook payload on stdin into `agent.signal` as that Agent.
//! It never exits 2, which Claude Code reads as "block": every failure is exit 1 and a message.

#[path = "common/served.rs"]
mod common;

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use common::Served;
use contracts::{ActorKind, EventData, Kind};
use serde_json::json;

/// Claude Code kills a command hook after this (the `timeout` roundup gives it in the settings).
const HOOK_TIMEOUT: Duration = Duration::from_secs(5);

impl Served {
    /// Run `rup signal <agent_id>` against this Daemon.
    fn signal(&self, agent_id: &str, attempt: &str, stdin: &str) -> Output {
        rup(&self.socket(), &["signal", agent_id], stdin, Some(attempt))
    }
}

/// Run `rup <args>` with `stdin` on its standard input, pointed at `socket`. A run that outlasts
/// Claude Code's hook timeout fails the test.
fn rup(socket: &Path, args: &[&str], stdin: &str, attempt: Option<&str>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_rup"));
    command.env_remove("ROUNDUP_ATTEMPT");
    if let Some(value) = attempt {
        command.env("ROUNDUP_ATTEMPT", value);
    }
    let mut rup = command
        .args(args)
        .env("RUPD_SOCKET", socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    // A rup that exits before reading (bad arguments) closes the pipe; that is not a test error.
    let _ = rup.stdin.take().unwrap().write_all(stdin.as_bytes());
    let deadline = Instant::now() + HOOK_TIMEOUT;
    while rup.try_wait().unwrap().is_none() {
        if Instant::now() > deadline {
            let _ = rup.kill();
            panic!("rup {args:?} outlasted Claude Code's hook timeout");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    rup.wait_with_output().unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a4_signal_signals_the_agent_as_that_agent() {
    let served = Served::start("#!/bin/sh\nsleep 30\n", &[]).await;
    let mut client = rpc::Client::connect(&served.socket()).await.unwrap();
    client
        .request("events.subscribe", json!(null))
        .await
        .unwrap();
    let cwd = served.dir.path().to_string_lossy().into_owned();
    let agent = client
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": null}),
        )
        .await
        .unwrap();
    let id = agent["id"].as_str().unwrap();

    let out = served.signal(
        id,
        agent["attempt"].as_str().unwrap(),
        r#"{"hook_event_name":"Stop"}"#,
    );

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let event = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let event = client.next_event().await.expect("events stay open");
            if let EventData::AgentStatus(status) = event.data {
                return (event.actor, status);
            }
        }
    })
    .await
    .expect("agent.status arrives");
    let (actor, status) = event;
    assert_eq!((actor.kind, actor.id.as_str()), (ActorKind::Agent, id));
    assert_eq!((status.id.as_str(), status.status.kind), (id, Kind::Idle));
}

#[tokio::test(flavor = "multi_thread")]
async fn a4_signal_for_an_unknown_agent_fails_loudly() {
    let served = Served::start("#!/bin/sh\nsleep 30\n", &[]).await;
    let out = served.signal("999", "1", r#"{"hook_event_name":"Stop"}"#);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("not found: an Agent that is gone"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a4_signal_rejects_a_payload_that_is_not_json() {
    let served = Served::start("#!/bin/sh\nsleep 30\n", &[]).await;
    let out = served.signal("1", "1", "not json");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("payload"));
}

#[test]
fn a4_signal_with_no_daemon_exits_1_with_a_message() {
    let nowhere = tempfile::tempdir().unwrap().path().join("missing.sock");
    let out = rup(
        &nowhere,
        &["signal", "1"],
        r#"{"hook_event_name":"Stop"}"#,
        Some("1"),
    );
    assert_eq!(out.status.code(), Some(1));
    assert!(!out.stderr.is_empty());
}

#[test]
fn a4_signal_to_a_daemon_that_never_answers_exits_1_in_time() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("silent.sock");
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    std::thread::spawn(move || {
        // Accepted and kept open, never answered.
        let mut held = vec![];
        for stream in listener.incoming() {
            held.push(stream);
        }
    });

    let started = Instant::now();
    let out = rup(
        &socket,
        &["signal", "1"],
        r#"{"hook_event_name":"Stop"}"#,
        Some("1"),
    );

    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("may or may not"), "{stderr}");
    // Well inside the hook timeout, so a slow Daemon never costs Claude Code its hook.
    assert!(
        started.elapsed() < HOOK_TIMEOUT / 2,
        "{:?}",
        started.elapsed()
    );
}

/// H15: a lost Signal costs the hook exactly one line on stderr, never a retry and never a second
/// write; Claude Code's own hook output is a line Claude Code shows the user, not several.
#[test]
fn h15_a_lost_signal_exits_1_with_exactly_one_stderr_line() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("silent.sock");
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    std::thread::spawn(move || {
        // Accepted and kept open, never answered.
        let mut held = vec![];
        for stream in listener.incoming() {
            held.push(stream);
        }
    });

    let out = rup(
        &socket,
        &["signal", "1"],
        r#"{"hook_event_name":"Stop"}"#,
        Some("1"),
    );

    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    let lines: Vec<&str> = stderr.lines().collect();
    assert_eq!(lines.len(), 1, "{stderr}");
    assert!(lines[0].contains("may or may not"), "{stderr}");
}

#[test]
fn a4_signal_to_a_daemon_that_closes_mid_call_says_the_signal_may_not_have_arrived() {
    use std::io::{BufRead, BufReader};
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("closing.sock");
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut lines = BufReader::new(&stream).lines();
        let identify: serde_json::Value =
            serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        let reply = json!({"jsonrpc": "2.0", "id": identify["id"], "result": null});
        (&stream)
            .write_all(format!("{reply}\n").as_bytes())
            .unwrap();
        // The agent.signal request is read, then the connection drops unanswered.
        lines.next().unwrap().unwrap();
    });

    let out = rup(
        &socket,
        &["signal", "1"],
        r#"{"hook_event_name":"Stop"}"#,
        Some("1"),
    );

    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("may or may not have arrived"), "{stderr}");
}

/// The OS threads of a live process: `/proc/<pid>/task` on Linux, one `ps -M` row per thread on
/// macOS (the header row is not one). 0 when the process is already gone.
fn os_threads(pid: u32) -> usize {
    if cfg!(target_os = "linux") {
        return std::fs::read_dir(format!("/proc/{pid}/task")).map_or(0, Iterator::count);
    }

    let out = Command::new("ps")
        .args(["-M", "-p", &pid.to_string()])
        .output()
        .unwrap();

    String::from_utf8_lossy(&out.stdout)
        .lines()
        .count()
        .saturating_sub(1)
}

/// H15: `rup signal` runs its `tokio::main` on a current-thread runtime (`crates/rup/src/main.rs`)
/// so a hook process never costs the OS more than one thread to schedule. Caught straight from
/// the OS's thread list, while the process is alive and blocked on a Daemon that never answers, so a mutant
/// that swaps in the default multi-threaded runtime (which starts a worker thread per core) fails
/// this even though it still exits 1 in time.
#[test]
fn h15_rup_signal_never_runs_more_than_one_os_thread() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("silent.sock");
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    std::thread::spawn(move || {
        // Accepted and kept open, never answered, so `rup signal` stays alive and blocked.
        let mut held = vec![];
        for stream in listener.incoming() {
            held.push(stream);
        }
    });

    let mut child = Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["signal", "1"])
        .env("RUPD_SOCKET", &socket)
        .env("ROUNDUP_ATTEMPT", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"hook_event_name":"Stop"}"#)
        .unwrap();
    let pid = child.id();

    // A multi-threaded runtime spawns its worker threads lazily, a few ms after the process
    // starts, so one read right after spawning would pass even on the mutant; the max over the
    // whole window is what actually proves "never more than one".
    let deadline = Instant::now() + HOOK_TIMEOUT / 2;
    let mut max_tasks = 0;
    while Instant::now() < deadline {
        max_tasks = max_tasks.max(os_threads(pid));
        if child.try_wait().unwrap().is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    let _ = child.kill();
    let _ = child.wait();

    assert!(max_tasks > 0, "pid {pid}: never read its thread count");
    assert_eq!(max_tasks, 1, "pid {pid}: expected exactly one OS thread");
}

#[test]
fn a4_signal_with_the_wrong_number_of_arguments_exits_1_not_2() {
    let nowhere = tempfile::tempdir().unwrap().path().join("missing.sock");
    for args in [&["signal"][..], &["signal", "1", "extra"]] {
        let out = rup(&nowhere, args, "{}", Some("1"));
        assert_eq!(out.status.code(), Some(1), "{args:?}");
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("usage"),
            "{args:?}"
        );
    }
}

#[test]
fn a7_signal_missing_or_malformed_attempt_fails_before_connecting() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("never-connect.sock");
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    listener.set_nonblocking(true).unwrap();
    for stamp in [
        None,
        Some(""),
        Some("0"),
        Some("01"),
        Some("+1"),
        Some("9223372036854775808"),
    ] {
        let out = rup(&socket, &["signal", "1"], "{}", stamp);
        assert_eq!(out.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&out.stderr).contains("ROUNDUP_ATTEMPT"));
        assert!(
            matches!(listener.accept(), Err(err) if err.kind() == std::io::ErrorKind::WouldBlock)
        );
    }
}

/// B39's fake `claude`: it sets the star title and keeps every byte the Daemon types in
/// `typed.txt`, so a test knows when a Message is in flight.
const TYPING_CLAUDE: &str = "#!/bin/sh\nprintf '\\033]0;\\342\\234\\263 claude\\007'\ncat > \"$(dirname \"$0\")/typed.txt\"\n";

impl Served {
    /// `rup signal` with the `UserPromptSubmit` payload that carries `prompt`.
    fn submit(&self, agent_id: &str, attempt: &str, prompt: &str) -> Output {
        let payload = json!({"hook_event_name": "UserPromptSubmit", "prompt": prompt});
        self.signal(agent_id, attempt, &payload.to_string())
    }

    /// An Agent spawned on this Daemon whose first turn is played to its end, so it is `idle`: its
    /// id and Attempt. Nothing is typed to it at start (A9), so its first paste is the first Message.
    async fn idle_agent(&self, client: &rpc::Client) -> (String, String) {
        let cwd = self.dir.path().to_string_lossy().into_owned();
        let agent = client
            .request(
                "agent.spawn",
                json!({"cwd": cwd, "name":"signal-reader", "prompt": null, "parent": null}),
            )
            .await
            .unwrap();
        let (id, attempt) = (
            agent["id"].as_str().unwrap().to_owned(),
            agent["attempt"].as_str().unwrap().to_owned(),
        );
        let start = r#"{"hook_event_name":"SessionStart","session_id":"s","source":"startup"}"#;
        assert!(self.signal(&id, &attempt, start).status.success());
        assert_eq!(self.submit(&id, &attempt, "start").status.code(), Some(0));
        let stop = r#"{"hook_event_name":"Stop"}"#;
        assert!(self.signal(&id, &attempt, stop).status.success());
        (id, attempt)
    }

    /// The user's `message.send` of the note `body` to `to`, on a connection of its own: to an
    /// `idle` receiver the call returns only once the prompt that carries it is submitted (H11).
    async fn send(
        &self,
        to: &str,
        body: &str,
    ) -> tokio::task::JoinHandle<Result<serde_json::Value, rpc::RpcError>> {
        let client = rpc::Client::connect(&self.socket()).await.unwrap();
        let params = json!({"to": to, "kind": "note", "body": body});
        tokio::spawn(async move { client.request("message.send", params).await })
    }

    /// The pastes `TYPING_CLAUDE` was typed, without their markers, once there are at least `n`.
    async fn pastes(&self, n: usize) -> Vec<String> {
        let typed = self.dir.path().join("typed.txt");
        for _ in 0..500 {
            let text = std::fs::read_to_string(&typed).unwrap_or_default();
            let pastes: Vec<String> = text
                .split("\x1b[200~")
                .skip(1)
                .filter_map(|rest| rest.split_once("\x1b[201~"))
                .map(|(paste, _)| paste.to_owned())
                .collect();
            if pastes.len() >= n {
                return pastes;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("fewer than {n} pastes were typed");
    }
}

async fn message_status(client: &rpc::Client, id: u32) -> serde_json::Value {
    client
        .request("message.get", json!({ "id": id }))
        .await
        .unwrap()["status"]
        .clone()
}

/// What Claude Code 2.1.302 hands `UserPromptSubmit` for `LEAD_IN` followed by a paste it shows as
/// a Paste placeholder, as a real run recorded it: the paste inside its `pasted_content` envelope.
fn wrapped_as_paste(pasted: &str) -> String {
    format!(
        "Follow this instruction: \n\n<pasted_content id=\"058a\">\n{pasted}\n</pasted_content id=\"058a\">\n"
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn b39_the_hook_exits_2_only_for_a_prompt_whose_messages_are_all_delivered() {
    let served = Served::start(TYPING_CLAUDE, &[]).await;
    let client = rpc::Client::connect(&served.socket()).await.unwrap();
    let (id, attempt) = served.idle_agent(&client).await;
    let (id, attempt) = (id.as_str(), attempt.as_str());
    let submit = |prompt: &str| served.submit(id, attempt, prompt);
    // The Agent is idle, so the Message is typed at once and waits in flight for its Signal.
    let sent = served.send(id, "hi").await;
    served.pastes(1).await;
    let status = || message_status(&client, 1);

    // Exit 0, and the Message still unconfirmed: no line, an id that names nothing, a line that
    // cannot be read.
    for prompt in [
        "[from you, note] hi",
        "hi\n\n[rup messages: 99]",
        "hi\n\n[rup messages: x]",
        "hi\n\n[rup messages: 1 99]x",
    ] {
        let out = submit(prompt);
        assert_eq!(out.status.code(), Some(0), "{prompt}");
        assert_eq!(status().await, "pending", "{prompt}");
    }
    assert_eq!(sent.await.unwrap().unwrap()["status"], "pending");
    // A Daemon that cannot be reached never blocks a prompt: exit 1, the failure Claude Code
    // shows without blocking.
    let down = rup(
        &served.dir.path().join("no-daemon.sock"),
        &["signal", id],
        r#"{"hook_event_name":"UserPromptSubmit","prompt":"hi\n\n[rup messages: 1]"}"#,
        Some(attempt),
    );
    assert_eq!(down.status.code(), Some(1));

    let prompt = "[from you, note] hi\n\n[rup messages: 1]";
    assert_eq!(submit(prompt).status.code(), Some(0));
    assert_eq!(status().await, "delivered");
    let repeated = submit(prompt);
    assert_eq!(repeated.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&repeated.stderr).contains("already delivered"));
    assert_eq!(status().await, "delivered");
    client
        .request("agent.stop", json!({ "id": id }))
        .await
        .unwrap();
}

/// B39 (f): Claude Code hands the hook a long paste inside its envelope, so the id line is not
/// the prompt's last line. Seen with 2.1.302: a Door's wake note was never confirmed, and every
/// `idle` typed it again.
#[tokio::test(flavor = "multi_thread")]
async fn b39_a_prompt_claude_code_wraps_as_a_paste_confirms_its_messages() {
    let served = Served::start(TYPING_CLAUDE, &[]).await;
    let client = rpc::Client::connect(&served.socket()).await.unwrap();
    let (id, attempt) = served.idle_agent(&client).await;
    // A note of several lines, which Claude Code shows as a Paste placeholder.
    let sent = served
        .send(&id, "[wake]\nwhy-2303-closed is idle\n  last: idle")
        .await;
    let prompt = wrapped_as_paste(&served.pastes(1).await[0]);

    assert_eq!(served.submit(&id, &attempt, &prompt).status.code(), Some(0));
    sent.await.unwrap().unwrap();
    assert_eq!(message_status(&client, 1).await, "delivered");
    // The same prompt again, as Claude Code puts an interrupted prompt back: the hook blocks it.
    assert_eq!(served.submit(&id, &attempt, &prompt).status.code(), Some(2));
    client
        .request("agent.stop", json!({ "id": id }))
        .await
        .unwrap();
}

/// B39 (g): a prompt whose Signal confirms none of its Messages leaves them `pending`, and this
/// Daemon run types them no more and logs it. Before, every `idle` typed them again.
#[tokio::test(flavor = "multi_thread")]
async fn b39_a_prompt_its_signal_did_not_confirm_is_not_typed_again_and_is_logged() {
    let served = Served::start(TYPING_CLAUDE, &[]).await;
    let client = rpc::Client::connect(&served.socket()).await.unwrap();
    let (id, attempt) = served.idle_agent(&client).await;
    let sent = served.send(&id, "one").await;
    let one = served.pastes(1).await.remove(0);
    // A prompt whose id line the Daemon cannot read, as Claude Code's own Paste placeholder.
    let unread = "Follow this instruction: [Pasted text #1 +3 lines]";
    assert_eq!(served.submit(&id, &attempt, unread).status.code(), Some(0));
    sent.await.unwrap().unwrap();

    // The turn ends, and the `idle` types only the next Message.
    let stop = r#"{"hook_event_name":"Stop"}"#;
    assert!(served.signal(&id, &attempt, stop).status.success());
    let _two = served.send(&id, "two").await;

    assert_eq!(
        served.pastes(2).await,
        [one, "[from you, note] two\n\n[rup messages: 2]".to_owned()]
    );
    assert_eq!(message_status(&client, 1).await, "pending");
    let mut log = String::new();
    for _ in 0..500 {
        log = served.stderr();
        if log.contains("confirm_prompt failed") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let failures: Vec<&str> = log
        .lines()
        .filter(|line| line.contains("confirm_prompt failed"))
        .collect();
    assert_eq!(
        failures,
        [format!(
            "rupd: messages: confirm_prompt failed: agent {id} submitted a prompt that did not confirm Messages 1; they stay pending and are not typed again until the Daemon restarts"
        )]
    );
    client
        .request("agent.stop", json!({ "id": id }))
        .await
        .unwrap();
}
