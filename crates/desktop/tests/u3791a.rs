//! U3791a: the real process owner, with Tokio time held under the observer's control.
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desktop::{AppState, Config};
use serde_json::{Value, json};
use tauri::ipc::Channel;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
use tauri::{App, Listener, Manager};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

struct Fixture {
    dir: TempDir,
    app: App<MockRuntime>,
    events: Arc<Mutex<Vec<Value>>>,
    calls: Arc<Mutex<Vec<String>>>,
    subscribe_failure: Arc<Mutex<Option<i64>>>,
}

impl Fixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        // A shell child exercises process ownership; the RPC peer is the listener below.
        let script = dir.path().join("recovery-fixture");
        std::fs::write(
            &script,
            format!(
                r#"#!/bin/sh
record() {{ printf '%s\n' "$1" >> '{d}/starts'; }}
if test -f "$1/fail"; then record "$1"; exit 17; fi
if test -f "$1/hold"; then echo $$ > "$1/held-pid"; record "$1"; exec cat > "$1/input"; fi
ln -s '{d}/real.sock' "$RUPD_SOCKET"
echo $$ > "$1/pid"
record "$1"
if test -f "$1/late-exit"; then cat > "$1/input"; echo closed > "$1/closed"; read go < "$1/exit-fifo"; exit 7; fi
exec cat > "$1/input"
"#,
                d = dir.path().display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut config = Config::locate(
            Some(script.into_os_string()),
            Path::new("/unused/app"),
            dir.path(),
            std::process::id(),
        )
        .unwrap();
        config.data_dir = Some(dir.path().join("data"));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let subscribe_failure = Arc::new(Mutex::new(None));
        let listener = UnixListener::bind(dir.path().join("real.sock")).unwrap();
        let logged = calls.clone();
        let refuse = subscribe_failure.clone();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let logged = logged.clone();
                let refuse = refuse.clone();
                tokio::spawn(async move {
                    let (read, mut write) = stream.into_split();
                    let mut lines = BufReader::new(read).lines();
                    while let Some(line) = lines.next_line().await.unwrap() {
                        let request: Value = serde_json::from_str(&line).unwrap();
                        let method = request["method"].as_str().unwrap();
                        logged.lock().unwrap().push(method.to_owned());
                        let answer = if method == "events.subscribe"
                            && refuse.lock().unwrap().is_some()
                        {
                            json!({"jsonrpc":"2.0", "id":request["id"], "error":{"code":*refuse.lock().unwrap(),"message":"subscription refused"}})
                        } else {
                            json!({"jsonrpc":"2.0", "id":request["id"], "result":if method == "events.subscribe" { json!({"head":0}) } else { json!({"pong":true}) }})
                        };
                        if write
                            .write_all(format!("{answer}\n").as_bytes())
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                });
            }
        });
        let app = mock_builder()
            .manage(AppState::new(config))
            .build(mock_context(noop_assets()))
            .unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let observed = events.clone();
        app.listen("daemon-exited", move |event| {
            observed
                .lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap())
        });
        Self {
            dir,
            app,
            events,
            calls,
            subscribe_failure,
        }
    }

    fn project(&self, name: &str) -> String {
        let path = self.dir.path().join(name);
        std::fs::create_dir(&path).unwrap();
        path.display().to_string()
    }

    async fn open(&self, path: &str) {
        let state = self.app.state::<AppState>();
        let open = state.open_project(self.app.handle(), Path::new(path));
        tokio::pin!(open);
        controlled(async {
            loop {
                tokio::select! {
                    biased;
                    result = &mut open => break result,
                    _ = tokio::task::yield_now() => tick(1).await,
                }
            }
        })
        .await
        .unwrap();
    }

    async fn subscribe(&self, path: &str) -> Result<u64, rpc::RpcError> {
        controlled(
            self.app
                .state::<AppState>()
                .subscribe(path, Channel::new(|_| Ok(())), None),
        )
        .await
    }

    fn starts(&self, path: &str) -> usize {
        std::fs::read_to_string(self.dir.path().join("starts"))
            .unwrap_or_default()
            .lines()
            .filter(|line| *line == path)
            .count()
    }

    async fn exit(&self, path: &str) {
        until(|| {
            std::fs::read_to_string(Path::new(path).join("pid"))
                .is_ok_and(|pid| pid.trim().parse::<u32>().is_ok())
        })
        .await;
        let pid = std::fs::read_to_string(Path::new(path).join("pid")).unwrap();
        assert!(
            std::process::Command::new("kill")
                .args(["-9", pid.trim()])
                .status()
                .unwrap()
                .success()
        );
        until(|| {
            self.events
                .lock()
                .unwrap()
                .iter()
                .any(|event| event["path"] == path && event["recovery"] == "waiting")
        })
        .await;
    }
}

