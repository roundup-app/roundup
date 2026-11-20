//! PG1 to PG5: a Project's own program runs in a Terminal on the Rail, restarts after a crash,
//! holds a stop, and is attached again, not started twice, by a reopened Daemon.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::sync::Arc;
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

/// A program that reports OSC 7501, records how it started and waits.
const SCRIPT: &str = r#"printf '\033]7501;state=working:msg=YnVpbGQ=\033\\'; echo "$PWD|$RUPD_SOCKET|${ROUNDUP_AGENT_ID-unset}|$PATH" >> "$OLDPWD/started.txt"; exec sleep 600"#;

struct Open {
    client: Client,
    daemon: Arc<rupd::Daemon>,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
}

impl Drop for Open {
    fn drop(&mut self) {
        self.server.abort();
    }
}

struct World {
    project: tempfile::TempDir,
    data: tempfile::TempDir,
}

fn world() -> World {
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir(project.path().join("work")).unwrap();
    World {
        project,
        data: tempfile::tempdir().unwrap(),
    }
}

impl World {
    async fn open(&self) -> Open {
        let (daemon, watchers) =
            rupd::Daemon::open_project(self.project.path(), self.data.path()).unwrap();
        let daemon = Arc::new(daemon);
        daemon.reattach_owners().await.unwrap();
        let socket = self.project.path().join(format!("{}.sock", rand_name()));
        let server = tokio::spawn(rupd::serve(
            UnixListener::bind(&socket).unwrap(),
            Arc::clone(&daemon),
            watchers,
        ));
        let client = Client::connect(&socket).await.unwrap();
        Open {
            client,
            daemon,
            server,
        }
    }

