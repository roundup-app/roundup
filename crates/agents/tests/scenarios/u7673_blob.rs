//! U7673a, U7673b, U7673c: every changed-file entry carries git's blob id of its To side (`scenarios/ui-changes-blob.md`).

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use agents::worktree::Git;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t"])
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

fn commit_all(dir: &Path) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", "step"]);
}

fn text(count: usize, tag: &str) -> Vec<u8> {
    (0..count)
        .flat_map(|n| format!("{tag} {n}\n").into_bytes())
        .collect()
}

async fn on(f: &Fixture) -> (String, PathBuf) {
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = node.worktree().expect("a Worktree").path.into();
    (node.base.id, path)
}

/// An added, a modified, a deleted, a binary and two renamed files, committed on the branch.
async fn seeded(f: &Fixture) -> (String, PathBuf) {
    write(f.dir.path(), "edit.txt", &text(5, "old"));
    write(f.dir.path(), "gone.txt", &text(3, "gone"));
    write(f.dir.path(), "pure.txt", &text(20, "pure"));
    write(f.dir.path(), "moved.txt", &text(20, "moved"));
    write(f.dir.path(), "image.bin", b"\0\x01\x02");
    commit_all(f.dir.path());
    let (id, path) = on(f).await;
    write(&path, "edit.txt", &text(5, "new"));
    write(&path, "added.txt", &text(2, "added"));
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    git(&path, &["mv", "pure.txt", "pure_to.txt"]);
    git(&path, &["mv", "moved.txt", "moved_to.txt"]);
    let mut edited = text(20, "moved");
    edited.extend(text(1, "extra"));
    write(&path, "moved_to.txt", &edited);
    write(&path, "image.bin", b"\0\x03\x04\x05");
    commit_all(&path);
    (id, path)
}

async fn blobs(f: &Fixture, id: &str, to: &str) -> BTreeMap<String, Value> {
    let files = f
        .call("agent.changedFiles", json!({"id": id, "to": to}))
        .await
        .unwrap();
    files["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            (
                file["path"].as_str().unwrap().to_owned(),
                file["blob"].clone(),
            )
        })
        .collect()
}

fn hash(path: &Path, name: &str) -> Value {
    let file = path.join(name);
    if !file.exists() {
        return Value::Null;
    }
    json!(git(path, &["hash-object", name]).trim())
}

fn changes_blobs(path: &Path, edits: &[&str]) -> BTreeMap<String, Value> {
    let edits: Vec<String> = edits
        .iter()
        .map(|e| path.join(e).display().to_string())
        .collect();
    let groups = Git::from_env().owned_groups(&edits);
    groups
        .iter()
        .flat_map(|group| &group.files)
        .map(|file| (file.path.clone(), json!(file.blob)))
        .collect()
}

const ALL: [&str; 7] = [
    "added.txt",
    "edit.txt",
    "gone.txt",
    "image.bin",
    "pure_to.txt",
    "moved_to.txt",
    "pure.txt",
];

#[tokio::test]
async fn u7673a_blob_equals_git_hash_object_for_every_file_state() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = seeded(&f).await;
    // Untracked files exist only in the working tree.
    write(&path, "loose.txt", b"loose\n");
    write(&path, "loose.bin", b"\0\0");

    let mut expected: BTreeMap<String, Value> = [
        "added.txt",
        "edit.txt",
        "gone.txt",
        "image.bin",
        "pure_to.txt",
        "moved_to.txt",
        "pure.txt",
        "moved.txt",
    ]
    .into_iter()
    .map(|name| (name.to_owned(), hash(&path, name)))
    .collect();
    expected.insert("gone.txt".into(), Value::Null);
    expected.insert("pure.txt".into(), Value::Null);
    expected.insert("moved.txt".into(), Value::Null);
    assert!(expected["edit.txt"].is_string() && expected["image.bin"].is_string());

    let branch = blobs(&f, &id, "branch").await;
    let mut want = expected.clone();
    want.retain(|name, _| branch.contains_key(name));
    assert_eq!(branch.len(), 6, "{branch:?}");
    assert_eq!(branch, want);

    let tree = blobs(&f, &id, "tree").await;
    let mut want = expected.clone();
    for loose in ["loose.txt", "loose.bin"] {
        want.insert(loose.into(), hash(&path, loose));
    }
    want.retain(|name, _| tree.contains_key(name));
    assert_eq!(tree.len(), 8, "{tree:?}");
    assert_eq!(tree, want);

    let own = changes_blobs(
        &path,
        &[&ALL[..], &["moved.txt", "loose.txt", "loose.bin"]].concat(),
    );
    let mut want = expected;
    for loose in ["loose.txt", "loose.bin"] {
        want.insert(loose.into(), hash(&path, loose));
    }
    want.retain(|name, _| own.contains_key(name));
    assert_eq!(own.len(), 8, "{own:?}");
    assert_eq!(own, want);
}

