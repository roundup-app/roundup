//! C7707a to C7707c, C7707e: `search.find` through the production router over the Project database.
use super::*;

async fn call_as(daemon: &Daemon, actor: Actor, params: Value) -> Result<Value, RpcError> {
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor,
        peer: None,
        events,
        output: None,
    };
    daemon.route_inner(&mut conn, "search.find", params).await
}

async fn find(daemon: &Daemon, query: &str) -> Value {
    call_as(daemon, Actor::user(), json!({ "query": query }))
        .await
        .unwrap()
}

fn ids(found: &Value, kind: &str) -> Vec<String> {
    found["hits"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|hit| hit["kind"] == kind)
        .map(|hit| hit["id"].as_str().unwrap().to_string())
        .collect()
}

fn say(dir: &Path, from: &str, to: &str, body: &str) {
    let db = storage::connect(dir).unwrap();
    db.execute(
        "INSERT INTO messages(from_actor,to_id,kind,body,status,at) VALUES (?1,?2,'note',?3,'delivered',5)",
        rusqlite::params![
            serde_json::to_string(&Actor { kind: contracts::ActorKind::Agent, id: from.into(), parent: None }).unwrap(),
            to,
            body
        ],
    )
    .unwrap();
}

async fn seeded(dir: &Path) -> Daemon {
    let daemon = test_daemon(dir).unwrap();
    call_as(&daemon, Actor::user(), json!({"query":""}))
        .await
        .unwrap();
    for (method, params) in [
        (
            "todo.create",
            json!({"title":"rotate","body":"rotate the token","owner":Actor::user()}),
        ),
        (
            "pad.create",
            json!({"name":"notes","text":"token rotation notes"}),
        ),
    ] {
        daemon
            .route(&mut test_conn(), method, params)
            .await
            .unwrap();
    }
    say(dir, "a1", "you", "renew the token");
    daemon
}

fn test_conn() -> Conn {
    let (events, _) = mpsc::unbounded_channel();
    Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    }
}

#[tokio::test]
async fn c7707a_a_word_in_a_message_a_pad_and_a_todo_finds_each_with_its_ranges() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    let found = find(&daemon, "token").await;
    assert_eq!(found["more"], false);
    assert_eq!(ids(&found, "todo"), ["1"]);
    assert_eq!(ids(&found, "pad"), ["notes"]);
    assert_eq!(ids(&found, "message"), ["1"]);
    let hit = |kind: &str| {
        found["hits"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["kind"] == kind)
            .unwrap()
            .clone()
    };
    let message = hit("message");
    assert_eq!(message["title"], "a1 to you");
    assert_eq!(message["opens"], "a1");
    assert_eq!(message["snippet"], "renew the token");
    assert_eq!(message["ranges"], json!([{"start":10,"end":15}]));
    assert_eq!(hit("pad")["ranges"], json!([{"start":0,"end":5}]));
    assert_eq!(hit("todo")["snippet"], "rotate the token");
    assert_eq!(hit("todo")["opens"], Value::Null);
}

#[tokio::test]
async fn c7707a_a_title_word_finds_its_pad_and_todo() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    let found = find(&daemon, "notes").await;
    assert_eq!(ids(&found, "pad"), ["notes"]);
    let found = find(&daemon, "rotate").await;
    assert_eq!(ids(&found, "todo"), ["1"]);
    assert_eq!(found["hits"][0]["title"], "rotate");
}

