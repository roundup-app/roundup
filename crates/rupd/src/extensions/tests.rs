//! UA1–UA8 over a real socket, a fake App connection and Extension folders in a temp directory.
//! Each Extension is a real `node` child: the process boundary is what these test.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use contracts::EventData;
use rpc::code;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{UnixListener, UnixStream};

use crate::Daemon;

struct Wire {
    lines: tokio::io::Lines<BufReader<OwnedReadHalf>>,
    write: OwnedWriteHalf,
}

impl Wire {
    async fn connect(socket: &Path) -> Self {
        let (read, write) = UnixStream::connect(socket).await.unwrap().into_split();
        Self {
            lines: BufReader::new(read).lines(),
            write,
        }
    }

    async fn send(&mut self, line: Value) {
        self.write
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn next(&mut self) -> Option<Value> {
        let line = self.lines.next_line().await.unwrap()?;
        Some(serde_json::from_str(&line).unwrap())
    }

    async fn call(&mut self, method: &str, params: Value) -> Value {
        self.send(json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
            .await;
        loop {
            let line = self.next().await.unwrap();
            if line["id"] == 1 {
                return line;
            }
        }
    }
}

struct Fx {
    root: tempfile::TempDir,
    socket: PathBuf,
    daemon: Arc<Daemon>,
    events: tokio::sync::broadcast::Receiver<contracts::Event>,
}

fn extensions(root: &Path) -> PathBuf {
    root.join("extensions")
}

/// An Extension folder whose module is `js`.
fn ext(root: &Path, folder: &str, permissions: &[&str], js: &str) {
    let dir = extensions(root).join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    let manifest = json!({"name": folder, "module": "index.mjs", "permissions": permissions});
    std::fs::write(dir.join("rup-extension.json"), manifest.to_string()).unwrap();
    std::fs::write(dir.join("index.mjs"), js).unwrap();
}

fn action(name: &str, body: &str) -> String {
    format!(
        "export function register(on) {{ on('action', {{ name: '{name}', label: 'Label of {name}' }}, async ($, e, next) => {{ {body} }}); }}"
    )
}

async fn open(
    root: tempfile::TempDir,
    node: &str,
    timeout: Duration,
    early: impl FnOnce(&Path),
) -> Fx {
    early(root.path());
    let data = root.path().join("data");
    let mut daemon = Daemon::open(&data).unwrap();
    daemon.extensions = super::Host::for_test(extensions(root.path()), node, timeout);
    let daemon = Arc::new(daemon);
    let (events, _) = daemon.subscribe();
    let socket = root.path().join("ext.sock");
    tokio::spawn(crate::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
    ));
    Fx {
        root,
        socket,
        daemon,
        events,
    }
}

async fn with(early: impl FnOnce(&Path)) -> Fx {
    open(
        tempfile::tempdir().unwrap(),
        "node",
        Duration::from_secs(10),
        early,
    )
    .await
}

impl Fx {
    async fn user(&self) -> Wire {
        Wire::connect(&self.socket).await
    }

