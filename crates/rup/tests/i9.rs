//! I9: `rup events` follows the Event log, exactly once. The built `rup` against an in-process Daemon on a temp socket.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

const BOUND: Duration = Duration::from_secs(20);

struct Daemon {
    data: PathBuf,
    socket: PathBuf,
    task: Option<JoinHandle<()>>,
}

impl Daemon {
    fn start(root: &Path) -> Self {
        let mut daemon = Self {
            data: root.join(".roundup"),
            socket: root.join("rupd.sock"),
            task: None,
        };
        daemon.restart();
        daemon
    }

    /// Stop the Daemon, if it runs, and open the same Project again.
    fn restart(&mut self) {
        self.stop();
        let _ = std::fs::remove_file(&self.socket);
        let daemon = Arc::new(rupd::Daemon::open(&self.data).unwrap());
        let listener = tokio::net::UnixListener::bind(&self.socket).unwrap();
        self.task = Some(tokio::spawn(async move {
            let _ = rupd::serve(listener, daemon).await;
        }));
    }

    fn stop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }

    async fn client(&self) -> rpc::Client {
        rpc::Client::connect(&self.socket).await.unwrap()
    }

    /// One saved Event each: a Todo is created.
    async fn save(&self, count: usize) {
        let client = self.client().await;
        for n in 0..count {
            client
                .request("todo.create", json!({ "title": format!("t{n}") }))
                .await
                .unwrap();
        }
    }

    fn rup(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_rup"));
        command
            .args(args)
            .env("RUPD_SOCKET", &self.socket)
            .env_remove("ROUNDUP_AGENT")
            .stdin(Stdio::null())
            .kill_on_drop(true);
        command
    }

    /// Run `rup` to its end: (exit code, stdout, stderr).
    async fn run(&self, args: &[&str]) -> (i32, String, String) {
        let output = tokio::time::timeout(BOUND, self.rup(args).output())
            .await
            .unwrap()
            .unwrap();
        (
            output.status.code().unwrap(),
            String::from_utf8(output.stdout).unwrap(),
            String::from_utf8(output.stderr).unwrap(),
        )
    }

    /// Every saved Event number, from a run of `rup events --after 0`.
    async fn seqs(&self) -> Vec<u64> {
        let (code, out, _) = self.run(&["events", "--after", "0"]).await;
        assert_eq!(code, 0);
        numbers(&out)
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        self.stop();
    }
}

fn numbers(out: &str) -> Vec<u64> {
    out.lines()
        .map(|line| {
            serde_json::from_str::<Value>(line).unwrap()["seq"]
                .as_u64()
                .unwrap()
        })
        .collect()
}

