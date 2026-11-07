use super::*;

#[tokio::test]
async fn t19_reopen_preserves_identity_fields_and_order() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(
        &h,
        json!({"title":"ship", "body":"details", "owner": owner_of(&agent("a"))}),
    )
    .await;
    made(&h, json!({"title":"other"})).await;
    h.call("todo.move", json!({"id":1,"home":"r1"}))
        .await
        .unwrap();
    h.call("todo.reorder", json!({"id":1,"before":null}))
        .await
        .unwrap();
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    let mut expected = h.call("todo.list", json!({})).await.unwrap();
    expected[1]["done"] = json!(false);
    let reopened = h.call("todo.reopen", json!({"id":1})).await.unwrap();
    expected[1]["updated_at"] = reopened["updated_at"].clone();
    assert_eq!(reopened, expected[1]);
    assert_eq!(h.call("todo.get", json!({"id":1})).await.unwrap(), reopened);
    assert_eq!(h.call("todo.list", json!({})).await.unwrap(), expected);
}

#[tokio::test]
async fn t19_reopen_history_and_provenance_name_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"blocker"})).await;
    made(&h, json!({"title":"dependent", "blockers":[1]})).await;
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    let dependent = changes(&h, 2).await;
    let touches = h.touches(2);
    h.events();
    let caller = agent("a");
    let reopened = h
        .call_as(
            caller.clone(),
            "todo.reopen",
            json!({"id":1,"actor":Actor::user()}),
        )
        .await
        .unwrap();
    let event = h.events.try_recv().unwrap();
    assert_eq!(event.actor, caller);
    assert!(
        matches!(event.data, EventData::TodoUpdated(todo) if serde_json::to_value(&todo).unwrap() == reopened)
    );
    assert!(h.events().is_empty());
    let history = changes(&h, 1).await;
    let entries = history["changes"].as_array().unwrap();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0]["actor"], json!(Actor::user()));
    assert_eq!(entries[2]["actor"], json!(caller));
    assert_eq!(entries[2]["before"]["done"], true);
    assert_eq!(entries[2]["after"]["done"], false);
    assert_eq!(
        h.touches(1),
        vec![
            (Verb::Wrote, "you".into()),
            (Verb::Wrote, "you".into()),
            (Verb::Wrote, "a".into())
        ]
    );
    assert_eq!(changes(&h, 2).await, dependent);
    assert_eq!(h.touches(2), touches);
}

#[tokio::test]
async fn t19_open_reopen_is_a_noop() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let todo = made(&h, json!({"title":"open"})).await;
    let history = changes(&h, 1).await;
    let touches = h.touches(1);
    h.events();
    assert_eq!(h.call("todo.reopen", json!({"id":1})).await.unwrap(), todo);
    assert_eq!(changes(&h, 1).await, history);
    assert_eq!(h.touches(1), touches);
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn t19_unknown_id_leaves_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"kept"})).await;
    let list = h.call("todo.list", json!({})).await.unwrap();
    let history = changes(&h, 1).await;
    h.events();
    assert_eq!(
        h.call("todo.reopen", json!({"id":99}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
    assert_eq!(h.call("todo.list", json!({})).await.unwrap(), list);
    assert_eq!(changes(&h, 1).await, history);
    assert!(h.touches(99).is_empty());
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn t19_reopen_reblocks_dependents_and_can_complete_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"own blocker"})).await;
    made(&h, json!({"title":"reopen", "blockers":[1]})).await;
    made(&h, json!({"title":"dependent", "blockers":[2]})).await;
    made(&h, json!({"title":"done dependent", "blockers":[2]})).await;
    for id in [2, 4] {
        h.call("todo.complete", json!({"id":id})).await.unwrap();
    }
    h.events();
    let reopened = h.call("todo.reopen", json!({"id":2})).await.unwrap();
    assert_eq!(reopened["blocked"], true);
    let list = h.call("todo.list", json!({})).await.unwrap();
    assert_eq!(list[2]["blocked"], true);
    assert_eq!(list[2]["done"], false);
    assert_eq!(list[3]["blocked"], true);
    assert_eq!(list[3]["done"], true);
    assert_eq!(h.events(), ["todo.updated 2"]);
    h.call("todo.complete", json!({"id":2})).await.unwrap();
    assert_eq!(
        h.events(),
        ["todo.updated 2", "todo.unblocked 3", "todo.unblocked 4"]
    );
}

