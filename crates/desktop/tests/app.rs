//! Scenarios S1 to S5, S8 and S10 (`scenarios/app.md`, `scenarios/project-tabs.md`). A fake `rupd` is a state script; the real Daemon runs
//! in-process on a socket the script links to the one the App chose.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]
use desktop::{AppState, Config, build};
use rpc::code;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::utils::config::AppDirectoriesOverride;
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;
use tokio::net::UnixListener;

/// The line a Daemon prints on its stdout once it is bound, and its first half; shell text for fake Daemons.
macro_rules! bound {
    () => {
        "printf 'rupd-bound\\n'"
    };
}
macro_rules! partial_bound {
    () => {
        "printf 'rupd-'"
    };
}

/// Every wait in these tests is bounded by this; nothing sleeps for a fixed time.
const WAIT: Duration = Duration::from_secs(10);

const BURST: usize = 50;

/// Mirrors `config::SOCKET_PATH_LIMIT` (`crates/desktop/src/config.rs`): the scenario-visible
/// 104-byte limit S1 and S5 both name.
const SOCKET_PATH_LIMIT: usize = 104;

/// The `"{run}-"` prefix `Config::socket_for_run` adds for the first reopen.
const REOPEN_PREFIX_LEN: usize = "1-".len();

struct Fixture {
    dir: TempDir,
    project: PathBuf,
    config: Config,
}

impl Fixture {
    /// `body` is the fake `rupd`. `{link}` in it becomes a command that points the App's socket
    /// at the real Daemon; `{dir}` is the fixture's directory; `read go < '{dir}/go'` waits for `release`.
    fn new(body: &str) -> Self {
        Self::in_dir(body, tempfile::tempdir().unwrap())
    }

    /// Like `new`, but the fixture's directory is padded so the first (`run` 0) socket path is
    /// exactly `socket_len` bytes, so a reopen's `{run}-` prefix passes the 104-byte limit.
    /// The padding is however much the real temp dir still leaves under `socket_len`, so this
    /// crosses the limit by construction instead of assuming `TMPDIR` is short: a `TMPDIR` long
    /// enough to already exceed `socket_len` fails loud here, not with a subtraction underflow.
    fn with_socket_len(body: &str, socket_len: usize) -> Self {
        let socket_name_len = format!("/roundup-{}.sock", std::process::id()).len();
        let parent = std::env::temp_dir();
        let parent_len = parent.to_string_lossy().trim_end_matches('/').len();
        let overhead = parent_len + 1 + socket_name_len;
        let prefix_len = socket_len.checked_sub(overhead).unwrap_or_else(|| {
            panic!(
                "the real temp dir {} is {overhead} bytes of overhead on its own, too long to pad down to a {socket_len}-byte socket path",
                parent.display()
            )
        });
        let dir = tempfile::Builder::new()
            .prefix(&"d".repeat(prefix_len))
            .rand_bytes(0)
            .tempdir_in(&parent)
            .unwrap();
        let fixture = Self::in_dir(body, dir);
        assert_eq!(fixture.config.socket.as_os_str().len(), socket_len);
        fixture
    }

    fn in_dir(body: &str, dir: TempDir) -> Self {
        let project = dir.path().join("my-project");
        std::fs::create_dir(&project).unwrap();
        let link = format!(
            "ln -s '{}' \"$RUPD_SOCKET\"",
            dir.path().join("real.sock").display()
        );
        let script = dir.path().join("rupd");
        let body = body
            .replace("{link}", &format!("{link}\nprintf 'rupd-bound\\n'"))
            .replace("{dir}", &dir.path().display().to_string());
        let go = dir.path().join("go");
        assert!(Command::new("mkfifo").arg(&go).status().unwrap().success());
        std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut config = Config::locate(
            Some(script.into_os_string()),
            Path::new("/unused/roundup"),
            dir.path(),
            std::process::id(),
        )
        .unwrap();
        config.data_dir = Some(dir.path().join("data"));
        config.reopen_waits = [Duration::from_millis(250); 3];
        Self {
            dir,
            project,
            config,
        }
    }

    /// Lets a fake `rupd` that is blocked on `read go < '{dir}/go'` continue. Opening a fifo for
    /// writing blocks until a reader opens it, so a fake that died first would hang the test.
    fn release(&self) {
        let go = self.dir.path().join("go");
        let (done, written) = mpsc::channel();
        std::thread::spawn(move || done.send(std::fs::write(go, "go\n")));
        written
            .recv_timeout(WAIT)
            .expect("the fake rupd never read from go")
            .unwrap();
    }

