//! RA1 to RA4: `agent.callPaths` for Rust through a stub `rust-analyzer` that replays the shape
//! of rust-analyzer's replies (`scenarios/call-paths-rust.md`). No real server runs in CI; RA5
//! is the record in `docs/perf.md`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use agents::worktree::Git;
use serde_json::{Value, json};

use crate::cp_call_paths::{
    alive, calls_of, fixture, outgoing_names, stub_tsc, symbol, trace, write,
};

const SEED: &str = "pub struct Foo;
impl Foo {
    pub fn run(&self, s: &dyn Shape) { free(); s.area(); }
}
pub fn free() {}
pub trait Shape {
    fn area(&self) -> u32;
}
";

fn edited() -> String {
    SEED.replace("free(); s.area();", "free(); s.area(); free();")
}

const MANIFEST: &str = "[package]\nname = \"p\"\nversion = \"0.0.0\"\nedition = \"2021\"\n";

/// The server loop of every stub: it records what it was started with in `gate/start.json`,
/// answers symbols and calls in rust-analyzer's shape, and obeys the flag files of `gate`:
/// `nocall`, `offline`, `silent`, `hold` (waits for `go`), `child` (starts a long `sleep`).
fn serve(gate: &Path) -> String {
    format!(
        r#"gate = {gate:?}
import json, subprocess
def flag(n): return os.path.exists(gate + '/' + n)
def read():
    n = 0
    while True:
        line = sys.stdin.buffer.readline()
        if line == b'': sys.exit(0)
        if line.strip() == b'': break
        if line.lower().startswith(b'content-length:'): n = int(line.split(b':')[1])
    return json.loads(sys.stdin.buffer.read(n))
def send(o):
    body = json.dumps(dict(o, jsonrpc='2.0')).encode()
    sys.stdout.buffer.write(b'Content-Length: %d\r\n\r\n' % len(body) + body); sys.stdout.buffer.flush()
def pos(l, c): return {{'start': {{'line': l, 'character': c}}, 'end': {{'line': l, 'character': c + 4}}}}
def sym(name, kind, l, c, children=()):
    return {{'name': name, 'kind': kind, 'range': pos(l, 0) | {{'end': {{'line': l + 1 if children else l, 'character': 0}}}}, 'selectionRange': pos(l, c), 'children': list(children)}}
TABLE = [sym('Foo', 23, 0, 11), sym('impl Foo', 5, 1, 5, [sym('run', 6, 2, 11)]), sym('free', 12, 4, 7), sym('Shape', 11, 5, 10, [sym('area', 6, 6, 7)])]
ITEMS = {{'run': (2, 11, 6), 'free': (4, 7, 12), 'area': (6, 6 + 1, 6)}}
def item(name, uri):
    l, c, k = ITEMS[name]
    return {{'name': name, 'kind': k, 'uri': uri, 'range': pos(l, 0), 'selectionRange': pos(l, c)}}
while True:
    m = read()
    method, id = m.get('method'), m.get('id')
    if method == 'initialize':
        open(gate + '/start.json', 'w').write(json.dumps({{'env': {{k: os.environ.get(k) for k in ('CARGO_TARGET_DIR', 'CARGO_NET_OFFLINE')}}, 'options': m['params'].get('initializationOptions'), 'cwd': os.getcwd()}}))
        open(gate + '/pid', 'w').write(str(os.getpid()))
        caps = {{}} if flag('nocall') else {{'callHierarchyProvider': True}}
        send({{'id': id, 'result': {{'capabilities': caps}}}})
        if flag('child'): open(gate + '/child.pid', 'w').write(str(subprocess.Popen(['sleep', '600']).pid))
        if flag('offline'): send({{'method': 'window/showMessage', 'params': {{'type': 1, 'message': 'cargo metadata failed: no matching package named `dep` found; offline mode (via `--offline`) can sometimes cause surprising resolution failures'}}}})
        if flag('silent'): time.sleep(600)
        if flag('hold'):
            open(gate + '/started', 'w').write('')
            while not flag('go'): time.sleep(0.05)
    elif method == 'textDocument/documentSymbol': send({{'id': id, 'result': TABLE}})
    elif method == 'textDocument/prepareCallHierarchy':
        l = m['params']['position']['line']
        name = {{2: 'run', 4: 'free', 6: 'area'}}.get(l)
        send({{'id': id, 'result': [item(name, m['params']['textDocument']['uri'])] if name else []}})
    elif method == 'callHierarchy/outgoingCalls':
        uri = m['params']['item']['uri']
        if m['params']['item']['name'] != 'run': send({{'id': id, 'result': []}}); continue
        lib = {{'name': 'read_to_string', 'kind': 12, 'uri': 'file:///home/u/.cargo/registry/src/x/io-1/src/lib.rs', 'range': pos(1, 0), 'selectionRange': pos(1, 4)}}
        std = dict(lib, uri='file:///home/u/.rustup/toolchains/t/lib/rustlib/src/rust/library/std/src/io.rs')
        send({{'id': id, 'result': [{{'to': item('free', uri), 'fromRanges': [pos(2, 37)]}}, {{'to': item('area', uri), 'fromRanges': [pos(2, 45)]}}, {{'to': lib, 'fromRanges': [pos(2, 12)]}}, {{'to': std, 'fromRanges': [pos(2, 14)]}}]}})
    elif method == 'callHierarchy/incomingCalls': send({{'id': id, 'result': [{{'from': item('free', m['params']['item']['uri']), 'fromRanges': [pos(4, 10)]}}] if m['params']['item']['name'] == 'run' else []}})
    elif id is not None: send({{'id': id, 'result': None}})
"#,
        gate = gate.display().to_string()
    )
}

