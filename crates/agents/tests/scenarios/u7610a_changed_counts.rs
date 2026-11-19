//! U7610a `agent.changedFiles` returns each file's line counts, as git counts them (`scenarios/ui-changes-counts.md`).

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;

use agents::worktree::Git;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn write(dir: &Path, name: &str, bytes: &[u8]) {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

fn lines(count: usize, tag: &str) -> Vec<u8> {
    (0..count)
        .flat_map(|n| format!("{tag} {n}\n").into_bytes())
        .collect()
}

async fn on(f: &Fixture) -> (String, std::path::PathBuf) {
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = node.worktree().expect("a Worktree").path.into();
    (node.base.id, path)
}

async fn counts(f: &Fixture, id: &str) -> BTreeMap<String, Value> {
    let files = f
        .call("agent.changedFiles", json!({"id": id}))
        .await
        .unwrap();
    files["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            (
                file["path"].as_str().unwrap().to_owned(),
                file["counts"].clone(),
            )
        })
        .collect()
}

/// Every file state at once: committed, staged, unstaged, untracked, a rewrite of 10,000 lines.
async fn seeded(f: &Fixture) -> (String, std::path::PathBuf) {
    write(f.dir.path(), "big.txt", &lines(10_000, "old"));
    write(f.dir.path(), "edit.txt", b"a\nb\nc\n");
    write(f.dir.path(), "gone.txt", b"x\ny\n");
    git(f.dir.path(), &["add", "-A"]);
    git(f.dir.path(), &["commit", "-q", "-m", "seed"]);
    let (id, path) = on(f).await;
    write(&path, "big.txt", &lines(10_000, "new"));
    git(&path, &["add", "big.txt"]);
    write(&path, "edit.txt", b"a\nB\nc\nd");
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    write(&path, "staged.txt", b"1\n2\n");
    git(&path, &["add", "staged.txt"]);
    write(&path, "loose.txt", b"1\n2\n3");
    write(&path, "empty.txt", b"");
    (id, path)
}

#[tokio::test]
async fn u7610a_counts_equal_git_numstat_for_every_file_state() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = seeded(&f).await;
    let base = git(&path, &["merge-base", "main", "HEAD"])
        .trim()
        .to_owned();

    let listed = counts(&f, &id).await;

    let mut expected: BTreeMap<String, Value> = git(&path, &["diff", "--numstat", &base])
        .lines()
        .map(|row| {
            let mut parts = row.splitn(3, '\t');
            let (added, removed, name) = (parts.next().unwrap(), parts.next().unwrap(), parts.next().unwrap());
            (name.to_owned(), json!({"added": added.parse::<u32>().unwrap(), "removed": removed.parse::<u32>().unwrap()}))
        })
        .collect();
    // Untracked files: numstat against nothing counts every line as added.
    expected.insert("loose.txt".into(), json!({"added": 3, "removed": 0}));
    expected.insert("empty.txt".into(), json!({"added": 0, "removed": 0}));
    assert_eq!(
        expected["big.txt"],
        json!({"added": 10_000, "removed": 10_000})
    );
    assert_eq!(listed, expected);
}

#[tokio::test]
async fn u7610a_a_binary_file_has_no_counts() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "image.bin", b"\0\x01\x02");
    git(f.dir.path(), &["add", "-A"]);
    git(f.dir.path(), &["commit", "-q", "-m", "seed"]);
    let (id, path) = on(&f).await;
    write(&path, "image.bin", b"\0\x03\x04\x05");
    write(&path, "new.bin", b"\0\0");

    let listed = counts(&f, &id).await;

    assert_eq!(listed["image.bin"], Value::Null);
    assert_eq!(listed["new.bin"], Value::Null);
}

#[tokio::test]
async fn u7610a_the_counts_come_from_one_git_call_for_the_list() {
    let tools = tempfile::tempdir().unwrap();
    let log = tools.path().join("calls");
    let real = which_git();
    let wrapper = tools.path().join("git");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho \"$@\" >> '{}'\nexec '{}' \"$@\"\n",
            log.display(),
            real
        ),
    )
    .unwrap();
    std::fs::set_permissions(
        &wrapper,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let mut path = OsString::from(tools.path());
    path.push(":");
    path.push(std::env::var_os("PATH").unwrap());
    let f = Fixture::in_git_project("sleep 30", Git::with_path(path));
    let (id, _) = seeded(&f).await;
    std::fs::write(&log, "").unwrap();

    counts(&f, &id).await;

    let calls = std::fs::read_to_string(&log).unwrap();
    let numstat = calls
        .lines()
        .filter(|call| call.contains("--numstat"))
        .count();
    let reads = calls
        .lines()
        .filter(|call| call.contains("cat-file") || call.contains(" show "))
        .count();
    assert_eq!((numstat, reads), (1, 0), "{calls}");
}

fn which_git() -> String {
    let path = std::env::var("PATH").unwrap();
    path.split(':')
        .map(|dir| Path::new(dir).join("git"))
        .find(|candidate| candidate.is_file())
        .unwrap()
        .display()
        .to_string()
}
