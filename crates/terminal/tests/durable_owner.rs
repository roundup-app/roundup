//! X8's real ownership observer crosses client process boundaries.
use contracts::terminal::SpawnParams;
use std::collections::BTreeMap;
use std::process::{Command, Stdio};
use terminal::TerminalOwner;

#[test]
fn x8_reconnecting_keeps_the_original_program() {
    let dir = tempfile::tempdir().unwrap();
    let params = SpawnParams {
        cwd: dir.path().to_string_lossy().into_owned(),
        command: Some(vec!["/bin/sh".into(), "-c".into(),
            "echo launch >> launches; echo $$ > original; trap 'exit' HUP; while read line; do stty size; printf 'reply:%s\\n' \"$line\"; done".into()]),
        env: BTreeMap::new(), cols: 80, rows: 24,
    };
    let (owner, mut helper) = TerminalOwner::start(
        std::path::Path::new(env!("CARGO_BIN_EXE_terminal-owner")),
        dir.path(),
        params,
    )
    .unwrap();
    let record = dir.path().join("record");
    std::fs::write(&record, serde_json::to_vec(&owner).unwrap()).unwrap();
    for stage in ["first", "second"] {
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "x8_client", "--nocapture"])
            .env("OWNER_RECORD", &record)
            .env("OWNER_STAGE", stage)
            .stdin(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
    }
    assert!(helper.wait().unwrap().success());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("launches")).unwrap(),
        "launch\n"
    );
}

#[test]
fn x8_client() {
    let Some(record) = std::env::var_os("OWNER_RECORD") else {
        return;
    };
    let owner: TerminalOwner = serde_json::from_slice(&std::fs::read(&record).unwrap()).unwrap();
    let project = std::path::Path::new(&record).parent().unwrap();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let mut connection = owner.connect(project).await.unwrap();
        let first = std::env::var("OWNER_STAGE").unwrap() == "first";
        connection.resize(100, 30).await.unwrap();
        connection.write(b"ping\n").await.unwrap();
        let observed = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let text = connection.read().await.unwrap();
                if text.contains("reply:ping") {
                    break text;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(observed.contains("30 100"), "{observed}");
        let pid = std::fs::read_to_string(project.join("original")).unwrap();
        if first {
            std::fs::write(project.join("observed-pid"), pid).unwrap();
        } else {
            assert_eq!(
                pid,
                std::fs::read_to_string(project.join("observed-pid")).unwrap()
            );
            connection.kill().await.unwrap();
        }
    });
}
