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

fn outgoing_names(reply: &Value, function: &str) -> Vec<String> {
    calls_of(reply, function)["outgoing"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn cp1_a_language_answers_done_no_server_or_failed() {
    let tool = Git::from_env().with_call_path_limit(std::time::Duration::from_millis(800));
    let (f, id, path, _origin) = fixture(tool, &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    assert_eq!(trace(&f, &id, "typescript").await["state"], "done");
    assert_eq!(trace(&f, &id, "rust").await["state"], "noServer");
    stub_tsc(&path, "7.0.2", &silent_server(&path.join("../s.pid")));
    assert_eq!(trace(&f, &id, "typescript").await["state"], "failed");
}

#[tokio::test]
async fn cp2_a_rename_without_edits_and_a_binary_file_add_no_symbol() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    git(&path, &["mv", "a.ts", "b.ts"]);
    std::fs::write(path.join("blob.ts"), [0u8, 159, 146, 150, 0, 1]).unwrap();
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done", "{reply}");
    assert_eq!(reply["symbols"], json!([]), "{reply}");
}

#[tokio::test]
async fn cp3_a_call_that_only_moved_lines_is_unchanged() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    let moved = SEED
        .replace("  gone();\n", "  // a note\n  gone();\n")
        .replace("return other();", "return other() + 0;");
    write(&path, "a.ts", &moved);
    let reply = trace(&f, &id, "typescript").await;
    let entry = calls_of(&reply, "entry");
    assert_eq!(status_of(entry, "helper"), "unchanged", "{entry}");
    assert_eq!(status_of(entry, "other"), "changed", "{entry}");
}

#[tokio::test]
async fn cp3_two_functions_of_one_name_in_different_files_are_never_joined() {
    let dup = "export function dup() { return 1; }\n";
    let (f, id, path, _origin) = fixture(
        Git::from_env(),
        &[
            ("a.ts", dup),
            ("b.ts", dup),
            (
                "c.ts",
                "import { dup } from './a';\nexport function run() { return dup(); }\n",
            ),
        ],
    )
    .await;
    write(
        &path,
        "c.ts",
        "import { dup } from './b';\nexport function run() { return dup() + 0; }\n",
    );
    let reply = trace(&f, &id, "typescript").await;
    let run = calls_of(&reply, "run");
    let mut found: Vec<(String, String)> = run["outgoing"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["path"].as_str().unwrap().to_owned(),
                c["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    found.sort();
    assert_eq!(
        found,
        [
            ("a.ts".to_owned(), "removed".to_owned()),
            ("b.ts".to_owned(), "added".to_owned())
        ],
        "{run}"
    );
}

#[tokio::test]
async fn cp3_library_callees_are_filtered_and_repeated_call_sites_collapse() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    write(
        &path,
        "a.ts",
        &SEED.replace(
            "  helper(1);\n",
            "  helper(1); helper(1);\n  Math.max(1, 2);\n  [1].map((n) => n);\n",
        ),
    );
    let reply = trace(&f, &id, "typescript").await;
    let names = outgoing_names(&reply, "entry");
    assert_eq!(
        names.iter().filter(|n| *n == "helper").count(),
        1,
        "{names:?}"
    );
    assert!(names.iter().all(|n| n != "max" && n != "map"), "{names:?}");
}

#[tokio::test]
async fn cp3_a_string_keyed_call_ends_the_path() {
    let seed = "const table: Record<string, () => number> = { target: () => 1 };
export function target() { return 1; }
export function route(k: string) { return 0; }
";
    let edited = seed.replace("return 0;", "return table[k + 'x']();");
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", seed)]).await;
    write(&path, "a.ts", &edited);
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done", "{reply}");
    assert!(outgoing_names(&reply, "route").is_empty(), "{reply}");
}

#[tokio::test]
async fn cp3_a_function_with_more_calls_than_the_cap_says_capped() {
    let many = |tail: &str| {
        let mut text = String::new();
        for n in 0..205 {
            text += &format!("export function f{n}() {{ return {n}; }}\n");
        }
        text += "export function entry() {\n";
        for n in 0..205 {
            text += &format!("  f{n}();\n");
        }
        text + tail + "}\n"
    };
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", &many("  // a\n"))]).await;
    write(&path, "a.ts", &many("  // b\n"));
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done", "{reply}");
    assert_eq!(reply["capped"], true);
    assert!(outgoing_names(&reply, "entry").len() <= 200);
}

fn depth_of(node: &Value) -> usize {
    node["calls"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| 1 + depth_of(c))
        .max()
        .unwrap_or(0)
}

#[tokio::test]
async fn cp4_a_tree_stops_at_the_depth_cap_and_says_so() {
    let chain = |ret: u32| {
        (0..9)
            .map(|n| {
                if n < 8 {
                    format!(
                        "export function f{n}() {{ return f{}() + {ret}; }}\n",
                        n + 1
                    )
                } else {
                    format!("export function f{n}() {{ return {ret}; }}\n")
                }
            })
            .collect::<String>()
    };
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", &chain(1))]).await;
    write(&path, "a.ts", &chain(2));
    let reply = trace(&f, &id, "typescript").await;
    let flows = reply["flows"].as_array().unwrap();
    let flow = flows
        .iter()
        .find(|flow| flow["entry"] == symbol(&reply, "f0")["key"])
        .unwrap();
    assert_eq!(depth_of(&flow["tree"]), 6, "{flow}");
    assert_eq!(flow["capped"], true);
    assert_eq!(reply["capped"], true);
}

/// A project-local `tsc` that logs the pid of each `--lsp` start and whether another logged
/// server was still alive, then runs the repository's real `tsc`.
fn logging_tsc(worktree: &Path, log: &Path) {
    let dir = worktree.join("node_modules/.bin");
    let _ = std::fs::remove_file(worktree.join("node_modules"));
    std::fs::create_dir_all(&dir).unwrap();
    let real = repo_node_modules().join(".bin/tsc").canonicalize().unwrap();
    let script = format!(
        "#!/usr/bin/env python3
import os, sys
if '--lsp' in sys.argv:
    log = {log:?}
    for line in open(log).read().split() if os.path.exists(log) else []:
        if line.isdigit() and os.path.exists('/proc/' + line) and ') Z' not in open('/proc/' + line + '/stat').read():
            open(log, 'a').write('overlap\\n')
    open(log, 'a').write(str(os.getpid()) + '\\n')
os.execv({real:?}, [{real:?}] + sys.argv[1:])
",
        log = log.display().to_string(),
        real = real.display().to_string(),
    );
    std::fs::write(dir.join("tsc"), script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir.join("tsc"), std::fs::Permissions::from_mode(0o755)).unwrap();
    std::os::unix::fs::symlink(
        repo_node_modules().join("typescript"),
        worktree.join("node_modules/typescript"),
    )
    .unwrap();
}

fn logged(log: &Path) -> Vec<String> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

#[tokio::test]
async fn cp5_the_old_and_new_servers_run_one_after_the_other_and_the_reply_flags_shared_dependencies()
 {
    let (f, id, path, _origin) = fixture(
        Git::from_env(),
        &[("a.ts", SEED), ("package.json", "{\"name\": \"p\"}\n")],
    )
    .await;
    let log = path.join("../servers.log");
    logging_tsc(&path, &log);
    write(&path, "a.ts", EDITED);
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(reply["state"], "done", "{reply}");
    assert!(logged(&log).len() >= 2, "{:?}", logged(&log));
    assert!(!logged(&log).contains(&"overlap".to_owned()));
    assert_eq!(reply["oldSideResolvedThroughNewDependencies"], false);
    write(&path, "package.json", "{\"name\": \"p\", \"x\": 1}\n");
    let reply = trace(&f, &id, "typescript").await;
    assert_eq!(
        reply["oldSideResolvedThroughNewDependencies"], true,
        "{reply}"
    );
}

#[tokio::test]
async fn cp5_two_requests_run_one_after_the_other() {
    let (f, id, path, _origin) = fixture(Git::from_env(), &[("a.ts", SEED)]).await;
    let log = path.join("../servers.log");
    logging_tsc(&path, &log);
    write(&path, "a.ts", EDITED);
    let (a, b) = tokio::join!(trace(&f, &id, "typescript"), trace(&f, &id, "typescript"));
    assert_eq!(
        (a["state"].as_str(), b["state"].as_str()),
        (Some("done"), Some("done"))
    );
    assert!(logged(&log).len() >= 4, "{:?}", logged(&log));
    assert!(!logged(&log).contains(&"overlap".to_owned()));
}

#[tokio::test]
async fn cp5_no_language_server_child_is_alive_after_any_outcome() {
    let tool = Git::from_env().with_call_path_limit(std::time::Duration::from_millis(800));
    let (f, id, path, _origin) = fixture(tool, &[("a.ts", SEED)]).await;
    let log = path.join("../servers.log");
    logging_tsc(&path, &log);
    write(&path, "a.ts", EDITED);
    assert_eq!(trace(&f, &id, "typescript").await["state"], "done");
    assert_eq!(trace(&f, &id, "rust").await["state"], "noServer");
    let pid = path.join("../silent.pid");
    stub_tsc(&path, "7.0.2", &silent_server(&pid));
    assert_eq!(trace(&f, &id, "typescript").await["state"], "failed");
    assert!(!alive(&pid));
    for line in logged(&log)
        .iter()
        .filter(|l| l.chars().all(|c| c.is_ascii_digit()))
    {
        assert!(!Path::new(&format!("/proc/{line}")).exists(), "{line} left");
    }
}

#[tokio::test]
async fn cp7_a_failed_trace_changes_no_other_method() {
    let tool = Git::from_env().with_call_path_limit(std::time::Duration::from_millis(800));
    let (f, id, path, _origin) = fixture(tool, &[("a.ts", SEED)]).await;
    write(&path, "a.ts", EDITED);
    let before = f
        .call("agent.changedFiles", json!({"id": id}))
        .await
        .unwrap();
    stub_tsc(&path, "7.0.2", &silent_server(&path.join("../s.pid")));
    assert_eq!(trace(&f, &id, "typescript").await["state"], "failed");
    let after = f
        .call("agent.changedFiles", json!({"id": id}))
        .await
        .unwrap();
    assert_eq!(before, after);
}
