//! ST3, ST4, ST6: `agent.spawn` takes `settings` only from the user and from a caller below the
//! Project's program Terminal; a claimed name never counts. Every program here is a real process
//! of a real `rupd` with a fake vendor, and a caller below the program is a child of its shell.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use backon::{ConstantBuilder, Retryable};
use rpc::Client;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Runs each `jobs/*.cmd` as a child of the program, once.
const RUNNER: &str = r#"while :; do for j in ../jobs/*.cmd; do [ -f "$j" ] || continue; mv "$j" "$j.run"; sh "$j.run" & done; sleep 0.1; done"#;

/// Sends one request on its own connection, after the identity it claims, and writes the reply.
const CALLER: &str = r#"
import json, socket, sys
sock = socket.socket(socket.AF_UNIX)
sock.connect(sys.argv[1])
lines = sock.makefile("rw")
def call(id, method, params):
    lines.write(json.dumps({"jsonrpc": "2.0", "id": id, "method": method, "params": params}) + "\n")
    lines.flush()
    while True:
        reply = json.loads(lines.readline())
        if reply.get("id") == id:
            return reply
if sys.argv[2]:
    call(1, "daemon.identify", {"actor": json.loads(sys.argv[2])})
open(sys.argv[5], "w").write(json.dumps(call(2, sys.argv[3], json.loads(sys.argv[4]))))
"#;

struct Run {
    daemon: rupd_harness::Rupd,
    dir: PathBuf,
    data: PathBuf,
    root: tempfile::TempDir,
    user: Client,
    jobs: std::cell::Cell<u32>,
}

/// A call an Agent's fake `claude` makes from its own process: `method` with `params`, the reply
/// written to the file.
struct Child<'a> {
    out: &'a Path,
    method: &'a str,
    /// The params, given the Project folder; the default is a Job spawn with settings.
    params: Option<fn(&Path) -> Value>,
}

fn rupd(dir: &Path, data: &Path, root: &Path, child: Option<Child<'_>>) -> rupd_harness::Rupd {
    let bin = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
    rupd_harness::start(&bin, dir, true, |cmd| {
        cmd.env("ROUNDUP_RUP_BIN", bin.with_file_name("rup"))
            .env(
                "ROUNDUP_CLAUDE_BIN",
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"),
            )
            .env("ROUNDUP_SIDECAR_DIR", root.join("unused-sidecar"))
            .env("CLAUDE_CONFIG_DIR", root.join("config"))
            .env("ROUNDUP_DATA_DIR", data)
            .env("FAKE_CLAUDE_LAUNCH_LOG", root.join("launches"));
        if let Some(Child {
            out,
            method,
            params,
        }) = child
        {
            let socket = dir.join("rupd.sock");
            let params = params.map_or_else(
                || json!({"cwd": dir, "role": "job", "prompt": "p", "settings": {"env": {"A": "1"}}}),
                |params| params(dir),
            );
            cmd.env(
                "FAKE_CLAUDE_CHILD_PROCESS",
                json!([
                    "python3",
                    root.join("caller.py"),
                    socket,
                    "",
                    method,
                    params.to_string(),
                    out
                ])
                .to_string(),
            );
        }
    })
}

impl Run {
    async fn start(agent_out: Option<&Path>) -> Self {
        let child = agent_out.map(|out| Child {
            out,
            method: "agent.spawn",
            params: None,
        });
        Self::start_with(child).await
    }

    async fn start_with(child: Option<Child<'_>>) -> Self {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().canonicalize().unwrap().join("proj");
        std::fs::create_dir_all(dir.join("work")).unwrap();
        std::fs::create_dir_all(root.path().join("jobs")).unwrap();
        std::fs::write(root.path().join("caller.py"), CALLER).unwrap();
        let data = root.path().canonicalize().unwrap().join("data");
        std::fs::create_dir_all(&data).unwrap();
        let daemon = rupd(&dir, &data, root.path(), child);
        let user = Client::connect(&daemon.socket).await.unwrap();
        Self {
            daemon,
            dir,
            data,
            root,
            user,
            jobs: Default::default(),
        }
    }

