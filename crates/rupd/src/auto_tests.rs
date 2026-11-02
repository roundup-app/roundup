// T4902 retires T29 setup; A3308 still proves ordered once-only Auto delivery.
use super::*;
use crate::tests::{ask, daemon_in, daemon_with_launcher};

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let response = ask(
        daemon,
        &json!({"id":1,"method":method,"params":params}).to_string(),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

#[tokio::test]
async fn a3308_set_auto_persists_and_emits_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let mut events = daemon.bus.subscribe();
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":node["id"],"auto":true}),
    )
    .await;
    let mut updates = 0;
    while let Ok(event) = events.try_recv() {
        if serde_json::to_value(event).unwrap()["name"] == "workstream.updated" {
            updates += 1;
        }
    }
    assert_eq!(updates, 1);
    drop(daemon);
    let reopened = daemon_in(dir.path());
    let rail = call(&reopened, "rail.tree", Value::Null).await;
    assert_eq!(rail[0]["auto"], true);
}

fn running_daemon(project: &std::path::Path) -> Daemon {
    use std::os::unix::fs::PermissionsExt;
    let data = project.join("data");
    let fake = project.join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.join("rup");
    std::fs::write(&rup, "").unwrap();
    daemon_with_launcher(
        project,
        &data,
        agents::claude_code::Launcher::new(
            fake.to_str().unwrap(),
            project.join("claude.json"),
            rup,
            None,
        ),
    )
}

async fn door(daemon: &Daemon) -> String {
    let node = call(daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    call(daemon, "rail.startDoor", json!({"id":node["id"]})).await;
    node["id"].as_str().unwrap().into()
}

async fn todo(daemon: &Daemon, home: &str, title: &str, owner: Value) -> Value {
    let todo = call(daemon, "todo.create", json!({"title":title,"owner":owner})).await;
    call(daemon, "todo.move", json!({"id":todo["id"],"home":home})).await
}

async fn notices(daemon: &Daemon, home: &str) -> Vec<Value> {
    call(daemon, "message.list", json!({"to":home}))
        .await
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| {
            m["from"] == json!(Actor::daemon()) && m["body"].as_str().unwrap().starts_with("[auto ")
        })
        .cloned()
        .collect()
}

#[tokio::test]
async fn a3308_auto_on_sends_each_unassigned_todo_to_the_door_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let first = todo(&daemon, &home, "First task", Value::Null).await;
    let second = todo(&daemon, &home, "Second task", Value::Null).await;
    call(
        &daemon,
        "todo.reorder",
        json!({"id":second["id"],"before":first["id"]}),
    )
    .await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let sent = notices(&daemon, &home).await;
    assert_eq!(sent.len(), 2);
    for (message, todo) in sent.iter().zip([&second, &first]) {
        let body = message["body"].as_str().unwrap();
        assert!(body.contains(todo["title"].as_str().unwrap()), "{body}");
        assert!(body.contains(&format!("Todo #{}", todo["id"])), "{body}");
        assert!(!body.to_lowercase().contains("estimate"), "{body}");
        assert!(!body.contains(" min"), "{body}");
    }
    call(
        &daemon,
        "todo.update",
        json!({"id":first["id"],"title":"Retitled"}),
    )
    .await;
    assert_eq!(notices(&daemon, &home).await.len(), 2);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_setting_the_same_value_emits_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let mut events = daemon.bus.subscribe();
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":node["id"],"auto":false}),
    )
    .await;
    assert!(events.try_recv().is_err());
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await[0]["auto"],
        false
    );
}

#[tokio::test]
async fn a3308_an_unknown_workstream_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let result = ask(
        &daemon,
        r#"{"id":1,"method":"workstream.setAuto","params":{"id":"404","auto":true}}"#,
    )
    .await;
    assert_eq!(result["error"]["code"], code::NOT_FOUND);
}

