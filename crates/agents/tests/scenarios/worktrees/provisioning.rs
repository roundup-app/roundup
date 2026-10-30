//! G1 and G2 provisioning, failure cleanup and cwd mapping (`scenarios/worktrees.md`).

use super::*;

#[tokio::test]
async fn g1_setting_defaults_off_and_survives_restart() {
    let f = Fixture::new();
    assert_eq!(
        project_get(&f).await.worktrees,
        Worktrees {
            on: false,
            check: None
        }
    );

    set_worktrees(&f, true, Some("just check")).await;

    let f = f.reopen();
    assert_eq!(
        project_get(&f).await.worktrees,
        Worktrees {
            on: true,
            check: Some("just check".into())
        }
    );
}

#[tokio::test]
async fn g1_empty_check_is_invalid_params() {
    let f = Fixture::new();

    let err = f
        .call("project.setWorktrees", json!({"on": true, "check": ""}))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(
        project_get(&f).await.worktrees,
        Worktrees {
            on: false,
            check: None
        }
    );
}

#[tokio::test]
async fn g1_off_leaves_spawn_as_a4_says() {
    let f = Fixture::running("sleep 30");

    let node = f.spawn(None, None).await.unwrap();

    assert_eq!(node.worktree, None);
    assert_eq!(f.tree().await[0].worktree, None);
}

#[tokio::test]
async fn g2_spawn_makes_branch_and_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let commit = git_output(f.dir.path(), &["rev-parse", "HEAD"])
        .trim()
        .to_owned();

    let node = f.spawn(None, None).await.unwrap();

    let worktree = node.worktree.clone().expect("a Worktree");
    assert_eq!(worktree.branch, format!("roundup/agent-{}", node.id));
    assert_eq!(worktree.base, "main");
    assert_eq!(
        git_output(f.dir.path(), &["rev-parse", &worktree.branch])
            .trim()
            .to_owned(),
        commit,
        "the branch starts at the Project's current commit"
    );
    let path = PathBuf::from(&worktree.path);
    assert_eq!(
        path,
        f.dir
            .path()
            .join(".roundup/worktrees")
            .join(format!("agent-{}", node.id))
    );
    assert!(path.is_dir());
    assert!(
        git_output(f.dir.path(), &["branch", "--list", &worktree.branch])
            .contains(&worktree.branch)
    );
    assert!(
        git_output(f.dir.path(), &["worktree", "list"]).contains(path.to_string_lossy().as_ref())
    );
    assert_eq!(f.tree().await[0].worktree, Some(worktree));
}

#[tokio::test]
async fn g2_base_is_the_branch_checked_out_not_always_main() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    git_output(f.dir.path(), &["checkout", "-q", "-b", "feature"]);
    set_worktrees(&f, true, None).await;

    let node = f.spawn(None, None).await.unwrap();

    assert_eq!(node.worktree.unwrap().base, "feature");
}

#[tokio::test]
async fn g2_exclude_worktrees_is_added_once() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let exclude = f.dir.path().join(".git/info/exclude");
    let count = |text: &str| {
        text.lines()
            .filter(|line| line.trim() == ".roundup/")
            .count()
    };

    f.spawn(None, None).await.unwrap();
    assert_eq!(count(&std::fs::read_to_string(&exclude).unwrap()), 1);

    f.spawn(None, None).await.unwrap();
    assert_eq!(count(&std::fs::read_to_string(&exclude).unwrap()), 1);
}

#[tokio::test]
async fn g2_a_project_whose_git_is_a_file_gets_the_exclude_line_in_the_real_git_dir() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let elsewhere = tempfile::tempdir().unwrap();
    let git_dir = elsewhere.path().join("gitdir");
    std::fs::rename(f.dir.path().join(".git"), &git_dir).unwrap();
    std::fs::write(
        f.dir.path().join(".git"),
        format!("gitdir: {}\n", git_dir.display()),
    )
    .unwrap();

    f.spawn(None, None).await.unwrap();

    let exclude = std::fs::read_to_string(git_dir.join("info/exclude")).unwrap();
    assert!(exclude.lines().any(|line| line.trim() == ".roundup/"));
}

