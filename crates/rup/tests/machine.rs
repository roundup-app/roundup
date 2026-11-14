//! MC21, MC22, MC23: `rup` on a machine spools a report, serves the bridge and fails loud when away.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};

#[path = "common/served.rs"]
#[allow(dead_code)]
mod common;

fn rup(dir: &Path, args: &[&str], stdin: &str) -> (Output, Duration) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_rup"));
    command
        .args(args)
        .env("ROUNDUP_MACHINE", "1")
        .env("ROUNDUP_ATTEMPT", "1")
        .env("RUPD_SOCKET", dir.join("none.sock"))
        .env("RUPQ_DIR", dir.join("rupq"))
        .env("RUPQ_RELAY_SOCK", dir.join("relay.sock"))
        .env("RUPQ_LIVE_SOCK", dir.join("live.sock"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let start = Instant::now();
    let mut child = command.spawn().unwrap();
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    let out = child.wait_with_output().unwrap();
    (out, start.elapsed())
}

fn spool(dir: &Path) -> Vec<Value> {
    std::fs::read_to_string(dir.join("rupq/spool"))
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn start_relay(dir: &Path) -> Child {
    let child = Command::new(env!("CARGO_BIN_EXE_rup"))
        .arg("relay")
        .env("ROUNDUP_MACHINE", "1")
        .env("RUPQ_DIR", dir.join("rupq"))
        .env("RUPQ_RELAY_SOCK", dir.join("relay.sock"))
        .env("RUPQ_LIVE_SOCK", dir.join("live.sock"))
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let (_tx, tick) = std::sync::mpsc::channel::<()>();
    while !dir.join("relay.sock").exists() || !dir.join("live.sock").exists() {
        assert!(Instant::now() < deadline, "the relay did not start");
        let _ = tick.recv_timeout(Duration::from_millis(10));
    }
    child
}

#[test]
fn mc21_signal_spools_and_exits_0_with_no_bridge() {
    let dir = tempfile::tempdir().unwrap();
    let (out, took) = rup(
        dir.path(),
        &["signal", "a1"],
        r#"{"hook_event_name":"Stop"}"#,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
    assert!(took < Duration::from_secs(1), "{took:?}");
    let lines = spool(dir.path());
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["id"], "a1:1");
    assert_eq!(lines[0]["method"], "agent.signal");
    assert_eq!(lines[0]["params"]["report"], "a1:1");
}

#[test]
fn mc21_signal_exits_0_the_same_with_the_bridge_up() {
    let dir = tempfile::tempdir().unwrap();
    let mut relay = start_relay(dir.path());
    let _bridge = std::os::unix::net::UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    let (out, took) = rup(dir.path(), &["signal", "a1"], "{}");
    relay.kill().unwrap();
    relay.wait().unwrap();
    assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty());
    assert!(took < Duration::from_secs(1), "{took:?}");
}

#[test]
fn mc21_signal_with_an_unwritable_spool_exits_1_with_the_cause() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("rupq"), "a file, not a directory").unwrap();
    let (out, _) = rup(dir.path(), &["signal", "a1"], "{}");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("cannot"));
}

#[test]
fn mc23_a_line_leaves_the_spool_only_on_the_ack_and_replays_on_connect() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    let dir = tempfile::tempdir().unwrap();
    let mut relay = start_relay(dir.path());
    rup(dir.path(), &["signal", "a1"], "{}");
    rup(dir.path(), &["signal", "a1"], "{}");
    let read = |stream: &UnixStream| {
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        serde_json::from_str::<Value>(&line).unwrap()
    };
    // A bridge that hangs up before acking leaves the line, and the next connect replays it.
    let first = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    assert_eq!(read(&first)["id"], "a1:1");
    drop(first);
    let mut second = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    assert_eq!(read(&second)["id"], "a1:1");
    assert_eq!(spool(dir.path()).len(), 2);
    second.write_all(b"{\"ack\":\"a1:1\"}\n").unwrap();
    let mut reader = BufReader::new(&second);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["id"], "a1:2");
    assert_eq!(spool(dir.path()).len(), 1);
    relay.kill().unwrap();
    relay.wait().unwrap();
}

