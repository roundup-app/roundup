//! N1 to N4: a Project's data lives in the data folder, never in the Project folder, and an older
//! Project's files move there whole. The real `rupd`, with the fake `claude` for every Agent.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use daemon::{Project, rail_tree, start_in};
use serde_json::{Value, json};

/// Every path under `root`, hidden files included, relative to it; `.git` and the test harness's
/// own socket are left out.
fn listing(root: &Path) -> BTreeSet<PathBuf> {
    fn walk(root: &Path, dir: &Path, into: &mut BTreeSet<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let relative = path.strip_prefix(root).unwrap().to_owned();
            if relative == Path::new(".git") || relative == Path::new("rupd.sock") {
                continue;
            }
            into.insert(relative);
            if path.is_dir() && !path.is_symlink() {
                walk(root, &path, into);
            }
        }
    }
    let mut paths = BTreeSet::new();
    walk(root, root, &mut paths);
    paths
}

fn git(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q"]);
    std::fs::write(dir.path().join("README.md"), "hello\n").unwrap();
    git(dir.path(), &["add", "-A"]);
    git(
        dir.path(),
        &[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "commit",
            "-q",
            "-m",
            "first",
        ],
    );
    dir
}

/// The environment that keeps the fake `claude`'s own config out of the Project folder.
fn env_for(data: &Path) -> Vec<(String, String)> {
    let config = data.join("claude-config");
    vec![
        (
            "CLAUDE_CONFIG_DIR".into(),
            config.to_string_lossy().into_owned(),
        ),
        ("GIT_CONFIG_GLOBAL".into(), "/dev/null".into()),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
    ]
}

fn open(dir: tempfile::TempDir, data: tempfile::TempDir) -> Project {
    let env = env_for(data.path());
    let pairs: Vec<(&str, &str)> = env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    start_in(dir, data, &pairs)
}

/// Spawn an Agent, start a Door, write a Todo and a Pad (file storage on).
async fn work(project: &Project) -> Vec<String> {
    let client = project.client().await;
    let agent = project.spawn_agent(&client).await;
    let team = client
        .request(
            "rail.createWorkstream",
            json!({ "name": "team", "parent": null }),
        )
        .await
        .unwrap();
    client
        .request("rail.startDoor", json!({ "id": team["id"] }))
        .await
        .unwrap();
    client
        .request("todo.create", json!({ "title": "keep me" }))
        .await
        .unwrap();
    client
        .request("pad.setStorage", json!({ "files": true }))
        .await
        .unwrap();
    client
        .request("pad.create", json!({ "name": "notes", "text": "body" }))
        .await
        .unwrap();
    vec![agent.id]
}

async fn titles(project: &Project) -> Vec<String> {
    let todos = project
        .client()
        .await
        .request("todo.list", Value::Null)
        .await
        .unwrap();
    todos
        .as_array()
        .unwrap()
        .iter()
        .map(|todo| todo["title"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn n1_n2_a_git_project_with_worktrees_off_is_left_as_it_was() {
    let dir = repository();
    let before = listing(dir.path());
    let project = open(dir, tempfile::tempdir().unwrap());

    work(&project).await;

    assert_eq!(listing(project.dir.path()), before);
    assert_eq!(git(project.dir.path(), &["status", "--porcelain"]), "");
    let data = project.data_dir();
    for path in ["project.db", "pads/notes.md"] {
        assert!(
            data.join(path).is_file(),
            "{path} is not in {}",
            data.display()
        );
    }
    assert!(std::fs::read_dir(data.join("agents")).unwrap().count() > 0);
}

#[tokio::test]
async fn n2_a_folder_that_is_not_a_repository_gets_no_roundup_folder() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), "a").unwrap();
    let before = listing(dir.path());
    let project = open(dir, tempfile::tempdir().unwrap());

    work(&project).await;

    assert_eq!(listing(project.dir.path()), before);
}

