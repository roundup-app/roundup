//! G1 to G6 exclude handling, symlinked folders, removal and recovery (`scenarios/worktrees.md`).

use super::*;

#[tokio::test]
async fn g1_setting_twice_stores_the_later_value() {
    let f = Fixture::new();
    set_worktrees(&f, true, Some("just check")).await;

    set_worktrees(&f, false, None).await;

    assert_eq!(
        project_get(&f).await.worktrees,
        Worktrees {
            on: false,
            check: None
        }
    );
}

#[tokio::test]
async fn g2_an_exclude_file_with_no_final_newline_keeps_its_last_line() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let exclude = f.dir.path().join(".git/info/exclude");
    std::fs::write(&exclude, "target").unwrap();

    f.spawn(None, None).await.unwrap();

    assert_eq!(
        std::fs::read_to_string(exclude).unwrap(),
        "target\n.roundup/\n"
    );
}

#[tokio::test]
async fn g2_a_repository_with_no_info_directory_still_gets_the_exclude_line() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    std::fs::remove_dir_all(f.dir.path().join(".git/info")).unwrap();

    f.spawn(None, None).await.unwrap();

    let exclude = std::fs::read_to_string(f.dir.path().join(".git/info/exclude")).unwrap();
    assert_eq!(exclude, ".roundup/\n");
}

#[tokio::test]
async fn g2_a_padded_exclude_entry_counts_as_present() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let exclude = f.dir.path().join(".git/info/exclude");
    std::fs::write(&exclude, "  .roundup/ \r\n").unwrap();

    f.spawn(None, None).await.unwrap();

    assert_eq!(
        std::fs::read_to_string(exclude).unwrap(),
        "  .roundup/ \r\n"
    );
}

#[tokio::test]
async fn g2_a_failure_locating_the_exclude_file_leaves_nothing() {
    let wrapper = tempfile::tempdir().unwrap();
    let f = Fixture::in_git_project(
        "sleep 30",
        failing_commands_git(wrapper.path(), GIT_PATH_FAILS),
    );
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());

    let err = f.spawn(None, None).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    assert_eq!(git_state(f.dir.path()), before);
    assert!(!f.dir.path().join(".roundup/worktrees/agent-1").exists());
}

#[tokio::test]
async fn g2_g6_failed_cleanup_retains_ownership_until_reopen_recovers_it() {
    let wrapper = tempfile::tempdir().unwrap();
    let removal_fails = "[ \"$1\" = worktree ] && [ \"$2\" = remove ]";
    let f = Fixture::in_git_project(
        "sleep 30",
        failing_commands_git(
            wrapper.path(),
            &format!("{{ {GIT_PATH_FAILS}; }} || {{ {removal_fails}; }}"),
        ),
    );
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());

    f.spawn(None, None).await.unwrap_err();

    assert_ne!(git_state(f.dir.path()), before);
    assert!(f.dir.path().join(".roundup/worktrees/agent-1").exists());
    assert!(f.tree().await[0].worktree.is_some());
    let f = f.reopen();
    assert_eq!(git_state(f.dir.path()), before);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn g2_a_dotdot_cwd_is_judged_by_where_it_leads() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let sub = f.dir.path().join("sub");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("keep.txt"), "x").unwrap();
    git_output(f.dir.path(), &["add", "sub/keep.txt"]);
    git_output(f.dir.path(), &["commit", "-q", "-m", "add sub"]);
    let before = git_state(f.dir.path());

    let out = spawn_in(&f, &sub.join("../.."), None).await.unwrap_err();
    let back = spawn_in(&f, &sub.join(".."), None).await.unwrap();

    assert_eq!(out.code, code::INVALID_PARAMS);
    assert!(
        out.message.contains("outside the project folder"),
        "{}",
        out.message
    );
    assert_eq!(
        git_state(f.dir.path()).0.lines().count(),
        before.0.lines().count() + 1
    );
    let worktree = std::fs::canonicalize(back.worktree.clone().unwrap().path).unwrap();
    assert_eq!(
        std::fs::canonicalize(terminal_cwd(&f, &back).await).unwrap(),
        worktree
    );
}

#[tokio::test]
async fn g2_a_symlink_to_the_project_is_a_cwd_inside_it() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let elsewhere = tempfile::tempdir().unwrap();
    let link = elsewhere.path().join("link");
    std::os::unix::fs::symlink(f.dir.path(), &link).unwrap();

    let node = spawn_in(&f, &link, None).await.unwrap();

    let worktree = std::fs::canonicalize(node.worktree.clone().unwrap().path).unwrap();
    assert_eq!(
        std::fs::canonicalize(terminal_cwd(&f, &node).await).unwrap(),
        worktree
    );
}