#[test]
fn mc22_a_live_call_with_no_bridge_returns_away_at_once() {
    let dir = tempfile::tempdir().unwrap();
    for relay in [false, true] {
        let mut child = relay.then(|| start_relay(dir.path()));
        let (out, took) = rup(dir.path(), &["todo", "list", "--agent", "a1"], "");
        assert_eq!(out.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&out.stderr).contains(r#"{"error":"away"}"#));
        assert!(took < Duration::from_secs(1), "{took:?}");
        if let Some(child) = child.as_mut() {
            child.kill().unwrap();
            child.wait().unwrap();
        }
    }
}

/// A machine's `rup mcp a1` with no bridge up, or (`machine` false) this Mac's.
async fn shim(
    dir: &Path,
    socket: &Path,
    machine: bool,
) -> (
    rmcp::service::RunningService<rmcp::service::RoleClient, ()>,
    tokio::process::Child,
) {
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"));
    command
        .args(["mcp", "a1"])
        .env("RUPD_SOCKET", socket)
        .env("RUPQ_DIR", dir.join("rupq"))
        .env("RUPQ_RELAY_SOCK", dir.join("relay.sock"))
        .env("RUPQ_LIVE_SOCK", dir.join("live.sock"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if machine {
        command.env("ROUNDUP_MACHINE", "1");
    }
    let mut child = command.spawn().unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = tokio::time::timeout(Duration::from_secs(20), ().serve(transport))
        .await
        .unwrap()
        .unwrap();
    (client, child)
}

async fn call(
    client: &rmcp::service::RunningService<rmcp::service::RoleClient, ()>,
    tool: &str,
    arguments: Value,
) -> rmcp::model::CallToolResult {
    let mut request = CallToolRequestParams::new(tool.to_owned());
    if let Value::Object(map) = arguments {
        request = request.with_arguments(map);
    }
    tokio::time::timeout(Duration::from_secs(20), client.call_tool(request))
        .await
        .unwrap()
        .unwrap()
}

fn result_text(result: &rmcp::model::CallToolResult) -> String {
    result.content[0].as_text().unwrap().text.clone()
}

/// The tool names the scenario's `rule` bullet (`**Waits**` or `**Fail loud**`) lists.
fn scenario_tools(bullet: &str) -> Vec<String> {
    let text = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scenarios/machine-channel.md"),
    )
    .unwrap();
    let start = text.find(bullet).unwrap();
    let end = start + text[start..].find('\n').unwrap();
    text[start..end]
        .split('`')
        .skip(1)
        .step_by(2)
        .filter(|w| w.contains('_') && w.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn mc22_the_two_lists_cover_tools_list() {
    let dir = tempfile::tempdir().unwrap();
    let waits = scenario_tools("- **Waits**");
    let loud = scenario_tools("- **Fail loud**");
    assert_eq!(waits, ["message_send"]);
    assert_eq!(loud.len(), 29, "{loud:?}");
    assert!(waits.iter().all(|w| !loud.contains(w)));
    let (client, _child) = shim(dir.path(), &dir.path().join("none.sock"), true).await;
    let mut served: Vec<String> = client
        .list_all_tools()
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.name.to_string())
        .collect();
    let mut expected: Vec<String> = waits.into_iter().chain(loud).collect();
    served.sort();
    expected.sort();
    assert_eq!(served, expected);
}

#[tokio::test]
async fn mc22_each_fail_loud_tool_returns_away_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let (client, _child) = shim(dir.path(), &dir.path().join("none.sock"), true).await;
    let start = Instant::now();
    for tool in scenario_tools("- **Fail loud**") {
        let result = call(&client, &tool, json!({})).await;
        assert_eq!(result.is_error, Some(true), "{tool}");
        assert_eq!(result_text(&result), r#"{"error":"away"}"#, "{tool}");
    }
    assert!(
        start.elapsed() < Duration::from_secs(1),
        "{:?}",
        start.elapsed()
    );
    assert!(
        spool(dir.path())
            .iter()
            .all(|l| l["method"] != "message.send")
    );
}

#[tokio::test]
async fn mc22_a_local_agent_is_never_away() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let _daemon = common::serve(dir.path(), &socket);
    let (client, _child) = shim(dir.path(), &socket, false).await;
    let names: Vec<String> = client
        .list_all_tools()
        .await
        .unwrap()
        .into_iter()
        .map(|t| t.name.to_string())
        .collect();
    assert!(names.len() > 30 && names.iter().any(|n| n == "agent_spawn"));
    let listed = call(&client, "message_list", json!({})).await;
    assert_eq!(listed.is_error, Some(false));
    assert_eq!(result_text(&listed), "[]");
}

/// What the Daemon holds of Message 1, less its id and times.
async fn record(socket: &Path) -> Value {
    let client = rpc::Client::connect(socket).await.unwrap();
    client
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: "a1".into(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    let mut message: Value = client
        .request("message.get", json!({"id": 1}))
        .await
        .unwrap();
    let object = message.as_object_mut().unwrap();
    object.retain(|key, _| matches!(key.as_str(), "from" | "to" | "kind" | "body" | "status"));
    message
}

#[tokio::test]
async fn mc22_message_send_waits_and_applies_once_on_drain() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    let dir = tempfile::tempdir().unwrap();
    let (client, _child) = shim(dir.path(), &dir.path().join("none.sock"), true).await;
    let sent = call(
        &client,
        "message_send",
        json!({"to": "you", "kind": "note", "body": "hi"}),
    )
    .await;
    assert_eq!(sent.is_error, Some(false));
    assert_eq!(
        serde_json::from_str::<Value>(&result_text(&sent)).unwrap(),
        json!({"queued": true, "id": "a1:2"})
    );
    // The shim's own Channel report is the first line of its Agent.
    let lines = spool(dir.path());
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["method"], "message.send");
    // The drain hands the line over once; the ack removes it and a later connect finds nothing.
    let mut relay = start_relay(dir.path());
    let bridge = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    let mut reader = BufReader::new(&bridge);
    for id in ["a1:1", "a1:2"] {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["id"], id);
        (&bridge)
            .write_all(format!("{{\"ack\":\"{id}\"}}\n").as_bytes())
            .unwrap();
    }
    drop(reader);
    drop(bridge);
    let deadline = Instant::now() + Duration::from_secs(5);
    while !spool(dir.path()).is_empty() {
        assert!(Instant::now() < deadline, "the ack did not clear the line");
        std::thread::yield_now();
    }
    let second = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    second
        .set_read_timeout(Some(Duration::from_millis(300)))
        .unwrap();
    assert!(
        BufReader::new(&second)
            .read_line(&mut String::new())
            .is_err()
    );
    relay.kill().unwrap();
    relay.wait().unwrap();
}

