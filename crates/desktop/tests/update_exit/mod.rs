//! `exit_for_update` through the native App seam.
use super::*;

/// A Daemon stand-in that answers one request, `open_project`'s ping, and then goes silent.
pub(super) fn serve_one_answer(socket: PathBuf) {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::os::unix::net::UnixListener::bind(socket).unwrap();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut writer = stream.try_clone().unwrap();
        let mut lines = BufReader::new(stream).lines();
        let first: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        writeln!(writer, "{}", json!({"id": first["id"], "result": null})).unwrap();
        // Hold the connection open and unanswered until the test ends.
        for _ in lines {}
    });
}

#[test]
fn s5981a_an_unsaved_daemon_fails_the_call_and_the_app_stays_open() {
    let fx = Fixture::new("{link}\ncat > /dev/null\ntouch '{dir}/stdin-closed'");
    serve_one_answer(fx.real_daemon_socket());
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);

    let error = invoke(&webview, "exit_for_update", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(error["message"].as_str().unwrap().contains("my-project"));
    // Nothing was ended: the Daemon is still running and its stdin is still open.
    assert!(exited.recv_timeout(Duration::from_millis(300)).is_err());
    assert!(!fx.dir.path().join("stdin-closed").exists());
}

/// A real `rupd` and `terminal-owner` under the App, with a fake `claude` as the Agent program.
struct Real {
    fx: Fixture,
    app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    exited: mpsc::Receiver<Value>,
}

fn built(name: &str) -> PathBuf {
    let dir = std::env::var_os("ROUNDUP_TEST_APP_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let exe = std::env::current_exe().unwrap();
            exe.parent().unwrap().parent().unwrap().to_owned()
        });
    let bin = dir.join(name);
    assert!(
        bin.is_file(),
        "{} is not built; run `cargo build -p rupd -p rup -p terminal --bins`",
        bin.display()
    );
    bin
}

fn kill_zero(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}

fn parent_of(pid: u32) -> u32 {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let after_name = stat.rsplit_once(')').unwrap().1;
    after_name
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap()
}

impl Real {
    fn start() -> Self {
        let rupd = built("rupd");
        let rup = built("rup");
        let fake_claude =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py");
        let body = format!(
            "export CLAUDE_CONFIG_DIR='{{dir}}/claude-config' FAKE_CLAUDE_LAUNCH_LOG='{{dir}}/launches' ROUNDUP_RUP_BIN='{}' ROUNDUP_CLAUDE_BIN='{}'\nexec '{}' \"$@\"",
            rup.display(),
            fake_claude.display(),
            rupd.display()
        );
        let fx = Fixture::new(&body);
        let (app, webview) = app(fx.config.clone(), None);
        let exited = daemon_exited(&app);
        open(&webview, &fx.project);
        Self {
            fx,
            app,
            webview,
            exited,
        }
    }

    fn rpc(&self, method: &str, params: Value) -> Result<Value, Value> {
        let path = self.fx.project.display().to_string();
        invoke(
            &self.webview,
            "rpc",
            json!({ "path": path, "method": method, "params": params }),
        )
    }

    /// Spawns an Agent and returns its id and the pids of its program and of the owner above it.
    fn spawn_agent(&self) -> (String, u32, u32) {
        let params = contracts::agent::SpawnParams {
            start_attribution: None,
            visibility: Default::default(),
            cols: None,
            rows: None,
            permission_mode: None,
            engine: None,
            cwd: self.fx.project.display().to_string(),
            prompt: None,
            order: None,
            name: None,
            app_named: None,
            parent: None,
            role: None,
            model: None,
            effort: None,
            scout: None,
            specialist: None,
            extras: None,
        };
        let node = self.rpc("agent.spawn", json!(params)).unwrap();
        let id = node["id"].as_str().unwrap().to_owned();
        let program = self.program_pid(&id);
        (id, program, parent_of(program))
    }

