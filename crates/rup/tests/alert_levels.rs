//! U5501: authoritative levels through the real Daemon's public calls.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use rpc::Client;
use serde_json::{Value, json};

async fn workstream(c: &Client, name: &str) -> String {
    c.request("rail.createWorkstream", json!({"name":name}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .into()
}

async fn set(
    p: &daemon::Project,
    c: &Client,
    id: &str,
    level: &str,
) -> Result<Value, rpc::RpcError> {
    c.request(
        "rail.setAlertLevel",
        json!({"project":p.dir.path(), "id":id, "level":level}),
    )
    .await
}

async fn levels(c: &Client) -> Vec<(String, Value)> {
    c.request("rail.tree", Value::Null)
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|n| (n["id"].as_str().unwrap().into(), n["alert_level"].clone()))
        .collect()
}

#[tokio::test]
async fn u5501_levels_survive_reopen_restart_and_home_move() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Home").await;
    let a = p.spawn_agent(&c).await;
    assert_eq!(levels(&c).await.last().unwrap().1, "default");
    c.request("agent.stop", json!({"id":a.id})).await.unwrap();
    let stopped = daemon::rail_tree(&c).await;
    let stopped = stopped.iter().find(|n| n.id == a.id).unwrap();
    set(&p, &c, &a.id, "quiet").await.unwrap();
    let changed = daemon::rail_tree(&c).await;
    let changed = changed.iter().find(|n| n.id == a.id).unwrap();
    assert_eq!(
        (&changed.attempt, &changed.terminal_id),
        (&stopped.attempt, &stopped.terminal_id),
        "a level write cannot resume a stopped Agent"
    );
    c.request("rail.move", json!({"id":a.id,"parent":home,"index":0}))
        .await
        .unwrap();
    // A fresh connection observes the acknowledged value, independent of the caller's lifetime.
    assert_eq!(levels(&p.client().await).await.last().unwrap().1, "quiet");
    p.close().await;
    p.restart(&[]);
    let c = p.client().await;
    let tree = daemon::rail_tree(&c).await;
    let agent = tree.iter().find(|n| n.id == a.id).unwrap();
    assert_eq!(agent.parent.as_deref(), Some(home.as_str()));
    assert_eq!(serde_json::to_value(agent).unwrap()["alert_level"], "quiet");
    assert!(
        tree.iter().all(|n| n.terminal_id.is_none()),
        "choosing/restoring levels starts no Agent"
    );
    // An acknowledged choice also survives an abrupt Daemon restart.
    set(&p, &c, &a.id, "all").await.unwrap();
    p.restart(&[]);
    let c = p.client().await;
    let restarted = daemon::rail_tree(&c).await;
    let agent = restarted.iter().find(|n| n.id == a.id).unwrap();
    assert_eq!(serde_json::to_value(agent).unwrap()["alert_level"], "all");
    assert!(agent.terminal_id.is_none());
}