#[tokio::test]
async fn g2_cwd_outside_project_is_invalid_params() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let outside = tempfile::tempdir().unwrap();
    let before = git_state(f.dir.path());

    let err = spawn_in(&f, outside.path(), None).await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(
        err.message.contains("outside the project folder"),
        "{}",
        err.message
    );
    assert!(f.tree().await.is_empty());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_start_failure_after_provisioning_leaves_no_branch_no_directory() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());
    std::fs::remove_file(f.dir.path().join(".roundup/rup")).unwrap();

    let err = f.spawn(None, None).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    assert!(f.tree().await.is_empty());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_exclude_failure_undoes_branch_and_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let exclude = f.dir.path().join(".git/info/exclude");
    // Read-only, not missing or a directory: `git worktree add` itself reads `info/exclude`
    // (and fails if it can't be read as a file), so only a write failure isolates the step
    // this test targets.
    std::fs::set_permissions(&exclude, std::fs::Permissions::from_mode(0o444)).unwrap();
    let before = git_state(f.dir.path());

    let err = f.spawn(None, None).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    assert!(
        err.message.starts_with("worktree_failed: "),
        "{}",
        err.message
    );
    assert!(f.tree().await.is_empty());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_two_spawns_have_different_cwds() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    async fn cwd_of(f: &Fixture, node: &RailNode) -> String {
        f.terminals
            .list()
            .await
            .into_iter()
            .find(|t| Some(&t.id) == node.terminal_id.as_ref())
            .unwrap()
            .cwd
    }

    let a = f.spawn(None, None).await.unwrap();
    let b = f.spawn(None, None).await.unwrap();

    assert_ne!(cwd_of(&f, &a).await, cwd_of(&f, &b).await);
    assert_ne!(a.worktree.unwrap().path, b.worktree.unwrap().path);
}

#[tokio::test]
async fn g2_two_start_doors_have_different_cwds() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let g1 = f.workstream("g1", None).await;
    let g2 = f.workstream("g2", None).await;
    async fn cwd_of(f: &Fixture, node: &RailNode) -> String {
        f.terminals
            .list()
            .await
            .into_iter()
            .find(|t| Some(&t.id) == node.terminal_id.as_ref())
            .unwrap()
            .cwd
    }

    let a = start_door(&f, &g1).await.unwrap();
    let b = start_door(&f, &g2).await.unwrap();

    assert_ne!(cwd_of(&f, &a).await, cwd_of(&f, &b).await);
    assert_ne!(a.worktree.unwrap().path, b.worktree.unwrap().path);
}

#[tokio::test]
async fn g2_subfolder_cwd_maps_into_the_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let sub = f.dir.path().join("sub");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("keep.txt"), "x").unwrap();
    git_output(f.dir.path(), &["add", "sub/keep.txt"]);
    git_output(f.dir.path(), &["commit", "-q", "-m", "add sub"]);

    let node = spawn_in(&f, &sub, None).await.unwrap();

    let worktree_path = PathBuf::from(&node.worktree.unwrap().path);
    let cwd = f
        .terminals
        .list()
        .await
        .into_iter()
        .find(|t| Some(&t.id) == node.terminal_id.as_ref())
        .unwrap()
        .cwd;
    assert_eq!(cwd, worktree_path.join("sub").to_string_lossy());
    assert!(Path::new(&cwd).is_dir());
}

#[tokio::test]
async fn g2_failure_leaves_no_branch_no_directory_no_node() {
    let wrapper = tempfile::tempdir().unwrap();
    let f = Fixture::in_git_project("sleep 30", failing_git(wrapper.path()));
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());

    let err = f.spawn(None, None).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    // The wrapper's `git worktree add` prints exactly "fake failure" on stderr (`failing_git`);
    // an equality check, not just the prefix, catches a message that drops git's own text.
    assert_eq!(err.message, "worktree_failed: fake failure");
    assert!(f.tree().await.is_empty());
    assert_eq!(git_state(f.dir.path()), before);
    assert!(!f.dir.path().join(".roundup/worktrees").exists());
}

