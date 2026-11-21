//! U7694a through a real Daemon: two PNG sides of exactly 4 MiB arrive whole over its socket.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::Path;

use base64::Engine;
use rpc::Client;
use serde_json::json;

const LIMIT: usize = 4 * 1024 * 1024;

fn git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .current_dir(dir)
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

/// A PNG signature and IHDR for a `w`×`h` image, zero-padded to exactly `LIMIT` bytes.
fn png_of_limit(w: u32, h: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    bytes.extend(w.to_be_bytes());
    bytes.extend(h.to_be_bytes());
    bytes.resize(LIMIT, 0);
    bytes
}

#[test]
fn u7694a_two_png_sides_of_exactly_4_mib_arrive_whole_over_the_socket() {
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let (old, new) = (png_of_limit(8, 8), png_of_limit(16, 16));
    git(project.path(), &["init", "-q", "-b", "main"]);
    std::fs::write(project.path().join("a.png"), &old).unwrap();
    git(project.path(), &["add", "-A"]);
    git(project.path(), &["commit", "-q", "-m", "seed"]);
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |command| {
            command.env("ROUNDUP_DATA_DIR", data.path()).env(
                "ROUNDUP_CLAUDE_BIN",
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"),
            );
            command
                .env("CLAUDE_CONFIG_DIR", data.path().join("config"))
                .env(
                    "ROUNDUP_RUP_BIN",
                    Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup"),
                );
        },
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(async {
        let user = Client::connect(&daemon.socket).await.unwrap();
        user.request("project.setWorktrees", json!({"on": true, "check": null}))
            .await
            .unwrap();
        let node = user
            .request("agent.spawn", json!({"cwd": project.path()}))
            .await
            .unwrap();
        let path = node["worktree"]["path"].as_str().expect("a Worktree");
        std::fs::write(Path::new(path).join("a.png"), &new).unwrap();
        user.request(
            "agent.compareFile",
            json!({"id": node["id"], "path": "a.png"}),
        )
        .await
        .unwrap()
    });
    for (side, bytes) in [("old", &old), ("new", &new)] {
        assert_eq!(result[side]["kind"], "image");
        assert_eq!(result[side]["size"], LIMIT);
        assert!(
            result[side]["revision"]
                .as_str()
                .unwrap()
                .starts_with("sha256:")
        );
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(result[side]["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(&decoded, bytes);
    }
}
