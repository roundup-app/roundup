//! G9 filesystem outcomes at the Worktree retention seam, with real directories and git.
use super::*;
use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};

fn identity(path: &Path) -> (u64, u64) {
    let m = std::fs::metadata(path).unwrap();
    (m.dev(), m.ino())
}

fn repository() -> (tempfile::TempDir, Git, Worktree) {
    let dir = tempfile::tempdir().unwrap();
    let git = Git::from_env();
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["config", "user.email", "g9@example.com"],
        vec!["config", "user.name", "G9"],
    ] {
        git.run(dir.path(), &args).unwrap();
    }
    std::fs::write(dir.path().join(".gitignore"), "ignored\n").unwrap();
    git.run(dir.path(), &["add", "."]).unwrap();
    git.run(dir.path(), &["commit", "-qm", "G9"]).unwrap();
    let plan = git.plan(dir.path(), "g9", "1").unwrap();
    let worktree = git.provision(dir.path(), &plan).unwrap();
    std::fs::write(worktree.path.join("ignored"), "only ignored copy").unwrap();
    (dir, git, worktree)
}

#[test]
fn g9_same_filesystem_backup_moves_the_directory() {
    let (dir, git, w) = repository();
    let original_directory = identity(&w.path);
    let original_file = identity(&w.path.join("ignored"));
    let registration = std::fs::read(w.path.join(".git")).unwrap();
    let base = git.run(dir.path(), &["rev-parse", "HEAD"]).unwrap();
    let removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    let saved = removal.entries[0]
        .2
        .as_ref()
        .unwrap()
        .path()
        .join("worktree");
    assert!(!w.path.exists());
    assert_eq!(identity(&saved), original_directory);
    assert_eq!(identity(&saved.join("ignored")), original_file);
    assert_eq!(git.run(dir.path(), &["rev-parse", "HEAD"]).unwrap(), base);
    assert_eq!(std::fs::read(saved.join(".git")).unwrap(), registration);
    removal.restore(&git, dir.path()).unwrap();
    assert_eq!(identity(&w.path), original_directory);
    assert_eq!(identity(&w.path.join("ignored")), original_file);
    assert!(
        git.run(&w.path, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
}

#[test]
fn g9_success_removes_worktrees_branches_and_backups() {
    let (dir, git, w) = repository();
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    let backup = removal.entries[0].2.as_ref().unwrap().path().to_owned();
    removal.remove(&git, dir.path()).unwrap();
    // Retained until the caller finishes its coordinated commit and releases the guard.
    assert!(backup.join("worktree/ignored").exists());
    assert!(
        !git.run(dir.path(), &["branch", "--list"])
            .unwrap()
            .contains(&w.branch)
    );
    drop(removal);
    assert!(!w.path.exists());
    assert!(!backup.exists());
    assert!(
        !git.run(dir.path(), &["worktree", "list", "--porcelain"])
            .unwrap()
            .contains("agent-g9")
    );
}

#[test]
fn g9_cross_device_backup_uses_copy_only_after_exdev() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    let target = dir.path().join("target");
    std::fs::create_dir_all(source.join("nested")).unwrap();
    std::fs::write(source.join("nested/ignored"), b"nested ignored bytes").unwrap();
    std::fs::set_permissions(
        source.join("nested/ignored"),
        std::fs::Permissions::from_mode(0o640),
    )
    .unwrap();
    std::fs::set_permissions(
        source.join("nested"),
        std::fs::Permissions::from_mode(0o750),
    )
    .unwrap();
    let outside = dir.path().join("outside");
    std::fs::write(&outside, "external bytes").unwrap();
    symlink(&outside, source.join("external")).unwrap();
    symlink("missing", source.join("dangling")).unwrap();
    symlink("nested", source.join("directory-link")).unwrap();
    let old = identity(&source.join("nested/ignored"));
    let mut called = false;
    retain_directory(&source, &target, |from, to| {
        assert_eq!(from, source);
        assert_eq!(to, target);
        assert!(!to.exists());
        called = true;
        Err(std::io::ErrorKind::CrossesDevices.into())
    })
    .unwrap();
    assert!(called);
    assert!(!source.exists());
    assert_ne!(identity(&target.join("nested/ignored")), old);
    assert_eq!(
        std::fs::read(target.join("nested/ignored")).unwrap(),
        b"nested ignored bytes"
    );
    assert_eq!(
        std::fs::metadata(target.join("nested/ignored"))
            .unwrap()
            .mode()
            & 0o777,
        0o640
    );
    assert_eq!(
        std::fs::metadata(target.join("nested")).unwrap().mode() & 0o777,
        0o750
    );
    assert_eq!(
        std::fs::read_link(target.join("external")).unwrap(),
        outside
    );
    assert_eq!(
        std::fs::read_link(target.join("dangling")).unwrap(),
        Path::new("missing")
    );
    assert_eq!(
        std::fs::read_link(target.join("directory-link")).unwrap(),
        Path::new("nested")
    );
    assert_eq!(std::fs::read_to_string(outside).unwrap(), "external bytes");
    // Restoration uses the same EXDEV-only seam.
    retain_directory(&target, &source, |_, _| {
        Err(std::io::ErrorKind::CrossesDevices.into())
    })
    .unwrap();
    assert_eq!(
        std::fs::read(source.join("nested/ignored")).unwrap(),
        b"nested ignored bytes"
    );
}

#[test]
fn g9_other_rename_errors_do_not_copy() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("ignored"), "keep").unwrap();
    let target = dir.path().join("target");
    assert!(
        retain_directory(&source, &target, |_, _| Err(
            std::io::ErrorKind::PermissionDenied.into()
        ))
        .is_err()
    );
    assert!(!target.exists());
    assert_eq!(
        std::fs::read_to_string(source.join("ignored")).unwrap(),
        "keep"
    );
}

