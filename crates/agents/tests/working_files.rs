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
    ]
}
#[tokio::test]
async fn a35_working_files_compare_and_restore_without_moving_git() {
    let dir = repo();
    let root = dir.path();
    let mark = mark(
        root,
        vec![regular(b"changed", b"old"), regular(b"deleted", b"back")],
    );
    fs::write(root.join("changed"), b"later commit").unwrap();
    git(root, &["commit", "-qam", "later"]);
    fs::write(root.join("added"), b"new").unwrap();
    fs::write(root.join(".git/info/exclude"), b"ignored\n").unwrap();
    fs::write(root.join("ignored"), b"keep").unwrap();
    let before = state(root);
    assert_eq!(
        agents::marks::changed_files(&mark).await.unwrap(),
        vec![b"added".to_vec(), b"changed".to_vec(), b"deleted".to_vec()]
    );
    assert_eq!(fs::read(root.join("changed")).unwrap(), b"later commit");
    assert_eq!(fs::read(root.join("added")).unwrap(), b"new");
    assert_eq!(state(root), before);
    for _ in 0..2 {
        agents::marks::restore_files(&mark).await.unwrap();
        assert_eq!(fs::read(root.join("changed")).unwrap(), b"old");
        assert_eq!(fs::read(root.join("deleted")).unwrap(), b"back");
        assert!(!root.join("added").exists());
        assert_eq!(fs::read(root.join("ignored")).unwrap(), b"keep");
        assert_eq!(state(root), before);
        assert!(
            agents::marks::changed_files(&mark)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