#[tokio::test]
async fn dv2_retained_revision_n2_with_worktrees_on_only_the_worktree_folders_appear() {
    let dir = repository();
    let before = listing(dir.path());
    let mut project = open(dir, tempfile::tempdir().unwrap());
    project
        .client()
        .await
        .request("project.setWorktrees", json!({"on": true, "check": "true"}))
        .await
        .unwrap();

    let ids = work(&project).await;

    let tree = rail_tree(&project.client().await).await;
    let with_worktree: Vec<_> = tree
        .iter()
        .filter(|node| node.worktree.is_some())
        .map(|node| node.id.clone())
        .collect();
    assert!(ids.iter().all(|id| with_worktree.contains(id)));
    let roots: BTreeSet<PathBuf> = with_worktree
        .iter()
        .map(|id| PathBuf::from(format!(".roundup/worktrees/agent-{id}")))
        .collect();
    let new: BTreeSet<PathBuf> = listing(project.dir.path())
        .difference(&before)
        .filter(|path| {
            !roots
                .iter()
                .any(|root| path.starts_with(root) && *path != root)
        })
        .cloned()
        .collect();
    let mut expected = roots.clone();
    expected.insert(PathBuf::from(".roundup"));
    expected.insert(PathBuf::from(".roundup/worktrees"));
    assert_eq!(new, expected);
    assert_eq!(git(project.dir.path(), &["status", "--porcelain"]), "");

    // DV2/DV3: cleaning a real maker Worktree cannot revoke its Project-stored Pad.
    let client = project.client().await;
    client
        .request(
            "pad.setOwner",
            json!({"name":"notes", "owner": {
                "kind":"agent", "id":ids[0]
            }}),
        )
        .await
        .unwrap();
    let db = rusqlite::Connection::open(project.data_dir().join("project.db")).unwrap();
    let before = pads::source(&db, "notes").unwrap().unwrap();
    let maker = project.client().await;
    maker
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":ids[0],"parent":null}}),
        )
        .await
        .unwrap();
    let pad=maker.request("deliverable.publish",json!({"key":"pad-retained","title":"Result","target":{"kind":"pad","name":"notes","incarnation":before.pad.incarnation,"revision":before.pad.revision}})).await.unwrap();
    let file=maker.request("deliverable.publish",json!({"key":"file-retained","title":"Result","target":{"kind":"file","path":"README.md"}})).await.unwrap();
    maker
        .request(
            "pad.write",
            json!({"name":"notes","text":"body revision two"}),
        )
        .await
        .unwrap();
    let before = pads::source(&db, "notes").unwrap().unwrap();

    client
        .request("agent.stop", json!({"id":ids[0]}))
        .await
        .unwrap();
    assert_eq!(
        pads::source_state(&db, before.incarnation).unwrap(),
        pads::PadSourceState::Live(before.clone())
    );
    client
        .request("rail.remove", json!({"id":ids[0]}))
        .await
        .unwrap();
    assert!(
        !project
            .dir
            .path()
            .join(format!(".roundup/worktrees/agent-{}", ids[0]))
            .exists()
    );
    assert_eq!(
        pads::source_state(&db, before.incarnation).unwrap(),
        pads::PadSourceState::Live(before)
    );
    project.restart(&[]);
    let client = project.client().await;
    for (record, expected) in [(pad, "body"), (file, "hello\n")] {
        let id = json!({"project":record["project"],"id":record["id"]});
        assert_eq!(
            client.request("deliverable.get", id.clone()).await.unwrap()["maker"]["id"],
            ids[0]
        );
        let result = client.request("deliverable.resolve", id).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(result["path"].as_str().unwrap()).unwrap(),
            expected
        );
    }
    assert_eq!(
        client
            .request("pad.read", json!({"name":"notes"}))
            .await
            .unwrap()["text"],
        "body revision two"
    );
}

