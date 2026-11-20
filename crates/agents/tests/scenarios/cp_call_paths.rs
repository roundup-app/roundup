//! CP1 to CP7: `agent.callPaths` reads which calls an Agent added, removed or changed through
//! the project's real `tsc --lsp` (`scenarios/call-paths.md`).

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
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

const SEED: &str = "export function helper(x: number) { return x + 1; }
export function other() { return 2; }
export function gone() { return 3; }
export function entry() {
  gone();
  helper(1);
  return other();
}
export type T = { a: number };
";

const EDITED: &str = "export function helper(x: number) { return x + 2; }
export function other() { return 2; }
export function gone() { return 3; }
export function fresh() { return 4; }
export function entry() {
  fresh();
  helper(2);
  return other();
}
export type T = { a: number; b: string };
";

fn repo_node_modules() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node_modules")
}

/// A project with an origin on `main`, TypeScript `files` committed, one Agent in its own
/// Worktree with the repository's `node_modules` (and so its real `tsc`) linked in.
async fn fixture(
    git_tool: Git,
    files: &[(&str, &str)],
) -> (Fixture, String, PathBuf, tempfile::TempDir) {
    let f = Fixture::in_git_project("sleep 30", git_tool);
    write(f.dir.path(), ".gitignore", "node_modules\n");
    for (name, text) in files {
        write(f.dir.path(), name, text);
    }
    commit_all(f.dir.path(), "seed");
    let origin = tempfile::tempdir().unwrap();
    git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);
    let url = origin.path().display().to_string();
    git(f.dir.path(), &["remote", "add", "origin", &url]);
    git(f.dir.path(), &["push", "-q", "origin", "main"]);
    git(f.dir.path(), &["fetch", "-q", "origin"]);
    git(f.dir.path(), &["remote", "set-head", "origin", "main"]);
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path: PathBuf = node.worktree().expect("a Worktree").path.into();
    std::os::unix::fs::symlink(repo_node_modules(), path.join("node_modules")).unwrap();
    (f, node.base.id, path, origin)
}

async fn trace(f: &Fixture, id: &str, language: &str) -> Value {
    f.call("agent.callPaths", json!({"id": id, "language": language}))
        .await
        .unwrap()
}

fn symbol<'a>(reply: &'a Value, name: &str) -> &'a Value {
    reply["symbols"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == name)
        .unwrap_or_else(|| panic!("no symbol {name} in {reply}"))
}

fn calls_of<'a>(reply: &'a Value, name: &str) -> &'a Value {
    let key = symbol(reply, name)["key"].clone();
    reply["calls"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["key"] == key)
        .unwrap()
}

fn status_of(calls: &Value, name: &str) -> String {
    calls["outgoing"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("no call to {name} in {calls}"))["status"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn cp1_the_lookup_lists_languages_and_starts_no_process() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    write(&path, "lib.rs", "fn x() {}\n");
    let reply = f.call("agent.callPaths", json!({"id": id})).await.unwrap();
    let rows = reply["languages"].as_array().unwrap();
    let row = |language: &str| rows.iter().find(|r| r["language"] == language).unwrap();
    assert_eq!(row("typescript")["files"], 1);
    assert_eq!(row("typescript")["server"]["found"], true);
    assert_eq!(row("typescript")["server"]["name"], "tsc");
    assert_eq!(row("rust")["server"]["found"], false);
}

#[tokio::test]
async fn cp1_a_language_with_no_server_row_is_reported_as_that() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "rust").await;
    assert_eq!(reply["state"], "noServer");
    assert_eq!(reply["cause"]["kind"], "notInstalled");
    assert!(reply["cause"]["detail"].as_str().unwrap().contains("rust"));
}