#[tokio::test]
async fn g2_failed_call_emits_no_event() {
    let wrapper = tempfile::tempdir().unwrap();
    let mut f = Fixture::in_git_project("sleep 30", failing_git(wrapper.path()));
    set_worktrees(&f, true, None).await;

    f.spawn(None, None).await.unwrap_err();

    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn g2_failed_start_door_leaves_a_stopped_workstream() {
    let wrapper = tempfile::tempdir().unwrap();
    let f = Fixture::in_git_project("sleep 30", failing_git(wrapper.path()));
    set_worktrees(&f, true, None).await;
    let workstream = f.workstream("team", None).await;
    let before = git_state(f.dir.path());

    let err = start_door(&f, &workstream).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    let tree = f.tree().await;
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].kind, NodeKind::Workstream);
    assert!(tree[0].terminal_id.is_none());
    assert_eq!(tree[0].worktree, None);
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_failed_start_door_leaves_children_where_they_were() {
    let wrapper = tempfile::tempdir().unwrap();
    let f = Fixture::in_git_project("sleep 30", failing_git(wrapper.path()));
    let workstream = f.workstream("team", None).await;
    let child = f.spawn(Some(&workstream), None).await.unwrap().id;
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());

    let err = start_door(&f, &workstream).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    let tree = f.tree().await;
    let group_node = tree.iter().find(|node| node.id == workstream).unwrap();
    assert_eq!(group_node.kind, NodeKind::Workstream);
    assert!(group_node.terminal_id.is_none());
    let child_node = tree.iter().find(|node| node.id == child).unwrap();
    assert_eq!(child_node.parent.as_deref(), Some(workstream.as_str()));
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_not_a_git_project_no_base_and_cwd_not_in_worktree() {
    // not_a_git_project: no `.git` at all.
    {
        let f = Fixture::in_git_project("sleep 30", Git::from_env());
        set_worktrees(&f, true, None).await;
        std::fs::remove_dir_all(f.dir.path().join(".git")).unwrap();

        let err = f.spawn(None, None).await.unwrap_err();

        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(
            err.message.starts_with("not_a_git_project: "),
            "{}",
            err.message
        );
        assert!(f.tree().await.is_empty());
    }

    // not_a_git_project: a git repository with no commit.
    {
        let f = Fixture::in_git_project("sleep 30", Git::from_env());
        set_worktrees(&f, true, None).await;
        std::fs::remove_dir_all(f.dir.path().join(".git")).unwrap();
        git_output(f.dir.path(), &["init", "-q", "-b", "main"]);

        let err = f.spawn(None, None).await.unwrap_err();

        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(
            err.message.starts_with("not_a_git_project: "),
            "{}",
            err.message
        );
        assert!(f.tree().await.is_empty());
    }

    // no_base: HEAD is detached.
    {
        let f = Fixture::in_git_project("sleep 30", Git::from_env());
        set_worktrees(&f, true, None).await;
        let commit = git_output(f.dir.path(), &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        git_output(f.dir.path(), &["checkout", "-q", "--detach", &commit]);

        let err = f.spawn(None, None).await.unwrap_err();

        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(err.message.starts_with("no_base: "), "{}", err.message);
        assert!(f.tree().await.is_empty());
    }

    // cwd_not_in_worktree: an untracked subfolder, missing from the fresh worktree.
    {
        let f = Fixture::in_git_project("sleep 30", Git::from_env());
        set_worktrees(&f, true, None).await;
        let sub = f.dir.path().join("untracked");
        std::fs::create_dir_all(&sub).unwrap();
        let before = git_state(f.dir.path());

        let err = spawn_in(&f, &sub, None).await.unwrap_err();

        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(
            err.message.starts_with("cwd_not_in_worktree: "),
            "{}",
            err.message
        );
        assert!(f.tree().await.is_empty());
        assert_eq!(git_state(f.dir.path()), before);
    }
}

#[tokio::test]
async fn g2_terminal_gets_no_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());

    let workstream = f.workstream("team", None).await;
    f.call("terminal.open", json!({"workstream": workstream}))
        .await
        .unwrap();

    assert!(f.tree().await.iter().all(|node| node.worktree.is_none()));
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_start_failure_of_start_door_leaves_a_stopped_workstream() {
    let mut f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let workstream = f.workstream("team", None).await;
    let before = git_state(f.dir.path());
    f.changed();
    std::fs::remove_file(f.dir.path().join(".roundup/rup")).unwrap();

    let err = start_door(&f, &workstream).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    let tree = f.tree().await;
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].kind, NodeKind::Workstream);
    assert!(tree[0].terminal_id.is_none());
    assert_eq!(tree[0].worktree, None);
    assert_eq!(git_state(f.dir.path()), before);
    assert_eq!(f.changed(), 0);
}

#[tokio::test]
async fn g2_a_record_failure_after_provisioning_leaves_no_branch_no_directory() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;
    let before = git_state(f.dir.path());
    // The Rail's own write of the finished Worktree is the one step this trigger refuses.
    rusqlite::Connection::open(f.dir.path().join(".roundup/agents.db"))
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER refuse_ready BEFORE UPDATE OF worktree_state ON nodes
             WHEN NEW.worktree_state = 'ready' BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();

    let err = f.spawn(None, None).await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    assert!(f.tree().await.is_empty());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn g2_concurrent_provisions_never_run_two_git_commands_at_once() {
    let wrapper = tempfile::tempdir().unwrap();
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let git = exclusive_git(wrapper.path());

    let made: Vec<_> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..4)
            .map(|n| {
                let (git, project) = (&git, f.dir.path());
                scope.spawn(move || {
                    let plan = git.plan(project, &format!("agent-{n}"))?;
                    git.provision(project, &plan)
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let mut paths: Vec<_> = made.into_iter().map(|w| w.unwrap().path).collect();
    paths.sort();
    paths.dedup();
    assert_eq!(paths.len(), 4);
}

#[tokio::test]
async fn g2_spawn_at_the_project_root_runs_in_the_worktree_root() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    set_worktrees(&f, true, None).await;

    let node = f.spawn(None, None).await.unwrap();

    let cwd = f
        .terminals
        .list()
        .await
        .into_iter()
        .find(|t| Some(&t.id) == node.terminal_id.as_ref())
        .unwrap()
        .cwd;
    assert_eq!(
        std::fs::canonicalize(cwd).unwrap(),
        std::fs::canonicalize(node.worktree.unwrap().path).unwrap()
    );
}
