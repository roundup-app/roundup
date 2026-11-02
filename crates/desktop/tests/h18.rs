//! H18: the App's data is temporary and cleaned up around the real `rupd` it started.
//! The Daemon here is the built `rupd` executable behind a wrapper that gives its Agents a fake
//! `claude`; the App is the Tauri mock runtime.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use desktop::{Config, build};
use serde_json::{Value, json};
use tauri::ipc::{InvokeBody, InvokeResponseBody};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;

const WAIT: Duration = Duration::from_secs(20);

/// `just check-rust` builds `rupd` and `rup` once before the tests start (L99); no test builds.
fn rupd() -> &'static Path {
    static BIN: OnceLock<PathBuf> = OnceLock::new();
    BIN.get_or_init(|| {
        let exe = std::env::current_exe().unwrap();
        let rupd = exe.parent().unwrap().parent().unwrap().join("rupd");
        assert!(
            rupd.is_file(),
            "{} is not built; run `just check-rust`",
            rupd.display()
        );
        rupd
    })
}

struct Fixture {
    dir: PathBuf,
    temporary: Option<TempDir>,
    project: PathBuf,
    _config: Config,
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
}

impl Fixture {
    fn with_home(home: &Path) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        // The fake `claude` records its arguments and environment, then stays alive.
        let claude = dir.path().join("claude");
        std::fs::write(
            &claude,
            format!(
                "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nprintf '%s\\n' \"$@\" > '{0}/claude-args'\nenv > '{0}/claude-env'\nexec sleep 60\n",
                dir.path().display()
            ),
        )
        .unwrap();
        let wrapper = dir.path().join("rupd");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexport ROUNDUP_DATA_DIR='{0}/data' HOME='{2}' XDG_DATA_HOME='{2}/xdg'\nprintf '%s\\n' \"$@\" >> '{0}/rupd-args'\nenv > '{0}/rupd-env'\nprintf '%s\\n' \"$RUPD_SOCKET\" >> '{0}/sockets'\nprintf '%s\\n' $$ >> '{0}/pids'\nROUNDUP_CLAUDE_BIN='{0}/claude' CLAUDE_CONFIG_DIR='{0}/claude-config' exec '{1}' \"$@\"\n",
                dir.path().display(),
                rupd().display(),
                home.display()
            ),
        )
        .unwrap();
        for script in [&claude, &wrapper] {
            std::fs::set_permissions(script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let config = Config::locate(
            Some(wrapper.into_os_string()),
            Path::new("/unused/roundup"),
            dir.path(),
            std::process::id(),
        )
        .unwrap();
        let app = build(mock_builder(), config.clone(), None, |app, code| {
            app.exit(code)
        })
        .build(mock_context(noop_assets()))
        .unwrap();
        let webview = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        Self {
            dir: dir.path().to_path_buf(),
            temporary: Some(dir),
            project,
            _config: config,
            _app: app,
            webview,
        }
    }

    fn invoke(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        get_ipc_response(
            &self.webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body: InvokeResponseBody| body.deserialize().unwrap())
    }

    fn open(&self) {
        self.invoke(
            "open_project",
            json!({"path": self.project.display().to_string()}),
        )
        .unwrap();
    }

    fn file(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.as_path().join(name)).unwrap_or_default()
    }

    fn pid(&self, run: usize) -> String {
        self.file("pids").lines().nth(run).unwrap().to_owned()
    }
}