/// What a Daemon before this change left: its data folder's files, in `<project>/.roundup/`.
fn age(project: &Project) {
    let old = project.dir.path().join(".roundup");
    std::fs::create_dir_all(&old).unwrap();
    let data = project.data_dir();
    for entry in std::fs::read_dir(&data).unwrap() {
        let entry = entry.unwrap();
        // Q11's runtime cache never existed in legacy Project storage. A killed modern
        // Daemon leaves it in the current data folder, outside this migration fixture.
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("q11-plugins-")
        {
            continue;
        }
        std::fs::rename(entry.path(), old.join(entry.file_name())).unwrap();
    }
}

#[tokio::test]
async fn n3_an_older_project_opens_whole_and_its_worktree_stays() {
    let dir = repository();
    let mut project = open(dir, tempfile::tempdir().unwrap());
    project
        .client()
        .await
        .request("project.setWorktrees", json!({"on": true, "check": "true"}))
        .await
        .unwrap();
    let ids = work(&project).await;
    project.crash();
    age(&project);
    let worktrees = listing(&project.dir.path().join(".roundup/worktrees"));
    assert!(!worktrees.is_empty());
    let bytes = std::fs::read(project.dir.path().join(".roundup/project.db")).unwrap();

    project.restart(&[]);

    assert_eq!(titles(&project).await, ["keep me"]);
    let tree = rail_tree(&project.client().await).await;
    assert!(
        tree.iter()
            .any(|node| node.id == ids[0] && node.worktree.is_some())
    );
    let old = project.dir.path().join(".roundup");
    let left: Vec<_> = std::fs::read_dir(&old)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(left, ["worktrees"]);
    assert_eq!(listing(&old.join("worktrees")), worktrees);
    assert!(project.data_dir().join("project.db").is_file());
    assert!(!bytes.is_empty());
    assert!(project.data_dir().join("pads/notes.md").is_file());
}

#[tokio::test]
async fn n3_a_second_open_moves_nothing_and_an_empty_old_folder_is_removed() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = open(dir, tempfile::tempdir().unwrap());
    work(&project).await;
    project.crash();
    age(&project);

    project.restart(&[]);

    assert!(!project.dir.path().join(".roundup").exists());
    assert_eq!(titles(&project).await, ["keep me"]);
    project.restart(&[]);
    assert_eq!(titles(&project).await, ["keep me"]);
    assert!(!project.dir.path().join(".roundup").exists());
}

/// A Daemon on `dir` with `data` that is expected to refuse: its exit status and stderr.
fn refused(dir: &Path, data: &Path) -> (bool, String) {
    refused_with(dir, data, Duration::from_secs(10), |_| {})
}

// This launch expects refusal, so it cannot use the serving harness's ping handshake.
struct Refused {
    child: Child,
}

impl Drop for Refused {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn refused_with(
    dir: &Path,
    data: &Path,
    bound: Duration,
    after_spawn: impl FnOnce(&mut Child),
) -> (bool, String) {
    let rupd = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("rupd");
    let socket = dir.join("refused.sock");
    let child = Command::new(rupd)
        .arg(dir)
        .env("RUPD_SOCKET", &socket)
        .env("ROUNDUP_DATA_DIR", data)
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    let mut daemon = Refused { child };
    after_spawn(&mut daemon.child);
    let started = Instant::now();
    let status = loop {
        assert!(started.elapsed() <= bound, "refusing Daemon timed out");
        if let Some(status) = daemon.child.try_wait().unwrap() {
            break status;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut daemon.child.stderr.take().unwrap(), &mut stderr).unwrap();
    assert!(!socket.exists(), "a refusing Daemon accepted connections");
    (!status.success(), stderr)
}

#[test]
fn n3_differing_copies_make_the_daemon_exit_naming_both_and_change_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let old = dir.path().join(".roundup");
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join("todos.db"), "old").unwrap();
    let key = rupd::data::project_data(data.path(), dir.path()).unwrap();
    std::fs::create_dir_all(&key).unwrap();
    std::fs::write(key.join("todos.db"), "new").unwrap();

    let (failed, stderr) = refused(dir.path(), data.path());