    fn real_daemon_socket(&self) -> PathBuf {
        self.dir.path().join("real.sock")
    }

    fn file(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.path().join(name)).unwrap_or_default()
    }

    /// Another Project folder beside the first.
    fn second_project(&self, name: &str) -> PathBuf {
        let path = self.dir.path().join(name);
        std::fs::create_dir(&path).unwrap();
        path
    }

    /// A real Daemon for the Project folder `name`, on the socket `TWO_DAEMONS` links to.
    fn serve_real_daemon_named(&self, name: &str) {
        let socket = self.dir.path().join(format!("real-{name}.sock"));
        self.serve_daemon(&format!(".roundup-{name}"), socket);
    }

    fn serve_real_daemon(&self) {
        self.serve_daemon(".roundup", self.real_daemon_socket());
    }

    fn serve_daemon(&self, data: &str, socket: PathBuf) {
        let (daemon, watchers) = rupd::Daemon::open(&self.dir.path().join(data)).unwrap();
        tauri::async_runtime::block_on(async move {
            let listener = UnixListener::bind(socket).unwrap();
            tauri::async_runtime::spawn(rupd::serve(listener, Arc::new(daemon), watchers));
        });
    }
}

fn app(config: Config, folder: Option<PathBuf>) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = build(mock_builder(), config, folder, |app, code| app.exit(code))
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .unwrap();
    (app, webview)
}

/// On Linux, Tauri creates each webview's data folder in the App's local data folder, which the real
/// context names `dev.roundup.app`; every App folder resolves to the fixture's data folder instead (N8).
fn real_context_app(config: Config) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let mut context = desktop::context();
    context.config_mut().app.app_directories_override = Some(AppDirectoriesOverride::Root(
        config
            .data_dir
            .clone()
            .expect("the fixture names its data folder"),
    ));
    let app = build(mock_builder(), config, None, |app, code| app.exit(code))
        .build(context)
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .unwrap();
    (app, webview)
}

fn event_channel() -> (Channel<contracts::Event>, mpsc::Receiver<Value>) {
    let (tx, received) = mpsc::channel();
    let channel = Channel::new(move |body| {
        let InvokeResponseBody::Json(json) = body else {
            panic!("events are JSON")
        };
        tx.send(serde_json::from_str::<Value>(&json).unwrap())
            .unwrap();
        Ok(())
    });
    (channel, received)
}

/// The `pong` of a `daemon.ping` answer; its `contract` is A38's.
fn pong(reply: Result<Value, Value>) -> Result<Value, Value> {
    reply.map(|answer| answer["pong"].clone())
}

fn invoke(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        webview,
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
    .map(|body| body.deserialize().unwrap())
}

fn path_arg(path: &Path) -> Value {
    json!({ "path": path.display().to_string() })
}

fn open(webview: &WebviewWindow<MockRuntime>, project: &Path) -> Value {
    invoke(webview, "open_project", path_arg(project)).unwrap()
}

fn eventually(what: &str, condition: impl Fn() -> bool) {
    let start = Instant::now();
    while !condition() {
        assert!(
            start.elapsed() < WAIT,
            "{what} did not happen within {WAIT:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn daemon_exited(app: &App<MockRuntime>) -> mpsc::Receiver<Value> {
    let (tx, rx) = mpsc::channel();
    app.listen("daemon-exited", move |event| {
        tx.send(serde_json::from_str(event.payload()).unwrap())
            .unwrap();
    });
    rx
}

const SERVE_AND_WAIT: &str = "{link}\nexec cat";

/// A fake `rupd` for several Projects: each links its socket to `real-<folder name>.sock` and
/// records what it was started with.
const TWO_DAEMONS: &str = "printf '%s\\n' \"$@\" >> '{dir}/args'\nprintf '%s\\n' \"$RUPD_SOCKET\" >> '{dir}/sockets'\nln -s \"{dir}/real-$(basename \"$1\").sock\" \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\nexec cat";

#[test]
fn s1_projects_is_empty_until_one_is_open_and_then_lists_the_open_one() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    assert_eq!(invoke(&webview, "projects", json!({})), Ok(json!([])));

    open(&webview, &fx.project);

    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(
            json!([{ "name": "my-project", "path": fx.project.display().to_string(), "running": true }])
        )
    );
}