#[tokio::test]
async fn c7707b_words_match_as_case_and_accent_blind_prefixes_in_one_item() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    say(dir.path(), "a1", "a2", "Café résumé tokens");
    assert_eq!(ids(&find(&daemon, "CAFE resu").await, "message"), ["2"]);
    assert_eq!(
        ids(&find(&daemon, "tok").await, "message"),
        ["1", "2"].map(String::from)
    );
    // every word must match in the same item: `renew` is in a Message, `rotation` in a Pad
    assert!(
        find(&daemon, "renew rotation").await["hits"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn c7707b_fts_syntax_in_a_query_is_literal() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    for query in [
        "\"",
        "token*",
        "-token",
        "NEAR(token",
        "title:token",
        "AND",
        "\"a\" OR",
        "((",
    ] {
        call_as(&daemon, Actor::user(), json!({"query":query}))
            .await
            .unwrap();
    }
    assert!(!ids(&find(&daemon, "-token").await, "todo").is_empty());
}

#[tokio::test]
async fn c7707b_a_blank_query_answers_nothing_and_the_cap_sets_more() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    for query in ["", "   ", "-- ** \"\""] {
        let found = find(&daemon, query).await;
        assert_eq!(
            (found["hits"].as_array().unwrap().len(), &found["more"]),
            (0, &json!(false))
        );
    }
    for n in 0..25 {
        say(dir.path(), "a1", "a2", &format!("many words {n}"));
    }
    let found = find(&daemon, "many").await;
    assert_eq!(
        (found["hits"].as_array().unwrap().len(), &found["more"]),
        (20, &json!(true))
    );
    let found = call_as(&daemon, Actor::user(), json!({"query":"many","limit":5}))
        .await
        .unwrap();
    assert_eq!(
        (found["hits"].as_array().unwrap().len(), &found["more"]),
        (5, &json!(true))
    );
    let found = call_as(&daemon, Actor::user(), json!({"query":"many","limit":500}))
        .await
        .unwrap();
    assert_eq!(
        (found["hits"].as_array().unwrap().len(), &found["more"]),
        (25, &json!(false))
    );
}

#[tokio::test]
async fn c7707c_edit_delete_and_rollback_keep_the_index_with_its_rows() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    daemon
        .route(
            &mut test_conn(),
            "todo.update",
            json!({"id":1,"body":"rotate the secret"}),
        )
        .await
        .unwrap();
    daemon
        .route(
            &mut test_conn(),
            "pad.write",
            json!({"name":"notes","text":"secret notes"}),
        )
        .await
        .unwrap();
    let found = find(&daemon, "token").await;
    assert_eq!(ids(&found, "todo").len() + ids(&found, "pad").len(), 0);
    let found = find(&daemon, "secret").await;
    assert_eq!(
        (ids(&found, "todo"), ids(&found, "pad")),
        (vec!["1".to_string()], vec!["notes".to_string()])
    );

    let mut db = storage::connect(dir.path()).unwrap();
    let tx = db.transaction().unwrap();
    tx.execute(
        "INSERT INTO pads(key,name,text,updated_at) VALUES ('k','ghost','phantom',1)",
        [],
    )
    .unwrap();
    tx.rollback().unwrap();
    assert!(
        find(&daemon, "phantom").await["hits"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    db.execute(
        "UPDATE pads SET key = 'n2', name = 'renamed' WHERE key = 'notes'",
        [],
    )
    .ok();
    db.execute("DELETE FROM pads", []).unwrap();
    db.execute("DELETE FROM todos", []).unwrap();
    db.execute("DELETE FROM messages", []).unwrap();
    assert!(
        find(&daemon, "secret").await["hits"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        find(&daemon, "renew").await["hits"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    for table in ["todos_fts", "messages_fts", "pads_fts"] {
        db.execute(
            &format!("INSERT INTO {table}({table}) VALUES ('integrity-check')"),
            [],
        )
        .unwrap_or_else(|e| panic!("{table}: {e}"));
    }
}

#[tokio::test]
async fn c7707e_an_agent_call_is_refused_and_the_tool_list_does_not_move() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = seeded(dir.path()).await;
    let agent = Actor {
        kind: contracts::ActorKind::Agent,
        id: "a1".into(),
        parent: None,
    };
    let error = call_as(&daemon, agent, json!({"query":"token"}))
        .await
        .unwrap_err();
    assert_eq!(error.code, code::FORBIDDEN);
    let listed = contracts::methods::metadata();
    let row = listed.iter().find(|m| m.name == "search.find").unwrap();
    assert!(matches!(row.mcp, contracts::methods::McpChoice::None(_)));
}