// Keep a runnable observer while real OS I/O completes: paused Tokio must not auto-advance.
async fn controlled<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::pin!(future);
    let bound = Instant::now();
    loop {
        tokio::select! {
            biased;
            value = &mut future => return value,
            _ = tokio::task::yield_now() => assert!(bound.elapsed() < Duration::from_secs(5), "OS fixture did not answer"),
        }
    }
}

async fn until(condition: impl Fn() -> bool) {
    controlled(async {
        while !condition() {
            tokio::task::yield_now().await;
        }
    })
    .await;
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

async fn tick(ms: u64) {
    tokio::time::advance(Duration::from_millis(ms)).await;
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

async fn u3791a_daemon_restart_has_bounded_backoff(fx: &Fixture) {
    let path = fx.project("bounded");
    fx.open(&path).await;
    std::fs::write(Path::new(&path).join("fail"), "").unwrap();
    fx.exit(&path).await;
    tick(249).await;
    assert_eq!(fx.starts(&path), 1);
    tick(1).await;
    until(|| fx.starts(&path) == 2).await;
    until(|| {
        fx.events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["path"] == path && event["recovery"] == "waiting")
            .count()
            == 2
    })
    .await;
    tick(499).await;
    assert_eq!(fx.starts(&path), 2);
    tick(1).await;
    until(|| {
        fx.events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["path"] == path && event["recovery"].is_null())
    })
    .await;
    assert_eq!(fx.starts(&path), 3);
    tick(10_000).await;
    assert_eq!(fx.starts(&path), 3);
    std::fs::remove_file(Path::new(&path).join("fail")).unwrap();
    fx.open(&path).await;
    fx.subscribe(&path).await.unwrap();
    assert_eq!(fx.starts(&path), 4);
}