#[tokio::test]
async fn t19_reopen_and_actor_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let before = {
        let h = Harness::new(dir.path());
        made(&h, json!({"title":"ship"})).await;
        h.call("todo.complete", json!({"id":1})).await.unwrap();
        h.call_as(agent("a"), "todo.reopen", json!({"id":1}))
            .await
            .unwrap();
        changes(&h, 1).await["changes"].clone()
    };
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.list", json!({})).await.unwrap()[0]["done"],
        false
    );
    assert_eq!(changes(&h, 1).await["changes"], before);
    assert_eq!(before[2]["actor"], json!(agent("a")));
}

#[tokio::test]
async fn t19_failed_history_preserves_done_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"done"})).await;
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    let before = changes(&h, 1).await;
    let touches = h.touches(1);
    h.events();
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'history failed'); END;").unwrap();
    assert!(h.call("todo.reopen", json!({"id":1})).await.is_err());
    assert_eq!(
        h.call("todo.list", json!({})).await.unwrap()[0]["done"],
        true
    );
    assert_eq!(changes(&h, 1).await, before);
    assert_eq!(
        h.call("todo.list", json!({})).await.unwrap()[0]["priority"],
        Value::Null
    );
    assert_eq!(h.touches(1), touches);
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn t15_initial_values_and_field_changes() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call(
        "todo.create",
        json!({"title": "First", "body": "one\n two"}),
    )
    .await
    .unwrap();
    h.call("todo.update", json!({"id": 1, "body": "three\nfour"}))
        .await
        .unwrap();
    let history = h.call("todo.getHistory", json!({"id": 1})).await.unwrap();
    assert_eq!(history["changes"].as_array().unwrap().len(), 2);
    assert_eq!(history["changes"][0]["after"]["title"], "First");
    assert_eq!(history["changes"][1]["before"]["body"], "one\n two");
    assert_eq!(history["changes"][1]["after"]["body"], "three\nfour");
    assert_eq!(history["unread"], history["changes"][0]["seq"]);
}

#[tokio::test]
async fn t15_combined_update_is_one_change() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a", "body": "b"}))
        .await
        .unwrap();
    h.call(
        "todo.update",
        json!({"id": 1, "title": "new", "body": "full\nbody"}),
    )
    .await
    .unwrap();
    let history = changes(&h, 1).await;
    assert_eq!(history["changes"].as_array().unwrap().len(), 2);
    assert_eq!(history["changes"][1]["before"]["title"], "a");
    assert_eq!(history["changes"][1]["after"]["body"], "full\nbody");
}

#[tokio::test]
async fn t15_noops_and_rejections_add_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let before = changes(&h, 1).await;
    h.call("todo.update", json!({"id": 1, "title": "a"}))
        .await
        .unwrap();
    h.call("todo.setBlockers", json!({"id": 1, "blockers": []}))
        .await
        .unwrap();
    assert!(
        h.call("todo.setBlockers", json!({"id": 1, "blockers": [1]}))
            .await
            .is_err()
    );
    assert!(h.call("todo.update", json!({"id": 1})).await.is_err());
    assert_eq!(changes(&h, 1).await, before);
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    let done = changes(&h, 1).await;
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(changes(&h, 1).await, done);
}

#[tokio::test]
async fn t15_reads_reorder_and_move_add_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b"})).await.unwrap();
    let before = changes(&h, 1).await["changes"].clone();
    h.call("todo.get", json!({"id": 1})).await.unwrap();
    h.call("todo.reorder", json!({"id": 1, "before": null}))
        .await
        .unwrap();
    h.call("todo.move", json!({"id": 1, "home": "workstream-1"}))
        .await
        .unwrap();
    assert_eq!(changes(&h, 1).await["changes"], before);
}

#[tokio::test]
async fn t15_deleted_blocker_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    for title in ["a", "b"] {
        h.call("todo.create", json!({"title": title}))
            .await
            .unwrap();
    }
    h.call("todo.setBlockers", json!({"id": 2, "blockers": [1]}))
        .await
        .unwrap();
    let before = changes(&h, 2).await["changes"].clone();
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(changes(&h, 2).await["changes"], before);
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    let history = changes(&h, 2).await;
    let last = history["changes"].as_array().unwrap().last().unwrap();
    assert_eq!(last["before"]["blockers"], json!([1]));
    assert_eq!(last["after"]["blockers"], json!([]));
}

#[tokio::test]
async fn t15_restart_retains_history() {
    let dir = tempfile::tempdir().unwrap();
    let before = {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.update", json!({"id": 1, "body": "many\nlines"}))
            .await
            .unwrap();
        h.call("todo.complete", json!({"id": 1})).await.unwrap();
        changes(&h, 1).await["changes"].clone()
    };
    assert_eq!(
        changes(&Harness::new(dir.path()), 1).await["changes"],
        before
    );
}