    fn program_pid(&self, agent: &str) -> u32 {
        let found = std::cell::Cell::new(None);
        eventually("the Agent's program", || {
            let nodes = self.rpc("rail.tree", Value::Null).unwrap();
            let Some(terminal) = nodes
                .as_array()
                .and_then(|nodes| nodes.iter().find(|node| node["id"] == agent))
                .and_then(|node| node["terminal_id"].as_str().map(str::to_owned))
            else {
                return false;
            };
            let list = self.rpc("terminal.list", Value::Null).unwrap();
            found.set(
                list.as_array()
                    .into_iter()
                    .flatten()
                    .find(|t| t["id"] == terminal.as_str())
                    .and_then(|t| t["program_pid"].as_u64()),
            );
            found.get().is_some()
        });
        found.get().unwrap() as u32
    }

    fn launches(&self) -> usize {
        self.fx.file("launches").lines().count()
    }
}

#[test]
fn s5981a_exit_for_update_leaves_owner_and_agent_programs_alive() {
    let real = Real::start();
    let (_, program, owner) = real.spawn_agent();

    invoke(&real.webview, "exit_for_update", json!({})).unwrap();

    assert_eq!(real.exited.recv_timeout(WAIT).unwrap()["code"], Value::Null);
    std::thread::sleep(Duration::from_millis(500));
    assert!(kill_zero(owner), "the Terminal owner was stopped");
    assert!(kill_zero(program), "the Agent program was stopped");
    let _ = Command::new("kill")
        .args(["-9", &owner.to_string(), &program.to_string()])
        .status();
}

#[test]
fn s5981a_the_next_app_reattaches_the_same_agents() {
    let real = Real::start();
    let (id, program, owner) = real.spawn_agent();
    eventually("the fake claude's first launch", || real.launches() >= 1);
    let before = real.rpc("rail.tree", Value::Null).unwrap();
    invoke(&real.webview, "exit_for_update", json!({})).unwrap();
    real.exited.recv_timeout(WAIT).unwrap();

    let (_next, webview) = app(real.fx.config.clone(), None);
    open(&webview, &real.fx.project);
    let path = real.fx.project.display().to_string();
    let rpc = |method: &str| {
        invoke(
            &webview,
            "rpc",
            json!({ "path": path, "method": method, "params": null }),
        )
        .unwrap()
    };
    let after = rpc("rail.tree");

    let node = |nodes: &Value| {
        nodes
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id.as_str())
            .cloned()
    };
    let (was, now) = (node(&before).unwrap(), node(&after).expect("same Agent id"));
    assert_eq!(now["parent"], was["parent"]);
    assert_eq!(now["name"], was["name"]);
    assert_eq!(now["conversation"], was["conversation"]);
    let terminals = rpc("terminal.list");
    let running: Vec<&Value> = terminals
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["running"] == true)
        .collect();
    assert_eq!(running.len(), 1, "one running Terminal");
    assert_eq!(running[0]["program_pid"], program, "the original program");
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(real.launches(), 1, "no new launch");
    assert!(kill_zero(owner));
    let _ = Command::new("kill")
        .args(["-9", &owner.to_string(), &program.to_string()])
        .status();
}

#[test]
fn s5981b_quit_stops_every_owner_and_agent_program() {
    let real = Real::start();
    let (_, program, owner) = real.spawn_agent();

    handle_run_event(real.app.handle(), &RunEvent::Exit);

    eventually("the owner and the program stop", || {
        !kill_zero(owner) && !kill_zero(program)
    });
}

#[test]
fn s5981c_exit_for_update_touches_only_this_apps_owners() {
    let first = Real::start();
    let (_, other_program, other_owner) = first.spawn_agent();
    let second = Real::start();
    let (_, program, owner) = second.spawn_agent();

    invoke(&second.webview, "exit_for_update", json!({})).unwrap();

    second.exited.recv_timeout(WAIT).unwrap();
    std::thread::sleep(Duration::from_millis(500));
    assert!(kill_zero(owner) && kill_zero(program));
    assert!(kill_zero(other_owner), "another App's owner was touched");
    assert!(
        kill_zero(other_program),
        "another App's program was touched"
    );
    assert_eq!(
        first
            .rpc("rail.tree", Value::Null)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let _ = Command::new("kill")
        .args(["-9", &owner.to_string(), &program.to_string()])
        .status();
}
