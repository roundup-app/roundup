//! X8's real ownership observer crosses client process boundaries.
use contracts::terminal::SpawnParams;
use serde_json::json;
use std::collections::BTreeMap;
use std::process::{Command, Stdio};
use terminal::{TerminalOwner, Terminals};

#[test]
fn x8_reconnecting_keeps_the_original_program() {
    let dir = tempfile::tempdir().unwrap();
    let params = SpawnParams {
        cwd: dir.path().to_string_lossy().into_owned(),
        command: Some(vec!["/bin/sh".into(), "-c".into(),
            "echo launch >> launches; sleep 60 & child=$!; echo \"$$ $child\" > original; trap 'wait \"$child\"; exit' HUP; while read line; do stty size; printf 'reply:%s:%s\\n' \"$line\" \"$$\"; done".into()]),
        env: BTreeMap::new(), cols: 80, rows: 24,
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let (records, _owned) = runtime.block_on(async {
        let terminals = Terminals::open(dir.path(), rpc::Bus::new())
            .unwrap()
            .with_terminal_owner(std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")));
        assert!(terminals.list().await.is_empty());
        assert!(terminals.terminal_owners().is_empty());
        let first = terminals.spawn(params.clone()).await.unwrap();
        let mut cleanup = vec![Owned {
            owner: terminals.terminal_owners()[0].clone(),
            child: None,
        }];
        let second_dir = dir.path().join("second");
        std::fs::create_dir(&second_dir).unwrap();
        let mut second_params = params;
        second_params.cwd = second_dir.to_string_lossy().into_owned();
        let second = terminals.spawn(second_params).await.unwrap();
        cleanup.push(Owned {
            owner: terminals.terminal_owners()[1].clone(),
            child: None,
        });
        assert_ne!(first.id, second.id);
        let owners = terminals.terminal_owners();
        assert_eq!(owners[0].info.id, owners[1].info.id);
        (owners, cleanup)
    });
    let record = dir.path().join("record");
    std::fs::write(&record, serde_json::to_vec(&records).unwrap()).unwrap();
    for stage in ["first", "second"] {
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "x8_client", "--ignored", "--nocapture"])
            .env("OWNER_RECORD", &record)
            .env("OWNER_STAGE", stage)
            .stdin(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
    }
    for folder in [dir.path().to_owned(), dir.path().join("second")] {
        let pids = std::fs::read_to_string(folder.join("original")).unwrap();
        for pid in pids
            .split_whitespace()
            .map(|pid| pid.parse::<i32>().unwrap())
        {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            while nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_ok() {
                assert!(
                    std::time::Instant::now() < deadline,
                    "owned PID {pid} survived kill"
                );
                std::thread::yield_now();
            }
        }
        assert_eq!(
            std::fs::read_to_string(folder.join("launches")).unwrap(),
            "launch\n"
        );
    }
}

#[test]
#[ignore = "invoked in fresh client processes by the ownership observer"]
fn x8_client() {
    let record = std::env::var_os("OWNER_RECORD").expect("observer record");
    let owners: Vec<TerminalOwner> =
        serde_json::from_slice(&std::fs::read(&record).unwrap()).unwrap();
    let project = std::path::Path::new(&record).parent().unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let terminals = Terminals::open(project, rpc::Bus::new()).unwrap();
        let first = std::env::var("OWNER_STAGE").unwrap() == "first";
        let mut attached = Vec::new();
        for owner in &owners { attached.push(terminals.attach_owner(project, owner).await.unwrap()); }
        assert_ne!(attached[0].id, attached[1].id);
        for (index, (owner, spawned)) in owners.iter().zip(attached.iter_mut()).enumerate() {
            let id = &spawned.id;
            let folder = if index == 0 { project.to_owned() } else { project.join("second") };
            let marker = format!("{}-{index}", if first { "first" } else { "second" });
            let mut output = terminals.subscribe_output(id).unwrap();
            let mut events = terminals.subscribe(id).unwrap();
            terminals.resize(id, if first {90} else {100}, if first {25} else {30}).await.unwrap();
            let refused = terminals.write_with(id, |_| Err(rpc::RpcError::conflict("guard refused"))).await.unwrap_err();
            assert_eq!(refused.code, rpc::code::CONFLICT);
            terminals.write_completed(id, format!("{marker}\n").into_bytes()).await.unwrap();
            let observed = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    let reply = terminals.read(&contracts::terminal::ReadParams {
                        id: id.clone(), after: Some(0), reader: None, max: None,
                    }).unwrap();
                    if reply.text.contains(&format!("reply:{marker}:")) { break reply.text; }
                    tokio::task::yield_now().await;
                }
            }).await.unwrap();
            assert!(observed.contains(if first {"25 90"} else {"30 100"}), "{observed}");
            let frame = tokio::time::timeout(std::time::Duration::from_secs(3), output.next()).await.unwrap().unwrap();
            assert!(matches!(frame, terminal::Output::Bytes { .. }));
            assert!(terminals.snapshot(id).unwrap().after > 0);
            let info = terminals.list().await.into_iter().find(|info| &info.id == id).unwrap();
            assert_eq!(info.incarnation, owner.info.incarnation);
            assert_eq!(info.program, "sh");
            let pids = std::fs::read_to_string(folder.join("original")).unwrap();
            let pid: u32 = pids.split_whitespace().next().unwrap().parse().unwrap();
            assert_eq!(terminals.program_pid(id), Some(pid));
            assert!(observed.contains(&format!("reply:{marker}:{pid}")), "{observed}");
            let catch_up = terminals.catch_up(&contracts::terminal::CatchUpParams { id: id.clone(), incarnation: info.incarnation.clone(), after: 0 }).unwrap();
            assert!(matches!(catch_up, contracts::terminal::CatchUp::Contiguous { id: ref caught, incarnation: ref inc, .. } if caught == id && inc == &info.incarnation));
            // The other owner's output never contains this Terminal's chosen input.
            let other = terminals.read(&contracts::terminal::ReadParams {
                id: attached_id(index), after: Some(0), reader: None, max: None,
            }).unwrap();
            assert!(!other.text.contains(&marker));
            if first { std::fs::write(folder.join("observed-pid"), &pids).unwrap(); }
            else {
                assert_eq!(pids, std::fs::read_to_string(folder.join("observed-pid")).unwrap());
                terminals.kill(id).await.unwrap();
                if index == 0 { assert!(terminals.list().await.iter().any(|info| info.id == "2" && info.running)); }
                let exited = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                    loop { let event = events.recv().await.unwrap(); if matches!(&*event, contracts::EventData::TerminalExited(event) if &event.id == id) { break; } }
                }).await;
                assert!(exited.is_ok());
            }
        }
    });
}

