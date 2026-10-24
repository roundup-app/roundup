//! LC4, LC6, LC7, LC8: what a child's start holds, read from the arguments the fake `claude`
//! records, and what the Door's extras do to a running one.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use contracts::agent::RailNode;
use contracts::{Actor, ActorKind, IdentifyParams, Kind};
use daemon::{Project, rail_tree, start};
use rpc::{Client, code};
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(30);

struct Run {
    project: Project,
    log: PathBuf,
}

fn run() -> Run {
    let log = tempfile::tempdir().unwrap().keep().join("launches");
    Run {
        project: start(&[("FAKE_CLAUDE_LAUNCH_LOG", log.to_str().unwrap())]),
        log,
    }
}

impl Run {
    fn launches(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    async fn launches_after(&self, count: usize) -> Vec<Value> {
        let deadline = Instant::now() + BOUND;
        while Instant::now() < deadline {
            let launches = self.launches();
            if launches.len() >= count {
                return launches;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("fewer than {count} launches: {:?}", self.launches());
    }

    fn root(&self) -> PathBuf {
        self.project.dir.path().to_path_buf()
    }

    /// The user's Claude folder, where `CLAUDE_CONFIG_DIR` points.
    fn user_dir(&self) -> PathBuf {
        self.root().join("claude-config")
    }

    async fn spawn(&self, client: &Client, extra: Value) -> Result<RailNode, rpc::RpcError> {
        let mut params = json!({ "cwd": self.root() });
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let node = client.request("agent.spawn", params).await?;
        Ok(serde_json::from_value(node).unwrap())
    }

    async fn idle(&self, client: &Client, id: &str) {
        let deadline = Instant::now() + BOUND;
        while Instant::now() < deadline {
            let node = rail_tree(client)
                .await
                .into_iter()
                .find(|node| node.id == id)
                .unwrap();
            if node.status.as_ref().is_some_and(|s| s.kind == Kind::Idle) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("{id} never went idle");
    }

    /// A skill of the Project, a plugin the user installed and an MCP server of the user's.
    fn known_extras(&self) {
        let skill = self.root().join(".claude/skills/zzskill");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: zzskill\n---\n").unwrap();
        let plugin = self.root().join("zzplug-install");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::create_dir_all(self.user_dir().join("plugins")).unwrap();
        std::fs::write(
            self.user_dir().join("plugins/installed_plugins.json"),
            json!({"version": 2, "plugins": {"zzplug@market": [{"installPath": plugin}]}})
                .to_string(),
        )
        .unwrap();
        std::fs::write(
            self.user_dir().join(".claude.json"),
            json!({"mcpServers": {"zzserver": {"type": "http", "url": "https://example.test"}}})
                .to_string(),
        )
        .unwrap();
    }
}

async fn as_agent(project: &Project, node: &RailNode) -> Client {
    let client = project.client().await;
    client
        .request(
            "daemon.identify",
            IdentifyParams {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: node.id.clone(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    client
}

fn argv(launch: &Value) -> Vec<&str> {
    launch["argv"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect()
}

fn after<'a>(argv: &[&'a str], flag: &str) -> Option<&'a str> {
    let at = argv.iter().position(|arg| *arg == flag)?;
    argv.get(at + 1).copied()
}

#[tokio::test]
async fn lc6_a_user_started_agent_keeps_the_users_setup() {
    let run = run();
    let user = run.project.client().await;
    let node = run.spawn(&user, json!({})).await.unwrap();
    let launch = &run.launches_after(1).await[0];
    let args = argv(launch);
    for flag in [
        "--setting-sources",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--tools",
    ] {
        assert!(!args.contains(&flag), "{flag}");
    }
    assert!(args.contains(&"--settings") && args.contains(&"--mcp-config"));
    let refused = run
        .spawn(&user, json!({ "scout": true }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, code::INVALID_PARAMS);
    let refused = run
        .spawn(&user, json!({ "extras": { "skills": ["x"] } }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, code::INVALID_PARAMS);
    assert_eq!(rail_tree(&user).await.len(), 1, "{}", node.id);
}

#[tokio::test]
async fn lc4_an_agents_scout_and_worker_start_lean() {
    let run = run();
    let user = run.project.client().await;
    let parent = run.spawn(&user, json!({})).await.unwrap();
    run.idle(&user, &parent.id).await;
    let door = as_agent(&run.project, &parent).await;
    run.spawn(&door, json!({ "scout": true })).await.unwrap();
    run.spawn(&door, json!({})).await.unwrap();
    let launches = run.launches_after(3).await;
    // The fake `claude` processes start together, so their log order is not the spawn order.
    let (mut scout, mut worker): (Vec<_>, Vec<_>) = launches[..3]
        .iter()
        .map(argv)
        .filter(|args| args.contains(&"--strict-mcp-config"))
        .partition(|args| args.contains(&"--tools"));
    assert_eq!((scout.len(), worker.len()), (1, 1));
    let (scout, worker) = (scout.remove(0), worker.remove(0));
    assert_eq!(
        after(&scout, "--tools"),
        Some("Read,Grep,Glob,Bash,ToolSearch,AskUserQuestion")
    );
    assert!(!scout.contains(&"--disable-slash-commands"));
    assert!(!worker.contains(&"--tools") && !worker.contains(&"--disable-slash-commands"));
    for lean in [&scout, &worker] {
        assert!(!lean.contains(&"--setting-sources"));
        assert!(lean.contains(&"--strict-mcp-config"));
    }
}

#[tokio::test]
async fn lc7_a_known_extra_joins_the_start() {
    let run = run();
    run.known_extras();
    let user = run.project.client().await;
    let parent = run.spawn(&user, json!({})).await.unwrap();
    run.idle(&user, &parent.id).await;
    let door = as_agent(&run.project, &parent).await;
    let names = door.request("agent.extras", Value::Null).await.unwrap();
    assert_eq!(
        names,
        json!({"skills": ["zzskill"], "plugins": ["zzplug@market"], "mcp": ["zzserver"]})
    );
    run.spawn(
        &door,
        json!({ "scout": true, "extras": {
            "skills": ["zzskill"], "plugins": ["zzplug"], "mcp": ["zzserver"] } }),
    )
    .await
    .unwrap();
    let launches = run.launches_after(2).await;
    let args = argv(&launches[1]);
    assert!(!args.contains(&"--disable-slash-commands"));
    let dirs: Vec<&str> = args
        .windows(2)
        .filter(|pair| pair[0] == "--plugin-dir")
        .map(|pair| pair[1])
        .collect();
    assert!(
        dirs.iter().any(|dir| dir.ends_with("zzplug-install")),
        "{dirs:?}"
    );
    assert!(
        dirs.iter()
            .any(|dir| std::path::Path::new(dir).join("skills/zzskill").exists())
    );
    let config: Value = serde_json::from_str(
        &std::fs::read_to_string(after(&args, "--mcp-config").unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        config["mcpServers"]["zzserver"]["url"],
        "https://example.test"
    );
}

#[tokio::test]
async fn lc7_an_unknown_extra_fails_the_start_and_is_named() {
    let run = run();
    run.known_extras();
    let user = run.project.client().await;
    let parent = run.spawn(&user, json!({})).await.unwrap();
    run.idle(&user, &parent.id).await;
    let door = as_agent(&run.project, &parent).await;
    let before = rail_tree(&user).await.len();
    let err = run
        .spawn(
            &door,
            json!({ "extras": { "skills": ["zzskill", "ghost"], "mcp": ["nowhere"] } }),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("skill ghost") && err.message.contains("mcp server nowhere"));
    assert!(!err.message.contains("skill zzskill"));
    assert_eq!(rail_tree(&user).await.len(), before);
    assert_eq!(run.launches().len(), 1, "nothing started");
}

#[tokio::test]
async fn lc8_a_missing_extra_relaunches_with_resume_and_snapshot_off() {
    let run = run();
    run.known_extras();
    let user = run.project.client().await;
    let parent = run.spawn(&user, json!({})).await.unwrap();
    run.idle(&user, &parent.id).await;
    let door = as_agent(&run.project, &parent).await;
    let child = run.spawn(&door, json!({ "scout": true })).await.unwrap();
    run.idle(&user, &child.id).await;

    let err = door
        .request(
            "agent.extras_add",
            json!({ "id": child.id, "extras": { "plugins": ["ghost"] } }),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(run.launches().len(), 2, "the child keeps running");
    run.idle(&user, &child.id).await;

    door.request(
        "agent.extras_add",
        json!({ "id": child.id, "extras": { "plugins": ["zzplug"] } }),
    )
    .await
    .unwrap();
    let launches = run.launches_after(3).await;
    let args = argv(&launches[2]);
    assert!(after(&args, "--resume").is_some());
    assert_eq!(after(&args, "--system-prompt-snapshot"), Some("off"));
    assert_eq!(
        after(&args, "--tools"),
        Some("Read,Grep,Glob,Bash,ToolSearch,AskUserQuestion")
    );
    assert!(
        args.windows(2)
            .any(|pair| pair[0] == "--plugin-dir" && pair[1].ends_with("zzplug-install"))
    );
    // The changed Brief applied once: a later resume keeps the default.
    run.idle(&user, &child.id).await;
    user.request("agent.stop", json!({ "id": child.id }))
        .await
        .unwrap();
    user.request("agent.resume", json!({ "id": child.id }))
        .await
        .unwrap();
    let launches = run.launches_after(4).await;
    let args = argv(&launches[3]);
    assert!(after(&args, "--resume").is_some());
    assert!(!args.contains(&"--system-prompt-snapshot"));
    assert!(
        args.windows(2)
            .any(|pair| pair[0] == "--plugin-dir" && pair[1].ends_with("zzplug-install"))
    );
}