    /// Waits until `action.userList` holds `names`.
    async fn listed(&self, names: &[&str]) -> Vec<Value> {
        let mut user = self.user().await;
        for _ in 0..200 {
            let rows = user.call("action.userList", Value::Null).await["result"]
                .as_array()
                .unwrap()
                .clone();
            if rows
                .iter()
                .map(|row| row["name"].as_str().unwrap())
                .collect::<Vec<_>>()
                == names
            {
                return rows;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("never listed {names:?}");
    }

    /// The `extension.problem` events so far, as `(extension, cause)`.
    fn problems(&mut self) -> Vec<(String, String)> {
        let mut found = Vec::new();
        while let Ok(event) = self.events.try_recv() {
            if let EventData::ExtensionProblem(problem) = event.data {
                found.push((problem.extension, problem.cause));
            }
        }
        found
    }

    async fn problems_after(&mut self, wait: Duration) -> Vec<(String, String)> {
        tokio::time::sleep(wait).await;
        self.problems()
    }

    /// A fake App: answers lists with `agent.new` and runs with `done`.
    async fn app(&self) {
        let mut app = self.user().await;
        app.call("action.serve", Value::Null).await;
        tokio::spawn(async move {
            while let Some(request) = app.next().await {
                let id = request["id"].clone();
                if request["method"] == "action.list" {
                    let rows = json!([{"name":"agent.new","label":"New agent","keys":"⌘N","args":[],"available":true}]);
                    app.send(json!({"jsonrpc":"2.0","id":id,"result":rows}))
                        .await;
                }
            }
        });
    }
}

#[tokio::test]
async fn ua1_a_registered_action_is_listed_after_the_apps() {
    // The stand-in `node` records whether the socket already served when the host started a child.
    let root = tempfile::tempdir().unwrap();
    let marker = root.path().join("socket-was-bound");
    let stand_in = root.path().join("node-stand-in.sh");
    std::fs::write(
        &stand_in,
        format!(
            "#!/bin/sh\n[ -S '{0}/ext.sock' ] && touch '{1}'\nexec node \"$@\"\n",
            root.path().display(),
            marker.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(
        &stand_in,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let js = "export function register(on) { on('action', { name: 'user.deploy', label: 'Deploy', args: [{ key: 'target', type: 'choice', options: ['staging', 'prod'] }] }, () => ({ done: true })); }";
    let fx = open(
        root,
        stand_in.to_str().unwrap(),
        Duration::from_secs(10),
        |root| ext(root, "deploy", &[], js),
    )
    .await;
    let rows = fx.listed(&["user.deploy"]).await;
    assert_eq!(rows[0]["label"], "Deploy");
    assert_eq!(rows[0]["source"], "user");
    assert_eq!(rows[0]["args"][0]["key"], "target");
    assert_eq!(rows[0]["args"][0]["options"], json!(["staging", "prod"]));
    assert!(fx.root.path().join("socket-was-bound").exists());
    fx.app().await;
    let list = fx.user().await.call("action.list", Value::Null).await["result"].clone();
    let list = list.as_array().unwrap();
    assert_eq!(list[0]["name"], "agent.new");
    assert_eq!(list.last().unwrap(), &rows[0]);
}

#[tokio::test]
async fn ua2_a_bad_manifest_adds_nothing_and_raises_one_problem() {
    let mut fx = with(|root| {
        let bad = |folder: &str, text: &str| {
            let dir = extensions(root).join(folder);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("rup-extension.json"), text).unwrap();
            std::fs::write(
                dir.join("index.mjs"),
                action("user.bad", "return { done: true };"),
            )
            .unwrap();
        };
        bad("no-name", r#"{"module":"index.mjs","permissions":[]}"#);
        bad("no-module", r#"{"name":"a","permissions":[]}"#);
        bad("no-permissions", r#"{"name":"b","module":"index.mjs"}"#);
        bad(
            "outside",
            r#"{"name":"c","module":"../elsewhere.mjs","permissions":[]}"#,
        );
        bad(
            "other-permission",
            r#"{"name":"d","module":"index.mjs","permissions":["network"]}"#,
        );
        bad("not-json", "{ nope");
        ext(
            root,
            "good",
            &[],
            &action("user.good", "return { done: true };"),
        );
    })
    .await;
    fx.listed(&["user.good"]).await;
    let problems = fx.problems_after(Duration::from_millis(500)).await;
    assert_eq!(problems.len(), 6, "{problems:?}");
    for (folder, part) in [
        ("no-name", "\"name\""),
        ("no-module", "\"module\""),
        ("no-permissions", "\"permissions\""),
        ("outside", "outside"),
        ("other-permission", "network"),
        ("not-json", "not JSON"),
    ] {
        let cause = problems
            .iter()
            .find(|(_, cause)| cause.starts_with(&format!("{folder}/rup-extension.json")))
            .unwrap_or_else(|| panic!("no problem for {folder}"));
        assert!(cause.1.contains(part), "{cause:?}");
    }
}

#[tokio::test]
async fn ua3_a_user_action_cannot_take_a_built_in_or_taken_name() {
    for app_first in [true, false] {
        let mut fx = with(|root| {
            ext(root, "a-first", &[], &action("agent.new", "return { done: true };"));
            ext(root, "b-second", &[], &format!("{}\nexport const x = 1;", "export function register(on) { for (const name of ['Bad Name', 'user.own', 'user.shared']) on('action', { name, label: name }, () => ({ done: true })); }"));
            ext(root, "c-third", &[], &action("user.shared", "return { done: true };"));
        })
        .await;
        if app_first {
            fx.app().await;
        }
        if !app_first {
            // Before the App registers nothing is built-in yet, so the name is listed.
            fx.listed(&["agent.new", "user.own", "user.shared"]).await;
            fx.app().await;
        }
        fx.listed(&["user.own", "user.shared"]).await;
        let list = fx.user().await.call("action.list", Value::Null).await["result"].clone();
        let names: Vec<_> = list
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            ["agent.new", "user.own", "user.shared"],
            "app_first={app_first}"
        );
        assert_eq!(list[0].get("source"), None);
        let problems = fx.problems_after(Duration::from_millis(500)).await;
        let has = |rule: &str, name: &str| {
            problems
                .iter()
                .filter(|(_, cause)| cause.contains(rule) && cause.contains(name))
                .count()
        };
        assert_eq!(has("pattern", "Bad Name"), 1, "{problems:?}");
        assert_eq!(has("built-in", "agent.new"), 1, "{problems:?}");
        assert_eq!(has("taken", "user.shared"), 1, "{problems:?}");
        assert_eq!(problems.len(), 3, "{problems:?}");
    }
}

fn todo_js(call: &str) -> String {
    format!(
        "export function register(on) {{ on('action', {{ name: 'user.touch', label: 'Touch' }}, async ($) => {{ try {{ await {call}; return {{ done: true }}; }} catch (error) {{ return {{ deny: error.message }}; }} }}); }}"
    )
}

#[tokio::test]
async fn ua4_a_declared_permission_is_used_and_touched_under_the_ext() {
    let fx = with(|root| {
        ext(
            root,
            "todoer",
            &["todos"],
            &todo_js("$.todos.create({ title: 'from an extension' })"),
        )
    })
    .await;
    fx.listed(&["user.touch"]).await;
    let mut user = fx.user().await;
    assert_eq!(
        user.call("action.run", json!({"name":"user.touch"})).await["result"]["status"],
        "done"
    );
    let todos = user.call("todo.list", Value::Null).await["result"].clone();
    assert_eq!(todos[0]["title"], "from an extension");
    let touched = user
        .call("provenance.touched", json!({"actor_id":"ext:todoer"}))
        .await["result"]
        .clone();
    assert!(
        touched
            .as_array()
            .unwrap()
            .iter()
            .any(|touch| touch["actor"]["kind"] == "ext"
                && touch["item"].as_str().unwrap().starts_with("todo")),
        "{touched}"
    );
}

#[tokio::test]
async fn ua4_an_undeclared_permission_is_forbidden_and_does_nothing() {
    let fx = with(|root| {
        ext(
            root,
            "padder",
            &["todos"],
            &todo_js("$.pads.write({ name: 'x', text: 'y' })"),
        );
        ext(
            root,
            "agenter",
            &["agents"],
            &todo_js("$.agents.context({ id: '1' })").replace("user.touch", "user.agent"),
        );
    })
    .await;
    fx.listed(&["user.agent", "user.touch"]).await;
    let mut user = fx.user().await;
    let reply = user.call("action.run", json!({"name":"user.touch"})).await;
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("permission `pads`") && message.contains("rup-extension.json"),
        "{message}"
    );
    assert_eq!(
        user.call("pad.list", Value::Null).await["result"],
        json!([])
    );
    let db = rusqlite::Connection::open(fx.root.path().join("data/project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES('1','agent','one',0)",
        [],
    )
    .unwrap();
    // `agents` declared still never gains `agent.context` (CL3).
    let reply = user.call("action.run", json!({"name":"user.agent"})).await;
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("may not read the Context"),
        "{reply}"
    );
}

#[tokio::test]
async fn ua5_run_checks_arguments_then_runs_the_hook_once() {
    let counted = "export function register(on) { on('action', { name: 'user.deploy', label: 'Deploy', args: [{ key: 'target', type: 'choice', options: ['staging', 'prod'], required: true }, { key: 'n', type: 'integer', min: 1, max: 3 }] }, async ($, e) => { await $.store.set({ key: 'runs', value: ((await $.store.get('runs')) ?? 0) + 1 }); return e.args.n === 3 ? { deny: 'three is too many' } : { done: true }; }); on('action', { name: 'user.count', label: 'Count' }, async ($) => ({ deny: String(await $.store.get('runs')) })); }";
    let fx = with(|root| ext(root, "deploy", &["store"], counted)).await;
    fx.listed(&["user.deploy", "user.count"]).await;
    let mut user = fx.user().await;
    let run = |args: Value| json!({"name":"user.deploy","args":args});
    let pair = |key: &str, value: &str| json!({"key":key,"value":value});
    for bad in [
        json!([]),
        json!([pair("target", "moon")]),
        json!([pair("target", "prod"), pair("n", "9")]),
        json!([pair("target", "prod"), pair("n", "x")]),
        json!([pair("target", "prod"), pair("nope", "1")]),
    ] {
        let reply = user.call("action.run", run(bad)).await;
        assert_eq!(reply["error"]["code"], code::INVALID_PARAMS, "{reply}");
    }
    let reply = user
        .call(
            "action.run",
            run(json!([pair("target", "prod"), pair("n", "3")])),
        )
        .await;
    assert_eq!(reply["error"]["message"], "three is too many");
    assert_eq!(
        user.call("action.run", run(json!([pair("target", "prod")])))
            .await["result"]["status"],
        "done"
    );
    // Two accepted runs, and none of the five refused ones, ran the hook.
    let reply = user.call("action.run", json!({"name":"user.count"})).await;
    assert_eq!(reply["error"]["message"], "2");
    let touched = user
        .call("provenance.touched", json!({"actor_id":"you"}))
        .await["result"]
        .clone();
    let items: Vec<_> = touched
        .as_array()
        .unwrap()
        .iter()
        .map(|touch| touch["item"].as_str().unwrap())
        .collect();
    assert!(
        items.contains(&"action:user.deploy:target")
            && items.iter().all(|item| !item.contains("prod")),
        "{items:?}"
    );
}

#[tokio::test]
async fn ua5_only_the_user_runs_a_user_action() {
    let fx = with(|root| {
        ext(
            root,
            "d",
            &["store"],
            &action(
                "user.deploy",
                "await $.store.set({ key: 'ran', value: 1 }); return { done: true };",
            ),
        )
    })
    .await;
    fx.listed(&["user.deploy"]).await;
    let mut agent = fx.user().await;
    agent
        .call(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":"7","parent":null}}),
        )
        .await;
    let reply = agent
        .call("action.run", json!({"name":"user.deploy"}))
        .await;
    assert_eq!(reply["error"]["code"], code::FORBIDDEN);
    assert_eq!(fx.daemon.extensions.store.lock().unwrap().get("d"), None);
}

#[tokio::test]
async fn ua5_a_user_action_runs_with_no_app() {
    let fx = with(|root| {
        ext(
            root,
            "d",
            &[],
            &action("user.deploy", "return { done: true };"),
        )
    })
    .await;
    fx.listed(&["user.deploy"]).await;
    let reply = fx
        .user()
        .await
        .call("action.run", json!({"name":"user.deploy"}))
        .await;
    assert_eq!(reply["result"]["status"], "done");
}

#[tokio::test]
async fn ua6_a_throwing_hook_is_skipped_with_one_problem() {
    let js = "export function register(on) { on('action', { name: 'user.a', label: 'A' }, () => { throw new Error('boom'); }); on('action', { name: 'user.a', label: 'A' }, () => ({ done: true })); on('action', { name: 'user.b', label: 'B' }, () => { throw new Error('bang'); }); on('action', { name: 'user.c', label: 'C' }, () => { throw new Error('bang'); }).catch(() => ({ deny: 'caught' })); }";
    let mut fx = with(|root| ext(root, "thrower", &[], js)).await;
    fx.listed(&["user.a", "user.b", "user.c"]).await;
    let mut user = fx.user().await;
    // The next hook in the chain still runs.
    assert_eq!(
        user.call("action.run", json!({"name":"user.a"})).await["result"]["status"],
        "done"
    );
    let reply = user.call("action.run", json!({"name":"user.b"})).await;
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("user.b") && message.contains("thrower") && message.contains("bang"),
        "{message}"
    );
    // `.catch` answers in place of the failure and raises nothing.
    assert_eq!(
        user.call("action.run", json!({"name":"user.c"})).await["error"]["message"],
        "caught"
    );
    assert_eq!(
        user.call("daemon.ping", Value::Null).await["result"]["pong"],
        true
    );
    assert_eq!(fx.problems().len(), 2);
}

#[tokio::test]
async fn ua6_a_hook_that_never_answers_ends_at_the_timeout() {
    let root = tempfile::tempdir().unwrap();
    let mut fx = open(root, "node", Duration::from_secs(1), |root| {
        ext(
            root,
            "hanger",
            &[],
            &action("user.hang", "await new Promise(() => {});"),
        )
    })
    .await;
    fx.listed(&["user.hang"]).await;
    let mut user = fx.user().await;
    let begun = std::time::Instant::now();
    let reply = user.call("action.run", json!({"name":"user.hang"})).await;
    assert!(begun.elapsed() < Duration::from_secs(5));
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("user.hang") && message.contains("hanger"),
        "{message}"
    );
    assert_eq!(fx.problems().len(), 1);
    assert_eq!(
        user.call("daemon.ping", Value::Null).await["result"]["pong"],
        true
    );
}

#[tokio::test]
async fn ua6_a_dead_child_unlists_its_actions_and_the_daemon_serves_on() {
    let mut fx = with(|root| {
        ext(
            root,
            "quitter",
            &[],
            &action("user.quit", "process.exit(3);"),
        );
        ext(
            root,
            "steady",
            &[],
            &action("user.steady", "return { done: true };"),
        );
    })
    .await;
    fx.listed(&["user.quit", "user.steady"]).await;
    let mut user = fx.user().await;
    let reply = user.call("action.run", json!({"name":"user.quit"})).await;
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("quitter"),
        "{reply}"
    );
    fx.listed(&["user.steady"]).await;
    assert_eq!(
        user.call("action.run", json!({"name":"user.steady"})).await["result"]["status"],
        "done"
    );
    assert_eq!(fx.problems_after(Duration::from_millis(300)).await.len(), 1);
}

#[tokio::test]
async fn ua7_a_saved_module_re_registers_and_keeps_the_store() {
    let first = "export function register(on) { setInterval(() => {}, 1000); on('action', { name: 'user.one', label: 'One' }, async ($) => { await $.store.set({ key: 'k', value: 'kept' }); return { done: true }; }); }";
    let mut fx = with(|root| ext(root, "hot", &["store"], first)).await;
    fx.listed(&["user.one"]).await;
    let mut user = fx.user().await;
    user.call("action.run", json!({"name":"user.one"})).await;
    while fx.events.try_recv().is_ok() {}
    let second = "export function register(on) { on('action', { name: 'user.two', label: 'Two' }, async ($) => ({ deny: await $.store.get('k') })); }";
    std::fs::write(extensions(fx.root.path()).join("hot/index.mjs"), second).unwrap();
    fx.listed(&["user.two"]).await;
    assert_eq!(
        user.call("action.run", json!({"name":"user.two"})).await["error"]["message"],
        "kept"
    );
    let mut changed = 0;
    while let Ok(event) = fx.events.try_recv() {
        changed += usize::from(matches!(event.data, EventData::ActionUserChanged));
    }
    assert_eq!(changed, 1);
    // Deleting the folder removes its actions.
    std::fs::remove_dir_all(extensions(fx.root.path()).join("hot")).unwrap();
    fx.listed(&[]).await;
}

#[tokio::test]
async fn ua7_a_bad_save_keeps_the_last_good_registration() {
    let mut fx = with(|root| {
        ext(
            root,
            "hot",
            &[],
            &action("user.good", "return { done: true };"),
        )
    })
    .await;
    fx.listed(&["user.good"]).await;
    let bad = "export function register() { throw new Error('half saved'); }";
    std::fs::write(extensions(fx.root.path()).join("hot/index.mjs"), bad).unwrap();
    let problems = fx.problems_after(Duration::from_secs(2)).await;
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert!(problems[0].1.contains("index.mjs") && problems[0].1.contains("half saved"));
    fx.listed(&["user.good"]).await;
    let reply = fx
        .user()
        .await
        .call("action.run", json!({"name":"user.good"}))
        .await;
    assert_eq!(reply["result"]["status"], "done");
}

#[tokio::test]
async fn ua8_a_broken_extension_never_stops_the_daemon() {
    let root = tempfile::tempdir().unwrap();
    let mut fx = open(root, "node", Duration::from_secs(1), |root| {
        ext(root, "exits", &[], "process.exit(1);");
        ext(root, "loops", &[], "export function register() { for (;;) {} }");
        ext(root, "prints", &[], "export function register() { for (;;) process.stdout.write('x'.repeat(100000) + '\\n'); }");
        ext(root, "rejects", &[], "export async function register() { throw new Error('no'); }");
        ext(root, "fine", &[], &action("user.fine", "return { done: true };"));
    })
    .await;
    let mut user = fx.user().await;
    assert_eq!(
        user.call("daemon.ping", Value::Null).await["result"]["pong"],
        true
    );
    fx.listed(&["user.fine"]).await;
    let problems = fx.problems_after(Duration::from_secs(3)).await;
    for broken in ["exits", "loops", "prints", "rejects"] {
        assert_eq!(
            problems
                .iter()
                .filter(|(extension, _)| extension == broken)
                .count(),
            1,
            "{problems:?}"
        );
    }
    assert_eq!(problems.len(), 4, "{problems:?}");
    assert!(user.call("action.list", Value::Null).await["error"]["code"] == code::APP_CLOSED);

    // `node` missing from the path: one problem per Extension, saying how to install it.
    let root = tempfile::tempdir().unwrap();
    let mut fx = open(root, "no-such-node-here", Duration::from_secs(1), |root| {
        ext(
            root,
            "one",
            &[],
            &action("user.one", "return { done: true };"),
        );
        ext(
            root,
            "two",
            &[],
            &action("user.two", "return { done: true };"),
        );
    })
    .await;
    let problems = fx.problems_after(Duration::from_secs(1)).await;
    assert_eq!(problems.len(), 2, "{problems:?}");
    assert!(
        problems
            .iter()
            .all(|(_, cause)| cause.contains("node was not found") && cause.contains("install"))
    );
    assert_eq!(
        fx.user().await.call("daemon.ping", Value::Null).await["result"]["pong"],
        true
    );
}