/// A `rust-analyzer` for PATH: `--version` reads `version`, else it runs `serve`.
fn stub_ra(bin: &Path, version: &str, body: &str) {
    let script = format!(
        "#!/usr/bin/env python3\nimport sys, os, time\nif '--version' in sys.argv:\n    print('rust-analyzer {version} (stub)'); sys.exit(0 if '{version}' else 1)\n{body}\n"
    );
    let path = bin.join("rust-analyzer");
    std::fs::write(&path, script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A project of one crate with an Agent whose `src/lib.rs` is edited, and a stub server.
async fn rust(
    tool: Git,
    gate: &Path,
    flags: &[&str],
) -> (crate::common::Fixture, String, PathBuf, tempfile::TempDir) {
    std::fs::create_dir_all(gate).unwrap();
    for flag in flags {
        std::fs::write(gate.join(flag), "").unwrap();
    }
    let (f, id, path, origin) = fixture(
        tool,
        &[
            ("Cargo.toml", MANIFEST),
            ("src/lib.rs", SEED),
            (".gitignore", "target\nnode_modules\n"),
        ],
    )
    .await;
    write(&path, "src/lib.rs", &edited());
    (f, id, path, origin)
}

fn tool(bin: &tempfile::TempDir, gate: &Path, version: &str) -> Git {
    stub_ra(bin.path(), version, &serve(gate));
    Git::with_path(format!(
        "{}:{}",
        bin.path().display(),
        std::env::var("PATH").unwrap()
    ))
}

fn started(gate: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(gate.join("start.json")).unwrap()).unwrap()
}

#[tokio::test]
async fn ra1_a_found_rust_analyzer_is_listed_with_its_version() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git, gate.path(), &[]).await;
    let reply = f.call("agent.callPaths", json!({"id": id})).await.unwrap();
    let row = &reply["languages"].as_array().unwrap()[0];
    assert_eq!(row["language"], "rust");
    assert_eq!(row["server"]["found"], true);
    assert_eq!(row["server"]["name"], "rust-analyzer");
    assert_eq!(row["server"]["version"], "1.99.0");
}

#[tokio::test]
async fn ra1_a_project_without_the_component_answers_no_server_with_how_to_get_it() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    // The rustup proxy exists; its `--version` fails because the component does not.
    let git = tool(&bin, gate.path(), "");
    let (f, id, _path, _origin) = rust(git, gate.path(), &[]).await;
    let reply = trace(&f, &id, "rust").await;
    assert_eq!(reply["state"], "noServer", "{reply}");
    assert_eq!(reply["cause"]["kind"], "notInstalled");
    assert_eq!(
        reply["cause"]["detail"],
        "rust-analyzer is not installed; `rustup component add rust-analyzer` installs it"
    );
    assert!(!gate.path().join("start.json").exists());
}