#[tokio::test]
async fn g2_a_failed_start_door_emits_no_event() {
    let wrapper = tempfile::tempdir().unwrap();
    let mut f = Fixture::in_git_project("sleep 30", failing_git(wrapper.path()));
    set_worktrees(&f, true, None).await;
    let workstream = f.workstream("team", None).await;
    f.changed();

    start_door(&f, &workstream).await.unwrap_err();

    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn g2_a_project_opened_through_a_symlink_accepts_its_own_folder() {
    let mut f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let elsewhere = tempfile::tempdir().unwrap();
    let link = elsewhere.path().join("project");
    std::os::unix::fs::symlink(f.dir.path(), &link).unwrap();
    let bin = f.dir.path().join("fake-claude");
    let (agents, terminals) = crate::common::open_in_with_git(
        &link.join(".roundup"),
        &f.bus,
        &bin.to_string_lossy(),
        Git::from_env(),
    );
    (f.agents, f.terminals) = (agents, terminals);

    let at_link = spawn_in(&f, &link, None).await.unwrap();
    let at_real = spawn_in(&f, f.dir.path(), None).await.unwrap();

    for node in [&at_link, &at_real] {
        let worktree = std::fs::canonicalize(node.worktree.clone().unwrap().path).unwrap();
        let cwd = std::fs::canonicalize(terminal_cwd(&f, node).await).unwrap();
        assert_eq!(cwd, worktree);
    }
}

#[tokio::test]
async fn g2_g6_door_retry_reuses_recorded_worktree_and_preserves_uncommitted_files() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    f.call("project.setWorktrees", json!({"on":true,"check":null}))
        .await
        .unwrap();
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    let first = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    let path = std::path::PathBuf::from(first["worktree"]["path"].as_str().unwrap());
    std::fs::write(path.join("uncommitted.txt"), "keep me").unwrap();
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let rup = f.dir.path().join(".roundup/rup");
    std::fs::remove_file(&rup).unwrap();
    assert!(f.call("rail.startDoor", json!({"id":id})).await.is_err());
    assert_eq!(
        std::fs::read_to_string(path.join("uncommitted.txt")).unwrap(),
        "keep me"
    );
    std::fs::write(rup, "").unwrap();
    let second = f.call("rail.startDoor", json!({"id":id})).await.unwrap();
    assert_eq!(second["worktree"], first["worktree"]);
    assert_eq!(second["attempt"], "3");
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let renamed = path.with_extension("retained");
    std::fs::rename(&path, &renamed).unwrap();
    let err = f
        .call("rail.startDoor", json!({"id":id}))
        .await
        .unwrap_err();
    assert!(err.message.starts_with("worktree_missing:"));
    let tree = f.call("rail.tree", Value::Null).await.unwrap();
    assert_eq!(tree[0]["worktree"], first["worktree"]);
    std::fs::rename(renamed, path).unwrap();
}

#[tokio::test]
async fn g5_removing_unlanded_work_refuses_before_stopping_the_door() {
    for (dirty, ahead) in [(true, false), (false, true), (true, true)] {
        let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
        set_worktrees(&f, true, None).await;
        let workstream = f
            .call(
                "rail.createWorkstream",
                json!({"name":"workstream","parent":null}),
            )
            .await
            .unwrap();
        let id = workstream["id"].as_str().unwrap();
        let node = start_door(&f, id).await.unwrap();
        let worktree = node.worktree.clone().unwrap();
        let path = Path::new(&worktree.path);
        if ahead {
            std::fs::write(path.join("committed"), "keep").unwrap();
            git_output(path, &["add", "committed"]);
            git_output(path, &["commit", "-qm", "keep"]);
        }
        if dirty {
            std::fs::write(path.join("dirty"), "keep").unwrap();
        }
        let before = git_state(f.dir.path());
        let err = f.call("rail.remove", json!({"id":id})).await.unwrap_err();
        assert_eq!(err.code, code::CONFLICT);
        assert!(err.message.starts_with("worktree_unlanded:"));
        assert_eq!(err.message.contains("dirty 1"), dirty);
        assert_eq!(err.message.contains("ahead 1"), ahead);
        assert_eq!(git_state(f.dir.path()), before);
        assert!(
            f.terminals
                .list()
                .await
                .iter()
                .any(|t| Some(&t.id) == node.terminal_id.as_ref() && t.running)
        );
        f.call("agent.stop", json!({"id":id})).await.unwrap();
    }
}

#[tokio::test]
async fn g5_removing_clean_workstream_removes_only_its_worktree() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    let node = start_door(&f, id).await.unwrap();
    f.call("rail.remove", json!({"id":id})).await.unwrap();
    assert_eq!(git_state(f.dir.path()), before);
    assert!(!Path::new(&node.worktree.unwrap().path).exists());
}

