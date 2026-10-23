use super::*;
use crate::tests::ask;

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
    let daemon = Daemon::open(dir.path()).unwrap();
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
    let reopened = Daemon::open(dir.path()).unwrap();
    let rail = call(&reopened, "rail.list", Value::Null).await;
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
    Daemon::open_stores(project, &data, None, |_| {
        let bus = Bus::new();
        let terminals = Arc::new(terminal::Terminals::open(&data, bus.clone()).unwrap());
        agents::Agents::open_in(
            project,
            &data,
            bus,
            terminals,
            agents::claude_code::Launcher::new(
                fake.to_str().unwrap(),
                project.join("claude.json"),
                rup,
                None,
            ),
            agents::worktree::Git::from_env(),
        )
        .unwrap()
    })
    .unwrap()
}

async fn door(daemon: &Daemon) -> String {
    let node = call(daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    call(daemon, "rail.startDoor", json!({"id":node["id"]})).await;
    node["id"].as_str().unwrap().into()
}

async fn todo(daemon: &Daemon, home: &str, title: &str, owner: Value) -> Value {
    let todo = call(
        daemon,
        "todo.create",
        json!({"title":title,"owner":owner,"estimate_minutes":45}),
    )
    .await;
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
        assert!(body.contains("45 min"), "{body}");
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