    async fn restart(self) -> Self {
        let Self {
            daemon,
            dir,
            data,
            root,
            user,
            ..
        } = self;
        drop(user);
        drop(daemon);
        let daemon = rupd(&dir, &data, root.path(), None);
        let user = Client::connect(&daemon.socket).await.unwrap();
        Self {
            daemon,
            dir,
            data,
            root,
            user,
            jobs: Default::default(),
        }
    }

    /// The program: a shell that runs the jobs this test drops beside it.
    async fn program(&self) {
        self.program_adopting(None).await;
    }

    /// `program`, whose entry names `adopt_dir` (G13) when given.
    async fn program_adopting(&self, adopt_dir: Option<&str>) {
        // The jobs folder is beside `work`, which is the program's directory.
        std::os::unix::fs::symlink(self.root.path().join("jobs"), self.dir.join("jobs")).unwrap();
        self.user
            .request(
                "project.setProgram",
                match adopt_dir {
                    Some(adopt) => {
                        json!({"argv": ["sh", "-c", RUNNER], "dir": "work", "adoptDir": adopt})
                    }
                    None => json!({"argv": ["sh", "-c", RUNNER], "dir": "work"}),
                },
            )
            .await
            .unwrap();
        self.user
            .request("project.startProgram", Value::Null)
            .await
            .unwrap();
        self.until_running().await;
    }

    async fn until_running(&self) {
        let up = || async {
            let run = self
                .user
                .request("project.programRun", Value::Null)
                .await
                .map_err(|e| e.to_string())?;
            if run["state"] == "running" {
                Ok(())
            } else {
                Err(run.to_string())
            }
        };
        up.retry(patient()).await.expect("the program never ran");
    }

    /// A call from a process of the program's shell, naming `claim` (an Actor) or none.
    async fn below(&self, claim: Option<Value>, method: &str, params: Value) -> Value {
        let n = self.jobs.replace(self.jobs.get() + 1);
        let out = self.root.path().join(format!("out{n}.json"));
        let line = [
            "python3".to_owned(),
            self.root.path().join("caller.py").display().to_string(),
            self.daemon.socket.display().to_string(),
            claim.map(|c| c.to_string()).unwrap_or_default(),
            method.to_owned(),
            params.to_string(),
            out.display().to_string(),
        ]
        .map(|word| format!("'{}'", word.replace('\'', r"'\''")))
        .join(" ");
        std::fs::write(self.root.path().join(format!("jobs/{n}.cmd")), line).unwrap();
        reply_at(&out).await
    }

    /// A call from this test's own process, outside every tree, naming `claim`.
    async fn outside(&self, claim: Option<Value>, params: Value) -> Result<Value, rpc::RpcError> {
        let client = Client::connect(&self.daemon.socket).await.unwrap();
        if let Some(actor) = claim {
            client
                .request("daemon.identify", json!({"actor": actor}))
                .await
                .unwrap();
        }
        client.request("agent.spawn", params).await
    }

    fn spawn_params(&self, settings: Option<Value>) -> Value {
        let mut params = json!({"cwd": self.dir});
        if let Some(settings) = settings {
            params["settings"] = settings;
        }
        params
    }

    async fn agents(&self) -> usize {
        let tree = self.user.request("rail.tree", Value::Null).await.unwrap();
        tree.as_array()
            .unwrap()
            .iter()
            .filter(|n| n["kind"] == "agent")
            .count()
    }
}

fn patient() -> ConstantBuilder {
    ConstantBuilder::default()
        .with_delay(Duration::from_millis(25))
        .with_max_times(600)
}

async fn reply_at(out: &Path) -> Value {
    let read = || async {
        let text = std::fs::read_to_string(out).map_err(|e| e.to_string())?;
        serde_json::from_str::<Value>(&text).map_err(|e| e.to_string())
    };
    read.retry(patient())
        .await
        .expect("the caller wrote its reply")
}

fn ext(name: &str) -> Value {
    json!({"kind": "ext", "id": name, "parent": null})
}

fn settings() -> Value {
    json!({"env": {"TOKEN": "hunter2"}, "permissions": {"deny": ["Bash(rm:*)"]}})
}

const FORBIDDEN: i64 = rpc::code::FORBIDDEN;