async fn u3791a_daemon_success_resets_count(fx: &Fixture) {
    let path = fx.project("reset");
    fx.open(&path).await;
    fx.exit(&path).await;
    tick(250).await;
    until(|| {
        fx.starts(&path) == 2 && std::fs::read_to_string(Path::new(&path).join("pid")).is_ok()
    })
    .await;
    tick(25).await;
    until(|| {
        fx.events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["path"] == path && event["recovery"] == "connecting")
    })
    .await;
    // Readiness alone is insufficient: rejecting the replacement subscription is failure 2.
    *fx.subscribe_failure.lock().unwrap() = Some(rpc::code::EVENTS_EXPIRED);
    assert_eq!(
        fx.subscribe(&path).await.unwrap_err().code,
        rpc::code::EVENTS_EXPIRED
    );
    assert!(
        fx.app
            .state::<AppState>()
            .projects()
            .iter()
            .any(|entry| entry.path == path && entry.running)
    );
    *fx.subscribe_failure.lock().unwrap() = Some(rpc::code::INTERNAL);
    assert!(fx.subscribe(&path).await.is_err());
    until(|| {
        fx.events
            .lock()
            .unwrap()
            .iter()
            .filter(|event| event["path"] == path && event["recovery"] == "waiting")
            .count()
            == 2
    })
    .await;
    let starts = fx.starts(&path);
    tick(499).await;
    assert_eq!(fx.starts(&path), starts);
    *fx.subscribe_failure.lock().unwrap() = None;
    tick(1).await;
    until(|| fx.starts(&path) == starts + 1).await;
    tick(25).await;
    until(|| {
        fx.starts(&path) == starts + 1
            && fx
                .app
                .state::<AppState>()
                .projects()
                .iter()
                .any(|entry| entry.path == path && entry.running)
    })
    .await;
    fx.subscribe(&path).await.unwrap();
    fx.events.lock().unwrap().clear();
    fx.exit(&path).await;
    tick(249).await;
    assert_eq!(fx.starts(&path), starts + 1);
    tick(1).await;
    until(|| fx.starts(&path) == starts + 2).await;
    tick(25).await;
    until(|| {
        fx.starts(&path) == starts + 2
            && fx
                .app
                .state::<AppState>()
                .projects()
                .iter()
                .any(|entry| entry.path == path && entry.running)
    })
    .await;
    fx.subscribe(&path).await.unwrap();
    assert!(
        !fx.events
            .lock()
            .unwrap()
            .iter()
            .any(|event| event["path"] == path && event["recovery"].is_null())
    );
    fx.app.state::<AppState>().close_project(&path).unwrap();
}

async fn u3791a_close_cancels_restart(fx: &Fixture) {
    let path = fx.project("cancel-wait");
    fx.open(&path).await;
    fx.exit(&path).await;
    fx.app.state::<AppState>().close_project(&path).unwrap();
    tick(1000).await;
    assert_eq!(fx.starts(&path), 1);

    let late = fx.project("cancel-start");
    fx.open(&late).await;
    std::fs::write(Path::new(&late).join("hold"), "").unwrap();
    fx.exit(&late).await;
    tick(250).await;
    until(|| Path::new(&late).join("held-pid").exists()).await;
    let held_pid = std::fs::read_to_string(Path::new(&late).join("held-pid")).unwrap();
    fx.app.state::<AppState>().close_project(&late).unwrap();
    until(|| {
        !std::process::Command::new("kill")
            .args(["-0", held_pid.trim()])
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap()
            .success()
    })
    .await;
    std::fs::remove_file(Path::new(&late).join("hold")).unwrap();
    fx.open(&late).await;
    fx.subscribe(&late).await.unwrap();
    tick(10_000).await;
    assert_eq!(fx.starts(&late), 3);
    assert!(
        fx.app
            .state::<AppState>()
            .projects()
            .iter()
            .any(|entry| entry.path == late && entry.running)
    );
    fx.app.state::<AppState>().close_project(&late).unwrap();
}

async fn u3791a_close_cancels_queued_reopen(fx: &Fixture) {
    let path = fx.project("queued-close");
    fx.open(&path).await;
    fx.exit(&path).await;
    let blocking = fx.project("blocking-start");
    std::fs::write(Path::new(&blocking).join("hold"), "").unwrap();
    let app = fx.app.handle().clone();
    let block_path = blocking.clone();
    let start = tokio::spawn(async move {
        app.state::<AppState>()
            .open_project(&app, Path::new(&block_path))
            .await
    });
    until(|| Path::new(&blocking).join("held-pid").exists()).await;
    let app = fx.app.handle().clone();
    let reopen_path = path.clone();
    let reopen = tokio::spawn(async move {
        app.state::<AppState>()
            .open_project(&app, Path::new(&reopen_path))
            .await
    });
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
    fx.app.state::<AppState>().close_project(&path).unwrap();
    assert!(controlled(reopen).await.unwrap().is_err());
    fx.app.state::<AppState>().close_project(&blocking).unwrap();
    assert!(controlled(start).await.unwrap().is_err());
    tick(1000).await;
    assert_eq!(fx.starts(&path), 1);
    assert!(
        !fx.app
            .state::<AppState>()
            .projects()
            .iter()
            .any(|entry| entry.path == path || entry.path == blocking)
    );
}