    assert!(failed, "{stderr}");
    assert!(
        stderr.contains(old.join("todos.db").to_str().unwrap()),
        "{stderr}"
    );
    assert!(
        stderr.contains(key.join("todos.db").to_str().unwrap()),
        "{stderr}"
    );
    assert_eq!(std::fs::read(old.join("todos.db")).unwrap(), b"old");
    assert_eq!(std::fs::read(key.join("todos.db")).unwrap(), b"new");
}

#[test]
fn n3_a_data_folder_that_cannot_be_written_leaves_the_old_files_whole() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let old = dir.path().join(".roundup");
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join("todos.db"), "old").unwrap();
    std::fs::set_permissions(data.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    if std::fs::write(data.path().join("probe"), "").is_ok() {
        return; // root writes anywhere; the case cannot be made
    }

    let (failed, stderr) = refused(dir.path(), data.path());

    std::fs::set_permissions(data.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(failed, "{stderr}");
    assert!(stderr.contains(data.path().to_str().unwrap()), "{stderr}");
    assert_eq!(std::fs::read(old.join("todos.db")).unwrap(), b"old");
}

#[tokio::test]
async fn n3_a_finished_copy_whose_old_file_a_kill_left_is_finished() {
    let dir = tempfile::tempdir().unwrap();
    let mut project = open(dir, tempfile::tempdir().unwrap());
    work(&project).await;
    project.crash();
    // The kill came after the copy and before the removal: both hold the same bytes.
    let old = project.dir.path().join(".roundup");
    std::fs::create_dir_all(&old).unwrap();
    let data = project.data_dir();
    for name in ["project.db", "project.db-wal", "project.db-shm"] {
        if data.join(name).is_file() {
            std::fs::copy(data.join(name), old.join(name)).unwrap();
        }
    }

    project.restart(&[]);

    assert_eq!(titles(&project).await, ["keep me"]);
    assert!(!old.exists());
}

#[tokio::test]
async fn n4_a_moved_project_opens_empty_and_moving_it_back_restores_it() {
    let mut project = open(tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    work(&project).await;
    project.crash();
    let old_key = project.data_dir();
    let held = listing(&old_key);
    let (here, there) = (project.dir.path().to_owned(), tempfile::tempdir().unwrap());
    let there_path = there.path().to_owned();
    std::fs::remove_dir(&there_path).unwrap();
    std::fs::rename(&here, &there_path).unwrap();
    let original = std::mem::replace(&mut project.dir, there);

    project.restart(&[]);

    assert_eq!(titles(&project).await, Vec::<String>::new());
    assert_ne!(project.data_dir(), old_key);
    assert_eq!(listing(&old_key), held);
    assert!(!there_path.join(".roundup").exists());
    project.crash();
    std::fs::rename(&there_path, &here).unwrap();
    project.dir = original;

    project.restart(&[]);

    assert_eq!(titles(&project).await, ["keep me"]);
}

fn snapshot(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, entries: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let bytes = if path.is_file() {
                std::fs::read(&path).unwrap()
            } else {
                Vec::new()
            };
            entries.push((path.strip_prefix(root).unwrap().to_owned(), bytes));
            if path.is_dir() && !path.is_symlink() {
                walk(root, &path, entries);
            }
        }
    }
    let mut entries = Vec::new();
    walk(root, root, &mut entries);
    entries.sort();
    entries
}

#[tokio::test]
async fn n7_launch_sites_use_owned_data() {
    let home = tempfile::tempdir().unwrap();
    let app = home.path().join("xdg/dev.roundup.app");
    std::fs::create_dir_all(app.join("seed")).unwrap();
    std::fs::write(app.join("seed/bytes"), b"keep these bytes").unwrap();
    let before = snapshot(home.path());
    let xdg = home.path().join("xdg");
    let overrides = [
        ("ROUNDUP_DATA_DIR", app.to_str().unwrap()),
        ("HOME", home.path().to_str().unwrap()),
        ("XDG_DATA_HOME", xdg.to_str().unwrap()),
    ];
    let mut project = start_in(
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        &overrides,
    );
    assert!(project.data.path().is_absolute());
    assert!(!project.data.path().starts_with(project.dir.path()));
    project
        .client()
        .await
        .request("todo.create", json!({"title": "private"}))
        .await
        .unwrap();
    assert!(project.data_dir().join("project.db").is_file());
    project.restart(&overrides);
    assert_eq!(titles(&project).await, ["private"]);
    drop(project);
    assert_eq!(snapshot(home.path()), before);
}

