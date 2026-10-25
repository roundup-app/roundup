//! An isolated App owner and real Daemon; no desktop or existing data is touched.
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub(crate) fn snapshot(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn visit(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            out.insert(
                path.strip_prefix(root).unwrap().to_owned(),
                if path.is_dir() {
                    vec![]
                } else {
                    std::fs::read(&path).unwrap()
                },
            );
            if path.is_dir() {
                visit(root, &path, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    visit(root, root, &mut out);
    out
}

pub(crate) fn app(dir: &Path) -> PathBuf {
    let path = dir.join("app");
    // The standalone Daemon survives its owner unless cleanup explicitly stops it.
    let log = dir.join("launched");
    let seeded = dir.join("app-data");
    std::fs::create_dir_all(seeded.join("projects/project-existing")).unwrap();
    std::fs::write(
        seeded.join("projects/project-existing/db"),
        b"original bytes",
    )
    .unwrap();
    let daemon = dir.join("rupd");
    let bin = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("rupd");
    assert!(
        bin.is_file(),
        "build rupd before testing the isolated App fixture"
    );
    // A Workstream needs the real hook executable beside the fixture's Daemon.
    std::os::unix::fs::symlink(bin.with_file_name("rup"), dir.join("rup")).unwrap();
    std::fs::write(
        &daemon,
        format!(
            r#"#!/bin/sh
printf "%s\n%s\n" "$ROUNDUP_DATA_DIR" "$$" > "$N7_LAUNCH_LOG"
exec {} "$@"
"#,
            shlex::try_quote(bin.to_str().unwrap()).unwrap()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&daemon, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::write(
        &path,
        format!(
            r#"#!/bin/sh
# Emulate the App resolving its own folder and explicitly passing it to its Daemon.
ROUNDUP_DATA_DIR="$HOME/app-data"; export ROUNDUP_DATA_DIR
N7_LAUNCH_LOG={}; export N7_LAUNCH_LOG
RUPD_SOCKET={}/roundup-$$.sock; export RUPD_SOCKET
"$ROUNDUP_RUPD_BIN" "$1" &
wait
"#,
            shlex::try_quote(log.to_str().unwrap()).unwrap(),
            shlex::try_quote(std::env::temp_dir().to_str().unwrap()).unwrap()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

pub(crate) async fn launched(dir: &Path) -> std::io::Result<(PathBuf, u32)> {
    let log = dir.join("launched");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Ok(text) = std::fs::read_to_string(&log) {
                let lines: Vec<_> = text.lines().collect();
                if lines.len() == 2 {
                    return Ok((
                        PathBuf::from(lines[0]),
                        lines[1].parse().map_err(std::io::Error::other)?,
                    ));
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .map_err(std::io::Error::other)?
}

pub(crate) fn exited(pid: u32) -> bool {
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(pid);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    system.process(pid).is_none_or(|p| {
        matches!(
            p.status(),
            sysinfo::ProcessStatus::Zombie | sysinfo::ProcessStatus::Dead
        )
    })
}

pub(crate) async fn ready(socket: &Path) -> std::io::Result<()> {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Ok(client) = rpc::Client::connect(socket).await
                && client
                    .request("daemon.ping", serde_json::Value::Null)
                    .await
                    .is_ok()
            {
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .map_err(std::io::Error::other)?
}
