// T4902 retires T29 duration setup; all non-duration scenario proofs below remain.
use super::*;

#[tokio::test]
async fn u3787a_undo_restores_original_graph() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call_as(
        agent("maker"),
        "todo.create",
        json!({"title":"first", "body":"retained", "owner":agent("worker")}),
    )
    .await
    .unwrap();
    h.call_as(Actor::daemon(), "todo.hand", json!({"agent":"worker"}))
        .await
        .unwrap();
    made(&h, json!({"title":"dependent", "blockers":[1]})).await;
    h.call("todo.move", json!({"id":1,"home":"a"}))
        .await
        .unwrap();
    h.call("todo.move", json!({"id":2,"home":"b"}))
        .await
        .unwrap();
    h.call("todo.comment", json!({"id":1,"body":"keep me"}))
        .await
        .unwrap();
    h.call(
        "todo.addRef",
        json!({"id":1,"url":"roundup://pad/retained?project=k#Section"}),
    )
    .await
    .unwrap();
    let mut before = h.call("todo.list", Value::Null).await.unwrap();
    let history = changes(&h, 1).await;
    let comments = h.call("todo.comments", json!({"id":1})).await.unwrap();
    h.call("todo.delete", json!({"operation":"chosen","ids":[1]}))
        .await
        .unwrap();
    h.call("todo.restore", json!({"operation":"chosen"}))
        .await
        .unwrap();
    h.call("todo.move", json!({"id":2,"home":"newer"}))
        .await
        .unwrap();
    before[1]["home"] = json!("newer");
    for (source, operation) in [("chosen", "redo-1"), ("redo-1", "redo-2")] {
        let restoration = h
            .call("todo.deletion", json!({"operation":source}))
            .await
            .unwrap()["restoration"]
            .clone();
        let redo = json!({"source":source,"operation":operation,"restoration":restoration});
        h.call("todo.redo", redo.clone()).await.unwrap();
        assert!(h.call("todo.get", json!({"id":1})).await.is_err());
        assert_eq!(
            h.call("todo.get", json!({"id":2})).await.unwrap()["blockers"],
            json!([])
        );
        h.call("todo.restore", json!({"operation":operation}))
            .await
            .unwrap();
        // Unknown-outcome replay must remain a readback even after the next undo.
        assert_eq!(
            h.call("todo.redo", redo).await.unwrap()["state"],
            "restored"
        );
    }
    // The dependent's blocker Changes (T6) move its `updated_at` (T30); everything else returns.
    let mut restored = h.call("todo.list", Value::Null).await.unwrap();
    restored[1]["updated_at"] = before[1]["updated_at"].clone();
    assert_eq!(restored, before);
    assert_eq!(changes(&h, 1).await, history);
    assert!(
        h.call_as(Actor::daemon(), "todo.hand", json!({"agent":"worker"}))
            .await
            .unwrap()
            .is_null()
    );
    assert_eq!(
        h.call("todo.comments", json!({"id":1})).await.unwrap(),
        comments
    );
}

