use super::*;
use std::{path::Path, process::Command};

fn marks() -> Marks {
    Marks {
        agents: vec![Mark {
            agent: "door".into(),
            cwd: "/project".into(),
            worktree: "/project".into(),
            conversation: vec![0, 255, 10],
            files: vec![
                File {
                    path: b"one".to_vec(),
                    content: FileContent::Regular {
                        bytes: b"same\0bytes".to_vec(),
                        executable: false,
                    },
                },
                File {
                    path: b"two\n\xff".to_vec(),
                    content: FileContent::Regular {
                        bytes: b"same\0bytes".to_vec(),
                        executable: true,
                    },
                },
                File {
                    path: b"broken".to_vec(),
                    content: FileContent::Symlink {
                        target: b"same\0bytes".to_vec(),
                    },
                },
                File {
                    path: b"empty".to_vec(),
                    content: FileContent::Regular {
                        bytes: vec![],
                        executable: false,
                    },
                },
            ],
        }],
    }
}

fn git(dir: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .arg("--git-dir")
        .arg(dir.join("objects.git"))
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[test]
fn n12_equal_contents_share_git_objects() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    let mut input = marks();
    let mut other = input.agents[0].clone();
    other.agent = "another-agent".into();
    input.agents.push(other);
    store.save_marks("door", 1, &input).unwrap();
    store.save_marks("door", 2, &input).unwrap();
    let content: String = store
        .db()
        .unwrap()
        .query_row("SELECT content FROM marks LIMIT 1", [], |r| r.get(0))
        .unwrap();
    assert!(
        content.contains("git_objects"),
        "file bytes must be object references: {content}"
    );
    let objects = git(
        dir.path(),
        &["cat-file", "--batch-all-objects", "--batch-check"],
    );
    let blobs: Vec<_> = objects
        .split(|b| *b == b'\n')
        .filter(|line| line.windows(6).any(|w| w == b" blob "))
        .collect();
    assert_eq!(blobs.len(), 2, "only shared contents and empty blob");
    assert_eq!(store.marks("door", 1).unwrap(), input);
}

#[test]
fn n12_metadata_does_not_change_blob_identity() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    let input = marks();
    store.save_marks("door", 1, &input).unwrap();
    let content: String = store
        .db()
        .unwrap()
        .query_row("SELECT content FROM marks", [], |r| r.get(0))
        .unwrap();
    let stored: StoredMarks = serde_json::from_str(&content).unwrap();
    let files = &stored.git_objects.agents[0].files;
    assert_eq!(files[0].content.object(), files[1].content.object());
    assert_eq!(files[0].content.object(), files[2].content.object());
    let blob = git(
        dir.path(),
        &["cat-file", "blob", files[0].content.object().name()],
    );
    assert_eq!(blob, b"same\0bytes");
    assert_eq!(store.marks("door", 1).unwrap(), input);
}

#[test]
fn n12_stored_marks_survive_git_gc() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    store.save_marks("door", 1, &marks()).unwrap();
    let mut invalidated = marks();
    invalidated.agents[0].files[0].content = FileContent::Regular {
        bytes: b"unique invalidated contents".to_vec(),
        executable: false,
    };
    store.save_marks("door", 2, &invalidated).unwrap();
    store.invalidate_after("door", 1).unwrap();
    drop(store);
    git(dir.path(), &["gc", "--prune=now"]);
    let store = Checkpoints::open(dir.path()).unwrap();
    assert_eq!(store.marks("door", 1).unwrap(), marks());
    assert!(store.marks("door", 2).is_err());
    // Invalidation changes eligibility, never retention or the stored file contents.
    let content: String = store
        .db()
        .unwrap()
        .query_row("SELECT content FROM marks WHERE checkpoint=2", [], |r| {
            r.get(0)
        })
        .unwrap();
    let stored: StoredMarks = serde_json::from_str(&content).unwrap();
    assert_eq!(
        stored.git_objects.read(&store.objects).unwrap(),
        invalidated
    );
}