fn alive(pid: &str) -> bool {
    Command::new("kill")
        .args(["-0", pid])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap()
        .success()
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let Some(dir) = self.temporary.take() else {
            return;
        };
        // Closing stdin requests shutdown; AppState's watcher reaps the child (state.rs).
        let _ = self.invoke(
            "close_project",
            json!({"path": self.project.display().to_string()}),
        );
        let started = Instant::now();
        for pid in self.file("pids").lines() {
            while alive(pid) {
                if started.elapsed() >= WAIT {
                    // Keep data rather than delete beneath a Daemon that has not exited.
                    let path = dir.keep();
                    eprintln!("Daemon {pid} did not exit; kept {}", path.display());
                    if !std::thread::panicking() {
                        panic!("H18 Daemon did not exit before cleanup");
                    }
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        dir.close().unwrap();
    }
}

fn tree(root: &Path) -> std::collections::BTreeMap<PathBuf, Option<Vec<u8>>> {
    let mut result = std::collections::BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let bytes = if path.is_dir() {
                pending.push(path.clone());
                None
            } else {
                Some(std::fs::read(&path).unwrap())
            };
            result.insert(path.strip_prefix(root).unwrap().to_path_buf(), bytes);
        }
    }
    result
}

fn seeded_home() -> TempDir {
    let home = tempfile::tempdir().unwrap();
    for base in [".local/share", "Library/Application Support", "xdg"] {
        let data = home
            .path()
            .join(base)
            .join("dev.roundup.app/projects/existing/pads");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("seed.md"), b"existing App data\0\xff").unwrap();
    }
    home
}

fn data_case() {
    let home = seeded_home();
    let before = tree(home.path());
    let fx = Fixture::with_home(home.path());
    fx.open();
    let data = fx.dir.as_path().join("data");
    assert!(data.is_absolute());
    assert!(
        fx.file("rupd-env")
            .lines()
            .any(|line| line == format!("ROUNDUP_DATA_DIR={}", data.display()))
    );
    let projects: Vec<_> = std::fs::read_dir(data.join("projects")).unwrap().collect();
    assert_eq!(projects.len(), 1);
    let project = projects[0].as_ref().unwrap().path();
    assert!(
        project
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("project-")
    );
    assert!(
        tree(&project)
            .values()
            .any(|bytes| bytes.as_ref().is_some_and(|bytes| !bytes.is_empty()))
    );
    drop(fx);
    assert_eq!(tree(home.path()), before);
}

#[test]
fn n6_h18_data_is_temporary() {
    data_case();
}

fn cleanup_case(fail: bool) {
    let home = seeded_home();
    let before = tree(home.path());
    let mut owned = None;
    let mut pid = None;
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let fx = Fixture::with_home(home.path());
        fx.open();
        owned = Some(fx.dir.clone());
        pid = Some(fx.pid(0));
        assert!(fx.dir.join("data/projects").is_dir());
        if fail {
            panic!("injected H18 failure after launch");
        }
    }));
    if fail {
        let failure = result.unwrap_err();
        assert_eq!(
            failure.downcast_ref::<&str>(),
            Some(&"injected H18 failure after launch")
        );
    } else {
        result.unwrap();
    }
    assert!(
        !alive(pid.as_deref().unwrap()),
        "cleanup left the Daemon alive"
    );
    assert!(!owned.unwrap().exists(), "cleanup left fixture data behind");
    assert_eq!(tree(home.path()), before);
}

#[test]
fn n6_h18_cleans_data_after_stop_and_failure() {
    for fail in [false, true] {
        cleanup_case(fail);
    }
}

mod recovery {
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
    if test -f "$1/hold"; then echo $$ > "$1/held-pid"; record "$1"; exec 3>&1; exec cat > "$1/input"; fi
    ln -s '{d}/real.sock' "$RUPD_SOCKET"
    printf 'rupd-bound\n'
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
                                json!({"jsonrpc":"2.0", "id":request["id"], "error":{"code":*refuse.lock().unwrap(),"message":"subscription refused", "data":{"kind":"events-expired", "oldest":6}}})
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
        let expired = fx.subscribe(&path).await.unwrap_err();
        assert_eq!(expired.code, rpc::code::EVENTS_EXPIRED);
        assert_eq!(
            expired.data,
            Some(contracts::RpcErrorData::EventsExpired { oldest: 6 })
        );
        let native = tauri::ipc::InvokeError::from(expired);
        assert_eq!(
            native.0,
            json!({"code": -32009, "message":"subscription refused", "data":{"kind":"events-expired", "oldest":6}})
        );
        assert!(
            fx.app
                .state::<AppState>()
                .projects()
                .unwrap()
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
                    .unwrap()
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
                    .unwrap()
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
                .unwrap()
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
                .unwrap()
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
                    .unwrap()
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
        assert!(fx.app.state::<AppState>().projects().unwrap().is_empty());
    }
}