async fn spawn(p: &daemon::Project, c: &Client, parent: &str) -> String {
    c.request("agent.spawn", json!({"cwd":p.dir.path(),"parent":parent}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .into()
}

#[tokio::test]
async fn u5501_workstream_bulk_change_includes_its_door_and_nested_agents() {
    let p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Home").await;
    let outside = workstream(&c, "Outside").await;
    c.request("rail.startDoor", json!({"id":home}))
        .await
        .unwrap();
    let a = spawn(&p, &c, &home).await;
    let agent = p.client().await;
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":a,"parent":home}}),
        )
        .await
        .unwrap();
    let b = spawn(&p, &agent, &a).await;
    let other = spawn(&p, &c, &outside).await;
    let before = daemon::rail_tree(&c).await;
    set(&p, &c, &home, "all").await.unwrap();
    for (id, level) in levels(&c).await {
        assert_eq!(
            level,
            if [&home, &a, &b].contains(&&id) {
                "all"
            } else {
                "default"
            },
            "{id}"
        );
    }
    let after = daemon::rail_tree(&c).await;
    assert_eq!(
        before
            .iter()
            .map(|n| (&n.id, &n.attempt, &n.terminal_id))
            .collect::<Vec<_>>(),
        after
            .iter()
            .map(|n| (&n.id, &n.attempt, &n.terminal_id))
            .collect::<Vec<_>>()
    );
    assert!(after.iter().any(|n| n.id == other));
}

#[tokio::test]
async fn u5501_bulk_choice_is_not_inherited_and_allows_an_agent_override() {
    let p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Home").await;
    c.request("rail.startDoor", json!({"id":home}))
        .await
        .unwrap();
    let a = spawn(&p, &c, &home).await;
    let moved = p.spawn_agent(&c).await;
    set(&p, &c, &home, "quiet").await.unwrap();
    let later = spawn(&p, &c, &home).await;
    c.request("rail.move", json!({"id":moved.id,"parent":home,"index":0}))
        .await
        .unwrap();
    set(&p, &c, &a, "all").await.unwrap();
    for (id, level) in levels(&c).await {
        assert_eq!(
            level,
            if id == a {
                "all"
            } else if id == later || id == moved.id {
                "default"
            } else {
                "quiet"
            },
            "{id}"
        );
    }
}

#[tokio::test]
async fn u5501_bad_level_or_project_changes_nothing() {
    let p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Home").await;
    let a = spawn(&p, &c, &home).await;
    set(&p, &c, &a, "quiet").await.unwrap();
    let before = levels(&c).await;
    let foreign = tempfile::tempdir().unwrap();
    for (project, level, id) in [
        (p.dir.path(), "invalid", home.as_str()),
        (foreign.path(), "all", home.as_str()),
        (p.dir.path(), "all", "999999"),
    ] {
        assert!(
            c.request(
                "rail.setAlertLevel",
                json!({"project":project,"id":id,"level":level})
            )
            .await
            .is_err()
        );
        assert_eq!(levels(&c).await, before);
    }
}

#[tokio::test]
async fn u5501_non_user_calls_cannot_change_any_level() {
    use contracts::{Actor, ActorKind, IdentifyParams};
    let p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Home").await;
    let a = spawn(&p, &c, &home).await;
    let other = spawn(&p, &c, &home).await;
    for id in [&a, &other] {
        c.request("agent.stop", json!({"id":id})).await.unwrap();
    }
    let before = levels(&c).await;
    let head = c.request("events.subscribe", Value::Null).await.unwrap();
    for kind in [ActorKind::Agent, ActorKind::Ext] {
        let non_user = p.client().await;
        non_user
            .request(
                "daemon.identify",
                IdentifyParams {
                    actor: Actor {
                        kind,
                        id: a.clone(),
                        parent: None,
                    },
                },
            )
            .await
            .unwrap();
        for id in [&a, &other, &home] {
            let result = non_user.request("rail.setAlertLevel", json!({"project":p.dir.path(),"id":id,"level":"all","actor":Actor::user(),"user":true})).await.unwrap_err();
            assert_eq!(result.code, rpc::code::FORBIDDEN);
        }
    }
    assert_eq!(levels(&c).await, before);
    let end = c.request("events.subscribe", Value::Null).await.unwrap();
    assert_eq!(end, head, "refused changes emit no success events");
}

#[tokio::test]
async fn u5501_a_known_agent_peer_cannot_claim_user_authority() {
    let scratch = tempfile::tempdir().unwrap();
    let report = scratch.path().join("report.json");
    // Run inside the fake vendor's process tree: the socket peer is authenticated as its Agent.
    let script = r#"import socket, json, os
s=socket.socket(socket.AF_UNIX); s.connect(os.environ['RUPD_SOCKET']); f=s.makefile('rw')
def call(i,m,p):
 f.write(json.dumps({'jsonrpc':'2.0','id':i,'method':m,'params':p})+'\n'); f.flush(); return json.loads(f.readline())
call(1,'daemon.identify',{'actor':{'kind':'user','id':'user','parent':None}})
print(json.dumps(call(2,'rail.setAlertLevel',{'project':os.getcwd(),'id':os.environ['ROUNDUP_AGENT_ID'],'level':'all','actor':{'kind':'user','id':'user','parent':None}})))
"#;
    let commands = json!([["python3", "-c", script]]).to_string();
    let p = daemon::start(&[
        ("FAKE_CLAUDE_RUN", &commands),
        ("FAKE_CLAUDE_RUN_REPORT", report.to_str().unwrap()),
    ]);
    let c = p.client().await;
    let a = p.spawn_agent(&c).await;
    let output = daemon::h21_poll("the Agent peer's response", async || {
        std::fs::read_to_string(&report)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    })
    .await;
    assert_eq!(output[0]["code"], 0, "{output}");
    let reply: Value = serde_json::from_str(output[0]["stdout"].as_str().unwrap().trim()).unwrap();
    assert_eq!(reply["error"]["code"], rpc::code::FORBIDDEN);
    assert_eq!(levels(&c).await, [(a.id, json!("default"))]);
}

#[tokio::test]
async fn u5501_an_empty_workstream_cannot_set_a_future_doors_level() {
    let p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Empty").await;
    set(&p, &c, &home, "quiet").await.unwrap();
    c.request("rail.startDoor", json!({"id":home}))
        .await
        .unwrap();
    assert_eq!(levels(&c).await, [(home, json!("default"))]);
}
