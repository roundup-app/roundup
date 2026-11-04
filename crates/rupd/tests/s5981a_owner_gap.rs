//! S5981a's byte-loss observer through a real `rupd`: an Agent's program prints a numbered line
//! every tick while no Daemon runs, and the reopened Project's Terminal holds every number once.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::Path;
use std::time::{Duration, Instant};

use rpc::Client;
use serde_json::{Value, json};

/// H21's child process of the fake `claude`: it shares the Agent's Terminal and prints a line per tick.
const COUNTER: &str = r#"["sh","-c","i=1; while [ $i -le 60 ]; do echo n$i; i=$((i+1)); sleep 0.1; done; sleep 120"]"#;

#[test]
fn s5981a_output_written_between_exit_and_reopen_is_replayed_in_order() {
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let owner = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("terminal-owner");
    assert!(owner.is_file(), "run `cargo build -p terminal --bins`");
    let start = || {
        rupd_harness::start(
            Path::new(env!("CARGO_BIN_EXE_rupd")),
            project.path(),
            false,
            |command| {
                command
                    .env("ROUNDUP_DATA_DIR", data.path())
                    .env(
                        "ROUNDUP_CLAUDE_BIN",
                        Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join("../rup/tests/e2e/fake_claude.py"),
                    )
                    .env("FAKE_CLAUDE_CHILD_PROCESS", COUNTER)
                    .env("FAKE_CLAUDE_LAUNCH_LOG", data.path().join("launches"))
                    .env("CLAUDE_CONFIG_DIR", data.path().join("config"))
                    .env("RUPD_TERMINAL_OWNER", &owner)
                    .env(
                        "ROUNDUP_RUP_BIN",
                        Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"),
                    );
            },
        )
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let daemon = start();
    runtime.block_on(async {
        let user = Client::connect(&daemon.socket).await.unwrap();
        let door = user
            .request(
                "rail.createWorkstream",
                json!({"name":"work","parent":null}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        user.request(
            "agent.spawn",
            json!({"name":"counter","parent":door,"cwd":project.path()}),
        )
        .await
        .unwrap();
    });
    // The Daemon ends without stopping the owner; the program keeps counting through the gap.
    drop(daemon);
    std::thread::sleep(Duration::from_secs(2));
    let daemon = start();
    let text = runtime.block_on(async {
        let user = Client::connect(&daemon.socket).await.unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let listed: Value = user.request("terminal.list", json!({})).await.unwrap();
            let mut text = String::new();
            for terminal in listed
                .as_array()
                .unwrap()
                .iter()
                .filter(|t| t["running"] == true)
            {
                let read = user
                    .request("terminal.read", json!({"id":terminal["id"],"after":0}))
                    .await
                    .unwrap();
                text.push_str(read["text"].as_str().unwrap());
            }
            if text.lines().any(|line| line == "n60") || Instant::now() > deadline {
                break text;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    // The owners outlive the Daemon, so stop them here.
    runtime.block_on(async {
        let user = Client::connect(&daemon.socket).await.unwrap();
        let listed: Value = user.request("terminal.list", json!({})).await.unwrap();
        for terminal in listed
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["running"] == true)
        {
            let _ = user
                .request("terminal.kill", json!({"id":terminal["id"]}))
                .await;
        }
    });
    let numbers: Vec<u32> = text
        .lines()
        .filter_map(|line| line.strip_prefix('n')?.trim().parse().ok())
        .collect();
    assert_eq!(numbers, (1..=60).collect::<Vec<_>>(), "{text}");
}