#[test]
fn g9_failed_copy_keeps_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("ignored"), "keep").unwrap();
    let target = dir.path().join("occupied");
    std::fs::write(&target, "external destination").unwrap();
    assert!(
        retain_directory(&source, &target, |_, _| Err(
            std::io::ErrorKind::CrossesDevices.into()
        ))
        .is_err()
    );
    assert_eq!(
        std::fs::read_to_string(source.join("ignored")).unwrap(),
        "keep"
    );
    let socket = std::os::unix::net::UnixListener::bind(source.join("special")).unwrap();
    assert!(
        retain_directory(&source, &dir.path().join("target"), |_, _| Err(
            std::io::ErrorKind::CrossesDevices.into()
        ))
        .is_err()
    );
    assert!(source.join("special").exists());
    assert_eq!(
        std::fs::read_to_string(source.join("ignored")).unwrap(),
        "keep"
    );
    drop(socket);
}

#[test]
fn g9_restore_preserves_external_writes() {
    let (dir, git, w) = repository();
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    let backup = removal.entries[0].2.as_ref().unwrap().path().to_owned();
    removal.remove(&git, dir.path()).unwrap();
    let advanced = git
        .run(
            dir.path(),
            &["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "external"],
        )
        .unwrap();
    git.run(
        dir.path(),
        &["update-ref", &format!("refs/heads/{}", w.branch), &advanced],
    )
    .unwrap();
    std::fs::create_dir(&w.path).unwrap();
    std::fs::write(w.path.join("external"), "external files").unwrap();
    let err = removal.restore(&git, dir.path()).unwrap_err();
    assert!(err.message.contains(&backup.display().to_string()));
    assert_eq!(
        std::fs::read_to_string(backup.join("worktree/ignored")).unwrap(),
        "only ignored copy"
    );
    assert_eq!(
        std::fs::read_to_string(w.path.join("external")).unwrap(),
        "external files"
    );
    assert_eq!(
        git.reference(dir.path(), &format!("refs/heads/{}", w.branch))
            .unwrap(),
        Some(advanced)
    );
    std::fs::remove_dir_all(backup).unwrap();
}

#[test]
fn g9_failed_restore_keeps_recoverable_backup() {
    let (dir, git, w) = repository();
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    let backup = removal.entries[0].2.as_ref().unwrap().path().to_owned();
    removal.remove(&git, dir.path()).unwrap();
    // A filesystem restoration failure: the destination is now an external regular file.
    std::fs::write(&w.path, "external files").unwrap();
    let err = removal.restore(&git, dir.path()).unwrap_err();
    assert!(err.message.starts_with("worktree_failed:"));
    assert!(err.message.contains(&backup.display().to_string()));
    assert_eq!(std::fs::read_to_string(&w.path).unwrap(), "external files");
    assert_eq!(
        std::fs::read_to_string(backup.join("worktree/ignored")).unwrap(),
        "only ignored copy"
    );
    std::fs::remove_dir_all(backup).unwrap();
}

#[test]
fn g9_drop_before_git_removal_restores_prepared_moves() {
    let (dir, git, w) = repository();
    let original = identity(&w.path.join("ignored"));
    let removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    assert!(!w.path.exists());
    drop(removal);
    assert_eq!(identity(&w.path.join("ignored")), original);
    assert!(
        git.run(&w.path, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
}

#[test]
fn g9_later_preparation_failure_restores_earlier_moves() {
    let (dir, git, w) = repository();
    let plan = git.plan(dir.path(), "second", "1").unwrap();
    let second = git.provision(dir.path(), &plan).unwrap();
    std::fs::write(second.path.join("dirty"), "keep").unwrap();
    let before = identity(&w.path.join("ignored"));
    let listing = git
        .run(dir.path(), &["worktree", "list", "--porcelain"])
        .unwrap();
    assert!(
        git.prepare_removal(dir.path(), &[w.clone(), second.clone()])
            .is_err()
    );
    assert_eq!(identity(&w.path.join("ignored")), before);
    assert_eq!(
        git.run(dir.path(), &["worktree", "list", "--porcelain"])
            .unwrap(),
        listing
    );
    assert_eq!(
        std::fs::read_to_string(second.path.join("dirty")).unwrap(),
        "keep"
    );
    std::fs::remove_file(second.path.join("dirty")).unwrap();
    let mut removal = git
        .prepare_removal(dir.path(), &[w.clone(), second.clone()])
        .unwrap();
    removal.remove(&git, dir.path()).unwrap();
    drop(removal);
    assert!(!w.path.exists());
    assert!(!second.path.exists());
}

#[test]
fn g9_restore_rename_never_replaces_even_an_empty_external_directory() {
    let dir = tempfile::tempdir().unwrap();
    let saved = dir.path().join("saved");
    let original = dir.path().join("original");
    std::fs::create_dir(&saved).unwrap();
    std::fs::write(saved.join("ignored"), "keep").unwrap();
    std::fs::create_dir(&original).unwrap();
    let external = identity(&original);
    assert!(retain_directory(&saved, &original, rename_directory).is_err());
    assert_eq!(identity(&original), external);
    assert_eq!(
        std::fs::read_to_string(saved.join("ignored")).unwrap(),
        "keep"
    );
}

#[test]
fn g9_git_repair_failure_keeps_the_ignored_backup_after_guard_drop() {
    let (dir, git, w) = repository();
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    let backup = removal.entries[0].2.as_ref().unwrap().path().to_owned();
    let original = identity(&backup.join("worktree/ignored"));
    removal.remove(&git, dir.path()).unwrap();
    let wrappers = tempfile::tempdir().unwrap();
    let actual = Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    let actual = String::from_utf8(actual.stdout).unwrap();
    let wrapper = wrappers.path().join("git");
    std::fs::write(&wrapper, format!("#!/bin/sh\nif [ \"$1\" = worktree ] && [ \"$2\" = repair ]; then echo 'G9 repair failure' >&2; exit 1; fi\nexec '{}' \"$@\"\n", actual.trim())).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let failing = Git::with_path(format!(
        "{}:{}",
        wrappers.path().display(),
        std::env::var("PATH").unwrap()
    ));
    let err = removal.restore(&failing, dir.path()).unwrap_err();
    assert!(err.message.contains("G9 repair failure"));
    assert!(err.message.contains(&backup.display().to_string()));
    assert_eq!(
        std::fs::read_to_string(backup.join("worktree/ignored")).unwrap(),
        "only ignored copy"
    );
    assert_eq!(identity(&backup.join("worktree/ignored")), original);
    assert!(!w.path.exists());
    std::fs::remove_dir_all(backup).unwrap();
}

#[test]
fn g9_removal_preserves_a_branch_advanced_after_preparation() {
    let (dir, git, w) = repository();
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    let advanced = git
        .run(
            dir.path(),
            &["commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "external"],
        )
        .unwrap();
    // Even if the external writer also advances Base, no prepared tip may be deleted.
    for branch in ["main", &w.branch] {
        git.run(
            dir.path(),
            &["update-ref", &format!("refs/heads/{branch}"), &advanced],
        )
        .unwrap();
    }
    assert!(removal.remove(&git, dir.path()).is_err());
    removal.restore(&git, dir.path()).unwrap();
    assert_eq!(
        git.run(dir.path(), &["rev-parse", &w.branch]).unwrap(),
        advanced
    );
    assert_eq!(
        git.run(dir.path(), &["rev-parse", "main"]).unwrap(),
        advanced
    );
    assert_eq!(
        std::fs::read_to_string(w.path.join("ignored")).unwrap(),
        "only ignored copy"
    );
}

#[test]
fn g9_registration_restore_never_writes_through_an_external_symlink() {
    let (dir, git, w) = repository();
    let pointer = std::fs::read(w.path.join(".git")).unwrap();
    let external = dir.path().join("external-registration");
    std::fs::write(&external, &pointer).unwrap();
    std::fs::remove_file(w.path.join(".git")).unwrap();
    symlink(&external, w.path.join(".git")).unwrap();
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    removal.remove(&git, dir.path()).unwrap();
    removal.restore(&git, dir.path()).unwrap();
    assert_eq!(std::fs::read(external).unwrap(), pointer);
    assert!(
        !std::fs::symlink_metadata(w.path.join(".git"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert!(
        git.run(&w.path, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
}

#[test]
fn g9_preparation_timeout_restores_earlier_moves() {
    let (dir, git, first) = repository();
    let plan = git.plan(dir.path(), "second", "1").unwrap();
    let second = git.provision(dir.path(), &plan).unwrap();
    let before = identity(&first.path.join("ignored"));
    let wrappers = tempfile::tempdir().unwrap();
    let actual = Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    let actual = String::from_utf8(actual.stdout).unwrap();
    let wrapper = wrappers.path().join("git");
    std::fs::write(&wrapper, format!("#!/bin/sh\nif [ \"$1\" = status ] && [ . -ef '{}' ]; then sleep 100; fi\nexec '{}' \"$@\"\n", second.path.display(), actual.trim())).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bounded = Git::with_path(format!(
        "{}:{}",
        wrappers.path().display(),
        std::env::var("PATH").unwrap()
    ))
    .bounded();
    let err = match bounded.prepare_removal(dir.path(), &[first.clone(), second.clone()]) {
        Ok(_) => panic!("the second Worktree's status must time out"),
        Err(err) => err,
    };
    assert!(err.message.contains("deadline"));
    assert_eq!(identity(&first.path.join("ignored")), before);
    assert!(
        git.run(&first.path, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
    assert!(
        git.run(&second.path, &["status", "--porcelain"])
            .unwrap()
            .is_empty()
    );
    let mut retry = git
        .prepare_removal(dir.path(), &[first.clone(), second.clone()])
        .unwrap();
    retry.remove(&git, dir.path()).unwrap();
    drop(retry);
    assert!(!first.path.exists());
    assert!(!second.path.exists());
}

#[test]
fn g2542d_enrolled_removal_and_rollback_retain_the_directory() {
    let (dir, git, w) = repository();
    git.set_enrolled(std::slice::from_ref(&w.path));
    let directory = identity(&w.path);
    let file = identity(&w.path.join("ignored"));
    let reference = format!("refs/heads/{}", w.branch);
    let tip = git.run(dir.path(), &["rev-parse", &reference]).unwrap();

    // Rolled back: nothing moved, nothing deleted.
    let removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    assert_eq!(identity(&w.path), directory);
    removal.restore(&git, dir.path()).unwrap();
    assert_eq!(identity(&w.path.join("ignored")), file);
    assert_eq!(
        git.run(dir.path(), &["rev-parse", &reference]).unwrap(),
        tip
    );

    // Removed: the branch goes, the directory parks on its tip with the ignored file.
    let mut removal = git
        .prepare_removal(dir.path(), std::slice::from_ref(&w))
        .unwrap();
    removal.remove(&git, dir.path()).unwrap();
    assert_eq!(identity(&w.path), directory);
    assert_eq!(identity(&w.path.join("ignored")), file);
    assert!(git.run(&w.path, &["symbolic-ref", "-q", "HEAD"]).is_err());
    assert_eq!(git.run(&w.path, &["rev-parse", "HEAD"]).unwrap(), tip);
    assert!(
        git.run(dir.path(), &["rev-parse", "--verify", &reference])
            .is_err()
    );

    // A failed metadata restore keeps the directory and says how to resume.
    git.run(
        &w.path,
        &["commit", "-q", "--allow-empty", "-m", "moved on"],
    )
    .unwrap();
    let err = removal.restore(&git, dir.path()).unwrap_err();
    assert!(
        err.message.contains("kept; to resume run `git -C"),
        "{}",
        err.message
    );
    assert_eq!(identity(&w.path.join("ignored")), file);
}