#[tokio::test]
async fn g5_a_write_during_stop_keeps_the_stopped_door_and_worktree() {
    let f = Fixture::in_git_project(
        "trap 'echo keep > stopped-write; exit' HUP INT\necho ready > ready\nwhile :; do read line; done",
        Git::from_env(),
    );
    set_worktrees(&f, true, None).await;
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    let node = start_door(&f, id).await.unwrap();
    let worktree = node.worktree.unwrap();
    let path = Path::new(&worktree.path);
    crate::common::until_file(&path.join("ready")).await;
    std::fs::remove_file(path.join("ready")).unwrap();
    let err = f.call("rail.remove", json!({"id":id})).await.unwrap_err();
    assert!(err.message.starts_with("worktree_unlanded:"));
    let retained = f
        .tree()
        .await
        .into_iter()
        .find(|node| node.id == id)
        .unwrap();
    assert_eq!(retained.terminal_id, None);
    assert_eq!(retained.status.unwrap().kind, contracts::Kind::Done);
    assert_eq!(retained.worktree, Some(worktree.clone()));
    assert_eq!(
        std::fs::read_to_string(path.join("stopped-write")).unwrap(),
        "keep\n"
    );
}

#[tokio::test]
async fn g5_missing_worktree_does_not_allow_deleting_an_ahead_branch() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    let node = start_door(&f, id).await.unwrap();
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let worktree = node.worktree.unwrap();
    let path = Path::new(&worktree.path);
    git_output(path, &["commit", "--allow-empty", "-qm", "keep"]);
    std::fs::remove_dir_all(path).unwrap();
    let err = f.call("rail.remove", json!({"id":id})).await.unwrap_err();
    assert!(err.message.contains("ahead 1"));
    assert_eq!(f.tree().await[0].worktree, Some(worktree.clone()));
    git_output(
        f.dir.path(),
        &[
            "update-ref",
            &format!("refs/heads/{}", worktree.branch),
            git_output(f.dir.path(), &["rev-parse", &worktree.base]).trim(),
        ],
    );
    f.call("rail.remove", json!({"id":id})).await.unwrap();
    assert!(f.tree().await.is_empty());
    assert!(!git_output(f.dir.path(), &["branch", "--list"]).contains(&worktree.branch));
}

#[tokio::test]
async fn g6_reopened_door_reuses_commits_and_dirty_files_without_launching_on_open() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let workstream = f
        .call(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap().to_owned();
    let node = start_door(&f, &id).await.unwrap();
    let worktree = node.worktree.unwrap();
    let path = Path::new(&worktree.path);
    git_output(path, &["commit", "--allow-empty", "-qm", "keep"]);
    std::fs::write(path.join("dirty"), "keep").unwrap();
    let head = git_output(path, &["rev-parse", "HEAD"]);
    f.call("agent.stop", json!({"id":id})).await.unwrap();
    let f = f.reopen();
    assert!(f.terminals.list().await.is_empty());
    set_worktrees(&f, false, None).await;
    let next = start_door(&f, &id).await.unwrap();
    assert_eq!(next.worktree, Some(worktree.clone()));
    assert_eq!(git_output(path, &["rev-parse", "HEAD"]), head);
    assert_eq!(std::fs::read_to_string(path.join("dirty")).unwrap(), "keep");
    f.call("agent.stop", json!({"id":id})).await.unwrap();
}

#[tokio::test]
async fn g6_recovery_preserves_changed_or_unowned_provisioning_resources() {
    for change in ["dirty", "commit", "owner"] {
        let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
        let git = Git::from_env();
        let plan = git.plan(f.dir.path(), "owned").unwrap();
        let worktree = git.provision(f.dir.path(), &plan).unwrap();
        match change {
            "dirty" => std::fs::write(worktree.path.join("keep"), "user work").unwrap(),
            "commit" => {
                git_output(
                    &worktree.path,
                    &["commit", "--allow-empty", "-qm", "user work"],
                );
            }
            "owner" => {
                git_output(f.dir.path(), &["update-ref", "-d", &plan.owner]);
            }
            _ => unreachable!(),
        }
        let before = git_state(f.dir.path());
        let head = git_output(&worktree.path, &["rev-parse", "HEAD"]);
        let err = git.recover(f.dir.path(), &plan).unwrap_err();
        assert!(err.message.starts_with("worktree_failed:"));
        assert_eq!(git_state(f.dir.path()), before);
        assert_eq!(git_output(&worktree.path, &["rev-parse", "HEAD"]), head);
        if change == "dirty" {
            assert_eq!(
                std::fs::read_to_string(worktree.path.join("keep")).unwrap(),
                "user work"
            );
        }
    }
}