#[tokio::test]
async fn a3308_me_and_agent_owned_todos_never_move() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let mine = todo(&daemon, &home, "Mine", json!(Actor::user())).await;
    let child = subagent(&daemon, &home, dir.path()).await;
    let theirs = todo(
        &daemon,
        &home,
        "Theirs",
        json!({"kind":"agent","id":child["id"]}),
    )
    .await;
    let done = todo(&daemon, &home, "Done", Value::Null).await;
    call(&daemon, "todo.complete", json!({"id":done["id"]})).await;
    let elsewhere = todo(&daemon, &home, "Elsewhere", Value::Null).await;
    call(
        &daemon,
        "todo.move",
        json!({"id":elsewhere["id"],"home":null}),
    )
    .await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    assert!(notices(&daemon, &home).await.is_empty());
    for before in [mine, theirs] {
        assert_eq!(
            call(&daemon, "todo.get", json!({"id":before["id"]})).await["owner"],
            before["owner"]
        );
    }
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_auto_off_sends_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    todo(&daemon, &home, "Before", Value::Null).await;
    assert!(notices(&daemon, &home).await.is_empty());
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let before = notices(&daemon, &home).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":false}),
    )
    .await;
    todo(&daemon, &home, "After", Value::Null).await;
    assert_eq!(notices(&daemon, &home).await, before);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_a_todo_is_sent_again_only_when_it_becomes_unassigned() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let todo = todo(&daemon, &home, "New task", Value::Null).await;
    assert_eq!(notices(&daemon, &home).await.len(), 1);
    call(
        &daemon,
        "todo.assign",
        json!({"id":todo["id"],"owner":Actor::user()}),
    )
    .await;
    call(
        &daemon,
        "todo.assign",
        json!({"id":todo["id"],"owner":null}),
    )
    .await;
    assert_eq!(notices(&daemon, &home).await.len(), 2);
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":false}),
    )
    .await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    assert_eq!(notices(&daemon, &home).await.len(), 2);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_a_restart_resends_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    todo(&daemon, &home, "Persistent task", Value::Null).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let before = notices(&daemon, &home).await;
    assert_eq!(before.len(), 1);
    daemon.stop_terminals().await.unwrap();
    drop(daemon);
    let reopened = running_daemon(dir.path());
    call(&reopened, "rail.startDoor", json!({"id":home})).await;
    let after = notices(&reopened, &home).await;
    assert_eq!(
        after.iter().map(|m| &m["id"]).collect::<Vec<_>>(),
        before.iter().map(|m| &m["id"]).collect::<Vec<_>>()
    );
    reopened.stop_terminals().await.unwrap();
}

async fn as_door(daemon: &Daemon, home: &str, method: &str, params: Value) -> Value {
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: home.into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    daemon.route(&mut conn, method, params).await.unwrap()
}

#[tokio::test]
async fn a3308_the_door_assign_is_recorded_in_history() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let todo = todo(&daemon, &home, "Assign this", Value::Null).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let child = subagent(&daemon, &home, dir.path()).await;
    let owner = json!({"kind":"agent","id":child["id"],"parent":null});
    let actor = json!({"kind":"agent","id":home,"parent":null});
    let mut events = daemon.bus.subscribe();
    as_door(
        &daemon,
        &home,
        "todo.assign",
        json!({"id":todo["id"],"owner":owner}),
    )
    .await;
    let history = call(&daemon, "todo.getHistory", json!({"id":todo["id"]})).await;
    let change = history["changes"].as_array().unwrap().last().unwrap();
    assert_eq!(change["actor"], actor);
    assert_eq!(change["before"]["owner"], Value::Null);
    assert_eq!(change["after"]["owner"], owner);
    let mut updates = vec![];
    while let Ok(event) = events.try_recv() {
        if let contracts::EventData::TodoUpdated(todo) = event.data {
            updates.push(todo.owner);
        }
    }
    assert_eq!(updates, vec![Some(serde_json::from_value(owner).unwrap())]);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_a_subagent_start_obeys_the_cap() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    call(&daemon, "project.setWorkstreamCap", json!({"cap":1})).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let todo = todo(&daemon, &home, "Delegate this", Value::Null).await;
    let child = as_door(&daemon, &home, "agent.spawn", json!({"cwd":dir.path(),"order":{"kind":"work","ask":"Implement the Todo","done":"The Todo is implemented","limits":[]}})).await;
    as_door(
        &daemon,
        &home,
        "todo.assign",
        json!({"id":todo["id"],"owner":{"kind":"agent","id":child["id"]}}),
    )
    .await;
    let queue = call(&daemon, "workstream.queue", json!({})).await;
    assert_eq!(queue["running"], 1);
    assert_eq!(queue["cap"], 1);
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":todo["id"]})).await["owner"]["id"],
        child["id"]
    );
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_an_agent_cannot_authorize_auto() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: node["id"].as_str().unwrap().into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let error = daemon
        .route(
            &mut conn,
            "workstream.setAuto",
            json!({"id":node["id"],"auto":true}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, code::FORBIDDEN);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await[0]["auto"],
        false
    );
}