#[tokio::test]
async fn t15_restart_retains_change_time() {
    let dir = tempfile::tempdir().unwrap();
    let (start, stored) = {
        let h = Harness::new(dir.path());
        let start = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.complete", json!({"id": 1})).await.unwrap();
        (start, changes(&h, 1).await["changes"].clone())
    };
    let reopened = changes(&Harness::new(dir.path()), 1).await["changes"].clone();
    assert_eq!(reopened, stored);
    for change in reopened.as_array().unwrap() {
        assert!(change["changed_at"].as_i64().unwrap() >= start);
    }
}

#[tokio::test]
async fn t15_unknown_todo_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.getHistory", json!({"id": 99}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn t15_history_failure_leaves_no_unrecorded_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let before = changes(&h, 1).await;
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'history failed'); END;").unwrap();
    for (method, params) in [
        ("todo.update", json!({"id": 1, "title": "lost"})),
        ("todo.update", json!({"id": 1, "priority": "high"})),
        ("todo.complete", json!({"id": 1})),
        ("todo.create", json!({"title": "lost"})),
    ] {
        assert!(h.call(method, params).await.is_err());
    }
    assert_eq!(
        h.call("todo.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(changes(&h, 1).await, before);
    assert_eq!(
        h.call("todo.list", json!({})).await.unwrap()[0]["priority"],
        Value::Null
    );
    // A reopen refuses a schema that differs from the migrations' (N5420a).
    db.execute_batch("DROP TRIGGER fail_history").unwrap();
    assert_eq!(
        Harness::new(dir.path())
            .call("todo.list", json!({}))
            .await
            .unwrap()[0]["title"],
        "a"
    );
}

#[tokio::test]
async fn t15_equal_time_reads_and_changes_keep_order() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    let mut h = h;
    h.ctx.touches = Arc::new(Touches::open(dir.path()).unwrap());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.get", json!({"id": 1})).await.unwrap();
    h.call_as(agent("a"), "todo.update", json!({"id": 1, "body": "new"}))
        .await
        .unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute("UPDATE touches SET at = 0", []).unwrap();
    let history = changes(&h, 1).await;
    assert_eq!(history["unread"], history["changes"][1]["seq"]);
    h.call_as(agent("a"), "todo.get", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(changes(&h, 1).await["unread"], history["unread"]);
}

#[tokio::test]
async fn t15_opening_read_does_not_acknowledge_a_later_change() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let fetched = changes(&h, 1).await;
    assert_eq!(h.touches(1).len(), 1);
    h.call_as(agent("a"), "todo.update", json!({"id": 1, "body": "later"}))
        .await
        .unwrap();
    h.call(
        "todo.readHistory",
        json!({"id": 1, "through": fetched["changes"][0]["seq"]}),
    )
    .await
    .unwrap();
    let history = changes(&h, 1).await;
    assert_eq!(history["unread"], history["changes"][1]["seq"]);
    assert_eq!(
        h.call("todo.readHistory", json!({"id": 1, "through": 999}))
            .await
            .unwrap_err()
            .code,
        code::INVALID_PARAMS
    );
}

#[tokio::test]
async fn t15_list_does_not_load_history() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    for n in 0..1000 {
        h.call("todo.update", json!({"id": 1, "body": n.to_string()}))
            .await
            .unwrap();
    }
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute("UPDATE changes SET after_values = 'unreadable'", [])
        .unwrap();
    let list = h.call("todo.list", json!({})).await.unwrap();
    assert_eq!(list[0]["body"], "999");
    assert!(list[0].get("changes").is_none());
    assert!(h.call("todo.getHistory", json!({"id": 1})).await.is_err());
}

// Valid current-schema payloads; setup is separate from execution/row observation.
fn hand_fixture() -> store::Store {
    let store = store::Store::open(Path::new(":memory:")).unwrap();
    store.db.execute_batch(
        "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM n WHERE id<1000)
         INSERT INTO todos(id,title,body,created_at,updated_at,pos,owner)
         SELECT id,'title '||id,'body '||id,1,1,1001-id,
         '{\"kind\":\"agent\",\"id\":\"a\",\"parent\":null}' FROM n;
         INSERT INTO changes(todo,before_values,after_values,after_touch)
         SELECT id,NULL,json_object('title',title,'body','old '||body,'done',json('false'),'blockers',json('[]'),'owner',json(owner)),0 FROM todos;
         INSERT INTO changes(todo,before_values,after_values,after_touch)
         SELECT id,json_object('title',title,'body','old '||body,'done',json('false'),'blockers',json('[]'),'owner',json(owner)),
         json_object('title',title,'body',body,'done',json('false'),'blockers',json('[]'),'owner',json(owner)),0 FROM todos;
         INSERT INTO changes(todo,before_values,after_values,after_touch)
         SELECT todo,after_values,json_set(after_values,'$.title','unrelated edit'),0 FROM changes WHERE seq>1000;
         UPDATE todos SET done=1 WHERE id=1000;
         INSERT INTO blockers VALUES(999,1);
         UPDATE todos SET owner='{\"kind\":\"agent\",\"id\":\"b\"}' WHERE id=998;
         INSERT INTO changes(todo,before_values,after_values,after_touch,handed)
         SELECT id,c.after_values,c.after_values,0,t.owner FROM todos t JOIN changes c ON c.todo=t.id
         WHERE t.id=997 AND c.seq=(SELECT MAX(seq) FROM changes WHERE todo=t.id);"
    ).unwrap();
    store
}

