//! C7684 `agent.repeatScan` reports where changed lines repeat (`scenarios/repeat-scan.md`).

use std::path::Path;
use std::time::Duration;

use agents::worktree::Git;
use rpc::{Module, code};
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn write(dir: &Path, name: &str, text: &str) {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// `count` lines of nine tokens each, told apart by `tag`.
fn block(tag: &str, count: usize, indent: &str, trail: &str) -> String {
    (0..count)
        .map(|n| format!("{indent}let {tag}_{n} = compute({n}, \"{tag}\");{trail}\n"))
        .collect()
}

fn unique(tag: &str, count: usize) -> String {
    (0..count)
        .map(|n| format!("fn {tag}_{n}() -> u32 {{ {n} }}\n"))
        .collect()
}

async fn on(f: &Fixture) -> (String, std::path::PathBuf) {
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    (
        node.base.id.clone(),
        node.worktree().expect("a Worktree").path.into(),
    )
}

async fn scan(f: &Fixture, id: &str) -> Value {
    f.call("agent.repeatScan", json!({"id": id})).await.unwrap()
}

fn hit(path: &str, start: u32, end: u32, other: &str, o_start: u32, o_end: u32) -> Value {
    json!({"path": path, "start": start, "end": end,
           "other": {"path": other, "start": o_start, "end": o_end}})
}

/// A project whose Base holds `owned.rs` with a 20-line block at lines 12-31.
async fn owned() -> (Fixture, String, std::path::PathBuf) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let text = format!(
        "{}{}{}",
        unique("head", 11),
        block("owned", 20, "", ""),
        unique("tail", 5)
    );
    write(f.dir.path(), "owned.rs", &text);
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;
    (f, id, path)
}

#[tokio::test]
async fn c7684a_a_copied_block_is_reported_with_the_other_file_and_lines() {
    let (f, id, path) = owned().await;
    let copy = block("owned", 20, "        ", "  ");
    write(&path, "new.rs", &format!("{}{copy}", unique("mine", 2)));

    let result = scan(&f, &id).await;

    assert_eq!(
        result,
        json!({"hits": [hit("new.rs", 3, 22, "owned.rs", 12, 31)], "complete": true})
    );
}

#[tokio::test]
async fn c7684a_a_copy_between_two_changed_files_is_reported_from_each() {
    let (f, id, path) = owned().await;
    write(
        &path,
        "a.rs",
        &format!("{}{}", unique("a", 2), block("shared", 10, "", "")),
    );
    write(&path, "b.rs", &block("shared", 10, "  ", ""));
    // One changed file that holds its block twice, away from the changed lines of a commit.
    write(
        &path,
        "c.rs",
        &format!("{0}{1}{0}", block("twice", 9, "", ""), unique("gap", 3)),
    );

    let hits = scan(&f, &id).await["hits"].clone();

    assert_eq!(
        hits,
        json!([
            hit("a.rs", 3, 12, "b.rs", 1, 10),
            hit("b.rs", 1, 10, "a.rs", 3, 12),
            hit("c.rs", 1, 9, "c.rs", 13, 21),
            hit("c.rs", 13, 21, "c.rs", 1, 9),
        ])
    );
}

#[tokio::test]
async fn c7684b_a_hunk_that_repeats_nothing_has_no_hit() {
    let (f, id, path) = owned().await;
    write(&path, "new.rs", &unique("fresh", 30));

    assert_eq!(scan(&f, &id).await, json!({"hits": [], "complete": true}));
}

#[tokio::test]
async fn c7684b_a_repeat_under_the_minimum_is_not_reported() {
    let (f, id, path) = owned().await;
    // 7 lines of the block, and 8 consecutive short lines under 40 tokens, which owned.rs holds.
    write(&path, "seven.rs", &block("owned", 7, "", ""));
    let short: String = (0..8).map(|n| format!("a{n} = b;\n")).collect();
    write(f.dir.path(), "short.rs", &short);
    commit_all(f.dir.path(), "short");
    git(&path, &["merge", "-q", "main"]);
    write(&path, "short_copy.rs", &short);

    assert_eq!(scan(&f, &id).await["hits"], json!([]));
}

#[tokio::test]
async fn c7684b_an_unscanned_file_is_neither_scanned_nor_reported() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let copy = block("owned", 20, "", "");
    let big = format!("{copy}{}", "// padding line\n".repeat(70_000));
    write(f.dir.path(), "generated/g.rs", &copy);
    write(f.dir.path(), "big.rs", &big);
    write(f.dir.path(), "bin.dat", &format!("\0{copy}"));
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;
    write(&path, "new.rs", &copy);
    write(&path, "generated/new.rs", &copy);
    write(&path, ".roundup/new.rs", &copy);
    write(&path, "wide.rs", &big);

    assert_eq!(scan(&f, &id).await["hits"], json!([]));
}