async fn u3791a_stale_exit_keeps_new_connection(fx: &Fixture) {
    let path = fx.project("stale");
    std::fs::write(Path::new(&path).join("late-exit"), "").unwrap();
    assert!(
        std::process::Command::new("mkfifo")
            .arg(Path::new(&path).join("exit-fifo"))
            .status()
            .unwrap()
            .success()
    );
    fx.open(&path).await;
    fx.app.state::<AppState>().close_project(&path).unwrap();
    until(|| Path::new(&path).join("closed").exists()).await;
    std::fs::remove_file(Path::new(&path).join("late-exit")).unwrap();
    fx.open(&path).await;
    fx.subscribe(&path).await.unwrap();
    let before = fx.events.lock().unwrap().len();
    std::fs::write(Path::new(&path).join("exit-fifo"), "go\n").unwrap();
    // Polling ping after the old child's exit must still use the replacement's client.
    tick(1000).await;
    assert!(
        controlled(
            fx.app
                .state::<AppState>()
                .rpc(&path, "daemon.ping", Value::Null)
        )
        .await
        .is_ok()
    );
    assert_eq!(fx.starts(&path), 2);
    assert_eq!(fx.events.lock().unwrap().len(), before);
    fx.app.state::<AppState>().close_project(&path).unwrap();
}

async fn u3791a_restart_is_project_scoped(fx: &Fixture) {
    let a = fx.project("scope-a");
    let b = fx.project("scope-b");
    fx.open(&a).await;
    fx.open(&b).await;
    std::fs::write(Path::new(&a).join("fail"), "").unwrap();
    fx.exit(&a).await;
    fx.exit(&b).await;
    fx.app.state::<AppState>().close_project(&a).unwrap();
    tick(250).await;
    until(|| fx.starts(&b) == 2).await;
    tick(25).await;
    until(|| {
        fx.starts(&b) == 2
            && fx
                .app
                .state::<AppState>()
                .projects()
                .iter()
                .any(|entry| entry.path == b && entry.running)
    })
    .await;
    fx.subscribe(&b).await.unwrap();
    assert_eq!(fx.starts(&a), 1);
    fx.app.state::<AppState>().close_project(&b).unwrap();
}

fn u3791a_recovery_sends_no_agent_input(fx: &Fixture) {
    assert!(
        fx.calls
            .lock()
            .unwrap()
            .iter()
            .all(|method| matches!(method.as_str(), "daemon.ping" | "events.subscribe"))
    );
    for entry in std::fs::read_dir(fx.dir.path()).unwrap() {
        let input = entry.unwrap().path().join("input");
        if input.exists() {
            assert!(std::fs::read(input).unwrap().is_empty());
        }
    }
}

#[tokio::test(start_paused = true)]
async fn u3791a_native_recovery() {
    tauri::async_runtime::set(tokio::runtime::Handle::current());
    let fx = Fixture::new().await;
    u3791a_daemon_restart_has_bounded_backoff(&fx).await;
    u3791a_daemon_success_resets_count(&fx).await;
    u3791a_close_cancels_restart(&fx).await;
    u3791a_close_cancels_queued_reopen(&fx).await;
    u3791a_stale_exit_keeps_new_connection(&fx).await;
    u3791a_restart_is_project_scoped(&fx).await;
    u3791a_recovery_sends_no_agent_input(&fx);
    // App shutdown cancels a delayed restart as well as individual Project closes.
    let path = fx.project("quit");
    fx.open(&path).await;
    fx.exit(&path).await;
    fx.app.state::<AppState>().close();
    tick(1000).await;
    assert_eq!(fx.starts(&path), 1);
    assert!(fx.app.state::<AppState>().projects().is_empty());
}