/// A `git`-only PATH, so no `tsc` outside the project is found.
fn git_only() -> (tempfile::TempDir, Git) {
    let bin = tempfile::tempdir().unwrap();
    let real = String::from_utf8(
        std::process::Command::new("which")
            .arg("git")
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    std::os::unix::fs::symlink(real.trim(), bin.path().join("git")).unwrap();
    let git = Git::with_path(bin.path());
    (bin, git)
}

/// A project-local `tsc` that reads `Version` and, for `--lsp`, runs `serve` (python).
fn stub_tsc(worktree: &Path, version: &str, serve: &str) {
    let dir = worktree.join("node_modules/.bin");
    let _ = std::fs::remove_file(worktree.join("node_modules"));
    std::fs::create_dir_all(&dir).unwrap();
    let script = format!(
        "#!/usr/bin/env python3\nimport sys, os, time\nif '--version' in sys.argv:\n    print('Version {version}'); sys.exit(0)\n{serve}\n"
    );
    std::fs::write(dir.join("tsc"), script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir.join("tsc"), std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[tokio::test]
async fn cp1_a_project_without_a_typescript_7_server_answers_no_server_with_its_cause() {
    let (_bin, tool) = git_only();
    let (f, id, path, _origin) = fixture(tool, &[("a.ts", SEED)]).await;
    std::fs::remove_file(path.join("node_modules")).unwrap();
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(
        (reply["state"].as_str(), reply["cause"]["kind"].as_str()),
        (Some("noServer"), Some("notInstalled"))
    );
    stub_tsc(&path, "6.0.3", "sys.exit(1)");
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["cause"]["kind"], "predates");
    assert!(
        reply["cause"]["detail"]
            .as_str()
            .unwrap()
            .contains("TypeScript 6.0.3 predates `tsc --lsp`; 7 or later is needed")
    );
}

/// A server that completes `initialize` and then stays silent, writing its pid to `pid`.
fn silent_server(pid: &Path) -> String {
    format!(
        "open({:?}, 'w').write(str(os.getpid()))
def read():
    n = 0
    while True:
        line = sys.stdin.buffer.readline()
        if line.strip() == b'': break
        if line.lower().startswith(b'content-length:'): n = int(line.split(b':')[1])
    return sys.stdin.buffer.read(n)
import json
msg = json.loads(read())
body = json.dumps({{'jsonrpc': '2.0', 'id': msg['id'], 'result': {{'capabilities': {{'callHierarchyProvider': True}}}}}}).encode()
sys.stdout.buffer.write(b'Content-Length: %d\\r\\n\\r\\n' % len(body) + body); sys.stdout.buffer.flush()
time.sleep(600)",
        pid.display().to_string()
    )
}

fn alive(pid: &Path) -> bool {
    let pid: i32 = std::fs::read_to_string(pid)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    std::path::Path::new(&format!("/proc/{pid}")).exists()
        && !std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .unwrap_or_default()
            .contains(") Z")
}

#[tokio::test]
async fn cp5_a_server_that_never_answers_ends_at_the_limit_as_failed_and_is_gone() {
    let tool = Git::from_env().with_call_path_limit(std::time::Duration::from_millis(800));
    let (f, id, path, _origin) = fixture(tool, &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let pid = path.join("../stub.pid");
    stub_tsc(&path, "7.0.2", &silent_server(&pid));
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(
        (reply["state"].as_str(), reply["cause"]["kind"].as_str()),
        (Some("failed"), Some("timeout")),
        "{reply}"
    );
    assert!(!alive(&pid));
}

#[tokio::test]
async fn cp2_a_hunk_maps_to_the_innermost_symbol_on_its_side_with_a_status() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done", "{reply}");
    assert_eq!(symbol(&reply, "helper")["status"], "changed");
    assert_eq!(symbol(&reply, "fresh")["status"], "added");
    assert_eq!(symbol(&reply, "fresh")["old"], Value::Null);
    assert_eq!(symbol(&reply, "entry")["status"], "changed");
    assert!(
        reply["symbols"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["name"] != "other")
    );
}

#[tokio::test]
async fn cp2_a_changed_function_and_method_carry_name_and_kind() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    let helper = symbol(&reply, "helper");
    assert_eq!(
        (helper["kind"].as_str(), helper["callable"].as_bool()),
        (Some("function"), Some(true))
    );
}

#[tokio::test]
async fn cp2_a_hunk_in_a_type_or_at_top_level_is_a_symbol_with_no_call_path() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    let t = symbol(&reply, "T");
    assert_eq!(t["callable"], false);
    assert!(
        reply["calls"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["key"] != t["key"])
    );
}

#[tokio::test]
async fn cp3_a_commit_that_adds_removes_and_edits_calls_lists_each_with_its_status() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    let entry = calls_of(&reply, "entry");
    assert_eq!(status_of(entry, "fresh"), "added");
    assert_eq!(status_of(entry, "gone"), "removed");
    assert_eq!(status_of(entry, "helper"), "changed");
    assert_eq!(status_of(entry, "other"), "unchanged");
}

#[tokio::test]
async fn cp4_an_entry_point_whose_callee_changed_carries_that_callee() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    let flows = reply["flows"].as_array().unwrap();
    let entry_key = &symbol(&reply, "entry")["key"];
    let helper_key = &symbol(&reply, "helper")["key"];
    assert!(flows.iter().all(|flow| flow["entry"] != *helper_key));
    let flow = flows
        .iter()
        .find(|flow| flow["entry"] == *entry_key)
        .unwrap();
    let callees: Vec<&Value> = flow["tree"]["calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| &n["key"])
        .collect();
    assert!(callees.contains(&helper_key), "{flow}");
}

