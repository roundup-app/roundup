//! G10 to G12 adopting a worktree the user made (`scenarios/worktrees.md`).

use super::*;
use crate::common::init_repo;

/// A worktree of the Project's repository outside the Project folder, on a new branch `name`.
fn user_worktree(f: &Fixture, outside: &Path, name: &str) -> PathBuf {
    let path = outside.join(name);
    git_output(
        f.dir.path(),
        &["worktree", "add", "-q", "-b", name, &path.to_string_lossy()],
    );
    path.canonicalize().unwrap()
}

fn commit(path: &Path, file: &str) {
    std::fs::write(path.join(file), file).unwrap();
    git_output(path, &["add", file]);
    git_output(path, &["commit", "-qm", file]);
}

/// A worktree with two commits the Base lacks and one untracked file: work in progress.
fn busy_worktree(f: &Fixture, outside: &Path) -> PathBuf {
    let path = user_worktree(f, outside, "feature");
    commit(&path, "one");
    commit(&path, "two");
    std::fs::write(path.join("scratch"), "untracked").unwrap();
    path
}

async fn adoptable(f: &Fixture) -> Vec<Value> {
    f.call("agent.adoptable", Value::Null).await.unwrap()["rows"]
        .as_array()
        .unwrap()
        .clone()
}

fn row<'a>(rows: &'a [Value], path: &Path) -> &'a Value {
    rows.iter()
        .find(|row| row["path"] == path.to_string_lossy().as_ref())
        .unwrap_or_else(|| panic!("no row for {}", path.display()))
}

/// Every byte adoption must leave alone: refs, the worktree list, the status of the worktree and
/// each file in it.
fn snapshot(f: &Fixture, path: &Path) -> (String, String, String, Vec<(String, Vec<u8>)>) {
    let mut files = Vec::new();
    let mut stack = vec![path.to_owned()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            if entry.file_name() == ".git" {
                continue;
            }
            if entry.path().is_dir() {
                stack.push(entry.path());
            } else {
                files.push((
                    entry.path().to_string_lossy().into_owned(),
                    std::fs::read(entry.path()).unwrap(),
                ));
            }
        }
    }
    files.sort();
    (
        git_output(f.dir.path(), &["for-each-ref"]),
        git_output(f.dir.path(), &["worktree", "list"]),
        git_output(path, &["status", "--porcelain=v2", "--untracked-files=all"]),
        files,
    )
}

async fn adopt(f: &Fixture, path: &Path, branch: &str) -> Result<RailNode, rpc::RpcError> {
    let node = f
        .call(
            "agent.adopt",
            json!({"path": path.to_string_lossy(), "branch": branch}),
        )
        .await?;
    Ok(serde_json::from_value(node).unwrap())
}