mod s6 {
    use desktop::{AppState, Config, build};
    use serde_json::{Value, json};
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use tauri::ipc::InvokeBody;
    use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    #[test]
    fn s6_facts_work_without_a_project_and_use_only_configured_fixtures() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("claude");
        std::fs::write(&binary, "#!/bin/sh\nprintf '9.8.7 (Claude Code)\\n'\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut config = Config::locate(None, Path::new("/unused/roundup"), dir.path(), 1).unwrap();
        config.data_dir = Some(dir.path().join("data"));
        config.claude_bin = Some(binary.clone().into_os_string());
        let app = build(mock_builder(), config, None, |_, _| panic!("no launch"))
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
            .build()
            .unwrap();
        let invoke = |cmd: &str| -> Value {
            get_ipc_response(
                &window,
                InvokeRequest {
                    cmd: cmd.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: InvokeBody::Json(json!({})),
                    headers: Default::default(),
                    invoke_key: INVOKE_KEY.into(),
                },
            )
            .unwrap()
            .deserialize()
            .unwrap()
        };
        assert_eq!(invoke("recent_projects"), json!([]));
        assert_eq!(
            invoke("claude_binary"),
            json!({"path": binary, "version": "9.8.7 (Claude Code)"})
        );
        assert!(app.state::<AppState>().projects().unwrap().is_empty());
    }

    #[test]
    fn s6_launch_and_successful_opens_record_recents_even_when_persistence_fails() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let socket = dir.path().join("real.sock");
        let daemon = rupd::Daemon::open(&dir.path().join("daemon-data")).unwrap();
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::UnixListener::bind(&socket).unwrap();
            tauri::async_runtime::spawn(rupd::serve(listener, std::sync::Arc::new(daemon)));
        });
        let script = dir.path().join("rupd");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nln -s '{}' \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\nexec cat\n",
                socket.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        for launch in [false, true] {
            let mut config = Config::locate(
                Some(script.clone().into_os_string()),
                Path::new("/unused/roundup"),
                dir.path(),
                if launch { 2 } else { 1 },
            )
            .unwrap();
            let data = dir
                .path()
                .join(if launch { "launch-data" } else { "unwritable" });
            config.data_dir = Some(data.clone());
            let mut app = build(
                mock_builder(),
                config.clone(),
                launch.then(|| project.clone()),
                |_, _| panic!("launch must succeed"),
            )
            .build(mock_context(noop_assets()))
            .unwrap();
            if launch {
                #[allow(deprecated)]
                app.run_iteration(|_, _| {});
            } else {
                app.state::<AppState>().recent_projects().unwrap();
                std::fs::write(&data, "not a directory").unwrap();
                tauri::async_runtime::block_on(
                    app.state::<AppState>().open_project(app.handle(), &project),
                )
                .unwrap();
            }
            assert_eq!(
                app.state::<AppState>().recent_projects().unwrap(),
                vec![project.display().to_string()]
            );
            assert_eq!(app.state::<AppState>().projects().unwrap().len(), 1);
            app.state::<AppState>().close();
            if launch {
                let newer = dir.path().join("newer");
                std::fs::create_dir(&newer).unwrap();
                std::fs::write(
                    data.join("projects.json"),
                    serde_json::to_vec(
                        &json!({"open": [project], "names": {}, "recent": [newer, project]}),
                    )
                    .unwrap(),
                )
                .unwrap();
                let restored = AppState::new(config);
                tauri::async_runtime::block_on(restored.restore(app.handle())).unwrap();
                assert_eq!(
                    restored.recent_projects().unwrap(),
                    vec![newer.display().to_string(), project.display().to_string()]
                );
                restored.close();
            }
        }
    }
}