fn attached_id(index: usize) -> String {
    if index == 0 { "2" } else { "1" }.into()
}

// Cleanup is independent of test success: stop through the verified owner, then reap the helper.
struct Owned {
    owner: TerminalOwner,
    child: Option<std::process::Child>,
}
impl Drop for Owned {
    fn drop(&mut self) {
        {
            let child = self.child.take();
            let owner = self.owner.clone();
            std::thread::spawn(move || {
                tokio::runtime::Runtime::new().unwrap().block_on(async {
                    let value = serde_json::to_value(&owner).unwrap();
                    let project = std::path::Path::new(value["project"].as_str().unwrap());
                    if let Ok(client) = owner.connect(project).await {
                        let _ = client
                            .request("terminal.kill", json!({"id":owner.info.id}))
                            .await;
                    }
                });
                if let Some(mut child) = child {
                    child.wait().unwrap();
                }
            })
            .join()
            .unwrap();
        }
    }
}

#[tokio::test]
async fn x8_attachment_never_creates_or_substitutes_a_program() {
    let dir = tempfile::tempdir().unwrap();
    let start = || {
        let (owner, child) = TerminalOwner::start(
            std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")),
            dir.path(),
            SpawnParams {
                cwd: dir.path().to_string_lossy().into_owned(),
                command: Some(vec![
                    "/bin/sh".into(),
                    "-c".into(),
                    "echo launch >> launches; read line; exit".into(),
                ]),
                env: BTreeMap::new(),
                cols: 80,
                rows: 24,
            },
        )
        .unwrap();
        Owned {
            owner,
            child: Some(child),
        }
    };
    let original = start();
    let replacement = start();
    let client = original.owner.connect(dir.path()).await.unwrap();
    let wrong_project = tempfile::tempdir().unwrap();
    let terminals = Terminals::open(dir.path(), rpc::Bus::new()).unwrap();
    assert!(
        terminals
            .attach_owner(wrong_project.path(), &original.owner)
            .await
            .is_err()
    );
    let original_record = serde_json::to_value(&original.owner).unwrap();
    let replacement_record = serde_json::to_value(&replacement.owner).unwrap();
    for (key, value) in [
        ("info", {
            let mut info = original_record["info"].clone();
            info["id"] = json!("2");
            info
        }),
        ("info", {
            let mut info = original_record["info"].clone();
            info["incarnation"] = json!("wrong");
            info
        }),
        ("socket", replacement_record["socket"].clone()),
        ("socket", json!(dir.path().join("missing/owner.sock"))),
    ] {
        let mut record = original_record.clone();
        record[key] = value;
        let wrong: TerminalOwner = serde_json::from_value(record).unwrap();
        assert!(terminals.attach_owner(dir.path(), &wrong).await.is_err());
    }
    assert!(
        client
            .request(
                "terminal.spawn",
                json!({"command":["/bin/sh","-c","echo BAD >> launches"]})
            )
            .await
            .is_err()
    );
    // The initial lookup is live, but the program exits before the next attachment.
    client
        .request(
            "terminal.write",
            json!({"id":original.owner.info.id,"data":"ZXhpdAo="}),
        )
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let infos = client.request("terminal.list", json!({})).await.unwrap();
            if infos[0]["running"] == false {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        terminals
            .attach_owner(dir.path(), &original.owner)
            .await
            .is_err()
    );
    assert!(client.request("terminal.spawn", json!({})).await.is_err());
    let other = replacement.owner.connect(dir.path()).await.unwrap();
    let screen = other
        .request(
            "terminal.read",
            json!({"id":replacement.owner.info.id,"after":0}),
        )
        .await
        .unwrap();
    assert_eq!(screen["text"], "");
    // Await the replacement's readiness through its input/output instead of a launch-file poll.
    other
        .request(
            "terminal.write",
            json!({"id":replacement.owner.info.id,"data":"ZXhpdAo="}),
        )
        .await
        .unwrap();
    drop(other);
    drop(client);
    drop(replacement);
    let stale = original.owner.clone();
    drop(original);
    assert!(terminals.attach_owner(dir.path(), &stale).await.is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("launches")).unwrap(),
        "launch\nlaunch\n"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn x8_owned_input_keeps_guards_cancellation_and_queue_order() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = std::sync::Arc::new(
        Terminals::open(dir.path(), rpc::Bus::new())
            .unwrap()
            .with_terminal_owner(std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner"))),
    );
    let spawned = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec![
                "/bin/sh".into(),
                "-c".into(),
                "stty -echo; while read line; do printf 'got:%s\\n' \"$line\"; done".into(),
            ]),
            env: BTreeMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();
    let _cleanup = Owned {
        owner: terminals.terminal_owners()[0].clone(),
        child: None,
    };
    let (entered, ready) = tokio::sync::oneshot::channel();
    let (release, hold) = std::sync::mpsc::sync_channel(1);
    let first = {
        let terminals = terminals.clone();
        let id = spawned.id.clone();
        tokio::spawn(async move {
            terminals
                .write_with(&id, move |writer| {
                    let _ = entered.send(());
                    hold.recv().unwrap();
                    writer
                        .write_all(b"A\n")
                        .and_then(|()| writer.flush())
                        .map_err(rpc::RpcError::internal)
                })
                .await
        })
    };
    ready.await.unwrap();
    {
        let cancelled = terminals.write_with(&spawned.id, |writer| {
            writer.write_all(b"BAD\n").map_err(rpc::RpcError::internal)
        });
        tokio::pin!(cancelled);
        // Poll once to enqueue, then drop while the earlier effect still holds the input thread.
        std::future::poll_fn(|cx| {
            assert!(std::future::Future::poll(cancelled.as_mut(), cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
    }
    terminals.write(&spawned.id, b"B\n").await.unwrap();
    release.send(()).unwrap();
    first.await.unwrap().unwrap();
    terminals
        .write_completed(&spawned.id, b"C\n".to_vec())
        .await
        .unwrap();
    let text = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let read = terminals
                .read(&contracts::terminal::ReadParams {
                    id: spawned.id.clone(),
                    after: Some(0),
                    reader: None,
                    max: None,
                })
                .unwrap();
            if read.text.contains("got:C") {
                break read.text;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(text.contains("got:A\ngot:B\ngot:C"), "{text}");
    assert!(!text.contains("BAD"), "{text}");
    terminals.kill(&spawned.id).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn x8_lost_physical_write_result_is_unknown_and_kill_remains_available() {
    let dir = tempfile::tempdir().unwrap();
    let terminals = std::sync::Arc::new(
        Terminals::open(dir.path(), rpc::Bus::new())
            .unwrap()
            .with_terminal_owner(std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner"))),
    );
    let mut spawned = terminals
        .spawn(SpawnParams {
            cwd: dir.path().to_string_lossy().into_owned(),
            command: Some(vec![
                "/bin/sh".into(),
                "-c".into(),
                "stty raw -echo; printf ready; exec sleep 60".into(),
            ]),
            env: BTreeMap::new(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();
    let _cleanup = Owned {
        owner: terminals.terminal_owners()[0].clone(),
        child: None,
    };
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while let Some(item) = spawned.output.next().await {
            if matches!(item, terminal::Output::Bytes { .. }) {
                break;
            }
        }
    })
    .await
    .unwrap();
    let (entered, ready) = tokio::sync::oneshot::channel();
    let write = {
        let terminals = terminals.clone();
        let id = spawned.id.clone();
        tokio::spawn(async move {
            terminals
                .write_with(&id, move |writer| {
                    writer.write_all(b"x").map_err(rpc::RpcError::internal)?;
                    let _ = entered.send(());
                    writer
                        .write_all(&vec![b'x'; 1_048_576])
                        .and_then(|()| writer.flush())
                        .map_err(|error| rpc::RpcError::unknown_outcome(error.to_string()))
                })
                .await
        })
    };
    ready.await.unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        terminals.kill(&spawned.id),
    )
    .await
    .unwrap()
    .unwrap();
    let error = tokio::time::timeout(std::time::Duration::from_secs(3), write)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert_eq!(error.code, rpc::code::UNKNOWN_OUTCOME);
}

#[tokio::test]
async fn x19_an_owner_binds_under_a_project_path_longer_than_sun_path() {
    let base = tempfile::tempdir().unwrap();
    let mut project = base.path().to_owned();
    while project.as_os_str().len() <= 110 {
        project.push("nested-project-directory");
    }
    std::fs::create_dir_all(&project).unwrap();
    let terminals = Terminals::open(&project, rpc::Bus::new())
        .unwrap()
        .with_terminal_owner(std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")));
    let params = SpawnParams {
        cwd: project.to_string_lossy().into_owned(),
        command: Some(vec![
            "/bin/sh".into(),
            "-c".into(),
            "while read l; do echo got:$l; done".into(),
        ]),
        env: BTreeMap::new(),
        cols: 80,
        rows: 24,
    };
    let spawned = terminals.spawn(params).await.unwrap();
    let owner = terminals.terminal_owners()[0].clone();
    let record = serde_json::to_value(&owner).unwrap();
    let socket = record["socket"].as_str().unwrap().to_owned();
    assert!(socket.len() <= 100, "{socket}");
    let directory = std::path::PathBuf::from(record["directory"].as_str().unwrap());
    let other = tempfile::tempdir().unwrap();
    let client = Terminals::open(&project, rpc::Bus::new()).unwrap();
    assert!(client.attach_owner(other.path(), &owner).await.is_err());
    let attached = client.attach_owner(&project, &owner).await.unwrap();
    client
        .write_completed(&attached.id, b"hi\n".to_vec())
        .await
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let text = client
            .read(&contracts::terminal::ReadParams {
                id: attached.id.clone(),
                after: Some(0),
                reader: None,
                max: None,
            })
            .unwrap()
            .text;
        if text.contains("got:hi") {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "{text}");
        tokio::task::yield_now().await;
    }
    terminals.kill(&spawned.id).await.unwrap();
    drop(client);
    drop(terminals);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while directory.exists() || std::path::Path::new(&socket).exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "owner directories remain"
        );
        tokio::task::yield_now().await;
    }
}
