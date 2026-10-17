//! M12: a Door picks a child's Model from any the Adapter lists. The built `rup mcp <agent-id>`
//! over stdio against the real `rupd` and the fake `claude`, which records each launch.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use contracts::Touch;
use contracts::agent::RailNode;
use daemon::{Project, rail_tree, start};
use rmcp::ServiceExt;
use rmcp::model::{CallToolRequestParams, CallToolResult};
use rmcp::service::{RoleClient, RunningService};
use rpc::Client;
use serde_json::{Value, json};
use tokio::process::Child;

const BOUND: Duration = Duration::from_secs(30);

struct Shim {
    client: RunningService<RoleClient, ()>,
    _child: Child,
}

impl Shim {
    async fn call(&self, tool: &'static str, arguments: Value) -> CallToolResult {
        let mut request = CallToolRequestParams::new(tool);
        if let Value::Object(map) = arguments {
            request = request.with_arguments(map);
        }
        tokio::time::timeout(BOUND, self.client.call_tool(request))
            .await
            .expect("the shim answered the call")
            .unwrap()
    }

    /// The whole `tools/list`, descriptions and schemas.
    async fn tools(&self) -> Value {
        let tools = tokio::time::timeout(BOUND, self.client.list_all_tools())
            .await
            .expect("the shim listed its tools")
            .unwrap();
        serde_json::to_value(tools).unwrap()
    }
}

fn text(result: &CallToolResult) -> String {
    result.content[0]
        .as_text()
        .expect("a text result")
        .text
        .clone()
}

struct Run {
    project: Project,
    log: PathBuf,
    brief: PathBuf,
}

impl Run {
    fn start() -> Run {
        let scratch = tempfile::tempdir().unwrap().keep();
        let (log, brief) = (scratch.join("launches"), scratch.join("brief.json"));
        let project = start(&[
            ("FAKE_CLAUDE_LAUNCH_LOG", log.to_str().unwrap()),
            ("FAKE_CLAUDE_BRIEF_REPORT", brief.to_str().unwrap()),
        ]);
        Run {
            project,
            log,
            brief,
        }
    }

    /// Wait until `count` launches are recorded and return the last.
    fn launch_number(&self, count: usize) -> Value {
        let deadline = std::time::Instant::now() + BOUND;
        while std::time::Instant::now() < deadline {
            if let Some(launch) = self.launches().get(count - 1) {
                return launch.clone();
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("fewer than {count} launches: {:?}", self.launches());
    }

    fn launches(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn cwd(&self) -> String {
        self.project.dir.path().to_string_lossy().into_owned()
    }

    /// An Agent `m` with its `rup mcp`.
    async fn caller(&self, client: &Client) -> (RailNode, Shim) {
        let node = self.project.spawn_agent(client).await;
        // The child must not race its caller for the first launch-log entry.
        self.launch_number(1);
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(["mcp", &node.id])
            .env("RUPD_SOCKET", self.project.socket())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
        let client = tokio::time::timeout(BOUND, ().serve(transport))
            .await
            .expect("the shim answered initialize")
            .unwrap();
        (
            node,
            Shim {
                client,
                _child: child,
            },
        )
    }

    /// The Brief text the first launch read, once it was reported.
    async fn brief(&self) -> String {
        tokio::time::timeout(BOUND, async {
            loop {
                if let Ok(text) = std::fs::read_to_string(&self.brief)
                    && let Ok(seen) = serde_json::from_str::<Value>(&text)
                {
                    return seen["brief"].as_str().unwrap().to_owned();
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the fake claude reported")
    }

    /// Every file of every launch, by name with the Agent's number left out.
    fn launch_files(&self) -> BTreeMap<String, Vec<u8>> {
        let agents = self.project.data_dir().join("agents");
        std::fs::read_dir(agents)
            .unwrap()
            .map(|entry| entry.unwrap())
            .filter(|entry| entry.file_type().unwrap().is_file())
            .map(|entry| {
                (
                    entry.file_name().to_string_lossy().into_owned(),
                    std::fs::read(entry.path()).unwrap(),
                )
            })
            .collect()
    }
}

async fn set_models(client: &Client, roles: Value) {
    client
        .request("project.setModels", json!({ "roles": roles }))
        .await
        .unwrap();
}

fn argv_has(launch: &Value, flag: &str, value: &str) -> bool {
    launch["argv"]
        .as_array()
        .unwrap()
        .windows(2)
        .any(|pair| pair[0] == flag && pair[1] == value)
}

async fn touches_of(client: &Client, agent: &str) -> Vec<Touch> {
    serde_json::from_value(
        client
            .request("provenance.touched", json!({ "actor_id": agent }))
            .await
            .unwrap(),
    )
    .unwrap()
}

async fn spawn_with(shim: &Shim, run: &Run, model: Option<&str>) -> CallToolResult {
    let mut arguments = json!({
        "cwd": run.cwd(),
        "order": {"kind": "work", "ask": "fix the build", "limits": []},
    });
    if let Some(model) = model {
        arguments["model"] = json!(model);
    }
    shim.call("agent_spawn", arguments).await
}

async fn children_of(client: &Client, parent: &str) -> Vec<RailNode> {
    rail_tree(client)
        .await
        .into_iter()
        .filter(|node| node.parent.as_deref() == Some(parent))
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn m12_a_listed_model_starts_the_child_on_it() {
    let run = Run::start();
    let user = run.project.client().await;
    set_models(&user, json!([])).await;
    let (caller, shim) = run.caller(&user).await;

    let spawned = spawn_with(&shim, &run, Some("haiku")).await;
    assert_eq!(spawned.is_error, Some(false), "{spawned:?}");

    let children = children_of(&user, &caller.id).await;
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].model.as_deref(), Some("haiku"));
    assert!(argv_has(&run.launch_number(2), "--model", "haiku"));
}

#[tokio::test(flavor = "multi_thread")]
async fn m12_no_model_takes_the_projects() {
    let run = Run::start();
    let user = run.project.client().await;
    set_models(
        &user,
        json!([{"role": "subagent", "model": "opus", "effort": null}]),
    )
    .await;
    let (caller, shim) = run.caller(&user).await;

    let spawned = spawn_with(&shim, &run, None).await;
    assert_eq!(spawned.is_error, Some(false), "{spawned:?}");

    let children = children_of(&user, &caller.id).await;
    assert_eq!(children[0].model.as_deref(), Some("opus"));
    assert!(argv_has(&run.launch_number(2), "--model", "opus"));
}

#[tokio::test(flavor = "multi_thread")]
async fn m12_an_unlisted_model_is_refused_and_starts_nothing() {
    let run = Run::start();
    let user = run.project.client().await;
    let (caller, shim) = run.caller(&user).await;
    let (tree, launches, touches) = (
        rail_tree(&user).await.len(),
        run.launches().len(),
        touches_of(&user, &caller.id).await.len(),
    );

    let refused = spawn_with(&shim, &run, Some("no-such-model")).await;
    assert_eq!(refused.is_error, Some(true));
    let message = text(&refused);
    assert!(
        message.contains("-32602") && message.contains("no-such-model"),
        "{message}"
    );

    assert_eq!(rail_tree(&user).await.len(), tree);
    assert_eq!(run.launches().len(), launches);
    assert_eq!(touches_of(&user, &caller.id).await.len(), touches);
}