#[tokio::test]
async fn a3308_an_idle_auto_workstream_cannot_start_over_the_cap() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let node = call(&daemon, "rail.tree", Value::Null).await[0].clone();
    call(
        &daemon,
        "agent.signal",
        json!({"id":home,"attempt":node["attempt"],"payload":{"hook_event_name":"Stop"}}),
    )
    .await;
    let other = door(&daemon).await;
    call(&daemon, "project.setWorkstreamCap", json!({"cap":1})).await;
    let before = call(&daemon, "rail.tree", Value::Null).await;
    assert_ne!(home, other);
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: home.clone(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let result = daemon.route(&mut conn, "agent.spawn", json!({"cwd":dir.path(),"order":{"kind":"work","ask":"Implement the Todo","done":"The Todo is implemented","limits":[]}})).await;
    assert_eq!(result.unwrap_err().code, code::CONFLICT);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null)
            .await
            .as_array()
            .unwrap()
            .len(),
        before.as_array().unwrap().len()
    );
    daemon.stop_terminals().await.unwrap();
}

async fn subagent(daemon: &Daemon, home: &str, cwd: &std::path::Path) -> Value {
    as_door(daemon, home, "agent.spawn", json!({"cwd":cwd,"order":{"kind":"work","ask":"Implement the Todo","done":"The Todo is implemented","limits":[]}})).await
}

#[tokio::test]
async fn a3308_an_agent_cannot_enable_auto_by_claiming_user() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let peer = daemon
        .agents
        .running_programs()
        .into_iter()
        .find(|(id, _)| id == &home)
        .unwrap()
        .1;
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: Some(peer),
        events,
        output: None,
    };
    let response = daemon
        .dispatch(
            &mut conn,
            &json!({"id":1,"method":"workstream.setAuto","params":{"id":home,"auto":true}})
                .to_string(),
            None,
        )
        .await
        .unwrap()
        .into_value();
    assert_eq!(response["error"]["code"], code::FORBIDDEN);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await[0]["auto"],
        false
    );
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn u3523c_import_agent_receives_prompt_and_tools() {
    let root = tempfile::tempdir().unwrap();
    let daemon = running_daemon(root.path());
    let prompt = "  List recent sessions with import.list\nLeave confirmation to the user.  ";
    let node = call(
        &daemon,
        "agent.spawn",
        json!({"cwd":root.path(), "prompt":prompt, "parent":null, "name":"Import"}),
    )
    .await;
    assert_eq!(node["work"]["ask"], prompt);
    let id = node["id"].as_str().unwrap();
    let ctx = daemon.ctx(Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    });
    let refused = daemon.modules["project"]
        .call(&ctx, "project.importCommit", json!({"selections":[]}))
        .await;
    assert!(refused.is_err());
}