#[tokio::test]
async fn u3787a_replay_reconciles_only_the_successful_chosen_subset() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    for title in ["chosen", "unchosen"] {
        made(&h, json!({"title":title})).await;
    }
    h.events();
    let request = json!({"operation":"bulk", "ids":[1,3,1]});
    let first = h.call("todo.delete", request.clone()).await.unwrap();
    made(&h, json!({"title":"arrival"})).await;
    h.events();
    assert_eq!(
        h.call("todo.deletion", json!({"operation":"bulk"}))
            .await
            .unwrap(),
        first
    );
    assert_eq!(h.call("todo.delete", request.clone()).await.unwrap(), first);
    assert!(h.events().is_empty());
    assert_eq!(first["deleted"], json!([1]));
    assert_eq!(first["missing"], json!([3]));
    h.call("todo.restore", json!({"operation":"bulk"}))
        .await
        .unwrap();
    h.events();
    assert_eq!(
        h.call("todo.delete", request).await.unwrap()["state"],
        "restored"
    );
    h.call("todo.restore", json!({"operation":"bulk"}))
        .await
        .unwrap();
    assert!(h.events().is_empty());
    assert_eq!(
        h.call("todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let before = h.call("todo.list", Value::Null).await.unwrap();
    // Clear done uses the captured successful set, never today's done Todos.
    h.call("todo.complete", json!({"id":3})).await.unwrap();
    let arrival = h.call("todo.get", json!({"id":3})).await.unwrap();
    let restoration = h
        .call("todo.deletion", json!({"operation":"bulk"}))
        .await
        .unwrap()["restoration"]
        .clone();
    let redo = json!({"source":"bulk","operation":"bulk-redo","restoration":restoration});
    let deleted = h.call("todo.redo", redo.clone()).await.unwrap();
    assert_eq!(deleted["deleted"], json!([1]));
    assert_eq!(
        h.call("todo.get", json!({"id":2})).await.unwrap(),
        *before
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == 2)
            .unwrap()
    );
    assert_eq!(h.call("todo.get", json!({"id":3})).await.unwrap(), arrival);
    h.events();
    assert_eq!(h.call("todo.redo", redo).await.unwrap(), deleted);
    assert_eq!(
        h.call("todo.deletion", json!({"operation":"bulk-redo"}))
            .await
            .unwrap(),
        deleted
    );
    assert!(h.events().is_empty());
    assert_eq!(
        h.call(
            "todo.redo",
            json!({"source":"bulk","operation":"widen","restoration":restoration})
        )
        .await
        .unwrap_err()
        .code,
        code::CONFLICT
    );
    h.call("todo.restore", json!({"operation":"bulk-redo"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap(),
        *before
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == 1)
            .unwrap()
    );
}

#[tokio::test]
async fn u3787a_transaction_refusal_retains_nothing_and_deletes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title":"chosen"})).await;
    let mut db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    let tx = db.transaction().unwrap();
    Todos::delete_in(
        &tx,
        &Actor::user(),
        &contracts::todo::DeleteParams {
            operation: "coordinated".into(),
            ids: vec![1],
        },
        0,
    )
    .unwrap();
    tx.rollback().unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["title"],
        "chosen"
    );
    assert!(
        h.call("todo.deletion", json!({"operation":"coordinated"}))
            .await
            .unwrap()
            .is_null()
    );
}

