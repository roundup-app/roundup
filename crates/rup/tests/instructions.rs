//! Instruction identity prerequisite only; result acceptance and continuation are not exercised.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use serde_json::{Value, json};

async fn status(client: &mut rpc::Client, id: &str, kind: contracts::Kind) {
    daemon::next(client, |event| match event {
        contracts::EventData::AgentStatus(s) if s.id == id && s.status.kind == kind => Some(()),
        _ => None,
    })
    .await;
}

#[tokio::test]
async fn u3078c_order_replacements_retain_exact_revisions_across_reopen() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let i1 = json!({"kind":"work", "ask":"Fix login", "done":"Login passes", "limits":["No deployment"]});
    let node = client
        .request(
            "rail.createWorkstream",
            json!({"name":"Login", "parent":null,"order":i1}),
        )
        .await
        .unwrap();
    let id = node["id"].clone();
    let mut expected = vec![i1.clone()];
    for changed in [
        json!({"kind":"work", "ask":"Fix logout", "done":"Login passes", "limits":["No deployment"]}),
        json!({"kind":"work", "ask":"Fix logout", "done":"Logout passes", "limits":["No deployment"]}),
        json!({"kind":"work", "ask":"Fix logout", "done":"Logout passes", "limits":["No schema changes"]}),
        i1.clone(),
    ] {
        client
            .request("agent.setOrder", json!({"id":id,"order":changed}))
            .await
            .unwrap();
        expected.push(changed);
    }
    let before = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(
        before["revisions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["order"].clone())
            .collect::<Vec<_>>(),
        expected
    );
    let revisions: std::collections::HashSet<_> = before["revisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["revision"].as_str().unwrap())
        .collect();
    assert_eq!(revisions.len(), 5);
    // Captured Order retains its existing value comparison, including change-away-and-back.
    client
        .request(
            "agent.setOrder",
            json!({"id":id,"order":i1,"captured":{"order":i1}}),
        )
        .await
        .unwrap();
    let conflict = client
        .request(
            "agent.setOrder",
            json!({"id":id,"order":i1,"captured":{"order":null}}),
        )
        .await
        .unwrap_err();
    assert_eq!(conflict.code, rpc::code::CONFLICT);
    let saved = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(saved["revisions"].as_array().unwrap().len(), 6);
    assert!(saved["deliveries"].as_array().unwrap().is_empty());
    drop(client);
    project.restart(&[]);
    let client = project.client().await;
    assert_eq!(
        client
            .request("agent.instructions", json!({"id":id}))
            .await
            .unwrap(),
        saved
    );
    // Exercise the public CLI registration, as well as Daemon dispatch.
    let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args([
            "agent",
            "instructions",
            id.as_str().unwrap(),
            "--agent",
            id.as_str().unwrap(),
            "--json",
        ])
        .env("RUPD_SOCKET", project.socket())
        .env_remove("ROUNDUP_AGENT")
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        saved
    );
    let terminals: Value = client.request("terminal.list", Value::Null).await.unwrap();
    assert!(terminals.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn u3078a_g_delivered_instruction_identity_survives_moves_removal_and_reopen() {
    let logs = tempfile::tempdir().unwrap();
    let launches = logs.path().join("launches");
    let prompts = logs.path().join("prompts");
    let fake = [
        ("FAKE_CLAUDE_LAUNCH_LOG", launches.to_str().unwrap()),
        ("FAKE_CLAUDE_PROMPT_LOG", prompts.to_str().unwrap()),
    ];
    let mut project = daemon::start(&fake);
    let mut client = project.subscribed().await;
    let mut homes = Vec::new();
    for name in ["Original", "Moved"] {
        homes.push(
            client
                .request("rail.createWorkstream", json!({"name":name,"parent":null}))
                .await
                .unwrap()["id"]
                .clone(),
        );
    }
    let order = json!({"kind":"work","ask":"Fix login precisely", "done":"Both login paths pass", "limits":["Keep schema","No deployment"]});
    let node = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"name":"Login","parent":homes[0],"order":order}),
        )
        .await
        .unwrap();
    let id = node["id"].as_str().unwrap().to_owned();
    status(&mut client, &id, contracts::Kind::Working).await;
    status(&mut client, &id, contracts::Kind::Idle).await;
    let initial = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(initial["project"], project.dir.path().to_str().unwrap());
    assert_eq!(initial["revisions"][0]["order"], order);
    assert_eq!(initial["revisions"][0]["agent"], id);
    assert_eq!(initial["revisions"][0]["workstream"], homes[0]);
    assert_eq!(initial["deliveries"][0]["revision"], initial["current"]);
    assert_eq!(initial["deliveries"][0]["attempt"], node["attempt"]);
    assert_eq!(initial["deliveries"][0]["state"], "submitted");
    assert_eq!(
        initial["deliveries"][0]["text"],
        "Fix login precisely\n\nDone when: Both login paths pass\n\nLimits:\n- Keep schema\n- No deployment"
    );
    // Each live replacement is delivered against its own revision and the same Attempt.
    let mut versions: Vec<Value> = Vec::new();
    for (field, value) in [
        ("ask", json!("Fix both login paths")),
        ("done", json!("Fresh and saved login pass")),
        ("limits", json!(["Keep schema", "No network"])),
    ] {
        let mut changed = versions.last().cloned().unwrap_or_else(|| order.clone());
        changed[field] = value;
        versions.push(changed);
    }
    versions.push(order.clone());
    for changed in &versions {
        client
            .request("agent.setOrder", json!({"id":id,"order":changed}))
            .await
            .unwrap();
        status(&mut client, &id, contracts::Kind::Working).await;
        status(&mut client, &id, contracts::Kind::Idle).await;
    }
    let replaced = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(replaced["revisions"].as_array().unwrap().len(), 5);
    assert_ne!(replaced["current"], initial["current"]);
    for (revision, delivery) in replaced["revisions"]
        .as_array()
        .unwrap()
        .iter()
        .zip(replaced["deliveries"].as_array().unwrap())
    {
        assert_eq!(delivery["revision"], revision["revision"]);
        assert_eq!(delivery["attempt"], node["attempt"]);
        assert_eq!(delivery["state"], "submitted");
    }
    // Crash with the original Agent retained. Passive recovery must not relaunch it.
    let before_launches = std::fs::read(&launches).unwrap();
    let before_prompts = std::fs::read(&prompts).unwrap();
    drop(client);
    project.restart(&fake);
    let mut client = project.subscribed().await;
    assert_eq!(
        client
            .request("agent.instructions", json!({"id":id}))
            .await
            .unwrap(),
        replaced
    );
    assert!(
        client
            .request("terminal.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(std::fs::read(&launches).unwrap(), before_launches);
    assert_eq!(std::fs::read(&prompts).unwrap(), before_prompts);
    let resumed = client
        .request("agent.resume", json!({"id":id}))
        .await
        .unwrap();
    status(&mut client, &id, contracts::Kind::Idle).await;
    assert_ne!(resumed["attempt"], node["attempt"]);
    assert_eq!(std::fs::read(&prompts).unwrap(), before_prompts);
    client
        .request("rail.move", json!({"id":id,"parent":homes[1],"index":0}))
        .await
        .unwrap();
    let body = "Check only the retained login output\nDone: both paths pass\nLimit: no deploy";
    let message = client
        .request("message.send", json!({"to":id,"kind":"note","body":body}))
        .await
        .unwrap();
    daemon::next(&mut client, |event| match event {
        contracts::EventData::MessageDelivered(m) if json!(m.id) == message["id"] => Some(()),
        _ => None,
    })
    .await;
    status(&mut client, &id, contracts::Kind::Idle).await;
    let history = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(history["home"], homes[1]);
    assert_eq!(history["revisions"][0], initial["revisions"][0]);
    assert_eq!(history["revisions"][5]["message"], message["id"]);
    assert_eq!(history["revisions"][5]["text"], body);
    assert_eq!(history["deliveries"][5]["attempt"], resumed["attempt"]);
    assert_eq!(
        history["deliveries"][5]["revision"],
        history["revisions"][5]["revision"]
    );
    assert_eq!(history["deliveries"][5]["state"], "submitted");
    // Non-user Messages take the existing Adapter inbox path and keep the same identity facts.
    let external = project.client().await;
    external
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"ext","id":"reviewer","parent":null}}),
        )
        .await
        .unwrap();
    let inbox_body = "Review the original login revision; do not deploy";
    let inbox = external
        .request(
            "message.send",
            json!({"to":id,"kind":"note","body":inbox_body}),
        )
        .await
        .unwrap();
    daemon::next(&mut client, |event| match event {
        contracts::EventData::MessageDelivered(m) if json!(m.id) == inbox["id"] => Some(()),
        _ => None,
    })
    .await;
    let history = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(history["revisions"][6]["message"], inbox["id"]);
    assert_eq!(history["revisions"][6]["text"], inbox_body);
    assert_eq!(
        history["deliveries"][6]["revision"],
        history["revisions"][6]["revision"]
    );
    assert_eq!(history["deliveries"][6]["attempt"], resumed["attempt"]);
    assert_eq!(history["deliveries"][6]["state"], "submitted");
    client
        .request("rail.remove", json!({"id":id}))
        .await
        .unwrap();
    let mut history = history;
    history["current"] = Value::Null;
    let replacement = client
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"name":"Login","parent":homes[1]}),
        )
        .await
        .unwrap();
    assert_ne!(replacement["id"], id);
    assert_eq!(replacement["name"], node["name"]);
    assert_eq!(
        client
            .request("agent.instructions", json!({"id":id}))
            .await
            .unwrap(),
        history
    );
    let refused = client
        .request("agent.setOrder", json!({"id":id,"order":order}))
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::NOT_FOUND);
    client
        .request("agent.stop", json!({"id":replacement["id"]}))
        .await
        .unwrap();
    let launch_bytes = std::fs::read(&launches).unwrap();
    let prompt_bytes = std::fs::read(&prompts).unwrap();
    drop(client);
    project.restart(&fake);
    let client = project.client().await;
    assert_eq!(
        client
            .request("agent.instructions", json!({"id":id}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(std::fs::read(launches).unwrap(), launch_bytes);
    assert_eq!(std::fs::read(prompts).unwrap(), prompt_bytes);
    assert!(
        client
            .request("terminal.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn u3078g_instruction_reads_use_the_authenticated_agents_reach() {
    let root = tempfile::tempdir().unwrap();
    let gate = root.path().join("registered");
    let report = root.path().join("report");
    let launches = root.path().join("launches");
    let wait = "import os,sys,time;\nwhile not os.path.exists(sys.argv[1]): time.sleep(.01)\nos.execv(sys.argv[2],sys.argv[2:])";
    let calls = json!([
        [
            "python3",
            "-c",
            wait,
            gate,
            env!("CARGO_BIN_EXE_rup"),
            "agent",
            "instructions",
            "1",
            "--agent",
            "1",
            "--json"
        ],
        [
            env!("CARGO_BIN_EXE_rup"),
            "agent",
            "instructions",
            "2",
            "--agent",
            "2",
            "--json"
        ]
    ])
    .to_string();
    let project = daemon::start(&[
        ("FAKE_CLAUDE_LAUNCH_LOG", launches.to_str().unwrap()),
        ("FAKE_CLAUDE_RUN", &calls),
        ("FAKE_CLAUDE_RUN_REPORT", report.to_str().unwrap()),
    ]);
    let mut client = project.subscribed().await;
    let foreign = client.request("rail.createWorkstream",json!({"name":"Private","order":{"kind":"work","ask":"Private instruction","limits":[]}})).await.unwrap();
    assert_eq!(foreign["id"], "1");
    let agent = project.spawn_agent(&client).await;
    assert_eq!(agent.id, "2");
    std::fs::write(gate, []).unwrap();
    status(&mut client, &agent.id, contracts::Kind::Idle).await;
    let report: Value = serde_json::from_slice(&std::fs::read(report).unwrap()).unwrap();
    assert_eq!(report[0]["code"], 1, "{report}");
    assert!(
        report[0]["stderr"].as_str().unwrap().contains("Reach"),
        "{report}"
    );
    assert_eq!(report[1]["code"], 0, "{report}");
    let own: Value = serde_json::from_str(report[1]["stdout"].as_str().unwrap()).unwrap();
    assert!(own["revisions"].as_array().unwrap().is_empty());
}
