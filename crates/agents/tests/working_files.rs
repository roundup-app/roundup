use checkpoints::{File, FileContent, Mark};
use std::{fs, path::Path, process::Command};

fn git(root: &Path, args: &[&str]) -> Vec<u8> {
    let out = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}
fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q"]);
    git(dir.path(), &["config", "user.email", "test@example.com"]);
    git(dir.path(), &["config", "user.name", "Test"]);
    fs::write(dir.path().join("changed"), b"old").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-qm", "mark"]);
    dir
}
fn mark(root: &Path, files: Vec<File>) -> Mark {
    Mark {
        agent: "door".into(),
        cwd: root.to_str().unwrap().into(),
        worktree: root.to_str().unwrap().into(),
        conversation: vec![],
        files,
    }
}
fn regular(path: &[u8], bytes: &[u8]) -> File {
    File {
        path: path.to_vec(),
        content: FileContent::Regular {
            bytes: bytes.to_vec(),
            executable: false,
        },
    }
}
fn state(root: &Path) -> Vec<Vec<u8>> {
    vec![
        git(root, &["rev-parse", "HEAD"]),
        git(root, &["show-ref"]),
        git(root, &["remote", "-v"]),
        fs::read(root.join(".git/index")).unwrap(),
        fs::read(root.join(".git/HEAD")).unwrap(),
        fs::read(root.join(".git/config")).unwrap(),
    ]
}
#[tokio::test]
async fn a35_working_files_compare_and_restore_without_moving_git() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("deleted"), b"back").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "snapshot files"]);
    let mark = mark(
        root,
        vec![regular(b"changed", b"old"), regular(b"deleted", b"back")],
    );
    fs::write(root.join("changed"), b"later commit").unwrap();
    fs::remove_file(root.join("deleted")).unwrap();
    fs::write(root.join("tracked-added"), b"committed after mark").unwrap();
    git(root, &["add", "tracked-added"]);
    git(root, &["commit", "-qam", "later"]);
    fs::write(root.join("added"), b"new").unwrap();
    fs::write(root.join(".git/info/exclude"), b"ignored\n").unwrap();
    fs::write(root.join("ignored"), b"keep").unwrap();
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "--bare", "-q"]);
    git(
        root,
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    git(root, &["push", "-q", "origin", "HEAD"]);
    let remote_before = git(remote.path(), &["show-ref"]);
    let before = state(root);
    assert_eq!(
        agents::marks::changed_files(&mark).await.unwrap(),
        vec![
            b"added".to_vec(),
            b"changed".to_vec(),
            b"deleted".to_vec(),
            b"tracked-added".to_vec()
        ]
    );
    assert_eq!(fs::read(root.join("changed")).unwrap(), b"later commit");
    assert_eq!(fs::read(root.join("added")).unwrap(), b"new");
    assert_eq!(state(root), before);
    for _ in 0..2 {
        agents::marks::restore_files(&mark).await.unwrap();
        assert_eq!(fs::read(root.join("changed")).unwrap(), b"old");
        assert_eq!(fs::read(root.join("deleted")).unwrap(), b"back");
        assert!(!root.join("added").exists());
        assert!(!root.join("tracked-added").exists());
        assert_eq!(fs::read(root.join("ignored")).unwrap(), b"keep");
        assert_eq!(state(root), before);
        assert_eq!(git(remote.path(), &["show-ref"]), remote_before);
        assert!(
            agents::marks::changed_files(&mark)
                .await
                .unwrap()
                .is_empty()
        );
    }
}

