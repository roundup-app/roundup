//! Z6395b: an Agent process writing raw JSON-RPC is refused `terminal.catchUp`.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};

/// The Agent's program: it waits for `request`, sends it raw with no `daemon.identify`,
/// and writes the reply line to the `reply` fifo.
const PROGRAM: &str = r#"#!/usr/bin/env python3
import os, socket, sys, time
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
d = os.path.dirname(os.path.abspath(__file__))
while not os.path.exists(d + '/request'):
    time.sleep(0.05)
s = socket.socket(socket.AF_UNIX)
s.connect(d + '/rupd.sock')
s.sendall(open(d + '/request', 'rb').read())
line = s.makefile('rb').readline()
open(d + '/reply', 'wb').write(line)
time.sleep(600)
"#;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn z6395b_an_agent_process_is_refused_terminal_catch_up_over_the_wire() {
    let dir = tempfile::tempdir().unwrap();
    let program = dir.path().join("claude");
    std::fs::write(&program, PROGRAM).unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let fifo = dir.path().join("reply");
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        true,
        |command| {
            command
                .current_dir(dir.path())
                .env("CLAUDE_CONFIG_DIR", dir.path().join("claude-config"))
                .env("ROUNDUP_RUP_BIN", &program)
                .env("ROUNDUP_CLAUDE_BIN", &program);
        },
    );
    let app = Client::connect(&daemon.socket).await.unwrap();
    let agent = app
        .request("agent.spawn", json!({"cwd": dir.path()}))
        .await
        .unwrap();
    let terminal = agent["terminal_id"].as_str().unwrap();
    let listed = app.request("terminal.list", json!({})).await.unwrap();
    let incarnation = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == terminal)
        .unwrap()["incarnation"]
        .clone();
    let params = json!({"id": terminal, "incarnation": incarnation, "after": 0});
    let request = json!({"jsonrpc":"2.0","id":1,"method":"terminal.catchUp","params":params});
    std::fs::write(dir.path().join("request"), format!("{request}\n")).unwrap();
    let read = tokio::task::spawn_blocking(move || std::fs::read_to_string(fifo));
    let line = tokio::time::timeout(Duration::from_secs(30), read)
        .await
        .expect("the Agent process got a reply")
        .unwrap()
        .unwrap();
    let reply = serde_json::from_str::<Value>(&line).unwrap();
    assert!(reply.get("result").is_none(), "{reply}");
    assert_eq!(reply["error"]["code"], rpc::code::FORBIDDEN, "{reply}");
    let caught_up = app.request("terminal.catchUp", params).await.unwrap();
    assert!(caught_up.get("kind").is_some(), "{caught_up}");
}