#[tokio::test]
async fn u3787a_restore_collision_keeps_the_operation_retryable() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title":"original"})).await;
    h.call("todo.delete", json!({"operation":"collision", "ids":[1]}))
        .await
        .unwrap();
    // An external identity collision is the input this acceptance clause explicitly names.
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute(
        "INSERT INTO todos(id,title,body,created_at) VALUES(1,'collision','',0)",
        [],
    )
    .unwrap();
    assert_eq!(
        h.call("todo.restore", json!({"operation":"collision"}))
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["title"],
        "collision"
    );
    assert_eq!(
        h.call("todo.deletion", json!({"operation":"collision"}))
            .await
            .unwrap()["state"],
        "deleted"
    );
    db.execute("DELETE FROM todos WHERE id=1", []).unwrap();
    h.call("todo.restore", json!({"operation":"collision"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["title"],
        "original"
    );
}

#[tokio::test]
async fn u3787a_retained_operation_authority_refuses_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title":"original"})).await;
    h.call("todo.delete", json!({"operation":"authority", "ids":[1]}))
        .await
        .unwrap();
    for method in ["todo.restore", "todo.deletion", "todo.delete"] {
        let params = if method == "todo.delete" {
            json!({"operation":"authority", "ids":[1]})
        } else {
            json!({"operation":"authority"})
        };
        assert_eq!(
            h.call_as(agent("other"), method, params)
                .await
                .unwrap_err()
                .code,
            code::FORBIDDEN
        );
    }
    assert_eq!(
        h.call(
            "todo.restore",
            json!({"operation":"authority","todos":[{"id":1,"title":"forged"}]})
        )
        .await
        .unwrap_err()
        .code,
        code::INVALID_PARAMS
    );
    assert_eq!(
        h.call("todo.delete", json!({"operation":"authority", "ids":[2]}))
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    h.call("todo.restore", json!({"operation":"authority"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["title"],
        "original"
    );
}

#[tokio::test]
async fn u3787a_failed_delete_rolls_back_retention_with_the_entire_bulk() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    for title in ["first", "second"] {
        made(&h, json!({"title":title})).await;
    }
    let before = h.call("todo.list", Value::Null).await.unwrap();
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_delete BEFORE DELETE ON todos WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'refused'); END;").unwrap();
    assert!(
        h.call("todo.delete", json!({"operation":"refused", "ids":[1,2]}))
            .await
            .is_err()
    );
    assert_eq!(h.call("todo.list", Value::Null).await.unwrap(), before);
    assert!(
        h.call("todo.deletion", json!({"operation":"refused"}))
            .await
            .unwrap()
            .is_null()
    );
    db.execute_batch("DROP TRIGGER refuse_delete;").unwrap();
    assert_eq!(
        h.call("todo.delete", json!({"operation":"refused", "ids":[1,2]}))
            .await
            .unwrap()["deleted"],
        json!([1, 2])
    );
    let restored = h
        .call("todo.restore", json!({"operation":"refused"}))
        .await
        .unwrap();
    let before = h.call("todo.list", Value::Null).await.unwrap();
    let redo = json!({"source":"refused","operation":"refused-redo","restoration":restored["restoration"]});
    db.execute_batch("CREATE TRIGGER refuse_delete BEFORE DELETE ON todos WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'refused'); END;").unwrap();
    assert!(h.call("todo.redo", redo.clone()).await.is_err());
    assert_eq!(h.call("todo.list", Value::Null).await.unwrap(), before);
    assert_eq!(
        h.call("todo.deletion", json!({"operation":"refused"}))
            .await
            .unwrap(),
        restored
    );
    assert!(
        h.call("todo.deletion", json!({"operation":"refused-redo"}))
            .await
            .unwrap()
            .is_null()
    );
    db.execute_batch("DROP TRIGGER refuse_delete;").unwrap();
    // Reopen before retry: rollback must leave neither source consumption nor a
    // redo receipt, and retained authority must survive losing the connection.
    drop(h);
    let h = Harness::new(dir.path());
    h.call("todo.redo", redo).await.unwrap();
    assert_eq!(h.call("todo.list", Value::Null).await.unwrap(), json!([]));
}

#[tokio::test]
async fn u3787a_coordinated_restore_refusal_rolls_back_every_participant() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    for title in ["survivor", "chosen"] {
        made(&h, json!({"title":title})).await;
    }
    h.call(
        "todo.delete",
        json!({"operation":"coordinated-restore", "ids":[2]}),
    )
    .await
    .unwrap();
    let error = h
        .todos
        .restore_with(&Actor::user(), "coordinated-restore", 0, |tx| {
            tx.execute("UPDATE todos SET title='coordinator change' WHERE id=1", [])
                .map_err(RpcError::internal)?;
            Err(RpcError::conflict("coordinator refused"))
        })
        .unwrap_err();
    assert_eq!(error.code, code::CONFLICT);
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["title"],
        "survivor"
    );
    assert_eq!(
        h.call("todo.deletion", json!({"operation":"coordinated-restore"}))
            .await
            .unwrap()["state"],
        "deleted"
    );
    h.call("todo.restore", json!({"operation":"coordinated-restore"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":2})).await.unwrap()["title"],
        "chosen"
    );
}

#[tokio::test]
async fn u3787a_redo_refusal_preserves_newer_placement_and_allows_repair() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    for title in ["first", "second"] {
        made(&h, json!({"title":title})).await;
    }
    h.call("todo.move", json!({"id":1,"home":"original"}))
        .await
        .unwrap();
    h.call("todo.delete", json!({"operation":"move","ids":[1,2]}))
        .await
        .unwrap();
    h.call("todo.restore", json!({"operation":"move"}))
        .await
        .unwrap();
    let restoration = h
        .call("todo.deletion", json!({"operation":"move"}))
        .await
        .unwrap()["restoration"]
        .clone();
    let redo = json!({"source":"move","operation":"move-redo","restoration":restoration});
    for (method, changed, repaired) in [
        (
            "todo.move",
            json!({"id":1,"home":"newer"}),
            json!({"id":1,"home":"original"}),
        ),
        (
            "todo.assign",
            json!({"id":1,"owner":Actor::user()}),
            json!({"id":1,"owner":null}),
        ),
    ] {
        h.call(method, changed).await.unwrap();
        let before = h.call("todo.list", Value::Null).await.unwrap();
        h.events();
        assert_eq!(
            h.call("todo.redo", redo.clone()).await.unwrap_err().code,
            code::CONFLICT
        );
        assert_eq!(h.call("todo.list", Value::Null).await.unwrap(), before);
        assert!(h.events().is_empty());
        assert!(
            h.call("todo.deletion", json!({"operation":"move-redo"}))
                .await
                .unwrap()
                .is_null()
        );
        h.call(method, repaired).await.unwrap();
    }
    assert_eq!(
        h.call_as(agent("other"), "todo.redo", redo.clone())
            .await
            .unwrap_err()
            .code,
        code::FORBIDDEN
    );
    h.call("todo.redo", redo).await.unwrap();
    assert_eq!(h.call("todo.list", Value::Null).await.unwrap(), json!([]));
    h.call("todo.restore", json!({"operation":"move-redo"}))
        .await
        .unwrap();
    assert_eq!(get_home(&h, 1).await, "original");
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["owner"],
        Value::Null
    );
}

