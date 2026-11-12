use super::*;

#[tokio::test]
async fn a39_the_placement_call_is_one_slim_request() {
    // A15: inject nested-run markers without mutating the shared runner environment.
    if std::env::var_os("ROUNDUP_A39_OBSERVER_CHILD").is_none() {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "a39_the_placement_call_is_one_slim_request",
                "--nocapture",
            ])
            .env("ROUNDUP_A39_OBSERVER_CHILD", "1");
        for name in agents::claude_code::MARKERS {
            command.env(name, "must-be-stripped");
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    use agents::{
        claude_code::Launcher,
        placement::{Destination, Request, place},
    };
    use std::os::unix::fs::PermissionsExt;
    let model = aimock::Model::start("a39_placement");
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    aimock::configure(&config, dir.path());
    let wrapper = dir.path().join("placement");
    let log = dir.path().join("launch.json");
    let script = format!(
        r#"#!/usr/bin/env python3
import os, sys, json
with open({log:?}, 'w') as f:
    json.dump({{'argv':sys.argv[1:], 'files':os.listdir('.'), 'cwd':os.getcwd(), 'pid':os.getpid(), 'markers':[n for n in {markers:?} if n in os.environ]}}, f)
os.environ['CLAUDE_CONFIG_DIR'] = {config:?}
os.environ['ANTHROPIC_BASE_URL'] = {url:?}
os.environ['ANTHROPIC_API_KEY'] = {key:?}
os.environ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1'
os.environ['DISABLE_AUTOUPDATER'] = '1'
os.environ['CLAUDE_CODE_MAX_RETRIES'] = '0'
os.execv({binary:?}, [{binary:?}, *sys.argv[1:]])
"#,
        log = log.to_str().unwrap(),
        config = config.to_str().unwrap(),
        url = model.url,
        key = aimock::KEY,
        binary = aimock::package_bin("claude").to_str().unwrap(),
        markers = agents::claude_code::MARKERS
    );
    std::fs::write(&wrapper, script).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let launcher = Launcher::from_vars(
        |name| match name {
            "ROUNDUP_CLAUDE_BIN" => Some(wrapper.as_os_str().to_owned()),
            "HOME" => Some(dir.path().as_os_str().to_owned()),
            _ => None,
        },
        &std::env::current_exe().unwrap(),
    )
    .unwrap();
    let rail = serde_json::from_value(json!({"id":"work", "kind":"workstream", "name":"Repair", "parent":null, "order":0, "status":null, "attempt":null, "status_revision":null, "terminal_id":null, "worktree":null, "can_resume":false, "channel":null, "work":{"kind":"work", "title":"Repair café", "ask":"Repair the café", "limits":[]}, "stray":[], "model":null, "effort":null})).unwrap();
    let earlier = (0..7)
        .map(|at| agents::placement::EarlierAsk {
            at,
            parts: vec![agents::placement::AskPart::new(
                format!("earlier {at}"),
                Destination::Routed {
                    workstream: "work".into(),
                },
            )],
        })
        .collect();
    let request = Request::new(
        "A39 fix café; /ship 原文; decide".into(),
        earlier,
        vec![rail],
    );
    let parts = place(&launcher.placement(), "ask-a39", &request, |id, cause| {
        panic!("{id}: {cause}")
    })
    .await;
    assert_eq!(
        parts,
        vec![
            agents::placement::AskPart::new(
                "A39 fix café",
                Destination::Routed {
                    workstream: "work".into()
                }
            ),
            agents::placement::AskPart::new(
                "/ship 原文",
                Destination::New {
                    title: "Ship".into()
                }
            ),
            agents::placement::AskPart::new(
                "decide",
                Destination::Unclear {
                    question: "Which work?".into(),
                    candidates: vec!["work".into()]
                }
            ),
        ]
    );
    model.assert_matched();
    let journal = model.journal();
    assert_eq!(journal.len(), 1, "{journal:#?}");
    let body = &journal[0]["body"];
    assert!(
        body["model"].as_str().unwrap().starts_with("claude-haiku"),
        "{body}"
    );
    assert!(
        body.to_string()
            .contains("You place the user's Ask into Workstreams."),
        "{body}"
    );
    let user = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "user")
        .map(|message| message["content"].to_string())
        .collect::<String>();
    for fact in ["earlier 6", "earlier 2", "Repair the café", "/ship 原文"] {
        assert!(user.contains(fact), "missing {fact}: {body}");
    }
    for omitted in ["earlier 0", "earlier 1"] {
        assert!(!user.contains(omitted), "{body}");
    }
    let tools = body["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1, "{tools:?}");
    assert_eq!(tools[0]["function"]["name"], "StructuredOutput");
    let launch: Value = serde_json::from_slice(&std::fs::read(log).unwrap()).unwrap();
    assert!(
        !std::process::Command::new("kill")
            .args(["-0", &launch["pid"].to_string()])
            .output()
            .unwrap()
            .status
            .success(),
        "Placement process remains running or unreaped"
    );
    assert_eq!(launch["files"], json!([]));
    assert_eq!(launch["markers"], json!([]));
    assert!(!std::path::Path::new(launch["cwd"].as_str().unwrap()).exists());
    let argv = launch["argv"].as_array().unwrap();
    assert_eq!(argv.len(), 18, "{argv:?}");
    let system = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "system")
        .map(|message| message["content"].to_string())
        .collect::<String>();
    assert!(system.contains(argv[17].as_str().unwrap()), "{body}");
    assert_eq!(
        &argv[..10],
        json!([
            "-p",
            "--model",
            "haiku",
            "--effort",
            "low",
            "--no-session-persistence",
            "--output-format",
            "json",
            "--json-schema",
            argv[9]
        ])
        .as_array()
        .unwrap()
    );
    assert_eq!(
        &argv[10..18],
        json!([
            "--tools",
            "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--settings",
            argv[15],
            "--system-prompt",
            argv[17]
        ])
        .as_array()
        .unwrap()
    );
}

#[tokio::test]
async fn u5991e_a_real_removal_hides_the_row_and_the_program_exits() {
    let project = daemon::start_real("u5991e_removal", &[]);
    let mut client = project.subscribed().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": "U5991E"}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let terminal = agent
        .terminal_id
        .clone()
        .expect("a running Agent has a Terminal");
    for kind in [Kind::Working, Kind::Idle] {
        project
            .next(&mut client, |event| match event {
                EventData::AgentStatus(status)
                    if status.id == agent.id && status.status.kind == kind =>
                {
                    Some(())
                }
                _ => None,
            })
            .await;
    }
    assert!(
        project
            .rail_tree(&client)
            .await
            .iter()
            .any(|node| node.id == agent.id),
        "the Agent is on the Rail before removal"
    );
    let began = std::time::Instant::now();
    client
        .request("rail.remove", json!({"id": agent.id}))
        .await
        .unwrap();
    assert!(
        project
            .rail_tree(&client)
            .await
            .iter()
            .all(|node| node.id != agent.id),
        "the removed Agent's row is gone from rail.tree"
    );
    tokio::time::timeout(
        U5991E_EXIT_BOUND.saturating_sub(began.elapsed()),
        project.next(&mut client, |event| match event {
            EventData::TerminalExited(exited) if exited.id == terminal => Some(()),
            _ => None,
        }),
    )
    .await
    .expect("the program exits within CLEAN_EXIT_BOUND plus KILL_WAIT_BOUND");
}
