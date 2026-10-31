//! I11: `rup api describe` and `rup api list`. The built `rup` against an in-process Daemon on a temp socket.

use std::process::Stdio;
use std::sync::Arc;

use serde_json::Value;
use tokio::process::Command;

struct Daemon {
    socket: std::path::PathBuf,
    _dir: tempfile::TempDir,
    task: tokio::task::JoinHandle<()>,
}

impl Daemon {
    fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("rupd.sock");
        let daemon = Arc::new(rupd::Daemon::open(&dir.path().join(".roundup")).unwrap());
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let task = tokio::spawn(async move {
            let _ = rupd::serve(listener, daemon).await;
        });
        Self {
            socket,
            _dir: dir,
            task,
        }
    }

    async fn run(&self, args: &[&str]) -> (i32, String, String) {
        let output = Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(args)
            .env("RUPD_SOCKET", &self.socket)
            .env_remove("ROUNDUP_AGENT")
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output()
            .await
            .unwrap();
        (
            output.status.code().unwrap(),
            String::from_utf8(output.stdout).unwrap(),
            String::from_utf8(output.stderr).unwrap(),
        )
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[tokio::test]
async fn i11_describe_prints_summary_arguments_result_and_example_in_order() {
    let daemon = Daemon::start();
    let (code, out, err) = daemon.run(&["api", "describe", "todo.create"]).await;
    assert_eq!((code, err.as_str()), (0, ""));
    assert!(out.ends_with('\n'));
    let at = |part: &str| {
        out.find(part)
            .unwrap_or_else(|| panic!("{part} missing in {out}"))
    };
    let order = [
        at("Create a Todo"),
        at("arguments:"),
        at("title  text  required"),
        at("result:"),
        at("example call: todo.create"),
        at("example result:"),
    ];
    assert!(order.windows(2).all(|w| w[0] < w[1]), "{out}");
}

#[tokio::test]
async fn i11_describe_json_is_the_daemons_result_alone() {
    let daemon = Daemon::start();
    let (code, out, err) = daemon
        .run(&["--json", "api", "describe", "todo.create"])
        .await;
    assert_eq!((code, err.as_str()), (0, ""));
    let result: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(result["name"], "todo.create");
    assert!(result["example"]["params"].is_object());
    assert_eq!(out.lines().count(), 1);
}

#[tokio::test]
async fn i11_list_prints_names_and_summaries_and_q_only_names() {
    let daemon = Daemon::start();
    let (code, full, _) = daemon.run(&["api", "list"]).await;
    assert_eq!(code, 0);
    let (code, names, _) = daemon.run(&["api", "list", "-q"]).await;
    assert_eq!(code, 0);
    let expected: Vec<&str> = full
        .lines()
        .map(|l| l.split("  ").next().unwrap())
        .collect();
    assert_eq!(names.lines().collect::<Vec<_>>(), expected);
    assert!(
        full.lines()
            .any(|l| l.starts_with("todo.create  ") && l.len() > 14)
    );
    assert!(names.lines().any(|l| l == "api.describe"));
}

#[tokio::test]
async fn i11_an_unknown_method_exits_1_naming_it() {
    let daemon = Daemon::start();
    let (code, out, err) = daemon.run(&["api", "describe", "todo.creat"]).await;
    assert_eq!((code, out.as_str()), (1, ""));
    let mut lines = err.lines();
    let first = lines.next().unwrap();
    assert!(
        first.starts_with("rup: ")
            && first.contains("todo.creat")
            && first.ends_with("(METHOD_NOT_FOUND)")
    );
    assert_eq!(lines.next(), Some("list them with \"rup api list\""));
}

#[tokio::test]
async fn i11_describe_without_a_method_exits_2() {
    let daemon = Daemon::start();
    assert_eq!(daemon.run(&["api", "describe"]).await.0, 2);
    assert_eq!(daemon.run(&["api", "describe", "a.b", "c.d"]).await.0, 2);
}