fn folded_hand(store: &store::Store) -> Option<u32> {
    store
        .list()
        .unwrap()
        .into_iter()
        .find(|todo| {
            let Some(owner) = &todo.owner else {
                return false;
            };
            if owner.kind != ActorKind::Agent || owner.id != "a" || todo.done || todo.blocked {
                return false;
            }
            let mut handed = false;
            for (change, _) in store.history(todo.id).unwrap() {
                if let Some(to) = &change.handed {
                    handed = to == owner;
                } else if change.before.as_ref().and_then(|v| v.owner.as_ref())
                    != change.after.owner.as_ref()
                {
                    handed = false;
                }
            }
            !handed
        })
        .map(|todo| todo.id)
}

// Trace executions and returned rows, then inspect their projections through SQLite's prepare API.
// No authorizer counts, SQL occurrence counts, mocks, or production instrumentation.
fn observed_hand(
    store: &store::Store,
) -> (
    Option<contracts::todo::Todo>,
    usize,
    Vec<String>,
    Vec<String>,
) {
    use rusqlite::trace::{TraceEvent, TraceEventCodes};
    use std::cell::RefCell;
    thread_local! { static EVENTS: RefCell<(usize, Vec<String>)> = const { RefCell::new((0, Vec::new())) }; }
    EVENTS.with_borrow_mut(|events| *events = (0, Vec::new()));
    store.db.trace_v2(
        TraceEventCodes::SQLITE_TRACE_STMT | TraceEventCodes::SQLITE_TRACE_ROW,
        Some(|event| {
            EVENTS.with_borrow_mut(|events| match event {
                TraceEvent::Stmt(stmt, _) if stmt.sql().trim_start().starts_with("SELECT") => {
                    events.0 += 1
                }
                TraceEvent::Row(stmt) => events.1.push(stmt.expanded_sql().unwrap()),
                _ => (),
            });
        }),
    );
    let started = std::time::Instant::now();
    let todo = store.hand("a", 0, &Actor::daemon()).unwrap();
    store.db.trace_v2(TraceEventCodes::empty(), None);
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    let (reads, rows) = EVENTS.take();
    let mut body_queries = Vec::new();
    let mut fields = Vec::new();
    for sql in rows {
        let stmt = store.db.prepare(&sql).unwrap();
        let columns = stmt.column_names();
        if columns.contains(&"body") {
            body_queries.push(sql.clone());
        }
        fields.extend(columns.into_iter().map(str::to_owned));
    }
    (todo, reads, body_queries, fields)
}

#[test]
fn t5642b_hand_materializes_only_the_first_eligible_todo() {
    let store = hand_fixture();
    let expected = folded_hand(&store).unwrap();
    assert_eq!(
        expected, 996,
        "reverse user order skips done, blocked, foreign, handed"
    );
    let (todo, reads, bodies, fields) = observed_hand(&store);
    let todo = todo.unwrap();
    assert_eq!(todo.id, expected);
    assert_eq!(bodies.len(), 1, "one returned base row; reads={reads}");
    // Outside measurement, resolve the single returned body's identity using its bound SQL.
    let mut stmt = store.db.prepare(&bodies[0]).unwrap();
    let body_column = stmt.column_index("body").unwrap();
    let body: String = stmt.query_row([], |row| row.get(body_column)).unwrap();
    assert_eq!(body, format!("body {expected}"));
    assert!(
        !fields
            .iter()
            .any(|field| matches!(field.as_str(), "before_values" | "after_values"))
    );
    assert!(
        reads <= 4,
        "candidate selection and winner's three reads: {reads}"
    );
    let history = store.history(expected).unwrap();
    let last = &history.last().unwrap().0;
    assert_eq!(last.handed, Some(agent("a")));
    assert_eq!(last.before.as_ref(), Some(&last.after));
}

