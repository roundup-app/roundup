//! G3 a Worktree's status, and G7 a Rail move never touches a Worktree (`scenarios/worktrees.md`).

use std::path::Path;

use agents::worktree::Git;
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn commit_file(dir: &Path, name: &str) {
    std::fs::write(dir.join(name), name).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", name]);
}

async fn state(f: &Fixture, id: &str) -> Result<Value, rpc::RpcError> {
    f.call("agent.worktreeState", json!({"id": id})).await
}

async fn on(f: &Fixture) -> (String, std::path::PathBuf) {
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = node.worktree.expect("a Worktree").path.into();
    (node.id, path)
}

#[tokio::test]
async fn g3_counts_commits_both_ways_and_untracked_files() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = on(&f).await;
    let project = f.dir.path();
    let before = git(project, &["rev-parse", "main"]);

    assert_eq!(
        state(&f, &id).await.unwrap(),
        json!({"ahead": 0, "behind": 0, "dirty": false})
    );
    commit_file(&path, "agent.txt");
    assert_eq!(
        state(&f, &id).await.unwrap(),
        json!({"ahead": 1, "behind": 0, "dirty": false})
    );
    commit_file(project, "base.txt");
    assert_eq!(
        state(&f, &id).await.unwrap(),
        json!({"ahead": 1, "behind": 1, "dirty": false})
    );
    std::fs::write(path.join("loose.txt"), "x").unwrap();
    let status = git(&path, &["status", "--porcelain=v2"]);
    assert_eq!(
        state(&f, &id).await.unwrap(),
        json!({"ahead": 1, "behind": 1, "dirty": true})
    );
    assert_eq!(git(&path, &["status", "--porcelain=v2"]), status);
    assert_ne!(git(project, &["rev-parse", "main"]), before);
}

#[tokio::test]
async fn g3_without_a_worktree_or_directory_it_fails_by_name() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let plain = f.spawn(None, None).await.unwrap();
    let err = state(&f, &plain.id).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(err.message.starts_with("no_worktree: "), "{}", err.message);

    let (id, path) = on(&f).await;
    std::fs::remove_dir_all(&path).unwrap();
    let err = state(&f, &id).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(
        err.message
            .starts_with(&format!("worktree_missing: {}", path.display())),
        "{}",
        err.message
    );
    assert!(f.tree().await.iter().any(|node| node.id == id));
}

#[tokio::test]
async fn g7_a_rail_move_changes_only_parent_and_order() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = on(&f).await;
    commit_file(&path, "kept.txt");
    std::fs::write(path.join("README.md"), "edited\n").unwrap();
    std::fs::write(path.join("loose.txt"), "x").unwrap();
    let workstream = f.workstream("elsewhere", None).await;
    let snapshot = |f: &Fixture| {
        let project = f.dir.path();
        (
            git(&path, &["diff"]),
            git(&path, &["diff", "--cached"]),
            git(&path, &["status", "--porcelain=v2"]),
            git(project, &["worktree", "list"]),
            git(
                project,
                &["rev-parse", "main", &format!("roundup/agent-{id}")],
            ),
        )
    };
    let before = snapshot(&f);
    let node_before = f.tree().await.into_iter().find(|n| n.id == id).unwrap();
    let state_before = state(&f, &id).await.unwrap();

    f.call(
        "rail.move",
        json!({"id": id, "parent": workstream, "index": 0}),
    )
    .await
    .unwrap();
    f.call("rail.move", json!({"id": id, "parent": null, "index": 0}))
        .await
        .unwrap();

    let node = f.tree().await.into_iter().find(|n| n.id == id).unwrap();
    assert_eq!(node.worktree, node_before.worktree);
    assert_eq!(node.terminal_id, node_before.terminal_id);
    assert_eq!(snapshot(&f), before);
    assert_eq!(state(&f, &id).await.unwrap(), state_before);

    let missing = f
        .call("rail.move", json!({"id": id, "parent": "nope", "index": 0}))
        .await
        .unwrap_err();
    assert_eq!(missing.code, code::NOT_FOUND);
    let under_agent = f
        .call(
            "rail.move",
            json!({"id": workstream, "parent": id, "index": 0}),
        )
        .await
        .unwrap_err();
    assert_eq!(under_agent.code, code::CONFLICT);
    assert_eq!(snapshot(&f), before);
}

