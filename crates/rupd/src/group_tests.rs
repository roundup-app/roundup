//! U5690c: persisted grouping through the real Daemon contract.
use super::*;
use crate::tests::{ask, daemon_in};

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let reply = ask(
        daemon,
        &json!({"id":1,"method":method,"params":params}).to_string(),
    )
    .await;
    assert!(reply.get("error").is_none(), "{reply}");
    reply["result"].clone()
}

#[tokio::test]
async fn u5690c_group_preserves_selected_identities_and_reopens() {
    for (selected, expected) in [
        (
            json!(["5", "1", "3", "1"]),
            json!([
                ["11", null, 0],
                ["1", "11", 0],
                ["2", "1", 0],
                ["9", "1", 1],
                ["10", "1", 2],
                ["3", "11", 1],
                ["4", "3", 0],
                ["5", "11", 2],
                ["6", null, 1],
                ["7", "6", 0]
            ]),
        ),
        (
            json!(["7", "2", "1"]),
            json!([
                ["11", null, 0],
                ["1", "11", 0],
                ["9", "1", 0],
                ["10", "1", 1],
                ["2", "11", 1],
                ["7", "11", 2],
                ["3", null, 1],
                ["4", "3", 0],
                ["5", null, 2],
                ["6", null, 3]
            ]),
        ),
        (
            json!(["4", "3"]),
            json!([
                ["1", null, 0],
                ["2", "1", 0],
                ["9", "1", 1],
                ["10", "1", 2],
                ["11", null, 1],
                ["3", "11", 0],
                ["4", "11", 1],
                ["5", null, 2],
                ["6", null, 3],
                ["7", "6", 0]
            ]),
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon_in(dir.path());
        // Setup is stored data; every effect and observation crosses public Rail RPC.
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute_batch(
            "INSERT INTO nodes(id,kind,name,parent,ord,conversation_id,conversation_cwd) VALUES
          (1,'workstream','A',NULL,0,'door-a','/a'),
          (2,'agent','A child',1,0,NULL,NULL),
          (3,'workstream','C',NULL,1,'door-c','/c'),
          (4,'agent','C child',3,0,NULL,NULL),
          (5,'workstream','E',NULL,2,NULL,NULL),
          (6,'workstream','F',NULL,3,NULL,NULL),
          (7,'agent','F child',6,0,NULL,NULL),
          (9,'agent','A kept first',1,1,NULL,NULL),
          (10,'agent','A kept second',1,2,NULL,NULL);",
        )
        .unwrap();
        drop(db);
        let todo = call(&daemon, "todo.create", json!({"title":"Keep this work"})).await;
        call(&daemon, "todo.move", json!({"id":todo["id"],"home":"1"})).await;
        call(
            &daemon,
            "pad.create",
            json!({"name":"kept-work","text":"Exact retained text"}),
        )
        .await;
        call(&daemon, "pad.move", json!({"name":"kept-work","home":"1"})).await;
        let todos = call(&daemon, "todo.list", Value::Null).await;
        let pad = call(&daemon, "pad.read", json!({"name":"kept-work"})).await;
        let before = call(&daemon, "rail.tree", Value::Null).await;
        let group = call(&daemon, "rail.group", json!({"ids":selected})).await;
        let typed: contracts::agent::RailNode = serde_json::from_value(group.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed.kind).unwrap(), "group");
        assert_eq!(group["id"], "11");
        call(
            &daemon,
            "rail.rename",
            json!({"id":"11","name":"Selected work"}),
        )
        .await;
        let after = call(&daemon, "rail.tree", Value::Null).await;
        let positions = |tree: &Value| {
            Value::Array(
                tree.as_array()
                    .unwrap()
                    .iter()
                    .map(|n| json!([n["id"], n["parent"], n["order"]]))
                    .collect(),
            )
        };
        assert_eq!(positions(&after), expected);
        assert_eq!(call(&daemon, "todo.list", Value::Null).await, todos);
        assert_eq!(
            call(&daemon, "pad.read", json!({"name":"kept-work"})).await,
            pad
        );
        for node in before.as_array().unwrap() {
            let retained = after
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == node["id"])
                .unwrap();
            for field in ["kind", "name", "attempt", "work", "can_resume"] {
                assert_eq!(retained[field], node[field], "{field}");
            }
        }
        for (id, home) in [
            (
                "2",
                if selected.as_array().unwrap().contains(&json!("2")) {
                    Value::Null
                } else {
                    json!("1")
                },
            ),
            (
                "4",
                if selected.as_array().unwrap().contains(&json!("4")) {
                    Value::Null
                } else {
                    json!("3")
                },
            ),
            (
                "7",
                if selected.as_array().unwrap().contains(&json!("7")) {
                    Value::Null
                } else {
                    json!("6")
                },
            ),
        ] {
            assert_eq!(
                call(&daemon, "agent.instructions", json!({"id":id})).await["home"],
                home
            );
        }
        assert!(daemon.agents.running_programs().is_empty());
        assert!(
            after
                .as_array()
                .unwrap()
                .iter()
                .all(|n| n["terminal_id"].is_null() && n["attempt"].is_null())
        );
        drop(daemon);
        let reopened = daemon_in(dir.path());
        let tree = call(&reopened, "rail.tree", Value::Null).await;
        let persisted = |mut tree: Value| {
            for node in tree.as_array_mut().unwrap() {
                if let Some(status) = node["status"].as_object_mut() {
                    status.remove("since");
                }
            }
            tree
        };
        assert_eq!(persisted(tree), persisted(after));
        assert!(reopened.agents.running_programs().is_empty());
        assert_eq!(call(&reopened, "todo.list", Value::Null).await, todos);
        assert_eq!(
            call(&reopened, "pad.read", json!({"name":"kept-work"})).await,
            pad
        );
    }
}