#[tokio::test]
async fn g10_adoptable_lists_qualifying_worktrees_and_refusals() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let busy = busy_worktree(&f, outside.path());
    let owned = user_worktree(&f, outside.path(), "roundup/agent-9");
    let detached = user_worktree(&f, outside.path(), "detached");
    git_output(&detached, &["checkout", "-q", "--detach"]);
    let merging = user_worktree(&f, outside.path(), "merging");
    let git_dir = git_output(&merging, &["rev-parse", "--absolute-git-dir"]);
    std::fs::write(Path::new(git_dir.trim()).join("MERGE_HEAD"), "x").unwrap();
    let gone = user_worktree(&f, outside.path(), "gone");
    std::fs::remove_dir_all(&gone).unwrap();
    let used = user_worktree(&f, outside.path(), "used");
    f.terminals
        .spawn(contracts::terminal::SpawnParams {
            cwd: used.to_string_lossy().into_owned(),
            command: Some(vec!["sleep".into(), "30".into()]),
            env: Default::default(),
            unset: Vec::new(),
            cols: 80,
            rows: 24,
            machine: None,
        })
        .await
        .unwrap();
    let before = git_state(f.dir.path());

    let rows = adoptable(&f).await;

    let name = |path: &Path| row(&rows, path)["refusal"].clone();
    assert_eq!(rows.len(), 6, "the primary checkout is not a row: {rows:?}");
    assert_eq!(name(&busy), Value::Null);
    assert_eq!(row(&rows, &busy)["ahead"], 2);
    assert_eq!(row(&rows, &busy)["dirty"], true);
    assert_eq!(row(&rows, &busy)["branch"], "feature");
    assert_eq!(name(&owned), "owned_branch");
    assert_eq!(name(&detached), "detached_head");
    assert_eq!(name(&merging), "operation_in_progress");
    assert_eq!(name(&gone), "worktree_missing");
    assert_eq!(name(&used), "worktree_in_use");
    assert_eq!(git_state(f.dir.path()), before, "discovery changes nothing");
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn g10_adopt_needs_the_branch_the_user_saw() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let before = snapshot(&f, &path);

    let err = adopt(&f, &path, "other").await.unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
    assert!(err.message.starts_with("adopt_stale: "), "{}", err.message);
    assert_eq!(snapshot(&f, &path), before);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn g10_adopt_refuses_what_the_row_refuses_and_changes_nothing() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let owned = user_worktree(&f, outside.path(), "roundup/agent-9");
    let elsewhere = tempfile::tempdir().unwrap();
    init_repo(elsewhere.path());
    let before = git_state(f.dir.path());

    for (path, branch, wanted, kind) in [
        (f.dir.path().to_owned(), "main", "primary_checkout", code::INVALID_PARAMS),
        (elsewhere.path().to_owned(), "main", "other_repository", code::INVALID_PARAMS),
        (outside.path().join("nowhere"), "x", "not_registered", code::INVALID_PARAMS),
        (owned, "roundup/agent-9", "owned_branch", code::INVALID_PARAMS),
    ] {
        let err = adopt(&f, &path, branch).await.unwrap_err();
        assert_eq!(err.code, kind, "{wanted}");
        assert!(err.message.starts_with(&format!("{wanted}: ")), "{}", err.message);
    }
    assert_eq!(git_state(f.dir.path()), before);
    assert!(f.tree().await.is_empty());
}

#[test]
fn g10_no_agent_tool_reaches_adoption() {
    for method in ["agent.adoptable", "agent.adopt"] {
        let entry = contracts::methods::metadata()
            .into_iter()
            .find(|entry| entry.name == method)
            .unwrap();
        assert!(
            matches!(entry.mcp, contracts::methods::McpChoice::None(_)),
            "{method} is offered as a tool"
        );
    }
}

#[tokio::test]
async fn g11_adopt_keeps_dirty_work_and_branch_untouched() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let before = snapshot(&f, &path);

    let node = adopt(&f, &path, "feature").await.unwrap();

    let worktree = node.worktree().expect("a Worktree");
    assert_eq!(worktree.path, path.to_string_lossy());
    assert_eq!(worktree.branch, "feature");
    assert_eq!(worktree.base, "main");
    assert!(worktree.adopted);
    assert_eq!(terminal_cwd(&f, &node).await, path.to_string_lossy());
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g11_adopted_state_counts_against_the_recorded_base() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let node = adopt(&f, &path, "feature").await.unwrap();

    let state = f
        .call("agent.worktreeState", json!({"id": node.id}))
        .await
        .unwrap();
    assert_eq!(
        (state["ahead"].clone(), state["behind"].clone(), state["dirty"].clone()),
        (json!(2), json!(0), json!(true))
    );

    // The Base is recorded once: moving the Project to another branch changes nothing.
    commit(f.dir.path(), "on-main");
    git_output(f.dir.path(), &["checkout", "-q", "-b", "elsewhere"]);
    let state = f
        .call("agent.worktreeState", json!({"id": node.id}))
        .await
        .unwrap();
    assert_eq!((state["ahead"].clone(), state["behind"].clone()), (json!(2), json!(1)));
}