struct Follow {
    child: Child,
    lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

impl Follow {
    fn start(daemon: &Daemon, args: &[&str]) -> Self {
        let mut child = daemon
            .rup(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let lines = BufReader::new(child.stdout.take().unwrap()).lines();
        Self { child, lines }
    }

    async fn next(&mut self) -> u64 {
        let line = tokio::time::timeout(BOUND, self.lines.next_line())
            .await
            .expect("a line within the bound")
            .unwrap()
            .expect("the stream is open");
        numbers(&line)[0]
    }
}

fn project() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[tokio::test]
async fn i9_events_after_prints_each_saved_event_past_n_and_stops_at_the_end() {
    let dir = project();
    let daemon = Daemon::start(dir.path());
    daemon.save(20).await;
    let all = daemon.seqs().await;
    assert!(all.len() >= 20);
    let head = *all.last().unwrap();

    let from = all[11];
    let (code, out, _) = daemon.run(&["events", "--after", &from.to_string()]).await;
    assert_eq!(code, 0);
    assert_eq!(numbers(&out), all[12..]);
    let first: Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
    assert!(
        first["actor"].is_object() && first["name"].is_string(),
        "{first}"
    );

    let (code, out, _) = daemon
        .run(&["events", "--after", &head.to_string(), "--json"])
        .await;
    assert_eq!((code, out.as_str()), (0, ""));
}

#[tokio::test]
async fn i9_follow_streams_live_after_the_replay_with_no_gap_and_no_repeat() {
    let dir = project();
    let daemon = Daemon::start(dir.path());
    daemon.save(5).await;
    let all = daemon.seqs().await;
    let from = all[1];
    let mut follow = Follow::start(
        &daemon,
        &["events", "--after", &from.to_string(), "--follow"],
    );
    let mut seen = Vec::new();
    for _ in 0..all.len() - 2 {
        seen.push(follow.next().await);
    }
    assert_eq!(seen, all[2..]);

    daemon.save(3).await;
    let now = daemon.seqs().await;
    for _ in 0..now.len() - all.len() {
        seen.push(follow.next().await);
    }
    assert_eq!(seen, now[2..]);
    assert!(
        follow.child.try_wait().unwrap().is_none(),
        "--follow never ends on its own"
    );
}

#[tokio::test]
async fn i9_no_after_starts_at_the_end() {
    let dir = project();
    let daemon = Daemon::start(dir.path());
    daemon.save(3).await;
    let (code, out, _) = daemon.run(&["events"]).await;
    assert_eq!((code, out.as_str()), (0, ""));

    let before = daemon.seqs().await;
    let mut follow = Follow::start(&daemon, &["events", "--follow"]);
    // The Daemon accepts the subscription before this save, or the save is in the replayed past.
    tokio::time::sleep(Duration::from_millis(300)).await;
    daemon.save(1).await;
    let first = follow.next().await;
    assert_eq!(first, before.last().unwrap() + 1);
}

#[tokio::test]
async fn i9_an_after_older_than_the_window_exits_1_with_the_daemons_error() {
    let dir = project();
    let mut daemon = Daemon::start(dir.path());
    daemon.save(1).await;
    daemon.stop();
    let db = rusqlite::Connection::open(daemon.data.join("project.db")).unwrap();
    for _ in 0..14 {
        db.execute("INSERT INTO events(event) SELECT event FROM events", [])
            .unwrap();
    }
    drop(db);
    daemon.restart();
    daemon.save(1).await;
    let (code, _, err) = daemon.run(&["events", "--after", "0"]).await;
    assert_eq!(code, 1);
    let oldest: u64 = err
        .split("oldest kept Event number is ")
        .nth(1)
        .and_then(|rest| rest.split(':').next())
        .unwrap()
        .parse()
        .unwrap();
    assert!(oldest > 1000, "the log was pruned to its window");
    let (_, out, _) = daemon
        .run(&["events", "--after", &(oldest - 1).to_string()])
        .await;
    let head = *numbers(&out).last().unwrap();

    let (code, out, err) = daemon
        .run(&["events", "--after", &(oldest - 2).to_string()])
        .await;
    assert_eq!((code, out.as_str()), (1, ""));
    assert!(
        err.contains("EVENTS_EXPIRED")
            && err.contains(&format!("oldest kept Event number is {oldest}")),
        "{err}"
    );
    assert!(err.contains(&format!("--after {}", oldest - 1)), "{err}");
    let (code, _, _) = daemon
        .run(&["events", "--after", &(oldest - 1).to_string()])
        .await;
    assert_eq!(code, 0);

    let (code, out, err) = daemon
        .run(&["events", "--after", &(head + 1).to_string()])
        .await;
    assert_eq!((code, out.as_str()), (1, ""));
    assert!(err.contains("INVALID_PARAMS"), "{err}");
}

#[tokio::test]
async fn i9_a_bad_after_exits_2() {
    let dir = project();
    let daemon = Daemon::start(dir.path());
    for args in [
        &["events", "--after", "x"][..],
        &["events", "--after", "-1"],
        &["events", "--after", "1.5"],
        &["events", "--bogus"],
        &["events", "--follow", "--follow"],
    ] {
        let (code, out, err) = daemon.run(args).await;
        assert_eq!((code, out.as_str()), (2, ""), "{args:?}: {err}");
    }
}

#[tokio::test]
async fn i9_a_restarted_caller_loses_and_repeats_nothing() {
    let dir = project();
    let mut daemon = Daemon::start(dir.path());
    daemon.save(4).await;
    let mut got = Vec::new();

    let mut follow = Follow::start(&daemon, &["events", "--after", "0", "--follow"]);
    let all = daemon.seqs().await;
    for _ in 0..all.len() - 1 {
        got.push(follow.next().await);
    }
    follow.child.kill().await.unwrap();

    daemon.save(2).await;
    let (code, out, _) = daemon
        .run(&["events", "--after", &got.last().unwrap().to_string()])
        .await;
    assert_eq!(code, 0);
    got.extend(numbers(&out));

    daemon.restart();
    daemon.save(2).await;
    let (code, out, _) = daemon
        .run(&["events", "--after", &got.last().unwrap().to_string()])
        .await;
    assert_eq!(code, 0);
    got.extend(numbers(&out));

    let saved = daemon.seqs().await;
    assert_eq!(got, saved[..got.len()]);
    assert_eq!(*got.last().unwrap(), *saved.last().unwrap());
}

#[tokio::test]
async fn i9_each_line_is_flushed_and_terminal_output_is_absent() {
    let dir = project();
    let daemon = Daemon::start(dir.path());
    let client = daemon.client().await;
    let mut follow = Follow::start(&daemon, &["events", "--follow"]);
    tokio::time::sleep(Duration::from_millis(300)).await;
    client
        .request(
            "terminal.spawn",
            json!({"cwd": dir.path(), "command": ["sh", "-c", "echo hi"], "env": {}, "cols": 80, "rows": 24}),
        )
        .await
        .unwrap();
    daemon.save(1).await;
    // Every line that arrives is a saved Event; Terminal output has no number, so `next` would fail on one.
    let first = follow.next().await;
    assert!(first > 0);

    // A reader that closed the pipe ends it with exit 0.
    let Follow { mut child, lines } = follow;
    drop(lines);
    tokio::time::sleep(Duration::from_millis(100)).await;
    daemon.save(2).await;
    let status = tokio::time::timeout(BOUND, child.wait())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status.code(), Some(0));
}