fn forbidden(err: &rpc::RpcError) -> bool {
    err.code == rpc::code::FORBIDDEN
        && err.message.contains("settings")
        && !err.message.contains("hunter2")
}

#[tokio::test]
async fn st3_a_caller_below_the_programs_terminal_is_the_program() {
    let run = Run::start(None).await;
    run.program().await;
    for claim in [None, Some(ext("hum")), Some(ext("anything"))] {
        let reply = run
            .below(claim, "agent.spawn", run.spawn_params(Some(settings())))
            .await;
        assert!(reply.get("error").is_none(), "{reply}");
    }
    assert_eq!(run.agents().await, 3);
}

#[tokio::test]
async fn st3_a_claimed_name_is_never_the_program() {
    let run = Run::start(None).await;
    run.program().await;
    for name in ["hum", "program", "anything"] {
        let err = run
            .outside(Some(ext(name)), run.spawn_params(Some(settings())))
            .await
            .unwrap_err();
        assert!(forbidden(&err), "{err:?}");
    }
    assert_eq!(run.agents().await, 0);
}

#[tokio::test]
async fn st4_an_agent_with_settings_is_forbidden_and_starts_nothing() {
    let out = tempfile::tempdir().unwrap();
    let out = out.path().join("agent.json");
    let run = Run::start(Some(&out)).await;
    run.user
        .request("agent.spawn", run.spawn_params(None))
        .await
        .unwrap();
    let reply = reply_at(&out).await;
    assert_eq!(reply["error"]["code"], FORBIDDEN, "{reply}");
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("settings")
    );
    assert_eq!(run.agents().await, 1, "only the user's Agent");
}

#[tokio::test]
async fn st4_an_ext_with_settings_is_forbidden_and_starts_nothing() {
    let run = Run::start(None).await;
    for params in [settings(), json!({})] {
        let err = run
            .outside(Some(ext("probe")), run.spawn_params(Some(params)))
            .await
            .unwrap_err();
        assert!(forbidden(&err), "{err:?}");
    }
    assert_eq!(run.agents().await, 0);
    assert!(!run.root.path().join("launches").exists());
}

#[tokio::test]
async fn st4_a_claim_of_the_programs_name_is_forbidden() {
    let run = Run::start(None).await;
    run.program().await;
    let err = run
        .outside(Some(ext("hum")), run.spawn_params(Some(settings())))
        .await
        .unwrap_err();
    assert!(forbidden(&err), "{err:?}");
    assert_eq!(run.agents().await, 0);
}

#[tokio::test]
async fn st4_a_spawn_without_settings_is_decided_as_before() {
    let run = Run::start(None).await;
    run.outside(Some(ext("probe")), run.spawn_params(None))
        .await
        .unwrap();
    run.outside(None, run.spawn_params(Some(json!({"env": {"A": "1"}}))))
        .await
        .unwrap();
    assert_eq!(run.agents().await, 2);
}

#[tokio::test]
async fn st4_the_program_sending_permission_mode_is_forbidden() {
    let run = Run::start(None).await;
    run.program().await;
    let mut params = run.spawn_params(Some(json!({})));
    params["permissionMode"] = json!("plan");
    let reply = run
        .below(Some(ext("hum")), "agent.spawn", params.clone())
        .await;
    assert_eq!(reply["error"]["code"], FORBIDDEN, "{reply}");
    let reply = run.below(None, "agent.spawn", params).await;
    assert_eq!(reply["error"]["code"], FORBIDDEN, "{reply}");
    assert_eq!(run.agents().await, 0);
}