#[tokio::test]
async fn u7673a_a_rewrite_that_keeps_the_counts_changes_the_blob() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = seeded(&f).await;
    let before = blobs(&f, &id, "tree").await;
    let again = blobs(&f, &id, "tree").await;
    assert_eq!(before, again);

    // Same line count, same +/-, one byte different.
    write(&path, "edit.txt", &text(5, "neu"));
    let after = blobs(&f, &id, "tree").await;

    assert_ne!(before["edit.txt"], after["edit.txt"]);
    assert_eq!(before["added.txt"], after["added.txt"]);
}

#[tokio::test]
async fn u7673a_counts_still_equal_git_numstat() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = seeded(&f).await;
    let base = git(&path, &["merge-base", "main", "HEAD"])
        .trim()
        .to_owned();
    for (to, end) in [("tree", None), ("branch", Some("HEAD"))] {
        let files = f
            .call("agent.changedFiles", json!({"id": id, "to": to}))
            .await
            .unwrap();
        let edit = files["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["path"] == "edit.txt")
            .unwrap();
        let mut args = vec!["diff", "--numstat", &base[..]];
        args.extend(end);
        let row = git(&path, &args);
        let row = row.lines().find(|row| row.ends_with("edit.txt")).unwrap();
        let mut parts = row.split('\t');
        let added: u32 = parts.next().unwrap().parse().unwrap();
        let removed: u32 = parts.next().unwrap().parse().unwrap();
        assert_eq!(edit["counts"], json!({"added": added, "removed": removed}));
    }
}

#[tokio::test]
async fn u7673b_five_hundred_files_start_one_hashing_process() {
    let tools = tempfile::tempdir().unwrap();
    let log = tools.path().join("calls");
    let real = std::env::var("PATH")
        .unwrap()
        .split(':')
        .map(|dir| Path::new(dir).join("git"))
        .find(|candidate| candidate.is_file())
        .unwrap();
    let wrapper = tools.path().join("git");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho \"$@\" >> '{}'\nexec '{}' \"$@\"\n",
            log.display(),
            real.display()
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
    write(f.dir.path(), "seed.txt", b"seed\n");
    commit_all(f.dir.path());
    let (id, path) = on(&f).await;
    for n in 0..500 {
        write(&path, &format!("d/f{n}.txt"), format!("{n}\n").as_bytes());
    }
    std::fs::write(&log, "").unwrap();

    let listed = blobs(&f, &id, "tree").await;

    assert_eq!(listed.len(), 500);
    assert!(listed.values().all(Value::is_string));
    let calls = std::fs::read_to_string(&log).unwrap();
    let hashing = calls
        .lines()
        .filter(|call| call.contains("hash-object"))
        .count();
    assert_eq!(hashing, 1, "{calls}");
}

#[tokio::test]
async fn u7673c_a_symlink_blob_is_the_hash_of_its_link_text() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "seed.txt", b"seed\n");
    commit_all(f.dir.path());
    let (id, path) = on(&f).await;
    write(&path, "target.txt", b"target bytes\n");
    std::fs::create_dir(path.join("dir")).unwrap();
    std::os::unix::fs::symlink("target.txt", path.join("to-file")).unwrap();
    std::os::unix::fs::symlink("dir", path.join("to-dir")).unwrap();
    std::os::unix::fs::symlink("nowhere", path.join("dangling")).unwrap();

    let listed = blobs(&f, &id, "tree").await;

    for (name, text) in [
        ("to-file", "target.txt"),
        ("to-dir", "dir"),
        ("dangling", "nowhere"),
    ] {
        git(&path, &["add", name]);
        let stored = git(&path, &["rev-parse", &format!(":{name}")]);
        assert_eq!(listed[name], json!(stored.trim()), "{name} -> {text}");
    }
    assert!(listed["target.txt"].is_string());
}

#[tokio::test]
async fn u7673c_a_file_gone_before_hashing_has_a_null_blob() {
    let tools = tempfile::tempdir().unwrap();
    let real = std::env::var("PATH")
        .unwrap()
        .split(':')
        .map(|dir| Path::new(dir).join("git"))
        .find(|candidate| candidate.is_file())
        .unwrap();
    let wrapper = tools.path().join("git");
    // The first hashing call finds `vanish.txt` already removed.
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\ncase \"$*\" in *hash-object*) rm -f vanish.txt;; esac\nexec '{}' \"$@\"\n",
            real.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(
        &wrapper,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let mut search = OsString::from(tools.path());
    search.push(":");
    search.push(std::env::var_os("PATH").unwrap());
    let f = Fixture::in_git_project("sleep 30", Git::with_path(search));
    write(f.dir.path(), "seed.txt", b"seed\n");
    commit_all(f.dir.path());
    let (id, path) = on(&f).await;
    write(&path, "vanish.txt", b"here\n");
    write(&path, "stays.txt", b"stays\n");

    let listed = blobs(&f, &id, "tree").await;

    assert_eq!(listed["vanish.txt"], Value::Null);
    let want = git(&path, &["hash-object", "stays.txt"]);
    assert_eq!(listed["stays.txt"], json!(want.trim()));
}