    fn started(&self) -> Vec<String> {
        std::fs::read_to_string(self.project.path().join("started.txt"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

fn rand_name() -> String {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    format!("d{}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

fn entry() -> Value {
    json!({"argv": ["sh", "-c", SCRIPT], "dir": "work"})
}

async fn call(o: &Open, method: &str, params: Value) -> Value {
    o.client.request(method, params).await.unwrap()
}

async fn refused(o: &Open, method: &str, params: Value) -> i64 {
    i64::from(o.client.request(method, params).await.unwrap_err().code)
}

async fn identify(o: &Open, kind: &str) {
    call(
        o,
        "daemon.identify",
        json!({"actor": {"kind": kind, "id": "someone", "parent": null}}),
    )
    .await;
}

async fn until<F: std::future::Future<Output = bool>>(what: &str, mut ready: impl FnMut() -> F) {
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while !ready().await {
        assert!(std::time::Instant::now() < deadline, "timed out: {what}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn run(o: &Open) -> Value {
    call(o, "project.programRun", Value::Null).await
}

async fn running(o: &Open) -> String {
    until("the program runs", || async { run(o).await["state"] == "running" }).await;
    run(o).await["terminalId"].as_str().unwrap().to_owned()
}

/// The Terminals the Project owns, which is where the program's row comes from.
async fn rows(o: &Open, w: &World) -> Vec<Value> {
    let owner = std::path::absolute(w.project.path()).unwrap();
    call(o, "terminal.list", json!({}))
        .await
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["owner"] == owner.to_string_lossy().as_ref())
        .cloned()
        .collect()
}

async fn set(o: &Open) {
    call(o, "project.setProgram", entry()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn pg1_set_stores_one_entry_and_replaces_it() {
    let w = world();
    let o = w.open().await;
    assert_eq!(call(&o, "project.get", Value::Null).await["program"], Value::Null);
    set(&o).await;
    assert_eq!(call(&o, "project.get", Value::Null).await["program"], entry());
    let second = json!({"argv": ["true"], "dir": ""});
    call(&o, "project.setProgram", second.clone()).await;
    assert_eq!(call(&o, "project.get", Value::Null).await["program"], second);
    drop(o);
    let again = w.open().await;
    assert_eq!(call(&again, "project.get", Value::Null).await["program"], second);
}

#[tokio::test(flavor = "multi_thread")]
async fn pg1_a_bad_argv_or_dir_changes_nothing() {
    let w = world();
    let o = w.open().await;
    set(&o).await;
    std::os::unix::fs::symlink("/", w.project.path().join("out")).unwrap();
    for bad in [
        json!({"argv": [], "dir": "work"}),
        json!({"argv": [""], "dir": "work"}),
        json!({"argv": ["x"], "dir": ".."}),
        json!({"argv": ["x"], "dir": "work/../.."}),
        json!({"argv": ["x"], "dir": "/tmp"}),
        json!({"argv": ["x"], "dir": "out"}),
        json!({"argv": ["x"], "dir": "missing"}),
    ] {
        assert_eq!(refused(&o, "project.setProgram", bad.clone()).await, i64::from(rpc::code::INVALID_PARAMS), "{bad}");
    }
    assert_eq!(call(&o, "project.get", Value::Null).await["program"], entry());
}

#[tokio::test(flavor = "multi_thread")]
async fn pg1_an_ext_or_agent_call_is_forbidden_and_changes_nothing() {
    let w = world();
    let o = w.open().await;
    set(&o).await;
    for kind in ["agent", "ext"] {
        identify(&o, kind).await;
        for (method, params) in [
            ("project.setProgram", json!({"argv": ["true"], "dir": ""})),
            ("project.clearProgram", Value::Null),
            ("project.startProgram", Value::Null),
            ("project.stopProgram", Value::Null),
        ] {
            assert_eq!(refused(&o, method, params).await, i64::from(rpc::code::FORBIDDEN), "{kind} {method}");
        }
    }
    identify(&o, "user").await;
    assert_eq!(call(&o, "project.get", Value::Null).await["program"], entry());
    assert_eq!(run(&o).await["state"], "stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn pg1_a_file_in_the_project_folder_names_no_program() {
    let w = world();
    for name in ["roundup.json", ".roundup/program.json", "program.json"] {
        let file = w.project.path().join(name);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, r#"{"argv": ["touch", "ran"], "dir": ""}"#).unwrap();
    }
    let o = w.open().await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(call(&o, "project.get", Value::Null).await["program"], Value::Null);
    assert!(!w.project.path().join("ran").exists());
    assert!(rows(&o, &w).await.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn pg2_open_starts_the_program_once_with_its_dir_and_environment() {
    let w = world();
    let first = w.open().await;
    set(&first).await;
    drop(first);
    let o = w.open().await;
    running(&o).await;
    until("it wrote its start", || async { !w.started().is_empty() }).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = w.started();
    assert_eq!(started.len(), 1, "{started:?}");
    let fields: Vec<&str> = started[0].split('|').collect();
    assert!(fields[0].ends_with("/work"), "{}", fields[0]);
    assert!(fields[1].ends_with(".sock"), "{}", fields[1]);
    assert_eq!(fields[2], "unset");
    let rup = std::env::current_exe().unwrap().with_file_name("rup");
    assert_eq!(
        fields[3].split(':').next().unwrap(),
        rup.parent().unwrap().to_str().unwrap()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn pg2_the_row_shows_the_reported_status() {
    let w = world();
    let first = w.open().await;
    set(&first).await;
    drop(first);
    let o = w.open().await;
    running(&o).await;
    until("the status shows on its row", || async {
        let rows = rows(&o, &w).await;
        rows.len() == 1 && rows[0]["status"]["kind"] == "working" && rows[0]["status"]["label"] == "build"
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn pg2_a_project_without_a_program_and_a_fork_start_nothing() {
    let w = world();
    let o = w.open().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(rows(&o, &w).await.is_empty());
    assert_eq!(run(&o).await["state"], "none");
    set(&o).await;
    drop(o);
    // FOP5978b: `<root>/fork.json` makes the data folder a Fork's.
    std::fs::write(w.data.path().join("fork.json"), "{}").unwrap();
    let fork = w.open().await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(rows(&fork, &w).await.is_empty());
    assert!(w.started().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn pg3_stop_holds_until_the_user_starts_it_and_survives_a_restart() {
    let w = world();
    let o = w.open().await;
    set(&o).await;
    call(&o, "project.startProgram", Value::Null).await;
    running(&o).await;
    call(&o, "project.stopProgram", Value::Null).await;
    assert_eq!(run(&o).await["state"], "stopped");
    tokio::time::sleep(Duration::from_millis(2500)).await;
    assert_eq!(run(&o).await["state"], "stopped");
    assert!(rows(&o, &w).await.is_empty());
    drop(o);
    let again = w.open().await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(run(&again).await["state"], "stopped");
    assert_eq!(w.started().len(), 1);
    call(&again, "project.startProgram", Value::Null).await;
    running(&again).await;
    until("it started again", || async { w.started().len() == 2 }).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn pg3_start_while_running_or_without_a_program_is_a_conflict() {
    let w = world();
    let o = w.open().await;
    let conflict = i64::from(rpc::code::CONFLICT);
    assert_eq!(refused(&o, "project.startProgram", Value::Null).await, conflict);
    assert_eq!(refused(&o, "project.stopProgram", Value::Null).await, conflict);
    set(&o).await;
    call(&o, "project.startProgram", Value::Null).await;
    running(&o).await;
    assert_eq!(refused(&o, "project.startProgram", Value::Null).await, conflict);
}

#[tokio::test(flavor = "multi_thread")]
async fn pg3_clear_leaves_a_running_program_and_clears_a_stop() {
    let w = world();
    let o = w.open().await;
    set(&o).await;
    call(&o, "project.startProgram", Value::Null).await;
    let id = running(&o).await;
    call(&o, "project.clearProgram", Value::Null).await;
    assert_eq!(run(&o).await["terminalId"], id.as_str());
    call(&o, "project.stopProgram", Value::Null).await;
    call(&o, "project.clearProgram", Value::Null).await;
    set(&o).await;
    drop(o);
    let again = w.open().await;
    running(&again).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn pg4_a_kill_restarts_after_the_first_wait() {
    let w = world();
    let o = w.open().await;
    set(&o).await;
    call(&o, "project.startProgram", Value::Null).await;
    let id = running(&o).await;
    let before = std::time::Instant::now();
    call(&o, "terminal.kill", json!({"id": id})).await;
    until("it waits to restart", || async { run(&o).await["state"] == "restarting" }).await;
    let next = running(&o).await;
    assert_ne!(next, id);
    assert!(before.elapsed() >= Duration::from_millis(900), "{:?}", before.elapsed());
    assert_eq!(rows(&o, &w).await.len(), 1);
    // PG4: a second exit in a row waits twice as long.
    let again = std::time::Instant::now();
    call(&o, "terminal.kill", json!({"id": next})).await;
    running(&o).await;
    assert!(again.elapsed() >= Duration::from_millis(1900), "{:?}", again.elapsed());
}

#[tokio::test(flavor = "multi_thread")]
async fn pg4_a_stop_or_clear_during_a_wait_cancels_the_restart() {
    let w = world();
    let o = w.open().await;
    set(&o).await;
    call(&o, "project.startProgram", Value::Null).await;
    let id = running(&o).await;
    call(&o, "terminal.kill", json!({"id": id})).await;
    until("it waits to restart", || async { run(&o).await["state"] == "restarting" }).await;
    call(&o, "project.clearProgram", Value::Null).await;
    tokio::time::sleep(Duration::from_millis(1800)).await;
    assert_eq!(run(&o).await["state"], "none");
    assert_eq!(w.started().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn pg5_a_surviving_program_is_attached_and_nothing_is_launched() {
    let w = world();
    let first = w.open().await;
    set(&first).await;
    call(&first, "project.startProgram", Value::Null).await;
    let id = running(&first).await;
    until("it started", || async { w.started().len() == 1 }).await;
    // The Daemon is lost without a shutdown: its Terminals live on in the core.
    first.server.abort();
    let second = w.open().await;
    let attached = running(&second).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(w.started().len(), 1);
    assert_eq!(rows(&second, &w).await.len(), 1);
    assert_ne!(attached, "");
    assert_ne!(id, "");
}

#[tokio::test(flavor = "multi_thread")]
async fn pg5_a_gone_or_replaced_owner_starts_one_program() {
    let w = world();
    let first = w.open().await;
    set(&first).await;
    call(&first, "project.startProgram", Value::Null).await;
    running(&first).await;
    first.daemon.stop_terminals().await.unwrap();
    drop(first);
    let second = w.open().await;
    running(&second).await;
    until("one started", || async { w.started().len() == 2 }).await;
    // A replaced entry: the survivor is ended and the new entry starts.
    call(&second, "project.setProgram", json!({"argv": ["sh", "-c", SCRIPT.replace("600", "601")], "dir": "work"})).await;
    second.server.abort();
    let third = w.open().await;
    running(&third).await;
    until("the new entry started", || async { w.started().len() == 3 }).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(rows(&third, &w).await.len(), 1);
}