#[tokio::test]
async fn g11_adopt_with_no_base_fails_and_changes_nothing() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    git_output(f.dir.path(), &["checkout", "-q", "--detach"]);
    let before = snapshot(&f, &path);

    let err = adopt(&f, &path, "feature").await.unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.starts_with("no_base: "), "{}", err.message);
    assert_eq!(snapshot(&f, &path), before);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn g11_restart_and_interrupted_adoption_keep_everything() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let node = adopt(&f, &path, "feature").await.unwrap();
    let before = snapshot(&f, &path);

    let f = f.reopen();
    let found = f.tree().await;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].worktree(), node.worktree());
    assert_eq!(snapshot(&f, &path), before);

    // An adoption cut off before its Agent started leaves its row, not the user's worktree.
    let db = rusqlite::Connection::open(f.dir.path().join(".roundup/agents.db")).unwrap();
    db.execute("UPDATE nodes SET worktree_state = 'adopting'", [])
        .unwrap();
    drop(db);
    let f = f.reopen();
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g12_discard_keeps_a_dirty_adopted_worktree_and_its_commits() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let node = adopt(&f, &path, "feature").await.unwrap();
    let before = snapshot(&f, &path);

    let reply = f.call("agent.discard", json!({"id": node.id})).await.unwrap();

    assert_eq!(reply, Value::Null);
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
    assert_eq!(git_output(f.dir.path(), &["rev-list", "--count", "main..feature"]).trim(), "2");
}

#[tokio::test]
async fn g12_remove_stop_and_workstream_removal_keep_adopted_branches() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let before = snapshot(&f, &path);

    // Stop, then remove a dirty, ahead one: no `worktree_unlanded`.
    let node = adopt(&f, &path, "feature").await.unwrap();
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    assert_eq!(snapshot(&f, &path), before);
    f.call("rail.remove", json!({"id": node.id})).await.unwrap();
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);

    // A clean, level one: removal keeps the branch where G5 would delete it.
    let level = user_worktree(&f, outside.path(), "level");
    let node = adopt(&f, &level, "level").await.unwrap();
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    f.call("rail.remove", json!({"id": node.id})).await.unwrap();
    assert!(level.is_dir());
    assert!(git_output(f.dir.path(), &["branch", "--list", "level"]).contains("level"));

    // A Workstream's removal takes the adopted child's row and keeps its worktree.
    let before = snapshot(&f, &path);
    let workstream = f.workstream("team", None).await;
    let child = f
        .call(
            "agent.adopt",
            json!({"path": path.to_string_lossy(), "branch": "feature"}),
        )
        .await
        .unwrap();
    f.call(
        "rail.move",
        json!({"id": child["id"], "parent": workstream, "index": 0}),
    )
    .await
    .unwrap();
    f.call("agent.stop", json!({"id": child["id"]})).await.unwrap();
    f.call("rail.remove", json!({"id": workstream})).await.unwrap();
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g12_failed_start_after_adoption_deletes_nothing() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = busy_worktree(&f, outside.path());
    let before = snapshot(&f, &path);
    std::fs::remove_file(f.dir.path().join(".roundup/rup")).unwrap();

    let err = adopt(&f, &path, "feature").await.unwrap_err();

    assert_eq!(err.code, code::INTERNAL);
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g12_a_deleted_directory_is_not_an_error() {
    let f = Fixture::in_git_project("exec sleep 30", Git::from_env());
    let outside = tempfile::tempdir().unwrap();
    let path = user_worktree(&f, outside.path(), "feature");
    let node = adopt(&f, &path, "feature").await.unwrap();
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    std::fs::remove_dir_all(&path).unwrap();
    let listed = git_output(f.dir.path(), &["worktree", "list"]);

    f.call("rail.remove", json!({"id": node.id})).await.unwrap();

    assert!(f.tree().await.is_empty());
    assert_eq!(git_output(f.dir.path(), &["worktree", "list"]), listed);
    assert!(git_output(f.dir.path(), &["branch", "--list", "feature"]).contains("feature"));
}
