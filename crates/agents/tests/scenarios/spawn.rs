//! A4 spawn, and A2, A3, A8 as seen through a real Terminal running a fake `claude`.

use contracts::Kind;
use contracts::agent::NodeKind;
use rpc::code;
use serde_json::{Value, json};

use crate::common::{Fixture, status_of, until_file};

#[tokio::test]
async fn a4_spawn_runs_claude_with_the_agents_settings_and_lists_an_agent() {
    let mut f = Fixture::running("echo \"$@\" > \"$(dirname \"$0\")/argv\"; sleep 30");
    f.changed();
    let node = f.spawn(None, None).await.unwrap();

    assert_eq!(node.kind, NodeKind::Agent);
    assert!(node.terminal_id.is_some());
    assert_eq!(node.status.as_ref().map(|s| s.kind), Some(Kind::Working));
    assert_eq!(f.tree().await, std::slice::from_ref(&node));
    assert_eq!(f.changed(), 1);

    let argv = until_file(&f.dir.path().join("argv")).await;
    let settings = argv
        .trim()
        .strip_prefix("--settings ")
        .and_then(|rest| rest.split(' ').next())
        .expect("--settings first");
    let settings: Value =
        serde_json::from_str(&std::fs::read_to_string(settings).unwrap()).unwrap();
    assert_eq!(
        shlex::split(
            settings["hooks"]["Stop"][0]["hooks"][0]["command"]
                .as_str()
                .unwrap()
        )
        .unwrap(),
        [
            "ROUNDUP_ATTEMPT=1",
            f.dir.path().join("rup").to_str().unwrap(),
            "signal",
            &node.id,
        ]
    );
    let trusted = f.dir.path().canonicalize().unwrap();
    let config: Value =
        serde_json::from_str(&std::fs::read_to_string(f.dir.path().join("claude.json")).unwrap())
            .unwrap();
    assert_eq!(
        config["projects"][trusted.to_str().unwrap()]["hasTrustDialogAccepted"],
        true
    );
}

#[tokio::test]
async fn a4_spawn_nests_under_a_workstream_and_never_under_an_agent() {
    let f = Fixture::running("sleep 30");
    let workstream = f.workstream("team", None).await;
    let child = f.spawn(Some(&workstream), None).await.unwrap();
    assert_eq!(child.parent.as_deref(), Some(workstream.as_str()));

    let err = f.spawn(Some(&child.id), None).await.unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(f.tree().await.len(), 2);
}

