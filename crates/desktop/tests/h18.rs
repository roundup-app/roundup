//! H18 (`scenarios/decisions.md`): the App answers a Decision through the real `rupd` it started.
//! The Daemon here is the built `rupd` executable behind a wrapper that gives its Agents a fake
//! `claude`; the App is the Tauri mock runtime.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use desktop::{Config, build};
use rpc::{Client, RpcError, code};
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
    home: Option<TempDir>,
    project: PathBuf,
    config: Config,
    app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
}

impl Fixture {
    fn new() -> Self {
        let home = seeded_home();
        let mut fixture = Self::with_home(home.path());
        fixture.home = Some(home);
        fixture
    }

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
            home: None,
            project,
            config,
            app,
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

    fn proof(&self) -> Result<String, Value> {
        self.invoke(
            "daemon_proof",
            json!({"path": self.project.display().to_string()}),
        )
        .map(|proof| proof.as_str().unwrap().to_owned())
    }

    /// The `answer` call the webview makes, through the App's `rpc` command.
    fn answer(&self, id: &str, proof: Option<&str>) -> Result<Value, Value> {
        self.invoke(
            "rpc",
            json!({"path": self.project.display().to_string(), "method": "decision.answer", "params": {"id": id, "answer": "allow", "proof": proof}}),
        )
    }

