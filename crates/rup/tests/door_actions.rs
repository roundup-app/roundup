//! A26, A39, A41, B37, F3, M9, M16, Q11: what a real Claude Door does through its tools.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use daemon::aimock;

use contracts::{EventData, Kind};
use daemon::{next, rail_tree};
use serde_json::{Value, json};
use std::time::Duration;

#[tokio::test]
async fn m9_a_door_asked_for_a_workstream_makes_one() {
    let project = daemon::start_real("m9_create_workstream", &[]);
    let mut events = project.subscribed().await;
    let door = events
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    events
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    // SessionStart also emits Idle; observe a completed turn before reusing its bundle.
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.status.kind == kind => {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    events.request("message.send", json!({"to": door, "kind": "note", "body": "E10 create another Workstream named x and start its Door"})).await.unwrap();
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_m9_create").await;
    let made: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(made.name, "x");
    model.tool_result("toolu_m9_start").await;
    let tree = rail_tree(&events).await;
    let node = tree.iter().find(|n| n.id == made.id).unwrap();
    assert!(node.parent.is_none());
    assert!(node.attempt.is_some(), "its Door is started");
    assert!(
        tree.iter().any(|n| n.id == door),
        "the Door that asked stays"
    );
    model.assert_matched();
}

#[tokio::test]
async fn q11_a_loaded_bundle_allows_a_subsequent_agent() {
    let project = daemon::start_real("m9_create_workstream", &[]);
    let mut events = project.subscribed().await;
    let door = events
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    events
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    // SessionStart also emits Idle; observe a completed turn before reusing its bundle.
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.status.kind == kind => {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    let agent = events
        .request(
            "agent.spawn",
            json!({
                "cwd": project.dir.path(), "prompt": "What is this Workstream for?"
            }),
        )
        .await
        .unwrap();
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status)
                if status.id == agent["id"].as_str().unwrap() && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    let model = project.model.as_ref().unwrap();
    model.assert_matched();
    assert_eq!(
        model
            .journal()
            .iter()
            .filter(|entry| entry["body"]["tools"].is_array())
            .count(),
        2,
        "both real Claude programs reached the model boundary"
    );
}

#[tokio::test]
async fn b37_real_claude_receives_d1_after_a_scripted_server_error() {
    let mut project = daemon::start_real("b37_server_error", &[]);
    let user = project.client().await;
    let mut events = project.subscribed().await;
    let door = user
        .request("rail.createWorkstream", json!({"name":"B37 supervisor"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == door && s.status.kind == Kind::Idle => Some(()),
        _ => None,
    })
    .await;
    let child = user
        .request(
            "agent.spawn",
            json!({"parent":door,"cwd":project.dir.path(),"name":"B37 child","prompt":"B37 prepare child"}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_b37_child_ready")
        .await;
    next(&mut events, |data| match data {
        EventData::AgentStatus(s)
            if s.id == child && s.status.kind == Kind::Working && s.status.label == "working" =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
    next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == child && s.status.kind == Kind::Idle => Some(()),
        _ => None,
    })
    .await;
    // The push window closes on the child's final idle Digest, not its earlier Rail status.
    next(&mut events, |data| match data {
        EventData::MessageDelivered(m)
            if m.to == door
                && m.body.contains("[digest] B37 child is idle")
                && m.body.contains("open todos: 1") =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
    // B50(c): the transcript records the Digest after the turn it starts may already be over, so the
    // door's idle edge can precede the Delivered event; the Rail poll below waits for idle instead.
    // Hold the child's Digests as well as its Decision note: otherwise needs-you can
    // start an intervening turn before tell_doors has queued the note.
    user.request("takeover.begin", json!({"agent":door}))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let nodes = rail_tree(&user).await;
            let node = nodes.iter().find(|n| n.id == door).unwrap();
            if node.status.as_ref().unwrap().kind == Kind::Idle {
                match user
                    .request(
                        "agent.prompt",
                        json!({"id":door,"text":"B37 scripted server error"}),
                    )
                    .await
                {
                    Ok(_) => break,
                    Err(e) if e.code == rpc::code::BUSY => {}
                    Err(e) => panic!("{e}"),
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let failed = next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == door && s.status.kind == Kind::Error => Some(s),
        _ => None,
    })
    .await;
    assert_eq!(failed.status.label, "server_error");
    let nodes = rail_tree(&user).await;
    let live = nodes.iter().find(|n| n.id == door).unwrap();
    assert!(live.terminal_id.is_some());
    assert_eq!(live.attempt.as_deref(), Some(failed.attempt.as_str()));
    let caller = project.client().await;
    let child_id = child.clone();
    let permission = tokio::spawn(async move {
        caller.request("agent.permission", json!({"id":child_id,"payload":{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo B37"}}})).await
    });
    let decision = next(&mut events, |data| match data {
        EventData::DecisionOpened(d) if d.agent == child => Some(d),
        _ => None,
    })
    .await;
    assert_eq!(decision.id, "d1");
    next(&mut events, |data| match data {
        EventData::MessageHeld(m) if m.to == door && m.body.starts_with("[decision d1]") => {
            Some(())
        }
        _ => None,
    })
    .await;
    user.request(
        "decision.answer",
        json!({"id":"d1","answer":"allow","proof":"0".repeat(64)}),
    )
    .await
    .unwrap();
    assert!(permission.await.unwrap().is_ok());
    user.request("takeover.end", json!({"agent":door}))
        .await
        .unwrap();
    next(&mut events, |data| match data {
        EventData::MessageDelivered(m) if m.to == door && m.body.starts_with("[decision d1]") => {
            Some(())
        }
        _ => None,
    })
    .await;
    // Polled, not awaited as an event: the transcript records the note after its turn may be over.
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let nodes = rail_tree(&user).await;
            let node = nodes.iter().find(|n| n.id == door).unwrap();
            if node.status.as_ref().unwrap().kind == Kind::Idle
                && node.status_revision.as_deref() != Some(failed.status_revision.as_str())
            {
                assert_eq!(node.attempt.as_deref(), Some(failed.attempt.as_str()));
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // This observer expects one failed model request; the shared success-only Drop check does not.
    let model = project.model.take().unwrap();
    let journal = model.journal();
    assert_eq!(
        journal
            .iter()
            .filter(|e| e["response"]["status"] == 500)
            .count(),
        1,
        "{journal:#?}"
    );
    assert!(
        journal.iter().all(|e| !e["response"]["fixture"].is_null()),
        "{journal:#?}"
    );
    let failed_request = journal
        .iter()
        .position(|e| e["response"]["status"] == 500)
        .unwrap();
    let identity = &journal[failed_request]["headers"]["x-claude-code-session-id"];
    assert!(identity.is_string());
    let following = journal
        .iter()
        .skip(failed_request + 1)
        .find(|e| {
            &e["headers"]["x-claude-code-session-id"] == identity && e["body"]["stream"] == true
        })
        .expect("the Door makes its next model request");
    assert_eq!(following["response"]["status"], 200);
    assert!(
        following["body"]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| { m["role"] == "user" && m["content"].to_string().contains("[decision d1]") }),
        "Door request sequence: {:#?}",
        journal
            .iter()
            .filter(|e| &e["headers"]["x-claude-code-session-id"] == identity)
            .map(
                |e| json!({"stream": e["body"]["stream"], "response": e["response"],
                "users": e["body"]["messages"].as_array().unwrap().iter()
                    .filter(|m| m["role"] == "user").collect::<Vec<_>>()})
            )
            .collect::<Vec<_>>()
    );
}

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
            parts: vec![agents::placement::AskPart {
                text: format!("earlier {at}"),
                destination: Destination::Routed {
                    workstream: "work".into(),
                },
            }],
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
            agents::placement::AskPart {
                text: "A39 fix café".into(),
                destination: Destination::Routed {
                    workstream: "work".into()
                }
            },
            agents::placement::AskPart {
                text: "/ship 原文".into(),
                destination: Destination::New {
                    title: "Ship".into()
                }
            },
            agents::placement::AskPart {
                text: "decide".into(),
                destination: Destination::Unclear {
                    question: "Which work?".into(),
                    candidates: vec!["work".into()]
                }
            },
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
async fn m16_real_claude_runs_tests_with_bash_without_a_run() {
    let project = daemon::start_real("m16_door_child_bash", &[]);
    std::fs::write(project.dir.path().join("test.sh"), "exit 0\n").unwrap();
    let client = project.subscribed().await;
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let spawned: contracts::agent::RailNode = serde_json::from_str(
        model.tool_result("toolu_m16_spawn").await["content"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let owned = |terminals: &Value, owner: &str| {
        terminals
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["owner"] == owner)
            .count()
    };
    let before = owned(
        &client.request("terminal.list", Value::Null).await.unwrap(),
        &spawned.id,
    );
    let decision = daemon::h21_decision(&client, &spawned.id, None).await;
    assert_eq!(decision["tool"], "Bash");
    client
        .request(
            "decision.answer",
            json!({"id": decision["id"], "answer": "allow", "proof": daemon::H21_PROOF}),
        )
        .await
        .unwrap();
    let result = model.tool_result("toolu_m16_bash").await;
    assert_eq!(result["is_error"], json!(null), "{result}");
    let after = owned(
        &client.request("terminal.list", Value::Null).await.unwrap(),
        &spawned.id,
    );
    assert_eq!(after, before, "the child's Bash started no Terminal");
    model.assert_matched();
}

#[tokio::test]
async fn f3_a_door_spawns_into_a_worktree_when_the_setting_is_on() {
    let project = daemon::start_real("f3_child_worktree", &[]);
    let path = project.dir.path();
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["config", "user.name", "roundup"],
        vec!["config", "user.email", "roundup@example.com"],
    ] {
        assert!(
            std::process::Command::new("git")
                .current_dir(path)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    std::fs::write(path.join("README"), "keep").unwrap();
    for args in [vec!["add", "README"], vec!["commit", "-qm", "base"]] {
        assert!(
            std::process::Command::new("git")
                .current_dir(path)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    let mut client = project.subscribed().await;
    client
        .request("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_f3_spawn").await;
    let spawned: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(spawned.parent.as_deref(), Some(door.as_str()));
    let worktree = spawned.worktree.expect("the child has a Worktree");
    assert_eq!(worktree.branch, format!("roundup/agent-{}", spawned.id));
    let listed = std::process::Command::new("git")
        .current_dir(path)
        .args(["worktree", "list"])
        .output()
        .unwrap();
    assert!(listed.status.success());
    let listed = String::from_utf8(listed.stdout).unwrap();
    assert!(listed.contains(&worktree.path), "{listed}");
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut client, |event| match event {
            EventData::AgentStatus(status)
                if status.id == spawned.id && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    model.assert_matched();
}

#[tokio::test]
async fn a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp() {
    let project = daemon::start_real("a26_three_deep", &[]);
    let mut client = project.subscribed().await;
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let first = model.tool_result("toolu_a26_child").await;
    let a: contracts::agent::RailNode =
        serde_json::from_str(first["content"].as_str().unwrap()).unwrap();
    let second = model.tool_result("toolu_a26_grandchild").await;
    let b: contracts::agent::RailNode =
        serde_json::from_str(second["content"].as_str().unwrap()).unwrap();
    assert_eq!(a.parent.as_deref(), Some(door.as_str()));
    assert!(a.worktree.is_none());
    assert_eq!(b.parent.as_deref(), Some(a.id.as_str()));
    let tree = rail_tree(&client).await;
    assert!(tree.iter().all(|n| n.parent.as_deref() != Some("999")));
    assert_eq!(
        tree.iter()
            .find(|n| n.id == a.id)
            .unwrap()
            .parent
            .as_deref(),
        Some(door.as_str())
    );
    let ids: Vec<_> = tree.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids, [door.as_str(), a.id.as_str(), b.id.as_str()]);
    // Wait through all three real turns so late unmatched requests cannot escape the observer.
    let mut working = std::collections::BTreeSet::new();
    let mut idle = std::collections::BTreeSet::new();
    while idle.len() < 3 {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if [&door, &a.id, &b.id].contains(&&status.id) => {
                Some(status)
            }
            _ => None,
        })
        .await;
        if status.status.kind == Kind::Working {
            working.insert(status.id.clone());
        }
        if status.status.kind == Kind::Idle && working.contains(&status.id) {
            idle.insert(status.id);
        }
    }
    model.assert_matched();
}

#[tokio::test]
async fn a41_a_leading_slash_runs_the_skill() {
    let project = daemon::start_real("a41_skill", &[]);
    std::fs::write(
        project.dir.path().join("CLAUDE.md"),
        "A41_PROJECT_INSTRUCTIONS",
    )
    .unwrap();
    let skill = project.dir.path().join(".claude/skills/a41-proof");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(skill.join("SKILL.md"), "---\nname: a41-proof\ndescription: Prove Ask delivery preserves skill invocation.\n---\nA41_SKILL_MARKER. Reply with Skill received.\n").unwrap();
    let mut client = project.client().await;
    client
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let node = client.request("rail.createWorkstream", json!({"name":"Skill","order":{"kind":"work","title":"Skill","ask":"A41 initial","limits":[]}})).await.unwrap();
    let id = node["id"].as_str().unwrap();
    client
        .request("rail.startDoor", json!({"id":id}))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(15), next(&mut client, |event| matches!(event, EventData::AgentStatus(status) if status.id == id && status.status.kind == Kind::Idle).then_some(()))).await.unwrap_or_else(|_| panic!("{:?}",project.model.as_ref().unwrap().journal()));
    let ask = client
        .request("ask.send", json!({"text":"@Skill /a41-proof x"}))
        .await
        .unwrap();
    next(&mut client, |event| matches!(event, EventData::AskChanged { ask: changed } if changed.id == ask["id"].as_str().unwrap() && changed.parts[0].state == contracts::ask::State::Typed).then_some(())).await;
    let model = project.model.as_ref().unwrap();
    let mut journal = Vec::new();
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            journal = model.journal();
            if journal.iter().any(|entry| {
                entry["body"]["messages"]
                    .to_string()
                    .contains("A41_SKILL_MARKER")
            }) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("skill request missing from model journal: {journal:#?}"));
    assert!(
        journal.iter().any(|entry| entry["body"]
            .to_string()
            .contains("A41_PROJECT_INSTRUCTIONS")),
        "Project instructions remain available"
    );
    assert!(
        journal.iter().all(|entry| entry["response"]["status"]
            .as_i64()
            .is_some_and(|status| status < 400)),
        "{journal:#?}"
    );
    assert!(
        journal.iter().all(|entry| !entry["body"]["model"]
            .as_str()
            .is_some_and(|model| model.starts_with("claude-haiku"))),
        "named routing made a Placement call"
    );
}