fn snapshot(path: &Path, main: &Path) -> Vec<String> {
    vec![
        git(path, &["status", "--porcelain=v2"]),
        git(path, &["rev-parse", "HEAD"]),
        git(main, &["for-each-ref"]),
        std::fs::read_to_string(path.join("new.rs")).unwrap(),
        std::fs::read(path.join(git(path, &["rev-parse", "--git-path", "index"]).trim()))
            .unwrap()
            .len()
            .to_string(),
    ]
}

#[tokio::test]
async fn c7684c_the_scan_changes_no_file_or_ref() {
    let (f, id, path) = owned().await;
    write(&path, "new.rs", &block("owned", 20, "", ""));
    let before = snapshot(&path, f.dir.path());

    scan(&f, &id).await;

    assert_eq!(snapshot(&path, f.dir.path()), before);
}

/// A repo of `count` small untracked files, so a scan has something to read.
fn fill(path: &Path, count: usize) {
    for n in 0..count {
        write(path, &format!("many/f{n}.txt"), &format!("only line {n}\n"));
    }
}

async fn until_reading(git: &Git, from: usize) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while git.scan_reads() <= from {
            tokio::time::sleep(Duration::from_micros(200)).await;
        }
    })
    .await
    .expect("the scan reads a file");
}

#[tokio::test]
async fn c7684c_a_commit_during_the_scan_succeeds() {
    let seen = Git::from_env();
    let f = Fixture::in_git_project("sleep 30", seen.clone());
    let (id, path) = on(&f).await;
    fill(&path, 3000);
    write(&path, "mine.txt", "x\n");

    let committing = async {
        until_reading(&seen, 0).await;
        let at = path.clone();
        tokio::task::spawn_blocking(move || commit_all(&at, "during"))
            .await
            .unwrap();
    };
    let (_, ()) = tokio::join!(scan(&f, &id), committing);

    assert_eq!(git(&path, &["log", "-1", "--format=%s"]).trim(), "during");
}

#[tokio::test]
async fn c7684d_a_large_repo_answers_partial_at_the_bound() {
    let seen = Git::from_env();
    let f = Fixture::in_git_project("sleep 30", seen.clone());
    let (id, path) = on(&f).await;
    fill(&path, 5001);

    let result = scan(&f, &id).await;

    assert_eq!(result["complete"], false);
    assert_eq!(seen.scan_reads(), 5000);
}

#[tokio::test]
async fn c7684d_another_call_answers_during_a_scan() {
    let seen = Git::from_env();
    let f = Fixture::in_git_project("sleep 30", seen.clone());
    let (id, path) = on(&f).await;
    fill(&path, 3000);

    let asking = async {
        until_reading(&seen, 0).await;
        let rows = tokio::time::timeout(Duration::from_millis(250), f.tree()).await;
        assert!(rows.is_ok(), "rail.tree waited for the scan");
        assert!(
            seen.scan_reads() < 3000,
            "the scan was over before the tree answered"
        );
    };
    let (_, ()) = tokio::join!(scan(&f, &id), asking);
}

#[tokio::test]
async fn c7684d_a_dropped_call_stops_the_scan() {
    let seen = Git::from_env();
    let f = Fixture::in_git_project("sleep 30", seen.clone());
    let (id, path) = on(&f).await;
    fill(&path, 4000);

    tokio::select! {
        _ = f.call("agent.repeatScan", json!({"id": id})) => panic!("the scan ended first"),
        () = until_reading(&seen, 0) => {}
    }
    tokio::time::sleep(Duration::from_millis(250)).await;
    let stopped = seen.scan_reads();
    tokio::time::sleep(Duration::from_millis(250)).await;

    assert_eq!(seen.scan_reads(), stopped);
    assert!(stopped < 4000, "the scan read every file");
}

#[tokio::test]
async fn c7684e_an_agent_call_is_refused_and_the_tool_list_does_not_move() {
    let (f, id, path) = owned().await;
    write(&path, "new.rs", &block("owned", 20, "", ""));
    let mut ctx = f.ctx();
    ctx.actor = contracts::Actor {
        kind: contracts::ActorKind::Agent,
        id: "someone".to_owned(),
        parent: None,
    };

    let err = f
        .agents
        .call(&ctx, "agent.repeatScan", json!({"id": id}))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    let row = contracts::methods::metadata()
        .into_iter()
        .find(|row| row.name == "agent.repeatScan")
        .unwrap();
    assert!(matches!(row.mcp, contracts::methods::McpChoice::None(_)));
}

#[tokio::test]
async fn c7684e_no_worktree_and_missing_worktree_fail_as_u2539a_does() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let plain = f.spawn(None, None).await.unwrap();
    let err = f
        .call("agent.repeatScan", json!({"id": plain.id}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(err.message.starts_with("no_worktree: "), "{}", err.message);

    let (id, path) = on(&f).await;
    std::fs::remove_dir_all(&path).unwrap();
    let err = f
        .call("agent.repeatScan", json!({"id": id}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(
        err.message
            .starts_with(&format!("worktree_missing: {}", path.display())),
        "{}",
        err.message
    );
}