// D9: the real Git holder must settle a finite 60-second read before the App's 30-second bound.
#[tokio::test]
async fn d9_worktree_state_returns_a_daemon_error_before_the_app_bound() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let wrapper = tempfile::tempdir().unwrap();
    let real = git(wrapper.path(), &["--exec-path"]);
    let executable = Path::new(real.trim()).join("git");
    let marker = wrapper.path().join("entered");
    let enabled = wrapper.path().join("hold");
    let script = wrapper.path().join("git");
    std::fs::write(&script, format!(
        "#!/bin/sh\nif [ -f '{}' ] && [ \"$1\" = rev-list ]; then echo $$ > '{}'; exec sleep 60; fi\nexec '{}' \"$@\"\n",
        enabled.display(), marker.display(), executable.display()
    )).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let holder = Git::with_path(format!(
        "{}:{}",
        wrapper.path().display(),
        std::env::var("PATH").unwrap()
    ));
    let f = Fixture::in_git_project("exec sleep 30", holder);
    let (id, _) = on(&f).await;
    std::fs::write(enabled, "hold").unwrap();
    let result = tokio::time::timeout(Duration::from_secs(8), state(&f, &id)).await;
    // Clean up the finite wrapper even on the red implementation; it execs sleep, so this PID
    // owns the entire delayed command rather than an untracked descendant.
    let pid = std::fs::read_to_string(&marker).expect("the Git wrapper entered");
    let _ = std::process::Command::new("kill")
        .args(["-KILL", pid.trim()])
        .stderr(std::process::Stdio::null())
        .status();
    f.call("agent.stop", json!({"id": id})).await.unwrap();
    let err = result
        .expect("the Daemon Worktree wait exceeded its budget")
        .unwrap_err();
    assert!(err.message.contains("deadline"), "{err:?}");
}