#[tokio::test]
async fn st6_a_process_left_from_an_earlier_start_is_refused() {
    let run = Run::start(None).await;
    run.program().await;
    // A process the first start left behind: detached, it outlives the program's Terminal, and
    // calls with the program's name once the new start runs.
    let left = run.root.path().join("left.json");
    let go = run.root.path().join("go");
    let claim = ext("hum").to_string();
    let script = run.root.path().join("left.sh");
    std::fs::write(
        &script,
        format!(
            "while [ ! -f {go} ]; do sleep 0.1; done\npython3 {caller} {socket} '{claim}' agent.spawn '{params}' {left}\n",
            go = go.display(),
            caller = run.root.path().join("caller.py").display(),
            socket = run.daemon.socket.display(),
            params = run.spawn_params(Some(settings())),
            left = left.display(),
        ),
    )
    .unwrap();
    std::fs::write(
        run.root.path().join("jobs/left.cmd"),
        format!(
            "setsid sh {} </dev/null >/dev/null 2>&1 &",
            script.display()
        ),
    )
    .unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    run.user
        .request("project.stopProgram", Value::Null)
        .await
        .unwrap();
    run.user
        .request("project.startProgram", Value::Null)
        .await
        .unwrap();
    run.until_running().await;
    std::fs::write(&go, "").unwrap();
    let reply = reply_at(&left).await;
    assert_eq!(reply["error"]["code"], FORBIDDEN, "{reply}");
    // Settled: the old start is no program, so a claim of its name is the Ext it names.
    let err = run
        .outside(Some(ext("hum")), run.spawn_params(Some(settings())))
        .await
        .unwrap_err();
    assert!(forbidden(&err), "{err:?}");
    let reply = run
        .below(None, "agent.spawn", run.spawn_params(Some(settings())))
        .await;
    assert!(reply.get("error").is_none(), "{reply}");
    assert_eq!(run.agents().await, 1);
}

#[tokio::test]
async fn st6_a_refusal_leaves_no_trace() {
    let run = Run::start(None).await;
    run.program().await;
    let before = run.user.request("rail.tree", Value::Null).await.unwrap();
    let err = run
        .outside(Some(ext("hum")), run.spawn_params(Some(settings())))
        .await
        .unwrap_err();
    assert!(forbidden(&err));
    assert_eq!(
        run.user.request("rail.tree", Value::Null).await.unwrap(),
        before
    );
    assert!(
        !run.dir.join(".roundup/agents").exists()
            || std::fs::read_dir(run.dir.join(".roundup/agents"))
                .unwrap()
                .count()
                == 0
    );
    let reply = run
        .below(None, "agent.spawn", run.spawn_params(Some(settings())))
        .await;
    assert!(reply.get("error").is_none(), "{reply}");
    assert_eq!(run.agents().await, 1);
}

#[tokio::test]
async fn st3_a_surviving_program_is_known_after_a_daemon_restart() {
    let run = Run::start(None).await;
    run.program().await;
    let run = run.restart().await;
    run.until_running().await;
    let reply = run
        .below(None, "agent.spawn", run.spawn_params(Some(settings())))
        .await;
    assert!(reply.get("error").is_none(), "{reply}");
}