#[tokio::test]
async fn a35_restore_preserves_modes_symlinks_and_raw_paths() {
    use std::os::unix::{
        ffi::OsStrExt,
        fs::{PermissionsExt, symlink},
    };
    let dir = repo();
    let root = dir.path();
    let raw = std::ffi::OsStr::from_bytes(b"raw-\xff");
    fs::write(root.join(raw), b"raw bytes").unwrap();
    fs::write(root.join("executable"), b"#!/bin/sh\n").unwrap();
    fs::set_permissions(root.join("executable"), fs::Permissions::from_mode(0o755)).unwrap();
    symlink(
        std::ffi::OsStr::from_bytes(b"target-\xfe"),
        root.join("link"),
    )
    .unwrap();
    let mark = mark(
        root,
        vec![
            regular(b"changed", b"old"),
            regular(b"raw-\xff", b"raw bytes"),
            File {
                path: b"executable".to_vec(),
                content: FileContent::Regular {
                    bytes: b"#!/bin/sh\n".to_vec(),
                    executable: true,
                },
            },
            File {
                path: b"link".to_vec(),
                content: FileContent::Symlink {
                    target: b"target-\xfe".to_vec(),
                },
            },
        ],
    );
    fs::write(root.join(raw), b"changed raw").unwrap();
    fs::write(root.join("executable"), b"changed mode").unwrap();
    fs::set_permissions(root.join("executable"), fs::Permissions::from_mode(0o644)).unwrap();
    fs::remove_file(root.join("link")).unwrap();
    symlink("wrong", root.join("link")).unwrap();
    let before = state(root);
    assert_eq!(
        agents::marks::changed_files(&mark).await.unwrap(),
        vec![
            b"executable".to_vec(),
            b"link".to_vec(),
            b"raw-\xff".to_vec()
        ]
    );
    assert_eq!(fs::read(root.join(raw)).unwrap(), b"changed raw");
    assert_eq!(
        fs::read_link(root.join("link")).unwrap(),
        Path::new("wrong")
    );
    assert_eq!(state(root), before);
    for _ in 0..2 {
        agents::marks::restore_files(&mark).await.unwrap();
        assert_eq!(fs::read(root.join(raw)).unwrap(), b"raw bytes");
        assert_eq!(fs::read(root.join("executable")).unwrap(), b"#!/bin/sh\n");
        assert_eq!(
            fs::metadata(root.join("executable"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0o111
        );
        assert_eq!(
            fs::read_link(root.join("link"))
                .unwrap()
                .as_os_str()
                .as_bytes(),
            b"target-\xfe"
        );
        assert_eq!(state(root), before);
    }
    fs::set_permissions(root.join("executable"), fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        agents::marks::changed_files(&mark).await.unwrap(),
        vec![b"executable".to_vec()]
    );
}

#[tokio::test]
async fn a35_replaced_parents_never_follow_outside_targets() {
    use std::fs::hard_link;
    use std::os::unix::fs::symlink;
    let dir = repo();
    let outside = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(outside.path().join("child"), b"outside").unwrap();
    fs::create_dir(root.join("parent")).unwrap();
    fs::write(root.join("parent/child"), b"recorded").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "parent"]);
    fs::remove_dir_all(root.join("parent")).unwrap();
    symlink(outside.path(), root.join("parent")).unwrap();
    fs::remove_file(root.join("changed")).unwrap();
    hard_link(outside.path().join("child"), root.join("changed")).unwrap();
    let mark = mark(
        root,
        vec![
            regular(b"changed", b"old"),
            regular(b"parent/child", b"recorded"),
        ],
    );
    let before = state(root);
    let paths = agents::marks::changed_files(&mark).await.unwrap();
    assert!(paths.contains(&b"parent/child".to_vec()));
    assert_eq!(fs::read(outside.path().join("child")).unwrap(), b"outside");
    for _ in 0..2 {
        agents::marks::restore_files(&mark).await.unwrap();
        assert_eq!(fs::read(root.join("parent/child")).unwrap(), b"recorded");
        assert_eq!(fs::read(root.join("changed")).unwrap(), b"old");
        assert_eq!(fs::read(outside.path().join("child")).unwrap(), b"outside");
        assert_eq!(state(root), before);
    }
    fs::remove_dir_all(root.join("parent")).unwrap();
    fs::write(root.join("parent"), b"replacement file").unwrap();
    agents::marks::restore_files(&mark).await.unwrap();
    assert_eq!(fs::read(root.join("parent/child")).unwrap(), b"recorded");
}

#[tokio::test]
async fn a35_restore_failure_keeps_completed_work_for_retry_and_ignored_files() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("zblocked"), b"file").unwrap();
    fs::write(root.join("changed"), b"later").unwrap();
    fs::remove_file(root.join("zblocked")).unwrap();
    fs::create_dir(root.join("zblocked")).unwrap();
    fs::write(root.join("zblocked/ignored"), b"keep").unwrap();
    fs::write(root.join(".git/info/exclude"), b"zblocked/ignored\n").unwrap();
    let mark = mark(
        root,
        vec![regular(b"changed", b"old"), regular(b"zblocked", b"file")],
    );
    let before = state(root);
    assert!(agents::marks::restore_files(&mark).await.is_err());
    assert_eq!(fs::read(root.join("changed")).unwrap(), b"old");
    assert_eq!(fs::read(root.join("zblocked/ignored")).unwrap(), b"keep");
    assert_eq!(state(root), before);
    fs::rename(root.join("zblocked/ignored"), root.join("ignored-kept")).unwrap();
    fs::write(root.join(".git/info/exclude"), b"ignored-kept\n").unwrap();
    agents::marks::restore_files(&mark).await.unwrap();
    assert_eq!(fs::read(root.join("zblocked")).unwrap(), b"file");
    assert_eq!(fs::read(root.join("ignored-kept")).unwrap(), b"keep");
    assert_eq!(state(root), before);
}

#[tokio::test]
async fn a35_restore_replaces_directory_with_recorded_file() {
    let dir = repo();
    let root = dir.path();
    fs::remove_file(root.join("changed")).unwrap();
    fs::create_dir_all(root.join("changed/nested")).unwrap();
    fs::write(root.join("changed/nested/new"), b"added").unwrap();
    let mark = mark(root, vec![regular(b"changed", b"old")]);
    let before = state(root);
    agents::marks::restore_files(&mark).await.unwrap();
    assert_eq!(fs::read(root.join("changed")).unwrap(), b"old");
    assert_eq!(state(root), before);
}

#[tokio::test]
async fn a35_restore_rejects_paths_outside_worktree_before_writing() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("changed"), b"keep current").unwrap();
    let before = state(root);
    for path in [
        b"../escape".as_slice(),
        b"/absolute",
        b".git/HEAD",
        b"parent/../../escape",
    ] {
        let mark = mark(
            root,
            vec![regular(b"changed", b"old"), regular(path, b"unsafe")],
        );
        assert!(agents::marks::restore_files(&mark).await.is_err());
        assert_eq!(fs::read(root.join("changed")).unwrap(), b"keep current");
        assert_eq!(state(root), before);
    }
}