#[test]
fn n12_workstreams_do_not_collide() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    let first = marks();
    let mut second = marks();
    second.agents[0].files[0].content = FileContent::Regular {
        bytes: b"different".to_vec(),
        executable: false,
    };
    store.save_marks("a/b", 1, &first).unwrap();
    store.save_marks("a-b", 1, &second).unwrap();
    drop(store);
    git(dir.path(), &["gc", "--prune=now"]);
    let store = Checkpoints::open(dir.path()).unwrap();
    assert_eq!(store.marks("a/b", 1).unwrap(), first);
    assert_eq!(store.marks("a-b", 1).unwrap(), second);
    assert_eq!(
        git(
            dir.path(),
            &["for-each-ref", "--format=%(refname)", "refs/checkpoints"]
        )
        .split(|b| *b == b'\n')
        .filter(|line| !line.is_empty())
        .count(),
        2
    );
}

#[test]
fn n13_object_marks_round_trip_after_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    let mut input = marks();
    input.agents[0].files[2].content = FileContent::Symlink {
        target: b"missing\xff".to_vec(),
    };
    store.save_marks("door", 1, &input).unwrap();
    drop(store);
    assert_eq!(
        Checkpoints::open(dir.path())
            .unwrap()
            .marks("door", 1)
            .unwrap(),
        input
    );
}

fn project_git(root: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}

#[cfg(unix)]
fn project_state(root: &Path) -> Vec<Vec<u8>> {
    use std::os::unix::ffi::OsStrExt;
    let mut result = vec![
        project_git(root, &["for-each-ref"]),
        project_git(root, &["remote", "-v"]),
    ];
    let index = project_git(
        root,
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
    );
    let index = std::ffi::OsStr::from_bytes(index.strip_suffix(b"\n").unwrap());
    result.push(std::fs::read(index).unwrap_or_default());
    let head = project_git(
        root,
        &["rev-parse", "--path-format=absolute", "--git-path", "HEAD"],
    );
    let head = std::ffi::OsStr::from_bytes(head.strip_suffix(b"\n").unwrap());
    result.push(std::fs::read(head).unwrap());
    result
}

#[cfg(unix)]
#[test]
fn n12_save_and_load_leave_project_git_state_unchanged() {
    let project = tempfile::tempdir().unwrap();
    project_git(project.path(), &["init", "-q"]);
    project_git(
        project.path(),
        &["config", "user.email", "test@example.com"],
    );
    project_git(project.path(), &["config", "user.name", "Test"]);
    std::fs::write(project.path().join("staged"), b"staged bytes").unwrap();
    project_git(project.path(), &["add", "staged"]);
    let data = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(data.path()).unwrap();
    let mut input = marks();
    input.agents[0].cwd = project.path().to_str().unwrap().into();
    input.agents[0].worktree = input.agents[0].cwd.clone();
    let before = project_state(project.path());
    store.save_marks("unborn", 1, &input).unwrap();
    assert_eq!(store.marks("unborn", 1).unwrap(), input);
    assert_eq!(project_state(project.path()), before);
    project_git(project.path(), &["commit", "-qm", "initial"]);
    let linked = project.path().join("linked");
    project_git(
        project.path(),
        &["worktree", "add", "-qb", "linked", linked.to_str().unwrap()],
    );
    std::fs::write(linked.join("staged"), b"linked staged").unwrap();
    project_git(&linked, &["add", "staged"]);
    std::fs::write(linked.join("staged"), b"linked working bytes").unwrap();
    input.agents[0].cwd = linked.to_str().unwrap().into();
    input.agents[0].worktree = input.agents[0].cwd.clone();
    let before = project_state(&linked);
    let original = project_state(project.path());
    store.save_marks("linked", 1, &input).unwrap();
    assert_eq!(store.marks("linked", 1).unwrap(), input);
    assert_eq!(project_state(&linked), before);
    assert_eq!(project_state(project.path()), original);
    assert_eq!(
        std::fs::read(linked.join("staged")).unwrap(),
        b"linked working bytes"
    );
    assert_eq!(
        std::fs::read(project.path().join("staged")).unwrap(),
        b"staged bytes"
    );
    assert!(!project.path().join("objects.git").exists());
    assert!(!linked.join("objects.git").exists());
}