    fn file(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.as_path().join(name)).unwrap_or_default()
    }

    /// The socket the nth Daemon was told to bind.
    fn socket(&self, run: usize) -> PathBuf {
        PathBuf::from(self.file("sockets").lines().nth(run).unwrap())
    }

    fn pid(&self, run: usize) -> String {
        self.file("pids").lines().nth(run).unwrap().to_owned()
    }

    /// Spawns an Agent and leaves its permission request waiting; returns the open Decision's id.
    fn pending(&self, run: usize) -> (Waiting, String) {
        let socket = self.socket(run);
        let cwd = self.project.display().to_string();
        tauri::async_runtime::block_on(async move {
            let client = Arc::new(Client::connect(&socket).await.unwrap());
            let agent = client
                .request(
                    "agent.spawn",
                    json!({"cwd": cwd, "prompt": null, "parent": null}),
                )
                .await
                .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_owned();
            let call = Arc::clone(&client);
            let ended = Arc::new(std::sync::Mutex::new(None));
            let record = Arc::clone(&ended);
            let hook = tauri::async_runtime::spawn(async move {
                let result = call
                    .request(
                        "agent.permission",
                        json!({"id": agent, "payload": {"hook_event_name": "PermissionRequest",
                        "tool_name": "Bash", "tool_input": {"command": "ls"}}}),
                    )
                    .await;
                *record.lock().unwrap() = Some(result.clone());
                result
            });
            let lister = Client::connect(&socket).await.unwrap();
            let id = loop {
                assert!(
                    ended.lock().unwrap().is_none(),
                    "the permission call ended: {:?}",
                    ended.lock().unwrap()
                );
                let open = lister.request("decision.list", Value::Null).await.unwrap();
                if let Some(first) = open.as_array().and_then(|open| open.first()) {
                    break first["id"].as_str().unwrap().to_owned();
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            };
            (
                Waiting {
                    hook,
                    socket,
                    _client: client,
                },
                id,
            )
        })
    }

    fn open_decisions(&self, run: usize) -> usize {
        let socket = self.socket(run);
        tauri::async_runtime::block_on(async move {
            let client = Client::connect(&socket).await.unwrap();
            client
                .request("decision.list", Value::Null)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .len()
        })
    }

    fn kill_daemon(&self, run: usize) {
        assert!(
            Command::new("kill")
                .args(["-9", &self.pid(run)])
                .status()
                .unwrap()
                .success()
        );
        let started = Instant::now();
        while self.proof().is_ok() {
            assert!(
                started.elapsed() < WAIT,
                "the App never noticed the Daemon exit"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
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

struct Waiting {
    hook: tauri::async_runtime::JoinHandle<Result<Value, RpcError>>,
    socket: PathBuf,
    _client: Arc<Client>,
}

impl Waiting {
    fn settled(self) -> Value {
        tauri::async_runtime::block_on(async { tokio::time::timeout(WAIT, self.hook).await })
            .expect("the pending call never settled")
            .unwrap()
            .unwrap()
    }

    /// Answers over a second connection that said it is not the user.
    fn answer_as(&self, kind: &str, id: &str, proof: &str) -> Result<Value, RpcError> {
        let socket = self.socket.clone();
        let (kind, id, proof) = (kind.to_owned(), id.to_owned(), proof.to_owned());
        tauri::async_runtime::block_on(async move {
            let client = Client::connect(&socket).await.map_err(RpcError::internal)?;
            client
                .request(
                    "daemon.identify",
                    json!({"actor": {"kind": kind, "id": "x", "parent": null}}),
                )
                .await?;
            client
                .request(
                    "decision.answer",
                    json!({"id": id, "answer": "allow", "proof": proof}),
                )
                .await
        })
    }
}

#[test]
fn h18_the_proof_the_app_returns_answers_a_pending_permission_through_the_real_daemon() {
    let fx = Fixture::new();
    fx.open();
    let proof = fx.proof().unwrap();
    let (waiting, id) = fx.pending(0);

    for attempt in [None, Some("0".repeat(64)), Some("guess".to_owned())] {
        let err = fx.answer(&id, attempt.as_deref()).unwrap_err();
        assert_eq!(err["code"], code::FORBIDDEN);
        assert_eq!(fx.open_decisions(0), 1);
    }
    // An Agent or Extension cannot know the proof, so what it can send is a guess.
    for kind in ["agent", "ext"] {
        assert!(waiting.answer_as(kind, &id, &"f".repeat(64)).is_err());
        assert_eq!(fx.open_decisions(0), 1);
    }
    fx.answer(&id, Some(&proof)).unwrap();

    let reply = waiting.settled();
    assert!(
        reply["output"]
            .as_str()
            .unwrap()
            .contains("\"behavior\":\"allow\"")
    );
    assert_eq!(fx.open_decisions(0), 0);
    let _ = &fx.app;
}

#[test]
fn h18_a_reload_gets_the_same_live_proof_and_a_reopen_a_different_one() {
    let fx = Fixture::new();
    fx.open();
    let first = fx.proof().unwrap();
    assert_eq!(first.len(), 64);
    assert_eq!(fx.proof().unwrap(), first, "a reload asks again");

    fx.kill_daemon(0);
    fx.open();
    let second = fx.proof().unwrap();
    let (waiting, id) = fx.pending(1);

    assert_ne!(second, first);
    assert_eq!(
        fx.answer(&id, Some(&first)).unwrap_err()["code"],
        code::FORBIDDEN
    );
    assert_eq!(fx.open_decisions(1), 1);
    fx.answer(&id, Some(&second)).unwrap();
    waiting.settled();
}

#[test]
fn h18_daemon_proof_fails_before_a_project_is_open_and_after_its_daemon_exits() {
    let fx = Fixture::new();
    assert_eq!(fx.proof().unwrap_err()["code"], code::CONFLICT);

    fx.open();
    fx.proof().unwrap();
    fx.kill_daemon(0);

    assert_eq!(fx.proof().unwrap_err()["code"], code::INTERNAL);
}

#[test]
fn h18_the_proof_is_in_no_argument_environment_file_or_log() {
    let fx = Fixture::new();
    fx.open();
    let proof = fx.proof().unwrap();
    let (waiting, id) = fx.pending(0);
    fx.answer(&id, Some(&proof)).unwrap();
    waiting.settled();

    for name in ["rupd-args", "rupd-env", "claude-args", "claude-env"] {
        assert!(!fx.file(name).contains(&proof), "{name} holds the proof");
    }
    assert!(
        fx.file("rupd-env").contains("RUPD_SOCKET"),
        "the wrapper never ran"
    );
    let mut files = vec![fx.project.join(".roundup"), fx.dir.join("data")];
    while let Some(path) = files.pop() {
        if path.is_dir() {
            files.extend(
                std::fs::read_dir(&path)
                    .unwrap()
                    .map(|entry| entry.unwrap().path()),
            );
        } else if let Ok(bytes) = std::fs::read(&path) {
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains(&proof), "{} holds the proof", path.display());
        }
    }
    let _ = &fx.config;
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
    let proof = fx.proof().unwrap();
    let (waiting, id) = fx.pending(0);
    fx.answer(&id, Some(&proof)).unwrap();
    waiting.settled();
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

#[test]
fn n7_launch_sites_use_owned_data_h18() {
    data_case();
}

#[test]
fn n7_launch_sites_clean_on_success_and_failure_h18() {
    for fail in [false, true] {
        cleanup_case(fail);
    }
}