#[tokio::test]
async fn ra1_a_rust_server_without_call_hierarchy_reads_no_server() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git, gate.path(), &["nocall"]).await;
    let reply = trace(&f, &id, "rust").await;
    assert_eq!(reply["state"], "noServer", "{reply}");
    assert_eq!(reply["cause"]["kind"], "noCallHierarchy");
}

#[tokio::test]
async fn ra2_the_server_gets_its_own_target_directory_offline_and_locked() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, path, _origin) = rust(git, gate.path(), &[]).await;
    assert_eq!(trace(&f, &id, "rust").await["state"], "done");
    let start = started(gate.path());
    let target = start["env"]["CARGO_TARGET_DIR"].as_str().unwrap();
    assert!(target.contains("/call-paths/target/"), "{target}");
    assert!(!Path::new(target).starts_with(&path));
    assert_eq!(start["env"]["CARGO_NET_OFFLINE"], "true");
    assert_eq!(
        start["options"]["cargo"]["extraArgs"],
        json!(["--offline", "--locked"])
    );
    assert_eq!(start["options"]["checkOnSave"], false);
    assert_eq!(start["options"]["cargo"]["targetDir"], target);
}

async fn wait_for(file: &Path) {
    for _ in 0..200 {
        if file.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{} never appeared", file.display());
}

fn tree(dir: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = vec![];
    let mut stack = vec![dir.to_owned()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let meta = e.metadata().unwrap();
            if meta.is_dir() {
                stack.push(e.path());
            } else {
                out.push((e.path(), meta.len()));
            }
        }
    }
    out.sort();
    out
}

#[tokio::test]
async fn ra2_the_agents_target_and_lock_file_are_untouched_and_its_build_runs() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, path, _origin) = rust(git, gate.path(), &["hold"]).await;
    let build = |path: &Path| {
        std::process::Command::new("cargo")
            .args(["build", "--offline", "-q"])
            .current_dir(path)
            .status()
            .unwrap()
            .success()
    };
    assert!(build(&path));
    let before = (
        tree(&path.join("target")),
        std::fs::read(path.join("Cargo.lock")).unwrap(),
    );
    let during = async {
        wait_for(&gate.path().join("started")).await;
        // The trace is open and holds nothing the Agent's cargo needs.
        let dir = path.clone();
        assert!(
            tokio::task::spawn_blocking(move || build(&dir))
                .await
                .unwrap()
        );
        std::fs::write(gate.path().join("go"), "").unwrap();
    };
    let (reply, ()) = tokio::join!(trace(&f, &id, "rust"), during);
    assert_eq!(reply["state"], "done");
    let after = (
        tree(&path.join("target")),
        std::fs::read(path.join("Cargo.lock")).unwrap(),
    );
    assert_eq!(before, after);
}

#[tokio::test]
async fn ra2_a_missing_dependency_reads_failed_with_its_cause() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git, gate.path(), &["offline"]).await;
    let reply = trace(&f, &id, "rust").await;
    assert_eq!(reply["state"], "failed", "{reply}");
    assert_eq!(reply["cause"]["kind"], "cargoOffline");
    assert!(
        reply["cause"]["detail"]
            .as_str()
            .unwrap()
            .contains("--offline")
    );
}

#[tokio::test]
async fn ra3_a_silent_rust_server_ends_at_the_rust_limit_as_failed() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0").with_call_path_limit(Duration::from_millis(800));
    let (f, id, _path, _origin) = rust(git, gate.path(), &["silent"]).await;
    let reply = trace(&f, &id, "rust").await;
    assert_eq!(
        (reply["state"].as_str(), reply["cause"]["kind"].as_str()),
        (Some("failed"), Some("timeout")),
        "{reply}"
    );
}

fn pid_file_alive(file: &Path) -> bool {
    alive(file)
}