#[tokio::test]
async fn mc22_a_message_sent_away_is_the_one_sent_present() {
    let dir = tempfile::tempdir().unwrap();
    let arguments = json!({"to": "you", "kind": "note", "body": "hi"});
    // Present: this Mac's shim sends it to the Daemon.
    let present_dir = dir.path().join("present");
    std::fs::create_dir_all(&present_dir).unwrap();
    let present_socket = present_dir.join("rupd.sock");
    let _present = common::serve(&present_dir, &present_socket);
    let (local, _local_child) = shim(&present_dir, &present_socket, false).await;
    assert_eq!(
        call(&local, "message_send", arguments.clone())
            .await
            .is_error,
        Some(false)
    );
    // Away: the machine's shim spools it, and the Daemon applies the spooled line.
    let away_dir = dir.path().join("away");
    std::fs::create_dir_all(&away_dir).unwrap();
    let away_socket = away_dir.join("rupd.sock");
    let _away = common::serve(&away_dir, &away_socket);
    let (machine, _machine_child) = shim(&away_dir, &away_dir.join("none.sock"), true).await;
    call(&machine, "message_send", arguments).await;
    let line = spool(&away_dir)
        .into_iter()
        .find(|l| l["method"] == "message.send")
        .unwrap();
    let client = rpc::Client::connect(&away_socket).await.unwrap();
    client
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: "a1".into(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    client
        .request(line["method"].as_str().unwrap(), &line["params"])
        .await
        .unwrap();
    let away = record(&away_socket).await;
    assert_eq!(away, record(&present_socket).await);
    assert_eq!(away["status"], "delivered");
}

#[test]
fn mc21_seq_never_repeats_across_a_rup_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut seen = Vec::new();
    for _ in 0..3 {
        // Each call is a fresh process on the same files, as after a reboot.
        rup(dir.path(), &["signal", "a1"], "{}");
        seen.push(spool(dir.path()).len());
    }
    let ids: Vec<String> = spool(dir.path())
        .iter()
        .map(|l| l["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["a1:1", "a1:2", "a1:3"]);
    assert_eq!(seen, [1, 2, 3]);
}

#[test]
fn mc22_signal_waits() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    let dir = tempfile::tempdir().unwrap();
    let (out, _) = rup(
        dir.path(),
        &["signal", "a1"],
        r#"{"hook_event_name":"Stop"}"#,
    );
    assert!(out.status.success());
    // The bridge returns later: the report is delivered once, and gone after its ack.
    let mut relay = start_relay(dir.path());
    let mut bridge = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    let mut line = String::new();
    BufReader::new(&bridge).read_line(&mut line).unwrap();
    let sent: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(
        (sent["id"].as_str(), sent["method"].as_str()),
        (Some("a1:1"), Some("agent.signal"))
    );
    bridge.write_all(b"{\"ack\":\"a1:1\"}\n").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let (_tx, tick) = std::sync::mpsc::channel::<()>();
    while !spool(dir.path()).is_empty() {
        assert!(
            Instant::now() < deadline,
            "the acked line stayed in the spool"
        );
        let _ = tick.recv_timeout(Duration::from_millis(10));
    }
    relay.kill().unwrap();
    relay.wait().unwrap();
}

#[test]
fn mc21_signal_p50_as_a_whole_process_is_within_5_ms_of_the_spike() {
    let dir = tempfile::tempdir().unwrap();
    let mut took: Vec<Duration> = (0..31)
        .map(|_| rup(dir.path(), &["signal", "a1"], "{}").1)
        .collect();
    took.sort();
    assert!(took[15] < Duration::from_millis(6), "p50 {:?}", took[15]);
}