#[test]
fn s1_the_socket_is_unique_to_the_run_and_under_the_unix_limit() {
    let tmp = Path::new("/tmp");
    let first = Config::locate(None, Path::new("/a/roundup"), tmp, 100).unwrap();
    let second = Config::locate(None, Path::new("/a/roundup"), tmp, 101).unwrap();
    assert_ne!(first.socket, second.socket);
    assert!(first.socket.as_os_str().len() < 104);

    let too_deep = PathBuf::from(format!("/tmp/{}", "d".repeat(100)));
    let error = Config::locate(None, Path::new("/a/roundup"), &too_deep, 100).unwrap_err();
    assert!(error.contains("under 104"), "{error}");
}

#[test]
fn s1_the_daemon_is_the_env_override_else_the_rupd_beside_the_executable() {
    let tmp = Path::new("/tmp");
    let exe = Path::new("/apps/roundup.app/roundup");
    let beside = Config::locate(None, exe, tmp, 1).unwrap();
    assert_eq!(beside.rupd_bin, Path::new("/apps/roundup.app/rupd"));
    let overridden = Config::locate(Some(OsString::from("/fake/rupd")), exe, tmp, 1).unwrap();
    assert_eq!(overridden.rupd_bin, Path::new("/fake/rupd"));
}

#[test]
fn s1_a_path_that_is_not_a_directory_is_invalid_params_naming_it() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = app(fx.config.clone(), None);
    let file = fx.dir.path().join("rupd");

    let error = invoke(&webview, "open_project", path_arg(&file)).unwrap_err();

    assert_eq!(error["code"], code::INVALID_PARAMS);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains(&file.display().to_string())
    );
}

#[test]
fn s8_opening_a_second_path_starts_a_second_daemon() {
    let fx = Fixture::new(TWO_DAEMONS);
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);

    let opened = open(&webview, &other);

    assert_eq!(
        opened,
        json!({ "name": "other-project", "path": other.display().to_string() })
    );
    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([
            { "name": "my-project", "path": fx.project.display().to_string(), "running": true },
            { "name": "other-project", "path": other.display().to_string(), "running": true },
        ]))
    );
    let args = fx.file("args");
    assert!(
        args.contains(&format!("{}\n--attached\n", fx.project.display())),
        "{args}"
    );
    assert!(
        args.contains(&format!("{}\n--attached\n", other.display())),
        "{args}"
    );
    let sockets: BTreeSet<String> = fx.file("sockets").lines().map(str::to_owned).collect();
    assert_eq!(
        sockets.len(),
        2,
        "each Daemon has its own socket: {sockets:?}"
    );
}

#[test]
fn s1_started_as_roundup_project_opens_that_project() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();

    let (mut app, webview) = app(fx.config.clone(), Some(fx.project.clone()));
    // Tauri runs the setup hook, where the folder is opened, when the event loop starts.
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});

    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(
            json!([{ "name": "my-project", "path": fx.project.display().to_string(), "running": true }])
        )
    );
}

fn tauri_config() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn s13_vite_takes_its_port_from_the_environment_and_stays_strict() {
    let vite = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/desktop/vite.config.ts");
    let vite = std::fs::read_to_string(vite).unwrap();

    assert_eq!(tauri_config()["build"]["devUrl"], "http://localhost:5173");
    assert!(
        vite.contains("process.env.ROUNDUP_DEV_PORT ?? 5173") && vite.contains("strictPort: true"),
        "vite must fail rather than move off the port devUrl names"
    );
}

#[path = "support/app_recipe.rs"]
mod app_recipe;

#[test]
fn s4_the_built_app_embeds_the_directory_vite_builds_into() {
    assert_eq!(
        tauri_config()["build"]["frontendDist"],
        "../../apps/desktop/dist"
    );
}

fn project_json(path: &Path, name: &str, running: bool) -> Value {
    json!({ "name": name, "path": path.display().to_string(), "running": running })
}