#[tokio::test]
async fn a34_a_door_worktree_failure_preserves_files_for_retry() {
    let guard = tempfile::tempdir().unwrap();
    let fail = guard.path().join("fail");
    let git = wrapped_git(
        guard.path(),
        &format!(
            "if [ \"$1\" = update-ref ] && [ \"$2\" = -d ] && [ -e '{}' ]; then case \"$3\" in refs/heads/*) rm '{}'; echo refused >&2; exit 1;; esac; fi\nexec \"$REAL\" \"$@\"",
            fail.display(),
            fail.display()
        ),
    );
    let f = Fixture::in_git_project("exec sleep 30", git);
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());
    let id = f.workstream("workstream", None).await;
    let node = start_door(&f, &id).await.unwrap();
    std::fs::write(fail, "once").unwrap();
    f.call("rail.remove", json!({"id":id})).await.unwrap_err();
    // A34 narrows G5 for a Workstream: restore the directory after a later branch failure.
    assert!(Path::new(&node.worktree.as_ref().unwrap().path).exists());
    assert_eq!(f.tree().await[0].worktree, node.worktree);
    f.call("rail.remove", json!({"id":id})).await.unwrap();
    assert!(f.tree().await.is_empty());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g5_branch_advance_after_safety_check_is_not_deleted() {
    let guard = tempfile::tempdir().unwrap();
    let advance = guard.path().join("advance");
    let count = guard.path().join("count");
    let git = wrapped_git(
        guard.path(),
        &format!(
            "if [ \"$1\" = rev-list ]; then n=0; [ ! -e '{}' ] || read n < '{}'; n=$((n+1)); echo \"$n\" > '{}'; if [ \"$n\" = 2 ]; then \"$REAL\" \"$@\" || exit; read branch commit < '{}'; \"$REAL\" update-ref \"$branch\" \"$commit\"; exit; fi; fi\nexec \"$REAL\" \"$@\"",
            count.display(),
            count.display(),
            count.display(),
            advance.display()
        ),
    );
    let f = Fixture::in_git_project("exec sleep 30", git);
    set_worktrees(&f, true, None).await;
    let id = f.workstream("workstream", None).await;
    let node = start_door(&f, &id).await.unwrap();
    let worktree = node.worktree.unwrap();
    let commit = git_output(
        f.dir.path(),
        &[
            "commit-tree",
            "HEAD^{tree}",
            "-p",
            "HEAD",
            "-m",
            "keep concurrent work",
        ],
    );
    std::fs::write(
        advance,
        format!("refs/heads/{} {}\n", worktree.branch, commit.trim()),
    )
    .unwrap();
    f.call("rail.remove", json!({"id":id})).await.unwrap_err();
    assert_eq!(
        git_output(f.dir.path(), &["rev-parse", &worktree.branch]),
        commit
    );
    assert_eq!(f.tree().await[0].worktree, Some(worktree));
    assert!(
        f.call("rail.remove", json!({"id":id}))
            .await
            .unwrap_err()
            .message
            .contains("ahead 1")
    );
}

#[tokio::test]
async fn g6_a_record_recovery_refuses_keeps_its_work_and_the_project_opens() {
    for record in ["legacy", "unowned"] {
        let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
        set_worktrees(&f, true, None).await;
        let node = f.spawn(None, None).await.unwrap();
        let path = PathBuf::from(node.worktree.clone().unwrap().path);
        std::fs::write(path.join("keep"), "user work").unwrap();
        f.call("agent.stop", json!({"id": node.id})).await.unwrap();
        // A crash during `git` leaves the row provisioning: before ownership proofs with no
        // owner at all, or with an owner ref that no longer proves the destination is ours.
        let owner = if record == "legacy" {
            "NULL"
        } else {
            "'refs/roundup/gone'"
        };
        rusqlite::Connection::open(f.dir.path().join(".roundup/agents.db"))
            .unwrap()
            .execute(
                &format!(
                    "UPDATE nodes SET worktree_state = 'provisioning', worktree_owner = {owner},
                     worktree_commit = 'deadbeef' WHERE id = ?"
                ),
                [&node.id],
            )
            .unwrap();
        let before = git_state(f.dir.path());

        let f = f.reopen();

        let kept = f.tree().await.into_iter().find(|n| n.id == node.id);
        assert_eq!(kept.and_then(|n| n.worktree), node.worktree, "{record}");
        assert_eq!(git_state(f.dir.path()), before, "{record}");
        assert_eq!(
            std::fs::read_to_string(path.join("keep")).unwrap(),
            "user work"
        );
        let other = f.spawn(None, None).await.unwrap();
        f.call("agent.stop", json!({"id": other.id})).await.unwrap();
    }
}
