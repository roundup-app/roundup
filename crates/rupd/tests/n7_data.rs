//! N7: real test launches own data and leave seeded App data untouched.
use std::path::{Path, PathBuf};
use std::process::Stdio;

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

#[path = "support/n7_data.rs"]
mod n7_data;
use n7_data::{assert_exited, isolated};

#[test]
fn n7_launch_sites_use_owned_data() {
    if isolated("n7_launch_sites_use_owned_data") {
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |command| {
            command.stderr(Stdio::null());
        },
    );
    let data = daemon.data.as_ref().unwrap().path().to_owned();
    assert!(data.is_absolute());
    assert!(!data.starts_with(project.path()));
    assert!(data.join("projects").is_dir());
    drop(daemon);
}

#[test]
fn n7_launch_sites_clean_on_success_and_failure() {
    if isolated("n7_launch_sites_clean_on_success_and_failure") {
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |_| {},
    );
    let data = daemon.data.as_ref().unwrap().path().to_owned();
    let pid = daemon.child.id();
    drop(daemon);
    assert_exited(pid);
    assert!(!data.exists());

    // An exec wrapper records the real Daemon's inherited data and PID before startup fails.
    use std::os::unix::fs::PermissionsExt;
    let wrapper = project.path().join("launch");
    std::fs::write(&wrapper, "#!/bin/sh\nprintf '%s\n%s\n' \"$ROUNDUP_DATA_DIR\" \"$$\" > \"$N7_RECORD\"\nexec \"$N7_RUPD\" \"$@\"\n").unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let record = project.path().join("record");
    let failure = std::panic::catch_unwind(|| {
        rupd_harness::start(&wrapper, project.path(), false, |command| {
            command
                .env("N7_RECORD", &record)
                .env("N7_RUPD", env!("CARGO_BIN_EXE_rupd"))
                .env("RUPD_SOCKET", project.path().join("launch/rupd.sock"));
        });
    });
    assert!(failure.is_err());
    let record = std::fs::read_to_string(record).unwrap();
    let mut lines = record.lines();
    let data = PathBuf::from(lines.next().unwrap());
    assert!(data.is_absolute());
    assert!(!data.exists());
    assert_exited(lines.next().unwrap().parse().unwrap());
}

#[test]
fn n7_caller_owned_data_survives_restart_and_failed_start() {
    if isolated("n7_caller_owned_data_survives_restart_and_failed_start") {
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let start = || {
        rupd_harness::start(
            Path::new(env!("CARGO_BIN_EXE_rupd")),
            project.path(),
            false,
            |command| {
                command.env("ROUNDUP_DATA_DIR", data.path());
            },
        )
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let daemon = start();
    let todo = runtime.block_on(async {
        let client = rpc::Client::connect(&daemon.socket).await.unwrap();
        client
            .request(
                "todo.create",
                serde_json::json!({"title":"kept across restart"}),
            )
            .await
            .unwrap()
    });
    drop(daemon);
    std::fs::write(data.path().join("keep"), b"caller-owned bytes").unwrap();
    let daemon = start();
    let reopened = runtime.block_on(async {
        let client = rpc::Client::connect(&daemon.socket).await.unwrap();
        client
            .request("todo.get", serde_json::json!({"id":todo["id"]}))
            .await
            .unwrap()
    });
    assert_eq!(reopened["title"], "kept across restart");
    drop(daemon);
    assert!(
        std::panic::catch_unwind(|| {
            rupd_harness::start(
                Path::new(env!("CARGO_BIN_EXE_rupd")),
                project.path(),
                false,
                |command| {
                    command
                        .env("ROUNDUP_DATA_DIR", data.path())
                        .env("RUPD_SOCKET", data.path().join("keep/rupd.sock"));
                },
            );
        })
        .is_err()
    );
    assert_eq!(
        std::fs::read(data.path().join("keep")).unwrap(),
        b"caller-owned bytes"
    );
}