#[tokio::test]
async fn a4_a_cwd_outside_the_project_folder_is_refused_and_leaves_nothing() {
    let f = Fixture::running("sleep 30");
    let err = f
        .call(
            "agent.spawn",
            json!({"cwd": "/usr", "prompt": null, "parent": null}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(f.tree().await.is_empty());
    assert!(!f.dir.path().join("claude.json").exists());
}

#[tokio::test]
async fn a4_a_spawn_that_cannot_start_leaves_no_agent_behind() {
    let f = Fixture::running("sleep 30");
    let err = f
        .call(
            "agent.spawn",
            json!({"cwd": "/no/such/dir", "prompt": null, "parent": null}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn a3_a_clean_exit_makes_the_agent_done() {
    let f = Fixture::running("exit 0");
    let node = f.spawn(None, None).await.unwrap();
    let tree = f
        .until(|t| status_of(t, &node.id).kind != Kind::Working)
        .await;
    assert_eq!(status_of(&tree, &node.id).kind, Kind::Done);
}

#[tokio::test]
async fn a3_a_non_zero_exit_makes_the_agent_an_error() {
    let f = Fixture::running("exit 3");
    let node = f.spawn(None, None).await.unwrap();
    let tree = f
        .until(|t| status_of(t, &node.id).kind != Kind::Working)
        .await;
    let status = status_of(&tree, &node.id);
    assert_eq!(
        (status.kind, status.label.as_str()),
        (Kind::Error, "exited 3")
    );
}

#[tokio::test]
async fn a2_a_star_title_from_the_terminal_ends_working() {
    let f = Fixture::running("printf '\\033]0;\\342\\234\\263 Claude Code\\007'; sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    let tree = f
        .until(|t| status_of(t, &node.id).kind != Kind::Working)
        .await;
    assert_eq!(status_of(&tree, &node.id).kind, Kind::Idle);
}

#[tokio::test]
async fn a8_an_agent_whose_terminal_is_gone_comes_back_done() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    let tree = f.reopen().tree().await;
    assert_eq!(tree[0].id, node.id);
    assert_eq!(tree[0].status.as_ref().map(|s| s.kind), Some(Kind::Done));
    assert_eq!(tree[0].terminal_id, None);
}

#[tokio::test]
async fn a4_a_missing_claude_leaves_no_agent_and_no_settings_file() {
    let f = Fixture::running("sleep 30");
    std::fs::remove_file(f.dir.path().join("fake-claude")).unwrap();
    f.spawn(None, None).await.unwrap_err();
    assert!(f.tree().await.is_empty());
    let left: Vec<_> = std::fs::read_dir(f.dir.path().join("agents"))
        .map(|entries| entries.map(|e| e.unwrap().file_name()).collect())
        .unwrap_or_default();
    assert!(left.is_empty(), "left behind: {left:?}");
}

/// Reads the kernel's PTY size before either draw; no vendor protocol or typed input.
const SIZE_PROGRAM: &str = r#"exec python3 -c '
import os, signal

def draw(marker):
    size = os.get_terminal_size(0)
    print("\033[2J\033[H" + marker + " %d %d pid=%d" % (size.columns, size.lines, os.getpid()), flush=True)

signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGWINCH})
draw("first")
while True:
    signal.sigwait({signal.SIGWINCH})
    draw("later")
'"#;

async fn size_report(f: &Fixture, id: &str, marker: &str) -> String {
    let mut output = f.terminals.subscribe_output(id).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let screen = f.terminals.read_screen(id, None).unwrap();
            let text = screen.lines.join("\n");
            if text.contains(marker) {
                return text;
            }
            assert!(
                output.next().await.is_some(),
                "program closed its PTY: {:?}",
                f.terminals.read_screen(id, None).unwrap().lines
            );
        }
    })
    .await
    .expect("program reports its actual PTY size")
}

#[tokio::test]
async fn u4590_agent_and_door_start_at_supplied_size_before_the_first_draw() {
    for method in ["agent.spawn", "rail.startDoor"] {
        let f = Fixture::running(SIZE_PROGRAM);
        let params = if method == "agent.spawn" {
            json!({"cwd": f.dir.path(), "cols": 113, "rows": 37})
        } else {
            let id = f.workstream("sized", None).await;
            json!({"id": id, "cols": 113, "rows": 37})
        };
        let node = f.call(method, params).await.unwrap();
        let id = node["terminal_id"].as_str().unwrap();
        let original = f.terminals.list().await;
        let first = size_report(&f, id, "first").await;
        assert!(first.contains("first 113 37"), "{method}: {first}");
        let pid = first.split("pid=").nth(1).unwrap().trim();
        f.terminals.resize(id, 97, 31).await.unwrap();
        assert!(
            size_report(&f, id, "later")
                .await
                .contains(&format!("later 97 31 pid={pid}")),
            "{method}"
        );
        assert_eq!(
            f.terminals.list().await[0].incarnation,
            original[0].incarnation
        );
        assert_eq!(f.terminals.list().await.len(), 1);
    }
}

#[tokio::test]
async fn u4590_invalid_launch_size_leaves_no_agent_or_terminal() {
    for method in [
        "agent.spawn",
        "rail.startDoor",
        "terminal.open",
        "agent.run",
    ] {
        let f = Fixture::running(SIZE_PROGRAM);
        let mut params = match method {
            "agent.spawn" => json!({"cwd": f.dir.path()}),
            "rail.startDoor" => json!({"id": f.workstream("sized", None).await}),
            "agent.run" => {
                json!({"id": f.spawn(None, None).await.unwrap().id, "command": ["/bin/sh", "-c", SIZE_PROGRAM]})
            }
            _ => json!({}),
        };
        let before = f.tree().await;
        let terminals = f.terminals.list().await.len();
        for (cols, rows) in [(0, 37), (113, 0), (-1, 37), (113, 65_536)] {
            params["cols"] = json!(cols);
            params["rows"] = json!(rows);
            assert_eq!(
                f.call(method, params.clone()).await.unwrap_err().code,
                rpc::code::INVALID_PARAMS,
                "{method}: {cols}x{rows}"
            );
            assert_eq!(f.tree().await, before);
            assert_eq!(f.terminals.list().await.len(), terminals);
        }
    }
}
