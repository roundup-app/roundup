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