#[tokio::test]
async fn ra3_a_rust_and_a_typescript_request_run_one_after_the_other_and_cancel_kills_the_group() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, path, _origin) = rust(git, gate.path(), &["hold", "child"]).await;
    write(&path, "a.ts", "export function a() { return 1; }\n");
    stub_tsc(&path, "7.0.2", &serve(gate.path()));
    // The Rust request holds the one trace slot; the TypeScript request waits behind it.
    let ts_gate = tempfile::tempdir().unwrap();
    stub_tsc(&path, "7.0.2", &serve(ts_gate.path()));
    let ts_call = async {
        wait_for(&gate.path().join("started")).await;
        trace(&f, &id, "typescript").await
    };
    let control = async {
        wait_for(&gate.path().join("started")).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(pid_file_alive(&gate.path().join("pid")));
        assert!(!ts_gate.path().join("start.json").exists());
    };
    // Cancelling (the callers gone) kills the server and the child it started, as one group.
    let both = async { tokio::join!(trace(&f, &id, "rust"), ts_call, control) };
    assert!(
        tokio::time::timeout(Duration::from_millis(1500), both)
            .await
            .is_err()
    );
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    for _ in 0..60 {
        tick.tick().await;
        if !pid_file_alive(&gate.path().join("pid"))
            && !pid_file_alive(&gate.path().join("child.pid"))
        {
            break;
        }
    }
    assert!(!pid_file_alive(&gate.path().join("pid")));
    assert!(!pid_file_alive(&gate.path().join("child.pid")));
}

#[tokio::test]
async fn ra3_no_rust_analyzer_child_is_alive_after_any_outcome() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0").with_call_path_limit(Duration::from_millis(800));
    let (f, id, _path, _origin) = rust(git, gate.path(), &["child"]).await;
    assert_eq!(trace(&f, &id, "rust").await["state"], "done");
    assert!(!pid_file_alive(&gate.path().join("pid")));
    assert!(!pid_file_alive(&gate.path().join("child.pid")));
    std::fs::write(gate.path().join("silent"), "").unwrap();
    assert_eq!(trace(&f, &id, "rust").await["state"], "failed");
    assert!(!pid_file_alive(&gate.path().join("pid")));
    assert!(!pid_file_alive(&gate.path().join("child.pid")));
}

async fn done(f: &crate::common::Fixture, id: &str) -> Value {
    let reply = trace(f, id, "rust").await;
    assert_eq!(reply["state"], "done", "{reply}");
    reply
}

#[tokio::test]
async fn ra4_a_method_is_keyed_under_its_impl_block() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git, gate.path(), &[]).await;
    let reply = done(&f, &id).await;
    let run = symbol(&reply, "run");
    assert_eq!(run["key"], "src/lib.rs#impl Foo#run#method");
    assert_eq!(run["status"], "changed");
    assert!(
        reply["symbols"]
            .as_array()
            .unwrap()
            .iter()
            .all(|s| s["name"] != "impl Foo")
    );
}

#[tokio::test]
async fn ra4_a_call_through_a_trait_object_ends_at_the_trait_method() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git, gate.path(), &[]).await;
    let reply = done(&f, &id).await;
    let area = calls_of(&reply, "run")["outgoing"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "area")
        .cloned()
        .unwrap();
    assert_eq!(area["key"], "src/lib.rs#Shape#area#method");
}

#[tokio::test]
async fn ra4_a_reply_names_the_levers_that_cut_calls() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git.clone(), gate.path(), &[]).await;
    let plain = done(&f, &id).await;
    assert!(plain.get("unresolved").is_none() && plain.get("directions").is_none());
    assert_eq!(calls_of(&plain, "run")["incoming_unchanged"], 1, "{plain}");
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0").with_call_path_levers(true, true);
    let (f, id, _path, _origin) = rust(git, gate.path(), &[]).await;
    let cut = done(&f, &id).await;
    assert_eq!(cut["unresolved"], json!(["macroGenerated"]));
    assert_eq!(cut["directions"], "outgoing");
    assert_eq!(calls_of(&cut, "run")["incoming_unchanged"], 0, "{cut}");
    let start = started(gate.path());
    assert_eq!(start["options"]["procMacro"]["enable"], false);
    assert_eq!(start["options"]["cargo"]["buildScripts"]["enable"], false);
}

#[tokio::test]
async fn ra4_library_callees_are_filtered_for_rust_paths() {
    let (bin, gate) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let git = tool(&bin, gate.path(), "1.99.0");
    let (f, id, _path, _origin) = rust(git, gate.path(), &[]).await;
    let reply = done(&f, &id).await;
    let names = outgoing_names(&reply, "run");
    assert!(names.contains(&"free".to_owned()), "{names:?}");
    assert!(!names.contains(&"read_to_string".to_owned()), "{names:?}");
}