#[test]
fn t5642b_no_eligible_todo_materializes_nothing() {
    let store = hand_fixture();
    store
        .db
        .execute(
            "INSERT INTO changes(todo,before_values,after_values,after_touch,handed)
         SELECT t.id,c.after_values,c.after_values,0,t.owner FROM todos t
         JOIN changes c ON c.seq=(SELECT MAX(seq) FROM changes WHERE todo=t.id)",
            [],
        )
        .unwrap();
    let before = store.list().unwrap();
    let changes: i64 = store
        .db
        .query_row("SELECT COUNT(*) FROM changes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(folded_hand(&store), None);
    let (todo, reads, bodies, fields) = observed_hand(&store);
    assert_eq!(todo, None);
    assert!(bodies.is_empty(), "no returned bodies; reads={reads}");
    assert!(
        !fields
            .iter()
            .any(|field| matches!(field.as_str(), "before_values" | "after_values"))
    );
    assert_eq!(reads, 1);
    assert_eq!(store.list().unwrap(), before);
    assert_eq!(
        store
            .db
            .query_row("SELECT COUNT(*) FROM changes", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        changes
    );
}

#[test]
fn t5642b_narrow_history_matches_actor_semantics() {
    let a = json!({"kind":"agent","id":"a","parent":null});
    let b = json!({"kind":"agent","id":"b","parent":null});
    let parent = json!({"kind":"agent","id":"a","parent":"parent"});
    let user = json!({"kind":"user","id":"a","parent":null});
    // Each event is (before owner, after owner, handed). Missing owner differs from explicit null
    // only in its encoding, as both decode to None in Values.
    let cases = [
        (
            "edit after hand",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (a.clone(), a.clone(), None),
            ],
            false,
        ),
        (
            "away and back",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (a.clone(), b.clone(), None),
                (b.clone(), a.clone(), None),
            ],
            true,
        ),
        (
            "other hand",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (a.clone(), a.clone(), Some(b.clone())),
            ],
            true,
        ),
        (
            "parent transition",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (parent.clone(), a.clone(), None),
            ],
            true,
        ),
        (
            "kind transition",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (user.clone(), a.clone(), None),
            ],
            true,
        ),
        (
            "different handed parent",
            vec![(a.clone(), a.clone(), Some(parent))],
            true,
        ),
        (
            "different handed kind",
            vec![(a.clone(), a.clone(), Some(user))],
            true,
        ),
        (
            "null owner",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (Value::Null, a.clone(), None),
            ],
            true,
        ),
        (
            "missing owner",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (json!("missing"), a.clone(), None),
            ],
            true,
        ),
        (
            "null to missing",
            vec![
                (a.clone(), a.clone(), Some(a.clone())),
                (Value::Null, json!("missing"), None),
            ],
            false,
        ),
    ];
    for (name, events, eligible) in cases {
        let store = store::Store::open(Path::new(":memory:")).unwrap();
        store
            .insert(
                "todo",
                "body",
                &[],
                &Actor::user(),
                Some(&agent("a")),
                None,
                0,
            )
            .unwrap();
        for (before, after, handed) in events {
            let values = |owner: Value| {
                let mut value = json!({"title":"todo","body":"body","done":false,"blockers":[]});
                if owner != json!("missing") {
                    value["owner"] = owner;
                }
                value
            };
            let before = values(before);
            let after = values(after);
            // Different key order/whitespace must not masquerade as an owner transition.
            let after = if after["owner"] == a {
                serde_json::to_string(&after).unwrap().replace(
                    &a.to_string(),
                    "{ \"parent\": null, \"id\": \"a\", \"kind\": \"agent\" }",
                )
            } else {
                after.to_string()
            };
            store.db.execute("INSERT INTO changes(todo,before_values,after_values,after_touch,handed) VALUES(1,?1,?2,0,?3)",
                rusqlite::params![before.to_string(),after,handed.map(|v| v.to_string())]).unwrap();
        }
        // A later unrelated body edit must not hide the last relevant event.
        store.db.execute("INSERT INTO changes(todo,before_values,after_values,after_touch) SELECT todo,after_values,json_set(after_values,'$.body','later body'),0 FROM changes ORDER BY seq DESC LIMIT 1", []).unwrap();
        assert_eq!(folded_hand(&store).is_some(), eligible, "fixture {name}");
        assert_eq!(
            !store.list_handed().unwrap().is_empty(),
            !eligible,
            "list_handed {name}"
        );
        assert_eq!(
            store.hand("a", 0, &Actor::daemon()).unwrap().is_some(),
            eligible,
            "hand {name}"
        );
    }
}