#[tokio::test]
async fn u5690c_group_uses_nearest_common_ancestor_and_preserves_workstream_restriction() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,parent,ord) VALUES
      (1,'workstream','Home',NULL,0), (2,'agent','A',1,0),
      (3,'agent','B',1,1), (4,'agent','C',1,2), (5,'agent','D',1,3),
      (6,'agent','E',1,4), (7,'workstream','Other',NULL,1);",
    )
    .unwrap();
    drop(db);
    let group = call(&daemon, "rail.group", json!({"ids":["6","2","4","2"]})).await;
    for id in ["2", "4", "6"] {
        assert_eq!(
            call(&daemon, "agent.instructions", json!({"id":id})).await["home"],
            "1"
        );
    }
    assert_eq!(group["parent"], "1");
    assert_eq!(group["order"], 0);
    let tree = call(&daemon, "rail.tree", Value::Null).await;
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["1", "8", "2", "4", "6", "3", "5", "7"]
    );
    let refused = ask(
        &daemon,
        &json!({"id":1,"method":"rail.move","params":{"id":"7","parent":"8","index":0}})
            .to_string(),
    )
    .await;
    assert!(refused.get("error").is_some(), "{refused}");
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await, tree);
}

#[tokio::test]
async fn u5690c_group_is_not_an_agent_and_workstream_removal_keeps_its_default_cascade() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,parent,ord) VALUES
      (1,'workstream','Home',NULL,0),(2,'agent','A',1,0),(3,'agent','B',1,1);",
    )
    .unwrap();
    drop(db);
    call(&daemon, "rail.group", json!({"ids":["2","3"]})).await;
    for method in ["rail.startDoor", "agent.resume", "agent.run"] {
        let params = if method == "agent.run" {
            json!({"id":"4","command":["true"]})
        } else {
            json!({"id":"4"})
        };
        let reply = ask(
            &daemon,
            &json!({"id":1,"method":method,"params":params}).to_string(),
        )
        .await;
        assert_eq!(
            reply["error"]["code"],
            if method == "agent.run" {
                rpc::code::INVALID_PARAMS
            } else {
                rpc::code::CONFLICT
            },
            "{method}: {reply}"
        );
    }
    call(&daemon, "rail.remove", json!({"id":"1"})).await;
    let tree = call(&daemon, "rail.tree", Value::Null).await;
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .map(|node| (&node["id"], &node["parent"]))
            .collect::<Vec<_>>(),
        [(&json!("4"), &Value::Null)]
    );
    assert!(daemon.agents.running_programs().is_empty());
}