#[test]
fn n7_launch_sites_clean_on_success_and_failure() {
    let home = tempfile::tempdir().unwrap();
    let app = home.path().join("xdg/dev.roundup.app");
    std::fs::create_dir_all(app.join("seed")).unwrap();
    std::fs::write(app.join("seed/bytes"), b"keep these bytes").unwrap();
    let before = snapshot(home.path());
    let xdg = home.path().join("xdg");
    for failure in ["none", "startup", "restart", "after launch"] {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let paths = [dir.path().to_owned(), data.path().to_owned()];
        let bad_socket = dir.path().join("missing/socket");
        let failed_pid = if matches!(failure, "startup" | "restart") {
            let project = paths[0].clone();
            let socket = bad_socket.clone();
            Some(std::thread::spawn(move || {
                let rupd = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("rupd");
                let deadline = Instant::now() + Duration::from_secs(30);
                loop {
                    if socket.exists() {
                        let output = Command::new("ps")
                            .args(["-axww", "-o", "pid=,args="])
                            .output()
                            .unwrap();
                        assert!(output.status.success());
                        for row in String::from_utf8(output.stdout).unwrap().lines() {
                            let mut fields = row.split_whitespace();
                            let pid = fields.next().unwrap();
                            if fields.next() == rupd.to_str() && fields.next() == project.to_str() {
                                return pid.parse::<u32>().unwrap();
                            }
                        }
                    }
                    assert!(
                        Instant::now() < deadline,
                        "failed-start Daemon was not observed"
                    );
                    std::thread::sleep(Duration::from_millis(20));
                }
            }))
        } else {
            None
        };
        let mut pids = Vec::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut overrides = vec![
                ("HOME", home.path().to_str().unwrap()),
                ("XDG_DATA_HOME", xdg.to_str().unwrap()),
                ("ROUNDUP_DATA_DIR", app.to_str().unwrap()),
            ];
            if failure == "startup" {
                overrides.push(("RUPD_SOCKET", bad_socket.to_str().unwrap()));
            }
            let mut project = start_in(dir, data, &overrides);
            pids.push(project.pid());
            if failure == "after launch" {
                panic!("observer failed after launch");
            }
            if failure == "restart" {
                overrides.push(("RUPD_SOCKET", bad_socket.to_str().unwrap()));
            }
            project.restart(&overrides);
            assert_reaped(pids[0]);
            pids.push(project.pid());
            drop(project);
        }));
        if let Some(observer) = failed_pid {
            pids.push(observer.join().unwrap());
        }
        assert_eq!(result.is_err(), failure != "none");
        for pid in pids {
            assert_reaped(pid);
        }
        for path in paths {
            assert!(!path.exists(), "{} remains", path.display());
        }
        assert_eq!(snapshot(home.path()), before);
    }
}

fn assert_reaped(pid: u32) {
    let status = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .unwrap();
    assert!(!status.success(), "Daemon {pid} remains alive or unreaped");
}

#[test]
fn n7_refused_launch_cleans_on_write_and_timeout_panic() {
    for write_failure in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let paths = [dir.path().to_owned(), data.path().to_owned()];
        let mut pid = None;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            refused_with(dir.path(), data.path(), Duration::ZERO, |daemon| {
                pid = Some(daemon.id());
                if write_failure {
                    // A failed observer write must unwind through the Daemon owner.
                    std::fs::write(data.path(), b"observer result").unwrap();
                }
            });
        }));
        assert!(result.is_err());
        assert_reaped(pid.unwrap());
        drop((dir, data));
        for path in paths {
            assert!(!path.exists());
        }
    }
}