#[test]
fn n13_objects_preserve_bytes_despite_attributes() {
    let project = tempfile::tempdir().unwrap();
    project_git(project.path(), &["init", "-q"]);
    std::fs::write(
        project.path().join(".gitattributes"),
        b"* text eol=crlf filter=destructive\n",
    )
    .unwrap();
    project_git(
        project.path(),
        &["config", "filter.destructive.clean", "printf destroyed"],
    );
    project_git(
        project.path(),
        &["config", "filter.destructive.smudge", "printf destroyed"],
    );
    project_git(
        project.path(),
        &["config", "filter.destructive.required", "true"],
    );
    let data = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(data.path()).unwrap();
    let mut input = marks();
    input.agents[0].cwd = project.path().to_str().unwrap().into();
    input.agents[0].worktree = input.agents[0].cwd.clone();
    input.agents[0].files[0].content = FileContent::Regular {
        bytes: b"\0binary\r\nraw\n\xff".to_vec(),
        executable: false,
    };
    store.save_marks("door", 1, &input).unwrap();
    drop(store);
    assert_eq!(
        Checkpoints::open(data.path())
            .unwrap()
            .marks("door", 1)
            .unwrap(),
        input
    );
}

#[test]
fn n14_failed_publication_preserves_existing_marks() {
    for failure in ["object", "ref", "metadata"] {
        let dir = tempfile::tempdir().unwrap();
        let store = Checkpoints::open(dir.path()).unwrap();
        store.save_marks("door", 1, &marks()).unwrap();
        let mut input = marks();
        let mut restore = None;
        match failure {
            "object" => {
                let bytes = b"new contents failing publication";
                let object = store.objects.write(bytes).unwrap();
                let prefix = dir
                    .path()
                    .join("objects.git/objects")
                    .join(&object.name()[..2]);
                let backup = dir.path().join("saved-prefix");
                std::fs::rename(&prefix, &backup).unwrap();
                std::fs::write(&prefix, b"obstruct object directory").unwrap();
                restore = Some((prefix, backup));
                input.agents[0].files[0].content = FileContent::Regular {
                    bytes: bytes.to_vec(),
                    executable: false,
                };
            }
            "ref" => {
                let tree = git(dir.path(), &["for-each-ref", "--format=%(objectname)"]);
                let tree = std::str::from_utf8(&tree).unwrap().trim();
                let parent = dir.path().join("objects.git/refs/checkpoints/w646f6f72/2");
                std::fs::create_dir_all(&parent).unwrap();
                std::fs::write(parent.join(format!("{tree}.lock")), b"locked").unwrap();
            }
            "metadata" => {
                store.db().unwrap().execute_batch("CREATE TRIGGER fail_marks BEFORE INSERT ON marks WHEN NEW.checkpoint = 2 BEGIN SELECT RAISE(ABORT, 'interrupted metadata'); END;").unwrap();
            }
            _ => unreachable!(),
        }
        assert!(store.save_marks("door", 2, &input).is_err(), "{failure}");
        drop(store);
        let store = Checkpoints::open(dir.path()).unwrap();
        assert_eq!(store.marks("door", 1).unwrap(), marks(), "{failure}");
        assert!(store.marks("door", 2).is_err(), "{failure}");
        match failure {
            "object" => {
                let (prefix, backup) = restore.unwrap();
                std::fs::remove_file(&prefix).unwrap();
                std::fs::rename(backup, prefix).unwrap();
            }
            "ref" => {
                let parent = dir.path().join("objects.git/refs/checkpoints/w646f6f72/2");
                std::fs::remove_dir_all(parent).unwrap();
            }
            "metadata" => {
                store
                    .db()
                    .unwrap()
                    .execute_batch("DROP TRIGGER fail_marks")
                    .unwrap();
            }
            _ => unreachable!(),
        }
        store.save_marks("door", 2, &input).unwrap();
        drop(store);
        git(dir.path(), &["gc", "--prune=now"]);
        let store = Checkpoints::open(dir.path()).unwrap();
        assert_eq!(store.marks("door", 1).unwrap(), marks());
        assert_eq!(store.marks("door", 2).unwrap(), input);
    }
}

#[test]
fn n14_missing_or_corrupt_object_fails_before_restore() {
    for corruption in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let store = Checkpoints::open(dir.path()).unwrap();
        store.save_marks("door", 1, &marks()).unwrap();
        let content: String = store
            .db()
            .unwrap()
            .query_row("SELECT content FROM marks", [], |r| r.get(0))
            .unwrap();
        let stored: StoredMarks = serde_json::from_str(&content).unwrap();
        let object = stored.git_objects.agents[0].files[0].content.object();
        let path = dir
            .path()
            .join("objects.git/objects")
            .join(&object.name()[..2])
            .join(&object.name()[2..]);
        std::fs::remove_file(&path).unwrap();
        if corruption {
            // A valid compressed blob under the wrong object name catches silent hash corruption.
            let other = store.objects.write(b"wrong contents").unwrap();
            let other_path = dir
                .path()
                .join("objects.git/objects")
                .join(&other.name()[..2])
                .join(&other.name()[2..]);
            std::fs::copy(other_path, &path).unwrap();
        }
        drop(store);
        let store = Checkpoints::open(dir.path()).unwrap();
        let error = store.marks("door", 1).unwrap_err().to_string();
        assert!(
            error.contains("Checkpoint door:1") && error.contains(object.name()),
            "{error}"
        );
    }
}