// A real checkout hook runs after Git has created its registration and directory.
#[tokio::test]
async fn d9_provisioning_deadline_recovers_owned_work_and_releases_the_git_lock() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let marker = f.dir.path().join("entered");
    let hook = f.dir.path().join(".git/hooks/post-checkout");
    std::fs::write(
        &hook,
        format!(
            "#!/bin/sh\necho $$ > '{}'\nexec sleep 60\n",
            marker.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let err = tokio::time::timeout(Duration::from_secs(8), f.spawn(None, None))
        .await
        .expect("provisioning exceeded its Daemon budget")
        .unwrap_err();
    assert!(err.message.contains("deadline"), "{err:?}");
    let pid = std::fs::read_to_string(marker).expect("checkout hook entered");
    assert!(
        !std::process::Command::new("kill")
            .args(["-0", pid.trim()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success(),
        "hook survived its Git command"
    );
    assert!(
        git(
            f.dir.path(),
            &[
                "for-each-ref",
                "--format=%(refname)",
                "refs/heads/roundup",
                "refs/roundup/provisioning"
            ]
        )
        .is_empty()
    );
    assert_eq!(
        git(f.dir.path(), &["worktree", "list", "--porcelain"])
            .matches("worktree ")
            .count(),
        1
    );
    assert!(f.tree().await.is_empty());
    std::fs::remove_file(hook).unwrap();
    let node = tokio::time::timeout(Duration::from_secs(8), f.spawn(None, None))
        .await
        .unwrap()
        .unwrap();
    assert!(
        node.worktree.is_some(),
        "later provisioning must acquire the released holder"
    );
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
}

#[tokio::test]
async fn d9_worktree_lock_acquisition_uses_the_same_deadline_as_commands() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let wrapper = tempfile::tempdir().unwrap();
    let real = git(wrapper.path(), &["--exec-path"]);
    let executable = Path::new(real.trim()).join("git");
    let marker = wrapper.path().join("entered");
    let enabled = wrapper.path().join("hold");
    let script = wrapper.path().join("git");
    std::fs::write(&script, format!(
        "#!/bin/sh\nif [ -f '{}' ] && [ \"$1\" = rev-parse ]; then echo $$ > '{}'; exec sleep 60; fi\nexec '{}' \"$@\"\n",
        enabled.display(), marker.display(), executable.display()
    )).unwrap();
    std::fs::set_permissions(script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let holder = Git::with_path(format!(
        "{}:{}",
        wrapper.path().display(),
        std::env::var("PATH").unwrap()
    ));
    let f = Fixture::in_git_project("exec sleep 30", holder.clone());
    let (id, _) = on(&f).await;
    std::fs::write(enabled, "hold").unwrap();
    let project = f.dir.path().to_owned();
    // The existing CLI holder has no App deadline; it must not lend its lifetime to an App read.
    let parked = tokio::task::spawn_blocking(move || holder.plan(&project, "parked"));
    tokio::time::timeout(Duration::from_secs(5), async {
        while !marker.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("Git must signal entry before measuring lock acquisition");
    let result = tokio::time::timeout(Duration::from_secs(5), state(&f, &id)).await;
    let pid = std::fs::read_to_string(marker).unwrap();
    assert!(
        std::process::Command::new("kill")
            .args(["-KILL", pid.trim()])
            .status()
            .unwrap()
            .success()
    );
    assert!(parked.await.unwrap().is_err());
    f.call("agent.stop", json!({"id": id})).await.unwrap();
    let err = result
        .expect("lock acquisition exceeded the Daemon budget")
        .unwrap_err();
    assert!(err.message.contains("deadline"), "{err:?}");
}

#[tokio::test]
async fn g4_the_configured_check_keeps_its_lifetime_beyond_app_git_waits() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let (id, _) = on(&f).await;
    f.call(
        "project.setWorktrees",
        json!({"on": true, "check": "sleep 4"}),
    )
    .await
    .unwrap();
    let before = git(f.dir.path(), &["rev-parse", "main"]);
    let landed = f.call("agent.land", json!({"id": id})).await.unwrap();
    assert_eq!(landed["base"], before.trim());
    f.call("agent.stop", json!({"id": id})).await.unwrap();
}

#[tokio::test]
async fn d9_reopening_with_parked_git_preserves_unfinished_provisioning() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;

    let wrapper = tempfile::tempdir().unwrap();
    let real = git(wrapper.path(), &["--exec-path"]);
    let executable = Path::new(real.trim()).join("git");
    let fail = wrapper.path().join("fail");
    let hold = wrapper.path().join("hold");
    let marker = wrapper.path().join("entered");
    let script = wrapper.path().join("git");
    std::fs::write(&script, format!(
        "#!/bin/sh\nif [ -f '{}' ] && {{ {{ [ \"$1\" = rev-parse ] && [ \"$2\" = --git-path ]; }} || {{ [ \"$1\" = worktree ] && [ \"$2\" = remove ]; }}; }}; then exit 1; fi\nif [ -f '{}' ] && [ \"$1\" = show-ref ]; then echo $$ > '{}'; exec sleep 60; fi\nexec '{}' \"$@\"\n",
        fail.display(), hold.display(), marker.display(), executable.display()
    )).unwrap();
    std::fs::set_permissions(script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let holder = Git::with_path(format!(
        "{}:{}",
        wrapper.path().display(),
        std::env::var("PATH").unwrap()
    ));
    let mut f = Fixture::in_git_project("exec sleep 30", holder.clone());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    std::fs::write(&fail, "fail").unwrap();
    f.spawn(None, None).await.unwrap_err();
    let kept = f
        .tree()
        .await
        .pop()
        .expect("failed recovery retains its record");
    let path = Path::new(&kept.worktree.as_ref().unwrap().path);
    std::fs::write(path.join("keep"), "user work").unwrap();
    std::fs::remove_file(fail).unwrap();
    std::fs::write(hold, "hold").unwrap();
    let dir = f.dir.path().join(".roundup");
    let bin = f.dir.path().join("fake-claude").display().to_string();
    let bus = f.bus.clone();
    let reopened = tokio::task::spawn_blocking(move || {
        crate::common::open_in_with_git(&dir, &bus, &bin, holder)
    });
    let (agents, terminals) = tokio::time::timeout(Duration::from_secs(8), reopened)
        .await
        .expect("recovery must not hold Project opening indefinitely")
        .unwrap();
    (f.agents, f.terminals) = (agents, terminals);
    let node = f
        .tree()
        .await
        .into_iter()
        .find(|node| node.id == kept.id)
        .unwrap();
    assert_eq!(node.worktree, kept.worktree);
    assert_eq!(
        std::fs::read_to_string(path.join("keep")).unwrap(),
        "user work"
    );
    let pid = std::fs::read_to_string(marker).expect("recovery entered Git");
    assert!(
        !std::process::Command::new("kill")
            .args(["-0", pid.trim()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success(),
        "recovery Git survived its deadline"
    );
}
