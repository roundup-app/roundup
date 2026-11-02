//! U5690c: persisted grouping through the real Daemon contract.
use super::*;
use crate::tests::{ask, daemon_in};

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let reply = ask(daemon, &json!({"id":1,"method":method,"params":params}).to_string()).await;
    assert!(reply.get("error").is_none(), "{reply}");
    reply["result"].clone()
}

#[tokio::test]
async fn u5690c_group_preserves_selected_identities_and_reopens() {
    for (selected, expected) in [
        (json!(["5","1","3","1"]), json!([["8",null,0],["1","8",0],["2","1",0],["3","8",1],["4","3",0],["5","8",2],["6",null,1],["7","6",0]])),
        (json!(["7","2","1"]), json!([["8",null,0],["1","8",0],["2","8",1],["7","8",2],["3",null,1],["4","3",0],["5",null,2],["6",null,3]])),
        (json!(["4","3"]), json!([["1",null,0],["2","1",0],["8",null,1],["3","8",0],["4","8",1],["5",null,2],["6",null,3],["7","6",0]])),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = daemon_in(dir.path());
        // Setup is stored data; every effect and observation crosses public Rail RPC.
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute_batch("INSERT INTO nodes(id,kind,name,parent,ord,conversation_id,conversation_cwd) VALUES
          (1,'workstream','A',NULL,0,'door-a','/a'),
          (2,'agent','A child',1,0,NULL,NULL),
          (3,'workstream','C',NULL,1,'door-c','/c'),
          (4,'agent','C child',3,0,NULL,NULL),
          (5,'workstream','E',NULL,2,NULL,NULL),
          (6,'workstream','F',NULL,3,NULL,NULL),
          (7,'agent','F child',6,0,NULL,NULL);").unwrap();
        drop(db);
        let before = call(&daemon,"rail.tree",Value::Null).await;
        let group = call(&daemon,"rail.group",json!({"ids":selected})).await;
        let typed: contracts::agent::RailNode = serde_json::from_value(group.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed.kind).unwrap(), "group");
        assert_eq!(group["id"], "8");
        call(&daemon,"rail.rename",json!({"id":"8","name":"Selected work"})).await;
        let after = call(&daemon,"rail.tree",Value::Null).await;
        let positions = |tree: &Value| Value::Array(tree.as_array().unwrap().iter().map(|n| json!([n["id"],n["parent"],n["order"]])).collect());
        assert_eq!(positions(&after), expected);
        for node in before.as_array().unwrap() {
            let held = after.as_array().unwrap().iter().find(|n| n["id"] == node["id"]).unwrap();
            for field in ["kind","name","attempt","work","can_resume"] { assert_eq!(held[field],node[field],"{field}"); }
        }
        assert!(daemon.agents.running_programs().is_empty());
        assert!(after.as_array().unwrap().iter().all(|n| n["terminal_id"].is_null() && n["attempt"].is_null()));
        drop(daemon);
        let reopened = daemon_in(dir.path());
        let tree = call(&reopened,"rail.tree",Value::Null).await;
        assert_eq!(tree, after);
        assert!(reopened.agents.running_programs().is_empty());
    }
}