#[test]
#[ignore = "child launched by interrupted-write test"]
fn n14_interrupted_write_child() {
    let dir = std::env::var_os("CHECKPOINT_INTERRUPTED_STORE").unwrap();
    let store = Checkpoints::open(Path::new(&dir)).unwrap();
    store.save_marks("door", 2, &marks()).unwrap();
}

#[test]
fn n14_interrupted_write_preserves_existing_marks() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    store.save_marks("door", 1, &marks()).unwrap();
    drop(store);
    let db = rusqlite::Connection::open(dir.path().join("checkpoints.db")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "marks::tests::n14_interrupted_write_child",
            "--ignored",
        ])
        .env("CHECKPOINT_INTERRUPTED_STORE", dir.path())
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
    let retained = dir.path().join("objects.git/refs/checkpoints/w646f6f72/2");
    let published = loop {
        if retained.is_dir()
            && std::fs::read_dir(&retained).unwrap().any(|entry| {
                !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".lock")
            })
        {
            break true;
        }
        if std::time::Instant::now() > deadline || child.try_wait().unwrap().is_some() {
            break false;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    child.kill().unwrap();
    child.wait().unwrap();
    db.execute_batch("ROLLBACK").unwrap();
    assert!(
        published,
        "child did not reach ref publication before metadata commit"
    );
    git(dir.path(), &["gc", "--prune=now"]);
    let store = Checkpoints::open(dir.path()).unwrap();
    assert_eq!(store.marks("door", 1).unwrap(), marks());
    assert!(store.marks("door", 2).is_err());
    store.save_marks("door", 2, &marks()).unwrap();
    assert_eq!(store.marks("door", 2).unwrap(), marks());
}