#[tokio::test]
async fn n1_fallback_uses_a_nested_temporary_home() {
    let run = tempfile::tempdir().unwrap();
    let path = run.path().to_owned();
    let home = run.path().join("home");
    let xdg = run.path().join("xdg");
    std::fs::create_dir(&home).unwrap();
    std::fs::create_dir(&xdg).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let rupd = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("rupd");
    let socket = dir.path().join("rupd.sock");
    // The serving harness always supplies owned data; this observer must exercise fallback.
    let mut daemon = Refused {
        child: Command::new(rupd)
            .arg(dir.path())
            .arg("--attached")
            .env("RUPD_SOCKET", &socket)
            .env_remove("ROUNDUP_DATA_DIR")
            .env("HOME", &home)
            .env("XDG_DATA_HOME", &xdg)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    };
    use std::io::Write as _;
    writeln!(
        daemon.child.stdin.as_mut().unwrap(),
        "roundup-proof 1 {}",
        "0".repeat(64)
    )
    .unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Ok(client) = rpc::Client::connect(&socket).await
                && client.request("daemon.ping", ()).await.is_ok()
            {
                break;
            }
            assert!(daemon.child.try_wait().unwrap().is_none());
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("fallback Daemon answered daemon.ping");
    let root = if cfg!(target_os = "macos") {
        home.join("Library/Application Support/dev.roundup.app")
    } else {
        xdg.join("dev.roundup.app")
    };
    let data = rupd::data::project_data(&root, dir.path()).unwrap();
    assert!(data.join("project.db").is_file());
    let pid = daemon.child.id();
    drop(daemon);
    assert_reaped(pid);
    drop(run);
    assert!(!path.exists());
}

#[tokio::test]
async fn dv2_preexisting_project_pads_gain_durable_source_incarnations() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let original = client
        .request(
            "pad.create",
            json!({"name":"existing", "text":"before upgrade"}),
        )
        .await
        .unwrap();
    project.crash();
    let path = project.data_dir().join("project.db");
    for name in ["project.db", "project.db-wal", "project.db-shm"] {
        match std::fs::remove_file(project.data_dir().join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("remove current fixture database: {error}"),
        }
    }
    let db = rusqlite::Connection::open(path).unwrap();
    // Pin historical Project version 12, before source incarnations. New migrations must
    // not turn this fixture into a different predecessor or replay already-created tables.
    let historical = [
        include_str!("../../rupd/migrations/001/up.sql"),
        include_str!("../../agents/migrations/003/up.sql"),
        include_str!("../../rupd/migrations/003/up.sql"),
        include_str!("../../agents/migrations/004/up.sql"),
        include_str!("../../rupd/migrations/005/up.sql"),
        include_str!("../../pads/migrations/002/up.sql"),
        include_str!("../../rupd/migrations/006/up.sql"),
        include_str!("../../agents/migrations/005/up.sql"),
        include_str!("../../messages/migrations/002/up.sql"),
        include_str!("../../messages/migrations/003/up.sql"),
        include_str!("../../rupd/migrations/project/0001-prepared.sql"),
        include_str!("../../rupd/migrations/project/0002-message-sender-names.sql"),
    ];
    for sql in historical {
        db.execute_batch(sql).unwrap();
    }
    db.execute("INSERT INTO pads(key,name,owner,text,updated_at,home,revision) VALUES ('existing','existing',?1,?2,?3,NULL,1)",rusqlite::params![original["owner"].to_string(),original["text"].as_str().unwrap(),original["updated_at"].as_i64().unwrap()]).unwrap();
    db.pragma_update(None, "user_version", 12).unwrap();
    project.restart(&[]);
    let first = pads::source(&db, "existing").unwrap().unwrap();
    assert_eq!(first.pad.text, "before upgrade");
    assert_eq!(first.pad.revision, 1);
    project.restart(&[]);
    assert_eq!(pads::source(&db, "EXISTING").unwrap(), Some(first));
}
