//! A5830: cached lookups cross the same attribution boundary as new starts.
use super::*;

#[tokio::test]
async fn a5830_cached_specialist_refuses_agent_start_attribution() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = test_daemon(dir.path()).unwrap();
    let original = json!({
        "project":"original-project", "agent":"original-agent",
        "project_name":"Original project", "agent_name":"Original Agent"
    });
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,parent,ord,attempt,terminal_id) VALUES
         (1,'workstream','Work',NULL,0,1,'door-terminal'),
         (2,'agent','Caller',1,0,1,'caller-terminal'),
         (3,'agent','Reader',2,0,2,'reader-terminal');",
    )
    .unwrap();
    db.execute(
        "UPDATE nodes SET start_attribution=?1 WHERE id=3",
        [original.to_string()],
    )
    .unwrap();
    drop(db);
    for id in ["1", "2", "3"] {
        daemon.agents.set_status_for_test(
            id,
            contracts::Status {
                kind: contracts::Kind::Idle,
                label: String::new(),
                since: 1,
                finished: "0".into(),
            },
        );
    }
    let actor = Actor {
        kind: ActorKind::Agent,
        id: "2".into(),
        parent: Some("1".into()),
    };
    let params = json!({
        "cwd":dir.path(), "name":"Reader", "specialist":"reader", "scout":true
    });
    daemon.specialists.lock().await.insert(
        ("1".into(), "reader".into()),
        Specialist {
            id: "3".into(),
            actor: actor.clone(),
            params: rpc::params(params.clone()).unwrap(),
            handoff: None,
        },
    );
    let before = crate::tests::ask(&daemon, r#"{"id":1,"method":"rail.tree"}"#).await;
    let specialist = before["result"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "3")
        .unwrap();
    assert_eq!(specialist["start_attribution"], original);
    assert_eq!(specialist["terminal_id"], "reader-terminal");
    assert_eq!(specialist["status"]["kind"], "idle");
    let programs = serde_json::to_value(daemon.terminals.list().await).unwrap();
    assert_eq!(programs, json!([]));
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor,
        peer: None,
        events,
        output: None,
    };
    let mut attributed = params.clone();
    attributed["start_attribution"] = json!({
        "project":"forged-project", "agent":"forged-agent",
        "project_name":"Forged project", "agent_name":"Forged Agent"
    });
    let refused = daemon
        .dispatch(
            &mut conn,
            &json!({"id":2,"method":"agent.spawn","params":attributed}).to_string(),
            None,
        )
        .await
        .unwrap()
        .into_value()
        .unwrap();
    assert_eq!(refused["error"]["code"], code::FORBIDDEN, "{refused}");
    assert_eq!(
        crate::tests::ask(&daemon, r#"{"id":1,"method":"rail.tree"}"#).await,
        before
    );
    assert_eq!(
        serde_json::to_value(daemon.terminals.list().await).unwrap(),
        programs
    );
    let reused = daemon
        .dispatch(
            &mut conn,
            &json!({"id":3,"method":"agent.spawn","params":params}).to_string(),
            None,
        )
        .await
        .unwrap()
        .into_value()
        .unwrap();
    assert_eq!(reused["result"], *specialist, "{reused}");
    assert_eq!(
        crate::tests::ask(&daemon, r#"{"id":1,"method":"rail.tree"}"#).await,
        before
    );
    assert_eq!(
        serde_json::to_value(daemon.terminals.list().await).unwrap(),
        programs
    );
}
