//! N1 to N4: a Project's data lives in the data folder, never in the Project folder, and an older
//! Project's files move there whole. The real `rupd`, with the fake `claude` for every Agent.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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
    for path in [
        "agents.db",
        "todos.db",
        "pads.db",
        "messages.db",
        "provenance.db",
        "digest.db",
        "pads/notes.md",
    ] {
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
async fn n2_with_worktrees_on_only_the_worktree_folders_appear() {
    let dir = repository();
    let before = listing(dir.path());
    let project = open(dir, tempfile::tempdir().unwrap());
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
}

/// What a Daemon before this change left: its data folder's files, in `<project>/.roundup/`.
fn age(project: &Project) {
    let old = project.dir.path().join(".roundup");
    std::fs::create_dir_all(&old).unwrap();
    let data = project.data_dir();
    for entry in std::fs::read_dir(&data).unwrap() {
        let entry = entry.unwrap();
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
    let bytes = std::fs::read(project.dir.path().join(".roundup/agents.db")).unwrap();

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
    assert!(project.data_dir().join("agents.db").is_file());
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
    let rupd = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("rupd");
    let socket = dir.join("refused.sock");
    let mut child = Command::new(rupd)
        .arg(dir)
        .env("RUPD_SOCKET", &socket)
        .env("ROUNDUP_DATA_DIR", data)
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if started.elapsed() > Duration::from_secs(10) {
            child.kill().unwrap();
            child.wait().unwrap();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut stderr).unwrap();
    assert!(!socket.exists(), "a refusing Daemon accepted connections");
    (status.is_some_and(|status| !status.success()), stderr)
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
    for name in ["todos.db", "todos.db-wal", "todos.db-shm"] {
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
