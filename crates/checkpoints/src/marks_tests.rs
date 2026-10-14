use super::*;
use std::{path::Path, process::Command};

fn marks() -> Marks {
    Marks {
        iteration: 3,
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
    input.agents.push(input.agents[0].clone());
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
    assert_eq!(store.marks("door", 1, 3).unwrap(), input);
}
