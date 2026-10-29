//! X8's real ownership observer crosses client process boundaries.
use base64::Engine;
use contracts::terminal::SpawnParams;
use serde_json::json;
use std::collections::BTreeMap;
use std::process::{Command, Stdio};
use terminal::TerminalOwner;

#[test]
fn x8_reconnecting_keeps_the_original_program() {
    let dir = tempfile::tempdir().unwrap();
    let params = SpawnParams {
        cwd: dir.path().to_string_lossy().into_owned(),
        command: Some(vec!["/bin/sh".into(), "-c".into(),
            "echo launch >> launches; sleep 60 & child=$!; echo \"$$ $child\" > original; trap 'wait \"$child\"; exit' HUP; while read line; do stty size; printf 'reply:%s:%s\\n' \"$line\" \"$$\"; done".into()]),
        env: BTreeMap::new(), cols: 80, rows: 24,
    };
    let (owner, helper) = TerminalOwner::start(
        std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")),
        dir.path(),
        params,
    )
    .unwrap();
    let mut owned = Owned {
        owner: owner.clone(),
        child: Some(helper),
    };
    let record = dir.path().join("record");
    std::fs::write(&record, serde_json::to_vec(&owner).unwrap()).unwrap();
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
    assert!(owned.child.as_mut().unwrap().wait().unwrap().success());
    owned.child.take();
    let pids = std::fs::read_to_string(dir.path().join("original")).unwrap();
    for pid in pids
        .split_whitespace()
        .map(|pid| pid.parse::<i32>().unwrap())
    {
        assert_eq!(
            nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None),
            Err(nix::errno::Errno::ESRCH)
        );
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("launches")).unwrap(),
        "launch\n"
    );
}

#[test]
#[ignore = "invoked in fresh client processes by the ownership observer"]
fn x8_client() {
    let record = std::env::var_os("OWNER_RECORD").expect("observer record");
    let owner: TerminalOwner = serde_json::from_slice(&std::fs::read(&record).unwrap()).unwrap();
    let project = std::path::Path::new(&record).parent().unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let mut connection = owner.connect(project).await.unwrap();
        let id = &owner.info.id;
        let first = std::env::var("OWNER_STAGE").unwrap() == "first";
        let mut output = connection.take_output().unwrap();
        connection.request("terminal.output", json!({"id":id})).await.unwrap();
        connection
            .request(
                "terminal.resize",
                serde_json::json!({"id":id,"cols":if first {90} else {100},"rows":if first {25} else {30}}),
            )
            .await
            .unwrap();
        connection
            .request(
                "terminal.write",
                serde_json::json!({"id":id,"data":base64::engine::general_purpose::STANDARD.encode(if first {&b"first\n"[..]} else {&b"second\n"[..]})}),
            )
            .await
            .unwrap();
        let observed = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let reply = connection
                    .request("terminal.read", serde_json::json!({"id":id,"after":0}))
                    .await
                    .unwrap();
                let text = reply["text"].as_str().unwrap().to_owned();
                if text.contains(if first {"reply:first:"} else {"reply:second:"}) {
                    break text;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(observed.contains(if first {"25 90"} else {"30 100"}), "{observed}");
        let frame = tokio::time::timeout(std::time::Duration::from_secs(3), output.recv()).await.unwrap().unwrap();
        assert!(matches!(frame, rpc::OutputFrame::Bytes(_)));
        let snapshot = connection.request("terminal.snapshot", json!({"id":id})).await.unwrap();
        assert!(snapshot["after"].as_u64().unwrap() > 0);
        let incarnation = connection.request("terminal.list", json!({})).await.unwrap();
        assert_eq!(incarnation[0]["incarnation"], owner.info.incarnation);

        let pid = std::fs::read_to_string(project.join("original")).unwrap();
        assert!(observed.contains(&format!("reply:{}:{}", if first {"first"} else {"second"}, pid.split_whitespace().next().unwrap())), "{observed}");
        let catch_up = connection.request("terminal.catchUp", json!({"id":id,"incarnation":owner.info.incarnation,"after":0})).await.unwrap();
        assert_eq!(catch_up["kind"], "contiguous");
        assert_eq!(catch_up["incarnation"], owner.info.incarnation);
        if first {
            std::fs::write(project.join("observed-pid"), pid).unwrap();
        } else {
            assert_eq!(
                pid,
                std::fs::read_to_string(project.join("observed-pid")).unwrap()
            );
            connection
                .request("terminal.kill", serde_json::json!({"id":id}))
                .await
                .unwrap();
        }
    });
}

// Cleanup is independent of test success: stop through the verified owner, then reap the helper.
struct Owned {
    owner: TerminalOwner,
    child: Option<std::process::Child>,
}
impl Drop for Owned {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
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
                child.wait().unwrap();
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
    assert!(original.owner.connect(wrong_project.path()).await.is_err());
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
        assert!(wrong.connect(dir.path()).await.is_err());
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
    assert!(original.owner.connect(dir.path()).await.is_err());
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
    assert!(stale.connect(dir.path()).await.is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("launches")).unwrap(),
        "launch\nlaunch\n"
    );
}