fn git(dir: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .current_dir(dir)
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

impl Run {
    /// The Project as a git repository on `main` with worktrees: one inside `trees` (the
    /// program's directory), one beside it and one outside the Project that a link inside
    /// `trees` leads to.
    fn repo(&self) -> [PathBuf; 3] {
        git(&self.dir, &["init", "-q", "-b", "main"]);
        git(&self.dir, &["commit", "-q", "--allow-empty", "-m", "base"]);
        let trees = self.dir.join("trees");
        std::fs::create_dir_all(&trees).unwrap();
        let inside = trees.join("inside");
        let beside = self.dir.join("beside");
        let out = self.root.path().canonicalize().unwrap().join("outside");
        for (path, branch) in [(&inside, "inside"), (&beside, "beside"), (&out, "out")] {
            git(
                &self.dir,
                &[
                    "worktree",
                    "add",
                    "-q",
                    "-b",
                    branch,
                    &path.to_string_lossy(),
                ],
            );
        }
        std::os::unix::fs::symlink(&out, trees.join("link")).unwrap();
        [inside, beside, out]
    }

    fn adopt_params(path: &Path, branch: &str) -> Value {
        json!({"path": path, "branch": branch, "visibility": "internal", "settings": {"env": {"A": "1"}}})
    }

    async fn nodes(&self) -> Vec<Value> {
        let tree = self.user.request("rail.tree", Value::Null).await.unwrap();
        tree.as_array().unwrap().clone()
    }
}

#[tokio::test]
async fn g13_program_adopts_inside_its_directory_with_launch_fields() {
    let run = Run::start(None).await;
    let [inside, ..] = run.repo();
    run.program_adopting(Some("trees")).await;
    let reply = run
        .below(None, "agent.adopt", Run::adopt_params(&inside, "inside"))
        .await;
    assert!(reply.get("error").is_none(), "{reply}");
    let node = &reply["result"];
    assert_eq!(node["worktree"]["adopted"], true, "{reply}");
    assert_eq!(node["visibility"], "internal", "{reply}");
}

#[tokio::test]
async fn g13_outside_and_linked_out_paths_are_refused() {
    let run = Run::start(None).await;
    let [_, beside, _] = run.repo();
    run.program_adopting(Some("trees")).await;
    let linked = run.dir.join("trees/link");
    for (path, branch) in [(&beside, "beside"), (&linked, "out")] {
        let reply = run
            .below(None, "agent.adopt", Run::adopt_params(path, branch))
            .await;
        assert_eq!(reply["error"]["code"], rpc::code::INVALID_PARAMS, "{reply}");
        assert!(
            reply["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with("outside_program_directory: ")
        );
    }
    assert!(run.nodes().await.iter().all(|n| n["kind"] != "agent"));
}

#[tokio::test]
async fn g13_no_directory_adopts_nothing() {
    let run = Run::start(None).await;
    let [inside, ..] = run.repo();
    run.program().await;
    let reply = run
        .below(None, "agent.adopt", Run::adopt_params(&inside, "inside"))
        .await;
    assert_eq!(reply["error"]["code"], rpc::code::INVALID_PARAMS, "{reply}");
    assert!(run.nodes().await.iter().all(|n| n["kind"] != "agent"));
}

#[tokio::test]
async fn g14_agent_and_claimed_name_are_refused() {
    let out = tempfile::tempdir().unwrap();
    let out = out.path().join("agent.json");
    let inside = |dir: &Path| Run::adopt_params(&dir.join("trees/inside"), "inside");
    let run = Run::start_with(Some(Child {
        out: &out,
        method: "agent.adopt",
        params: Some(|dir| Run::adopt_params(&dir.join("trees/inside"), "inside")),
    }))
    .await;
    run.repo();
    run.program_adopting(Some("trees")).await;
    let before = std::process::Command::new("git")
        .current_dir(&run.dir)
        .args(["worktree", "list"])
        .output()
        .unwrap()
        .stdout;
    // An Agent whose process calls `agent.adopt` is refused.
    run.user
        .request("agent.spawn", run.spawn_params(None))
        .await
        .unwrap();
    let reply = reply_at(&out).await;
    assert_eq!(reply["error"]["code"], FORBIDDEN, "{reply}");
    // A detached caller claiming the program's name is refused.
    let client = Client::connect(&run.daemon.socket).await.unwrap();
    client
        .request("daemon.identify", json!({"actor": ext("hum")}))
        .await
        .unwrap();
    let err = client
        .request("agent.adopt", inside(&run.dir))
        .await
        .unwrap_err();
    assert_eq!(err.code, FORBIDDEN, "{err:?}");
    let err = client
        .request("agent.adoptable", Value::Null)
        .await
        .unwrap_err();
    assert_eq!(err.code, FORBIDDEN, "{err:?}");
    assert_eq!(
        run.nodes()
            .await
            .iter()
            .filter(|n| n["kind"] == "agent")
            .count(),
        1
    );
    let after = std::process::Command::new("git")
        .current_dir(&run.dir)
        .args(["worktree", "list"])
        .output()
        .unwrap()
        .stdout;
    assert_eq!(after, before);
}

#[tokio::test]
async fn g14_adoptable_for_the_program_holds_only_its_directory() {
    let run = Run::start(None).await;
    let [inside, ..] = run.repo();
    run.program_adopting(Some("trees")).await;
    let for_program = run.below(None, "agent.adoptable", Value::Null).await;
    let rows = for_program["result"].as_array().unwrap();
    assert_eq!(rows.len(), 1, "{for_program}");
    assert_eq!(rows[0]["path"], inside.to_str().unwrap());
    let for_user = run
        .user
        .request("agent.adoptable", Value::Null)
        .await
        .unwrap();
    assert_eq!(for_user.as_array().unwrap().len(), 3);
}