#[cfg(unix)]
async fn restore_loaded(repeat: bool, keep: bool) {
    use std::os::unix::{ffi::OsStrExt, fs::PermissionsExt};
    let project = tempfile::tempdir().unwrap();
    let root = project.path();
    project_git(root, &["init", "-q"]);
    std::fs::write(root.join(".gitignore"), b"ignored\none\n").unwrap();
    std::fs::write(root.join("ignored"), b"keep ignored").unwrap();
    std::fs::write(root.join("one"), b"initial tracked").unwrap();
    project_git(root, &["add", "-f", "one"]);
    let mut input = marks();
    input.agents[0].cwd = root.to_str().unwrap().into();
    input.agents[0].worktree = input.agents[0].cwd.clone();
    // macOS filesystems reject non-UTF8 names; storage-only round trips still
    // exercise arbitrary path bytes without asking the filesystem to create them.
    if cfg!(target_os = "macos") {
        input.agents[0].files[1].path = "two\n雪".as_bytes().to_vec();
    }
    input.agents[0].files[2].content = FileContent::Symlink {
        target: b"missing\xff".to_vec(),
    };
    input.agents[0].files.push(File {
        path: b".gitignore".to_vec(),
        content: FileContent::Regular {
            bytes: b"ignored\none\n".to_vec(),
            executable: false,
        },
    });
    let data = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(data.path()).unwrap();
    store.save_marks("door", 1, &input).unwrap();
    drop(store);
    let store = Checkpoints::open(data.path()).unwrap();
    let loaded = store.marks("door", 1).unwrap();
    // Cargo compiles the library separately for this dev-dependency cycle.
    let restored_mark =
        serde_json::from_value(serde_json::to_value(&loaded.agents[0]).unwrap()).unwrap();
    std::fs::write(root.join("one"), b"changed").unwrap();
    std::fs::write(root.join("added"), b"new").unwrap();
    std::os::unix::fs::symlink("other-missing", root.join("broken")).unwrap();
    let before = project_state(root);
    if keep {
        assert!(
            !agents::marks::changed_files(&restored_mark)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(std::fs::read(root.join("one")).unwrap(), b"changed");
        assert_eq!(std::fs::read(root.join("added")).unwrap(), b"new");
        assert_eq!(
            std::fs::read_link(root.join("broken")).unwrap(),
            Path::new("other-missing")
        );
        assert!(!root.join("empty").exists());
    } else {
        agents::marks::restore_files(&restored_mark).await.unwrap();
        if repeat {
            agents::marks::restore_files(&restored_mark).await.unwrap();
        }
        for file in &loaded.agents[0].files {
            let path = root.join(std::ffi::OsStr::from_bytes(&file.path));
            match &file.content {
                FileContent::Regular { bytes, executable } => {
                    assert_eq!(std::fs::read(&path).unwrap(), *bytes);
                    assert_eq!(
                        std::fs::metadata(path).unwrap().permissions().mode() & 0o111 != 0,
                        *executable
                    );
                }
                FileContent::Symlink { target } => assert_eq!(
                    std::fs::read_link(path).unwrap().as_os_str().as_bytes(),
                    target
                ),
            }
        }
        assert!(!root.join("added").exists());
        assert!(
            agents::marks::changed_files(&restored_mark)
                .await
                .unwrap()
                .is_empty()
        );
    }
    assert_eq!(
        std::fs::read(root.join("ignored")).unwrap(),
        b"keep ignored"
    );
    assert_eq!(project_state(root), before);
}

#[cfg(unix)]
#[tokio::test]
async fn n13_loaded_marks_restore_existing_file_semantics() {
    restore_loaded(false, false).await;
}

#[cfg(unix)]
#[tokio::test]
async fn n13_restoration_is_idempotent() {
    restore_loaded(true, false).await;
}

#[cfg(unix)]
#[tokio::test]
async fn n13_keep_leaves_files_unchanged() {
    restore_loaded(false, true).await;
}

#[test]
fn n13_large_binary_objects_do_not_block_pipes() {
    let dir = tempfile::tempdir().unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    let mut input = marks();
    input.agents[0].files[0].content = FileContent::Regular {
        bytes: b"\0\xff\r\n".repeat(262144),
        executable: true,
    };
    store.save_marks("door", 1, &input).unwrap();
    drop(store);
    assert_eq!(
        Checkpoints::open(dir.path())
            .unwrap()
            .marks("door", 1)
            .unwrap(),
        input
    );
}

#[test]
fn n14_legacy_and_object_marks_coexist() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("checkpoints.db"),
        include_bytes!("../tests/fixtures/legacy.db"),
    )
    .unwrap();
    let store = Checkpoints::open(dir.path()).unwrap();
    assert_eq!(store.marks("door", 1).unwrap(), marks());
    assert!(store.marks("door", 2).is_err());
    let original: Vec<(String, String, bool)> = {
        let db = store.db().unwrap();
        let mut query = db.prepare("SELECT c.title,c.blocks,m.usable FROM checkpoints c JOIN marks m ON c.workstream=m.workstream AND c.id=m.checkpoint ORDER BY c.id").unwrap();
        query
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    assert_eq!(
        original,
        vec![
            (
                "legacy title".into(),
                "[{\"kind\":\"text\",\"text\":\"legacy block\"}]".into(),
                true
            ),
            ("invalidated title".into(), "[]".into(), false)
        ]
    );
    let legacy: String = store
        .db()
        .unwrap()
        .query_row("SELECT content FROM marks WHERE checkpoint=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    let mut new = marks();
    new.agents[0].conversation.push(42);
    store.save_marks("door", 3, &new).unwrap();
    drop(store);
    for _ in 0..2 {
        let store = Checkpoints::open(dir.path()).unwrap();
        assert_eq!(store.marks("door", 1).unwrap(), marks());
        assert_eq!(store.marks("door", 3).unwrap(), new);
        assert!(store.marks("door", 2).is_err());
        let content: String = store
            .db()
            .unwrap()
            .query_row("SELECT content FROM marks WHERE checkpoint=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(content, legacy);
        let preserved: Vec<(String, String, bool)> = {
            let db = store.db().unwrap();
            let mut query = db.prepare("SELECT c.title,c.blocks,m.usable FROM checkpoints c JOIN marks m ON c.workstream=m.workstream AND c.id=m.checkpoint ORDER BY c.id").unwrap();
            query
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert_eq!(preserved, original);
    }
}
