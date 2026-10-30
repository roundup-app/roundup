//! U3787a observes the production router, authority guards and shared Project store.
use super::*;

/// T30: restoring a Todo's owner or blockers is a Change, so `updated_at` moves; the rest returns.
fn without_updated_at(mut value: Value) -> Value {
    if let Some(todos) = value.as_array_mut() {
        todos.iter_mut().for_each(|todo| {
            todo.as_object_mut()
                .map(|object| object.remove("updated_at"));
        });
    } else if let Some(object) = value.as_object_mut() {
        object.remove("updated_at");
    }
    value
}

async fn call(daemon: &Daemon, method: &str, params: Value) -> Result<Value, RpcError> {
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    daemon.route(&mut conn, method, params).await
}

#[tokio::test]
async fn u3787a_daemon_restores_exact_graph_without_starting_processes() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = test_daemon(dir.path()).unwrap();
    for name in ["a", "b"] {
        call(
            &daemon,
            "rail.createWorkstream",
            json!({"name":name,"parent":null}),
        )
        .await
        .unwrap();
    }
    let homes = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    for title in ["first", "chosen", "surviving"] {
        call(
            &daemon,
            "todo.create",
            json!({"title":title,"owner":Actor::user()}),
        )
        .await
        .unwrap();
    }
    call(&daemon, "todo.move", json!({"id":2,"home":homes[0]["id"]}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":3,"home":homes[1]["id"]}))
        .await
        .unwrap();
    call(&daemon, "todo.setBlockers", json!({"id":2,"blockers":[1]}))
        .await
        .unwrap();
    call(&daemon, "todo.setBlockers", json!({"id":3,"blockers":[2]}))
        .await
        .unwrap();
    call(&daemon, "todo.complete", json!({"id":2}))
        .await
        .unwrap();
    call(
        &daemon,
        "todo.comment",
        json!({"id":2,"body":"retained comment"}),
    )
    .await
    .unwrap();
    let before = call(&daemon, "todo.list", Value::Null).await.unwrap();
    let history = call(&daemon, "todo.getHistory", json!({"id":2}))
        .await
        .unwrap();
    let comments = call(&daemon, "todo.comments", json!({"id":2}))
        .await
        .unwrap();
    let rail = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let messages = call(&daemon, "message.list", json!({})).await.unwrap();
    call(
        &daemon,
        "todo.delete",
        json!({"operation":"bulk","ids":[1,2,99]}),
    )
    .await
    .unwrap();
    call(&daemon, "todo.restore", json!({"operation":"bulk"}))
        .await
        .unwrap();
    let restoration = call(&daemon, "todo.deletion", json!({"operation":"bulk"}))
        .await
        .unwrap()["restoration"]
        .clone();
    let redo = json!({"source":"bulk","operation":"redo-bulk","restoration":restoration});
    let receipt = call(&daemon, "todo.redo", redo.clone()).await.unwrap();
    assert_eq!(receipt["deleted"], json!([1, 2]));
    assert_eq!(
        call(&daemon, "todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(call(&daemon, "todo.redo", redo).await.unwrap(), receipt);
    call(&daemon, "todo.restore", json!({"operation":"redo-bulk"}))
        .await
        .unwrap();
    assert_eq!(
        without_updated_at(call(&daemon, "todo.list", Value::Null).await.unwrap()),
        without_updated_at(before)
    );
    assert_eq!(
        call(&daemon, "todo.getHistory", json!({"id":2}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(
        call(&daemon, "todo.comments", json!({"id":2}))
            .await
            .unwrap(),
        comments
    );
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), rail);
    assert_eq!(
        call(&daemon, "message.list", json!({})).await.unwrap(),
        messages
    );
    assert_eq!(
        call(&daemon, "terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u3787a_daemon_refuses_cross_project_and_non_user_restoration() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = test_daemon(dir.path()).unwrap();
    call(&daemon, "todo.create", json!({"title":"chosen"}))
        .await
        .unwrap();
    call(
        &daemon,
        "todo.delete",
        json!({"operation":"original-project","ids":[1]}),
    )
    .await
    .unwrap();
    let other_dir = tempfile::tempdir().unwrap();
    let other = test_daemon(other_dir.path()).unwrap();
    assert_eq!(
        call(
            &other,
            "todo.restore",
            json!({"operation":"original-project"})
        )
        .await
        .unwrap_err()
        .code,
        code::NOT_FOUND
    );
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "untrusted".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    assert_eq!(
        daemon
            .route_inner(
                &mut conn,
                "todo.restore",
                json!({"operation":"original-project"})
            )
            .await
            .unwrap_err()
            .code,
        code::FORBIDDEN
    );
    assert_eq!(
        call(
            &daemon,
            "todo.restore",
            json!({"operation":"original-project","snapshot":[]})
        )
        .await
        .unwrap_err()
        .code,
        code::INVALID_PARAMS
    );
    assert_eq!(
        call(
            &daemon,
            "todo.restore",
            json!({"operation":"original-project"})
        )
        .await
        .unwrap()["state"],
        "restored"
    );
}

#[tokio::test]
async fn u3787a_daemon_keeps_missing_home_restoration_retryable() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = test_daemon(dir.path()).unwrap();
    let home = call(
        &daemon,
        "rail.createWorkstream",
        json!({"name":"Home","parent":null}),
    )
    .await
    .unwrap()["id"]
        .clone();
    call(&daemon, "todo.create", json!({"title":"chosen"}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":1,"home":home}))
        .await
        .unwrap();
    call(
        &daemon,
        "todo.delete",
        json!({"operation":"home","ids":[1]}),
    )
    .await
    .unwrap();
    call(&daemon, "rail.remove", json!({"id":home}))
        .await
        .unwrap();
    let error = call(&daemon, "todo.restore", json!({"operation":"home"}))
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    assert_eq!(
        serde_json::to_value(error.data).unwrap(),
        json!({"kind":"undo-parent","id":home,"name":"Home"})
    );
    assert_eq!(
        call(&daemon, "todo.deletion", json!({"operation":"home"}))
            .await
            .unwrap()["state"],
        "deleted"
    );
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u3787a_redo_requires_original_project_restoration_and_user_authority() {
    let dirs = [tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap()];
    let daemons = [
        test_daemon(dirs[0].path()).unwrap(),
        test_daemon(dirs[1].path()).unwrap(),
    ];
    let mut restorations = Vec::new();
    for daemon in &daemons {
        call(
            daemon,
            "todo.create",
            json!({"title":"same numeric identity"}),
        )
        .await
        .unwrap();
        call(
            daemon,
            "todo.delete",
            json!({"operation":"same-key","ids":[1]}),
        )
        .await
        .unwrap();
        restorations.push(
            call(daemon, "todo.restore", json!({"operation":"same-key"}))
                .await
                .unwrap(),
        );
    }
    let redo = json!({"source":"same-key","operation":"redo","restoration":restorations[0]["restoration"]});
    let before = call(&daemons[1], "todo.list", Value::Null).await.unwrap();
    assert_eq!(
        call(&daemons[1], "todo.redo", redo.clone())
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    assert_eq!(
        call(&daemons[1], "todo.list", Value::Null).await.unwrap(),
        before
    );
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "untrusted".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    assert_eq!(
        daemons[0]
            .route_inner(&mut conn, "todo.redo", redo.clone())
            .await
            .unwrap_err()
            .code,
        code::FORBIDDEN
    );
    call(&daemons[0], "todo.redo", redo).await.unwrap();
    assert_eq!(
        call(&daemons[0], "todo.list", Value::Null).await.unwrap(),
        json!([])
    );
    assert_eq!(
        call(&daemons[1], "todo.list", Value::Null).await.unwrap(),
        before
    );
}
