use super::*;

#[tokio::test]
async fn a2693a_missing_data_does_not_stop_the_target() {
    let f = Fixture::running("sleep 30");
    let node = f.spawn(None, None).await.unwrap();
    let err = f
        .call("agent.resume", json!({"id": node.id, "mode": "yolo"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    let terminal = f
        .terminals
        .list()
        .await
        .into_iter()
        .find(|t| Some(&t.id) == node.terminal_id.as_ref())
        .unwrap();
    assert!(terminal.running);
}

#[tokio::test]
async fn a2693a_yolo_argv_and_node_agree_after_ack() {
    let f = Arc::new(Fixture::running("echo \"$@\" > argv.txt; sleep 30"));
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let resuming = {
        let f = Arc::clone(&f);
        let id = node.id.clone();
        tokio::spawn(async move {
            f.call("agent.resume", json!({"id": id, "mode": "yolo"}))
                .await
        })
    };
    let pending = f
        .until_attempt_changed(&node.id, node.attempt.as_deref().unwrap())
        .await;
    assert!(!pending.iter().find(|n| n.id == node.id).unwrap().yolo);
    f.session_start(&node.id, CONVERSATION, "resume")
        .await
        .unwrap();
    let resumed = resuming.await.unwrap().unwrap();
    assert_eq!(resumed["yolo"], true);
    let argv = until_resumed(&f).await;
    assert!(argv.contains(&format!("--resume {CONVERSATION}")));
    assert!(argv.contains("--dangerously-skip-permissions"));
    let tree = f.call("rail.tree", Value::Null).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == node.id)
            .unwrap()["yolo"],
        true
    );
}

#[tokio::test]
async fn a2693a_running_and_exited_targets_continue_once_in_each_mode() {
    for door in [false, true] {
        for running in [false, true] {
            for mode in ["normal", "yolo"] {
                let f = Arc::new(Fixture::running(
                    r#"here=$(dirname "$0"); if [ -f "$here/live.pid" ] && kill -0 "$(cat "$here/live.pid")" 2>/dev/null; then echo overlap > "$here/overlap"; fi; echo $$ > "$here/live.pid"; echo "$@" > "$here/argv.txt"; pwd > "$here/cwd.txt"; sleep 30"#,
                ));
                let node = if door {
                    let id = f.workstream("work", None).await;
                    serde_json::from_value(
                        f.call("rail.startDoor", json!({"id": id})).await.unwrap(),
                    )
                    .unwrap()
                } else {
                    f.spawn(None, None).await.unwrap()
                };
                crate::common::until_file(&f.dir.path().join("argv.txt")).await;
                let original_cwd = crate::common::until_file(&f.dir.path().join("cwd.txt")).await;
                f.session_start(&node.id, CONVERSATION, "startup")
                    .await
                    .unwrap();
                if !running {
                    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
                }
                let resumed = resume_in_mode(&f, &node, Some(mode)).await;
                assert_eq!(resumed.id, node.id);
                assert_eq!(resumed.name, node.name);
                assert_eq!(resumed.parent, node.parent);
                assert_eq!(resumed.order, node.order);
                assert_eq!(resumed.worktree, node.worktree);
                assert_ne!(resumed.terminal_id, node.terminal_id);
                let terminals = f.terminals.list().await;
                assert_eq!(terminals.len(), 2, "exactly one next launch");
                assert_eq!(terminals.iter().filter(|t| t.running).count(), 1);
                assert!(
                    !terminals
                        .iter()
                        .find(|t| Some(&t.id) == node.terminal_id.as_ref())
                        .unwrap()
                        .running
                );
                let argv = until_resumed(&f).await;
                assert!(argv.contains(&format!("--resume {CONVERSATION}")));
                assert!(
                    !f.dir.path().join("overlap").exists(),
                    "new launch preceded old exit"
                );
                assert_eq!(
                    std::fs::read_to_string(f.dir.path().join("cwd.txt")).unwrap(),
                    original_cwd
                );
            }
        }
    }
}

#[tokio::test]
async fn a2693a_every_normal_launch_clears_yolo() {
    for mode in [None, Some("normal"), Some("door")] {
        let f = Arc::new(Fixture::running(
            "echo \"$@\" > \"$(dirname \"$0\")/argv.txt\"; sleep 30",
        ));
        let node = if mode == Some("door") {
            exited_door(&f).await
        } else {
            exited_with_conversation(&f, CONVERSATION).await
        };
        let yolo = resume_in_mode(&f, &node, Some("yolo")).await;
        until_resumed(&f).await;
        f.call("agent.stop", json!({"id":node.id})).await.unwrap();
        std::fs::remove_file(f.dir.path().join("argv.txt")).unwrap();
        let normal = if mode == Some("door") {
            let starting = {
                let f = Arc::clone(&f);
                let id = node.id.clone();
                tokio::spawn(async move { start_door(&f, &id).await })
            };
            f.until_attempt_changed(&node.id, yolo.attempt.as_deref().unwrap())
                .await;
            f.session_start(&node.id, CONVERSATION, "resume")
                .await
                .unwrap();
            starting.await.unwrap().unwrap()
        } else {
            resume_in_mode(&f, &yolo, mode).await
        };
        assert!(!normal.yolo);
        assert!(
            !until_resumed(&f)
                .await
                .contains("--dangerously-skip-permissions")
        );
    }
}

#[tokio::test]
async fn a2693a_concurrent_actions_never_launch_twice() {
    let f = Arc::new(Fixture::running("sleep 30"));
    let node = f.spawn(None, None).await.unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    let pending = {
        let f = Arc::clone(&f);
        let id = node.id.clone();
        tokio::spawn(async move { f.call("agent.resume", json!({"id":id,"mode":"yolo"})).await })
    };
    f.until_attempt_changed(&node.id, node.attempt.as_deref().unwrap())
        .await;
    for method in ["agent.resume", "agent.stop", "rail.remove"] {
        let err = f
            .call(method, json!({"id":node.id,"mode":"normal"}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::CONFLICT, "{method}");
    }
    f.session_start(&node.id, CONVERSATION, "resume")
        .await
        .unwrap();
    pending.await.unwrap().unwrap();
    assert_eq!(
        f.terminals
            .list()
            .await
            .iter()
            .filter(|t| t.running)
            .count(),
        1
    );
}

#[tokio::test]
async fn a2693a_exit_keeps_and_reopen_clears_the_attempt_mode() {
    let f = Arc::new(Fixture::running("sleep 30"));
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let yolo = resume_in_mode(&f, &node, Some("yolo")).await;
    f.call("agent.stop", json!({"id":yolo.id})).await.unwrap();
    assert!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .yolo
    );
    let f = Arc::try_unwrap(f).ok().unwrap().reopen();
    assert!(
        !f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .yolo
    );
}

#[tokio::test]
async fn a2693a_failed_start_does_not_publish_the_requested_mode() {
    let f = Arc::new(Fixture::running("sleep 30"));
    let node = exited_with_conversation(&f, CONVERSATION).await;
    std::fs::remove_file(f.dir.path().join("fake-claude")).unwrap();
    let err = f
        .call("agent.resume", json!({"id":node.id,"mode":"yolo"}))
        .await
        .unwrap_err();
    assert!(!err.message.is_empty());
    let after = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
        .unwrap();
    assert!(!after.yolo);
    assert_eq!(after.terminal_id, node.terminal_id);
}

#[tokio::test]
async fn b2693b_note_mode_matches_the_receiver_attempt() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixListener;
    let f = Arc::new(Fixture::running("echo \"$@\" > argv.txt; sleep 30"));
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let yolo = resume_in_mode(&f, &node, Some("yolo")).await;
    let argv = until_resumed(&f).await;
    let socket = argv
        .split_whitespace()
        .skip_while(|word| *word != "--messaging-socket-path")
        .nth(1)
        .unwrap();
    let mut listener = UnixListener::bind(socket).unwrap();
    let sessions = f.dir.path().join("sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    let pid = std::process::id();
    std::fs::write(
        sessions.join(format!("{pid}.json")),
        json!({"pid":pid,"messagingSocketPath":socket,"peerProtocol":1}).to_string(),
    )
    .unwrap();
    std::fs::write(
        sessions.join(format!("{pid}.test.key")),
        json!({"peerToken":"test-token"}).to_string(),
    )
    .unwrap();
    for (sender, expected) in [
        ("normal sender", "bypassPermissions"),
        ("YOLO sender", "default"),
    ] {
        if expected == "default" {
            resume_in_mode(&f, &yolo, Some("normal")).await;
            drop(listener);
            listener = UnixListener::bind(socket).unwrap();
        }
        f.agents
            .inbox_write(
                &node.id,
                &[agents::claude_code::inbox::Entry {
                    id: 1,
                    kind: contracts::message::MessageKind::Note,
                    from: sender.into(),
                    text: "note".into(),
                    one_line: false,
                }],
            )
            .unwrap();
        let (stream, _) = listener.accept().unwrap();
        let lines: Vec<Value> = BufReader::new(stream)
            .lines()
            .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
            .collect();
        assert!(
            lines[1]["message"]["content"]
                .as_str()
                .unwrap()
                .contains(&format!("from-mode=\"{expected}\""))
        );
    }
}

#[tokio::test]
async fn a2693a_failed_resume_keeps_the_old_node() {
    let mut f = Fixture::running("echo old snapshot; sleep 30");
    f.agents = f.agents.with_resume_effect(|phase, _| {
        if phase == "claimed" {
            Err(rpc::RpcError::conflict("resume rejected"))
        } else {
            Ok(())
        }
    });
    let node = f.spawn(None, None).await.unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while f
            .terminals
            .snapshot(node.terminal_id.as_deref().unwrap())
            .unwrap()
            .after
            == 0
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut exit = f
        .terminals
        .subscribe(node.terminal_id.as_deref().unwrap())
        .unwrap();
    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !matches!(
            exit.recv().await.unwrap().as_ref(),
            contracts::EventData::TerminalExited(_)
        ) {}
    })
    .await
    .unwrap();
    let old_node = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
        .unwrap();
    let before = f
        .terminals
        .snapshot(node.terminal_id.as_deref().unwrap())
        .unwrap();
    let err = f
        .call("agent.resume", json!({"id":node.id,"mode":"yolo"}))
        .await
        .unwrap_err();
    assert!(err.message.contains("resume rejected"));
    let after = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
        .unwrap();
    assert_eq!(after.terminal_id, old_node.terminal_id);
    assert_eq!(after.name, node.name);
    assert!(!after.yolo);
    assert!(f.terminals.list().await.iter().all(|t| !t.running));
    assert_eq!(
        f.terminals
            .snapshot(node.terminal_id.as_deref().unwrap())
            .unwrap()
            .data,
        before.data
    );
}

#[tokio::test]
async fn a2693a_cleanup_stop_keeps_the_last_acknowledged_mode() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let fail = Arc::new(AtomicBool::new(false));
    let mut f = Fixture::running("sleep 30");
    f.agents = f.agents.with_resume_effect({
        let fail = Arc::clone(&fail);
        move |phase, _| {
            if fail.load(Ordering::SeqCst) && matches!(phase, "claimed" | "cleanup") {
                Err(rpc::RpcError::conflict("injected resume/cleanup failure"))
            } else {
                Ok(())
            }
        }
    });
    let f = Arc::new(f);
    let node = exited_with_conversation(&f, CONVERSATION).await;
    resume_in_mode(&f, &node, Some("yolo")).await;
    fail.store(true, Ordering::SeqCst);
    let err = f
        .call("agent.resume", json!({"id":node.id,"mode":"normal"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::UNKNOWN_OUTCOME);
    assert!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .yolo
    );
    fail.store(false, Ordering::SeqCst);
    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
    assert!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .yolo
    );
}