/// D9 uses the built Daemon under the App's production RPC path. Only this child's PATH and
/// Claude configuration change; the test process and the user's configuration stay untouched.
fn worktree_git_fixture(command: &str) -> Fixture {
    let daemon = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("rupd");
    assert!(
        daemon.is_file(),
        "build rupd before running the App observer"
    );
    let fx = Fixture::new(&format!(
        "echo $$ > '{0}/daemon-pid'\nexport PATH='{0}/git-bin':\"$PATH\"\nexport CLAUDE_CONFIG_DIR='{0}/claude-config'\nexport ROUNDUP_CLAUDE_BIN='{0}/fake-claude'\nexec '{1}' \"$@\"",
        "{dir}",
        daemon.display()
    ));
    let git_bin = fx.dir.path().join("git-bin");
    std::fs::create_dir(&git_bin).unwrap();
    let real_git = Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    assert!(real_git.status.success());
    let real_git = String::from_utf8(real_git.stdout).unwrap();
    let wrapper = git_bin.join("git");
    std::fs::write(&wrapper, format!(
        "#!/bin/sh\nif [ -f '{0}/hold' ] && {1}; then echo $$ > '{0}/entered'; exec sleep 60; fi\nexec '{2}' \"$@\"\n",
        fx.dir.path().display(), command, real_git.trim()
    )).unwrap();
    std::fs::set_permissions(wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let fake = fx.dir.path().join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 60\n").unwrap();
    std::fs::set_permissions(fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["config", "user.email", "roundup@example.com"],
        vec!["config", "user.name", "roundup"],
        vec!["commit", "--allow-empty", "-q", "-m", "init"],
    ] {
        assert!(
            Command::new("git")
                .current_dir(&fx.project)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    fx
}

fn observe_app_worktree_bound(provision: bool, command: &str) {
    let fx = worktree_git_fixture(command);
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let state = app.state::<AppState>();
    let path = fx.project.display().to_string();
    tauri::async_runtime::block_on(async {
        state
            .rpc(
                &path,
                "project.setWorktrees",
                json!({"on": true, "check": null}),
            )
            .await
            .unwrap();
        let (method, params) = if provision {
            ("agent.spawn", json!({"cwd": path}))
        } else {
            let node = state
                .rpc(&path, "agent.spawn", json!({"cwd": path}))
                .await
                .unwrap();
            ("agent.worktreeState", json!({"id": node["id"]}))
        };
        std::fs::write(fx.dir.path().join("hold"), "hold").unwrap();
        let start = Instant::now();
        let error = tokio::time::timeout(Duration::from_secs(8), state.rpc(&path, method, params))
            .await
            .expect("App-facing Git wait exceeded the Daemon budget")
            .unwrap_err();
        assert!(error.message.contains("deadline"), "{error:?}");
        assert!(start.elapsed() < Duration::from_secs(30));
        let pid = fx.file("entered");
        assert!(!pid.is_empty(), "the finite Git wrapper must enter");
        assert!(
            !Command::new("kill")
                .args(["-0", pid.trim()])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success(),
            "Git command survived its response"
        );
        let tree = state.rpc(&path, "rail.tree", json!({})).await.unwrap();
        if provision {
            assert_eq!(tree, json!([]), "failed spawn must roll back its Rail row");
            let refs = Command::new("git")
                .current_dir(&fx.project)
                .args([
                    "for-each-ref",
                    "--format=%(refname)",
                    "refs/heads/roundup",
                    "refs/roundup/provisioning",
                ])
                .output()
                .unwrap();
            assert!(refs.status.success());
            assert!(
                refs.stdout.is_empty(),
                "owned provisioning refs must be recovered"
            );
        }
    });
    state.close();
    tauri::async_runtime::block_on(async {
        let daemon = fx.file("daemon-pid");
        assert!(!daemon.is_empty());
        tokio::time::timeout(Duration::from_secs(8), async {
            while Command::new("kill")
                .args(["-0", daemon.trim()])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success()
            {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("the observer's attached Daemon must end before its fixture closes");
    });
}

#[test]
fn d9_the_app_worktree_state_wait_stays_within_the_call_bound() {
    observe_app_worktree_bound(false, "[ \"$1\" = rev-list ]");
}

#[test]
fn d9_the_app_worktree_provision_wait_stays_within_the_call_bound() {
    for command in [
        "[ \"$1\" = rev-parse ]",
        "[ \"$1\" = show-ref ]",
        "[ \"$1\" = update-ref ] && [ \"$2\" = --stdin ]",
        "[ \"$1\" = worktree ] && [ \"$2\" = add ]",
    ] {
        observe_app_worktree_bound(true, command);
    }
}

#[test]
fn d1_pending_worktree_git_ends_with_its_attached_daemon() {
    let fx = worktree_git_fixture("[ \"$1\" = rev-parse ]");
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let state = app.state::<AppState>();
    let path = fx.project.display().to_string();
    tauri::async_runtime::block_on(async {
        state
            .rpc(
                &path,
                "project.setWorktrees",
                json!({"on": true, "check": null}),
            )
            .await
            .unwrap();
        std::fs::write(fx.dir.path().join("hold"), "hold").unwrap();
        let pending = state.rpc(&path, "agent.spawn", json!({"cwd": path}));
        tokio::pin!(pending);
        tokio::select! {
            reply = &mut pending => panic!("Git did not hold the request: {reply:?}"),
            _ = tokio::time::timeout(Duration::from_secs(5), async {
                while fx.file("entered").is_empty() {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            }) => {}
        }
        let git = fx.file("entered");
        assert!(
            !git.is_empty(),
            "Git must signal entry before closing the App's attached stdin"
        );
        let daemon = fx.file("daemon-pid");
        assert!(!daemon.is_empty());
        state.close();
        tokio::time::timeout(Duration::from_secs(8), async {
            loop {
                let exists = |pid: &str| {
                    Command::new("kill")
                        .args(["-0", pid.trim()])
                        .stderr(std::process::Stdio::null())
                        .status()
                        .unwrap()
                        .success()
                };
                if !exists(&daemon) {
                    assert!(!exists(&git), "Git outlived its owning Daemon");
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("attached shutdown exceeded its Worktree budget");
    });
}

/// X14: a program writes NUL, ESC, invalid UTF-8 and a multibyte character split across writes.
const RAW_BYTES: &[u8] = b"a\0b\x1b[31m\xff\xfe\xe2\x82\xac!";

#[test]
fn x14_desktop_output_channel_uses_raw_bodies() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let path = fx.project.display().to_string();
    let program = "stty -opost -echo; printf ready; read go; printf 'a\\000b\\033[31m\\377\\376\\342\\202'; sleep 0.2; printf '\\254!'; sleep 30";
    let spawned = invoke(
        &webview,
        "rpc",
        json!({ "path": path, "method": "terminal.spawn", "params": {
            "cwd": fx.project, "command": ["/bin/sh", "-c", program], "env": {}, "cols": 80, "rows": 24,
        }}),
    )
    .unwrap();
    let id = spawned["id"].as_str().unwrap().to_owned();
    // The program has switched the tty to raw before the App selects its output.
    eventually("the program is ready", || {
        invoke(
            &webview,
            "rpc",
            json!({ "path": path, "method": "terminal.read", "params": { "id": id, "after": 0 } }),
        )
        .is_ok_and(|read| {
            read["text"]
                .as_str()
                .is_some_and(|text| text.contains("ready"))
        })
    });
    let (tx, received) = mpsc::channel();
    let channel = Channel::<InvokeResponseBody>::new(move |body| {
        tx.send(body).unwrap();
        Ok(())
    });

    let started = tauri::async_runtime::block_on(
        app.state::<AppState>().terminal_output(&path, &id, channel),
    );
    assert_eq!(started.unwrap(), 5);
    invoke(
        &webview,
        "rpc",
        json!({ "path": path, "method": "terminal.write", "params": { "id": id, "data": "Cg==" } }),
    )
    .unwrap();

    let mut bytes = Vec::new();
    let mut bodies = 0;
    while bytes.len() < RAW_BYTES.len() {
        match received
            .recv_timeout(WAIT)
            .unwrap_or_else(|_| panic!("only {bytes:?} arrived"))
        {
            InvokeResponseBody::Raw(chunk) => {
                bodies += 1;
                bytes.extend(chunk);
            }
            InvokeResponseBody::Json(json) => panic!("bytes crossed as JSON: {json}"),
        }
    }
    assert_eq!(bytes, RAW_BYTES);
    assert!(bodies >= 2, "the character was split between bodies");

    // The release is this Terminal's own: no further body arrives after it.
    invoke(
        &webview,
        "terminal_output_stop",
        json!({ "path": path, "id": id }),
    )
    .unwrap();
    invoke(
        &webview,
        "rpc",
        json!({ "path": path, "method": "terminal.kill", "params": { "id": id } }),
    )
    .unwrap();
    assert!(received.recv_timeout(Duration::from_millis(300)).is_err());
}

#[path = "app/calls.rs"]
mod calls;
mod project_names;
mod project_opening;
mod project_task;
#[path = "app/projects.rs"]
mod projects;
#[path = "app/reopen.rs"]
mod reopen;
#[path = "app/start.rs"]
mod start;
mod update_exit;