#[tokio::test]
async fn u3787a_redo_refuses_replaced_creation_and_retries_after_authoritative_repair() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title":"original"})).await;
    h.call("todo.delete", json!({"operation":"first","ids":[1]}))
        .await
        .unwrap();
    h.call("todo.restore", json!({"operation":"first"}))
        .await
        .unwrap();
    let original = h.call("todo.get", json!({"id":1})).await.unwrap();
    h.call("todo.delete", json!({"operation":"later","ids":[1]}))
        .await
        .unwrap();
    // An external replacement copies all visible fields and timestamps, but cannot
    // acquire the retained creation Change. This is the named incarnation probe.
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute("INSERT INTO todos SELECT id,title,body,done,created_at,creator,home,pos,owner,updated_at FROM deleted_todos WHERE operation='later'", []).unwrap();
    let restoration = h
        .call("todo.deletion", json!({"operation":"first"}))
        .await
        .unwrap()["restoration"]
        .clone();
    let redo = json!({"source":"first","operation":"retry","restoration":restoration});
    assert_eq!(h.call("todo.get", json!({"id":1})).await.unwrap(), original);
    assert_eq!(
        h.call("todo.redo", redo.clone()).await.unwrap_err().code,
        code::CONFLICT
    );
    assert_eq!(h.call("todo.get", json!({"id":1})).await.unwrap(), original);
    db.execute("DELETE FROM todos WHERE id=1", []).unwrap();
    h.call("todo.restore", json!({"operation":"later"}))
        .await
        .unwrap();
    h.call("todo.redo", redo).await.unwrap();
    assert!(h.call("todo.get", json!({"id":1})).await.is_err());
    h.call("todo.restore", json!({"operation":"retry"}))
        .await
        .unwrap();
    assert_eq!(h.call("todo.get", json!({"id":1})).await.unwrap(), original);
}
