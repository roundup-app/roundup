//! I7: Terminal reads through the CLI.
use super::*;

fn terminal_reply() -> Value {
    json!({"from": 0, "next": 5, "text": "hello", "truncated": true})
}

#[tokio::test]
async fn i7_read_prints_text_on_stdout_and_next_on_stderr() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut seen = stand_in(
        &socket,
        false,
        vec![("terminal.read", terminal_reply())],
        &[],
    );
    let output = on(&socket)
        .rup(&["terminal", "read", "3", "--after", "120"])
        .await;
    assert_eq!((out(&output).as_str(), code(&output)), ("hello", 0));
    assert_eq!(err(&output), "next: 5\ntruncated\n");
    assert_eq!(
        request_of(&mut seen, "terminal.read").await,
        json!({"id": "3", "after": 120, "reader": "a1"})
    );
}

#[tokio::test]
async fn i7_read_json_has_next_in_the_result() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _seen = stand_in(
        &socket,
        false,
        vec![("terminal.read", terminal_reply())],
        &[],
    );
    let output = on(&socket).rup(&["terminal", "read", "3", "--json"]).await;
    assert_eq!(
        serde_json::from_str::<Value>(&out(&output)).unwrap(),
        terminal_reply()
    );
    assert!(err(&output).is_empty());
}

/// A real Terminal that prints 40 000 bytes: each read is cut at the 16 384-byte cap as over MCP, and a loop from `next` misses and repeats nothing.
#[tokio::test(flavor = "multi_thread")]
async fn i7_a_loop_of_reads_from_next_misses_and_repeats_nothing() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    let spawned = run
        .rup(&[
            "terminal",
            "spawn",
            "/",
            "80",
            "24",
            "--env",
            "{}",
            "--command",
            "/bin/sh",
            "--command",
            "-c",
            "--command",
            "head -c 40000 /dev/zero | tr '\\0' x; sleep 30",
            "--json",
        ])
        .await;
    assert_eq!(code(&spawned), 0, "{}", err(&spawned));
    let id = serde_json::from_str::<Value>(&out(&spawned)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (mut after, mut got, mut longest) = (0u64, 0usize, 0usize);
    let started = Instant::now();
    while got < 40_000 && started.elapsed() < Duration::from_secs(20) {
        let output = run
            .rup(&["terminal", "read", &id, "--after", &after.to_string()])
            .await;
        assert_eq!(code(&output), 0, "{}", err(&output));
        let text = out(&output);
        longest = longest.max(text.len());
        got += text.len();
        let next = err(&output)
            .lines()
            .find_map(|line| line.strip_prefix("next: ").map(str::to_owned))
            .unwrap();
        after = next.parse().unwrap();
        assert!(
            text.chars().all(|ch| ch == 'x' || ch == '\r' || ch == '\n'),
            "{text:?}"
        );
        if text.is_empty() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    assert!(longest <= 16_384, "{longest}");
    assert!(got >= 40_000, "{got}");
}

#[tokio::test]
async fn i7_a_reply_over_the_cap_is_cut_as_over_mcp() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    let spawned = run
        .rup(&[
            "terminal",
            "spawn",
            "/",
            "80",
            "24",
            "--env",
            "{}",
            "--command",
            "/bin/sh",
            "--command",
            "-c",
            "--command",
            "head -c 40000 /dev/zero | tr '\\0' x; sleep 30",
            "--json",
        ])
        .await;
    let id = serde_json::from_str::<Value>(&out(&spawned)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let started = Instant::now();
    loop {
        let output = run.rup(&["terminal", "read", &id]).await;
        if err(&output).contains("truncated") {
            assert_eq!(out(&output).len(), 16_384);
            break;
        }
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "never truncated"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn i7_a_daemon_that_never_answers_exits_1_in_ten_seconds() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _seen = stand_in(&socket, false, Vec::new(), &["terminal.read"]);
    let started = Instant::now();
    let output = on(&socket).rup(&["terminal", "read", "3"]).await;
    assert_eq!(code(&output), 1);
    assert!(
        err(&output).contains("no answer within 10 s"),
        "{}",
        err(&output)
    );
    assert!(started.elapsed() >= Duration::from_secs(10));
    assert!(started.elapsed() < Duration::from_secs(14));
}