#[tokio::test]
async fn cp4_a_cycle_ends_where_it_closes() {
    let seed = "export function loop(n: number): number { return n; }\n";
    let edited = "export function loop(n: number): number { return n > 0 ? loop(n - 1) : n; }\n";
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("r.ts", seed)]).await;
    write(&path, "r.ts", edited);
    let reply = trace(&f, &id, "typescript").await;
    let flow = &reply["flows"].as_array().unwrap()[0];
    let node = &flow["tree"]["calls"].as_array().unwrap()[0];
    assert_eq!(node["cycle"], true, "{flow}");
}

#[tokio::test]
async fn cp4_a_changed_function_with_no_calls_is_an_entry_point_with_an_empty_tree() {
    let (f, id, path, _origin) = fixture(
        Git::from_env(),
        &[("a.ts", "export function solo() { return 1; }\n")],
    )
    .await;
    write(&path, "a.ts", "export function solo() { return 2; }\n");
    let reply = trace(&f, &id, "typescript").await;
    let flows = reply["flows"].as_array().unwrap();
    assert_eq!(flows.len(), 1);
    assert_eq!(flows[0]["tree"]["calls"], json!([]));
}

#[tokio::test]
async fn cp6_a_second_request_for_the_same_merge_base_exports_nothing() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    trace(&f, &id, "typescript").await;
    let cache = f.dir.path().join(".roundup/cache/call-paths");
    let entry = std::fs::read_dir(&cache)
        .unwrap()
        .flatten()
        .find(|e| e.path().join("complete").exists())
        .unwrap()
        .path();
    let before = std::fs::metadata(entry.join("a.ts"))
        .unwrap()
        .modified()
        .unwrap();
    trace(&f, &id, "typescript").await;
    assert_eq!(
        std::fs::metadata(entry.join("a.ts"))
            .unwrap()
            .modified()
            .unwrap(),
        before
    );
    assert_eq!(std::fs::read_dir(&cache).unwrap().flatten().count(), 1);
}

#[tokio::test]
async fn cp6_a_corrupt_entry_is_rebuilt_and_an_interrupted_export_leaves_none() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    trace(&f, &id, "typescript").await;
    let cache = f.dir.path().join(".roundup/cache/call-paths");
    let entry = std::fs::read_dir(&cache)
        .unwrap()
        .flatten()
        .next()
        .unwrap()
        .path();
    std::fs::remove_file(entry.join("complete")).unwrap();
    std::fs::remove_file(entry.join("a.ts")).unwrap();
    std::fs::create_dir_all(cache.join(".tmp-interrupted")).unwrap();
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done");
    assert!(entry.join("complete").exists() && entry.join("a.ts").exists());
    assert!(!cache.join(".tmp-interrupted").exists());
}

#[tokio::test]
async fn cp6_a_fifth_merge_base_evicts_the_oldest() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    let cache = f.dir.path().join(".roundup/cache/call-paths");
    for n in 0..5 {
        write(&path, "a.ts", &format!("{SEED}// {n}\n"));
        trace(&f, &id, "typescript").await;
        // A new merge base: a new commit on main, which the Agent's branch contains.
        write(f.dir.path(), "m.txt", &n.to_string());
        commit_all(f.dir.path(), "main moves");
        git(f.dir.path(), &["push", "-q", "origin", "main"]);
        git(f.dir.path(), &["fetch", "-q", "origin"]);
        git(&path, &["merge", "-q", "--no-edit", "main"]);
    }
    assert_eq!(std::fs::read_dir(&cache).unwrap().flatten().count(), 4);
}

#[tokio::test]
async fn cp7_the_repository_is_byte_identical_after_a_trace() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    write(&path, "new.ts", "export function n() { return 1; }\n");
    let state = |dir: &Path| {
        (
            git(dir, &["status", "--porcelain", "-uall"]),
            git(dir, &["for-each-ref"]),
            std::fs::read(git_dir(dir).join("index")).unwrap(),
            std::fs::read(dir.join("a.ts")).unwrap(),
        )
    };
    let before = state(&path);
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done");
    assert!(
        reply["symbols"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["name"] == "n")
    );
    assert_eq!(state(&path), before);
}

fn git_dir(dir: &Path) -> PathBuf {
    let out = git(dir, &["rev-parse", "--absolute-git-dir"]);
    PathBuf::from(out)
}

#[tokio::test]
async fn cp5_closing_the_connection_kills_the_server() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let pid = path.join("../stub.pid");
    stub_tsc(&path, "7.0.2", &silent_server(&pid));
    let call = f.call(
        "agent.callPaths",
        json!({"id": id, "language": "typescript"}),
    );
    let _ = tokio::time::timeout(std::time::Duration::from_millis(1500), call).await;
    // The caller is gone: the server is killed, and the next request is free to start.
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(50));
    for _ in 0..40 {
        tick.tick().await;
        if !alive(&pid) {
            break;
        }
    }
    assert!(!alive(&pid));
}
