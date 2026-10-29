//! U3787a: restoration crosses the same socket and Project storage as production clients.
use rpc::Client;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::net::UnixListener;

struct World {
    _dir: tempfile::TempDir,
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
}
impl Drop for World {
    fn drop(&mut self) {
        self.server.abort();
    }
}
async fn world() -> World {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let daemon = Arc::new(rupd::Daemon::open(dir.path()).unwrap());
    let server = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    let client = Client::connect(&socket).await.unwrap();
    World {
        _dir: dir,
        client,
        server,
    }
}
async fn call(w: &World, method: &str, p: Value) -> Value {
    w.client.request(method, p).await.unwrap()
}
#[tokio::test]
async fn u3787a_restore_keeps_the_original_pad_creation() {
    let w = world().await;
    let original = call(
        &w,
        "pad.create",
        json!({"name":"notes", "text":"exact\n雪\n"}),
    )
    .await;
    let deleted = call(&w, "pad.delete", json!({"name":"notes", "operation":"remove-one", "expectedIncarnation":original["incarnation"]})).await;
    let restored = call(
        &w,
        "pad.restore",
        json!({"project":deleted["project"], "operation":"remove-one"}),
    )
    .await;
    assert_eq!(restored["pad"], original);
    assert_eq!(
        call(&w, "pad.read", json!({"name":"notes"})).await,
        original
    );
}

fn deletion_id(receipt: &Value) -> Value {
    json!({"project":receipt["project"], "operation":receipt["operation"]})
}
async fn deleted(w: &World, name: &str) -> (Value, Value) {
    let pad = call(
        w,
        "pad.create",
        json!({"name":name,"text":"  retained é 🧭\n\nlast  "}),
    )
    .await;
    let receipt = call(w,"pad.delete",json!({"name":name,"operation":format!("delete-{name}"),"expectedIncarnation":pad["incarnation"]})).await;
    (pad, receipt)
}
async fn identify(w: &World, id: &str) {
    call(
        w,
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":id,"parent":null}}),
    )
    .await;
}
async fn user(w: &World) {
    call(
        w,
        "daemon.identify",
        json!({"actor":{"kind":"user","id":"you","parent":null}}),
    )
    .await;
}

#[tokio::test]
async fn u3787a_restore_keeps_agent_owner_home_revision_after_reopen() {
    let mut w = world().await;
    let home = call(&w, "rail.createWorkstream", json!({"name":"original Home"})).await;
    identify(&w, home["id"].as_str().unwrap()).await;
    call(&w, "pad.create", json!({"name":"owned","text":"first"})).await;
    let original = call(
        &w,
        "pad.write",
        json!({"name":"owned","text":"  second\n雪\n  ","expectedRevision":1}),
    )
    .await;
    user(&w).await;
    let receipt = call(
        &w,
        "pad.delete",
        json!({"name":"owned","operation":"agent-owned"}),
    )
    .await;
    w.server.abort();
    let socket = w._dir.path().join("reopen.sock");
    let daemon = Arc::new(rupd::Daemon::open(w._dir.path()).unwrap());
    w.server = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    w.client = Client::connect(&socket).await.unwrap();
    let restored = call(&w, "pad.restore", deletion_id(&receipt)).await;
    assert_eq!(restored["pad"], original);
    assert_eq!(
        call(&w, "pad.read", json!({"name":"owned"})).await,
        original
    );
    assert_eq!(call(&w, "terminal.list", Value::Null).await, json!([]));
    assert_eq!(
        call(&w, "rail.tree", Value::Null).await[0]["attempt"],
        Value::Null
    );
}

#[tokio::test]
async fn u3787a_name_conflicts_keep_the_operation_retryable() {
    for (name, replacement) in [("notes", "NOTES"), ("é", "e\u{301}")] {
        let w = world().await;
        let (original, receipt) = deleted(&w, name).await;
        let other = call(
            &w,
            "pad.create",
            json!({"name":replacement,"text":"do not overwrite"}),
        )
        .await;
        let err = w
            .client
            .request("pad.restore", deletion_id(&receipt))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::CONFLICT);
        assert_eq!(
            call(&w, "pad.read", json!({"name":replacement})).await,
            other
        );
        assert_eq!(
            call(
                &w,
                "pad.getDeletion",
                json!({"operation":receipt["operation"]})
            )
            .await["restored"],
            false
        );
        call(&w, "pad.delete", json!({"name":replacement})).await;
        assert_eq!(
            call(&w, "pad.restore", deletion_id(&receipt)).await["pad"],
            original
        );
    }
}

#[tokio::test]
async fn u3787a_replayed_restore_never_overwrites_later_edits() {
    let w = world().await;
    let (_, receipt) = deleted(&w, "notes").await;
    let id = deletion_id(&receipt);
    call(&w, "pad.restore", id.clone()).await;
    let edited = call(&w, "pad.write", json!({"name":"notes","text":"new work"})).await;
    call(&w, "pad.restore", id).await;
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, edited);
    assert_eq!(
        call(&w, "provenance.history", json!({"item":"pad:notes"}))
            .await
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["verb"] == "wrote")
            .count(),
        4
    );
}

#[tokio::test]
async fn u3787a_unknown_delete_reconciles_without_deleting_replacement() {
    let w = world().await;
    let (_, receipt) = deleted(&w, "notes").await;
    let other = call(
        &w,
        "pad.create",
        json!({"name":"notes","text":"replacement"}),
    )
    .await;
    assert_eq!(
        call(&w, "pad.getDeletion", json!({"operation":"delete-notes"})).await,
        receipt
    );
    let repeated = call(&w,"pad.delete",json!({"name":"notes","operation":"delete-notes","expectedIncarnation":receipt["pad"]["incarnation"]})).await;
    assert_eq!(repeated, receipt);
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, other);
}

#[tokio::test]
async fn u3787a_operation_cannot_acquire_a_different_target() {
    let w = world().await;
    deleted(&w, "notes").await;
    let other = call(&w, "pad.create", json!({"name":"other"})).await;
    assert_eq!(
        w.client
            .request(
                "pad.delete",
                json!({"name":"other","operation":"delete-notes"})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(call(&w, "pad.read", json!({"name":"other"})).await, other);
}

#[tokio::test]
async fn u3787a_stale_delete_never_removes_a_replacement_creation() {
    let w = world().await;
    let (old, _) = deleted(&w, "notes").await;
    let other = call(&w, "pad.create", json!({"name":"notes"})).await;
    assert_eq!(
        w.client
            .request(
                "pad.delete",
                json!({"name":"notes","expectedIncarnation":old["incarnation"]})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, other);
}

#[tokio::test]
async fn u3787a_cross_project_restore_refuses_even_with_the_same_operation() {
    let a = world().await;
    let b = world().await;
    let (_, receipt) = deleted(&a, "notes").await;
    deleted(&b, "notes").await;
    assert_eq!(
        b.client
            .request("pad.restore", deletion_id(&receipt))
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        call(&b, "pad.getDeletion", json!({"operation":"delete-notes"})).await["restored"],
        false
    );
    assert_eq!(call(&b, "pad.list", Value::Null).await, json!([]));
}

#[tokio::test]
async fn u3787a_other_actor_cannot_read_or_consume_the_operation() {
    let w = world().await;
    let (_, receipt) = deleted(&w, "notes").await;
    identify(&w, "intruder").await;
    for method in ["pad.getDeletion", "pad.restore"] {
        assert_eq!(
            w.client
                .request(method, deletion_id(&receipt))
                .await
                .unwrap_err()
                .code,
            rpc::code::FORBIDDEN
        );
    }
    user(&w).await;
    assert_eq!(
        call(&w, "pad.getDeletion", json!({"operation":"delete-notes"})).await["restored"],
        false
    );
}

#[tokio::test]
async fn u3787a_bulk_successes_are_individually_restorable_without_failed_targets() {
    let w = world().await;
    let home = call(&w, "rail.createWorkstream", json!({"name":"Home"})).await;
    identify(&w, home["id"].as_str().unwrap()).await;
    let own = call(&w, "pad.create", json!({"name":"own"})).await;
    user(&w).await;
    let other = call(&w, "pad.create", json!({"name":"other"})).await;
    identify(&w, home["id"].as_str().unwrap()).await;
    let receipt = call(
        &w,
        "pad.delete",
        json!({"name":"own","operation":"subset-own"}),
    )
    .await;
    assert_eq!(
        w.client
            .request(
                "pad.delete",
                json!({"name":"other","operation":"subset-other","expectedIncarnation":"retired"})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    assert_eq!(call(&w, "pad.read", json!({"name":"own"})).await, own);
    assert_eq!(call(&w, "pad.read", json!({"name":"other"})).await, other);
    assert_eq!(
        w.client
            .request("pad.getDeletion", json!({"operation":"subset-other"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
}

#[tokio::test]
async fn u3787a_mirror_refusal_rolls_back_delete_and_leaves_no_operation() {
    let w = world().await;
    let pad = call(&w, "pad.create", json!({"name":"notes","text":"keep"})).await;
    call(&w, "pad.setStorage", json!({"files":true})).await;
    let file = w._dir.path().join("pads/notes.md");
    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    assert!(
        w.client
            .request("pad.delete", json!({"name":"notes","operation":"retry"}))
            .await
            .is_err()
    );
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    assert_eq!(
        w.client
            .request("pad.getDeletion", json!({"operation":"retry"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    assert!(file.is_dir());
}

#[tokio::test]
async fn u3787a_mirror_refusal_rolls_back_restore_and_can_retry() {
    let w = world().await;
    call(&w, "pad.setStorage", json!({"files":true})).await;
    let (pad, receipt) = deleted(&w, "notes").await;
    let file = w._dir.path().join("pads/notes.md");
    std::fs::write(&file, "external work").unwrap();
    assert!(
        w.client
            .request("pad.restore", deletion_id(&receipt))
            .await
            .is_err()
    );
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([]));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "external work");
    assert_eq!(
        call(&w, "pad.getDeletion", json!({"operation":"delete-notes"})).await["restored"],
        false
    );
    std::fs::remove_file(&file).unwrap();
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&receipt)).await["pad"],
        pad
    );
    assert_eq!(
        std::fs::read_to_string(file).unwrap(),
        pad["text"].as_str().unwrap()
    );
}

#[tokio::test]
async fn u3787a_restored_pad_can_publish_again_without_reauthorizing_old_publications() {
    let w = world().await;
    let pad = call(&w, "pad.create", json!({"name":"notes","text":"published"})).await;
    let mut publications = Vec::new();
    for (key, operation) in [("first", "delete-first"), ("second", "delete-second")] {
        let publication = call(&w, "deliverable.publish", json!({"key":key,"title":"Result","target":{"kind":"pad","name":"notes","incarnation":pad["incarnation"],"revision":1}})).await;
        let resolved = call(
            &w,
            "deliverable.resolve",
            json!({"project":publication["project"],"id":publication["id"]}),
        )
        .await;
        assert_eq!(resolved["kind"], "retained");
        assert_eq!(
            std::fs::read_to_string(resolved["path"].as_str().unwrap()).unwrap(),
            "published"
        );
        publications.push(publication);
        let receipt = call(
            &w,
            "pad.delete",
            json!({"name":"notes","operation":operation}),
        )
        .await;
        call(&w, "pad.restore", deletion_id(&receipt)).await;
        for publication in &publications {
            assert_eq!(
                call(
                    &w,
                    "deliverable.resolve",
                    json!({"project":publication["project"],"id":publication["id"]})
                )
                .await,
                json!({"kind":"unavailable","cause":"access-revoked"})
            );
        }
    }
}

#[tokio::test]
async fn u3787a_coordinator_rollback_keeps_the_original_operation_retryable() {
    let w = world().await;
    let (pad, receipt) = deleted(&w, "notes").await;
    let mut db = rusqlite::Connection::open(w._dir.path().join("project.db")).unwrap();
    {
        let tx = db.transaction().unwrap();
        let id: contracts::pad::DeletionId = serde_json::from_value(deletion_id(&receipt)).unwrap();
        let (restored, changed) = pads::restore(&tx, &contracts::Actor::user(), &id).unwrap();
        assert!(changed);
        assert_eq!(serde_json::to_value(restored.pad).unwrap(), pad);
        // The surrounding Rail transaction refuses; no Pad consumption may escape it.
    }
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([]));
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&receipt)).await["pad"],
        pad
    );
}

#[tokio::test]
async fn u3787a_coordinator_retains_authoritative_content_inside_its_transaction() {
    let w = world().await;
    call(&w, "pad.create", json!({"name":"notes","text":"old"})).await;
    let latest = call(&w, "pad.write", json!({"name":"notes","text":"latest"})).await;
    let mut db = rusqlite::Connection::open(w._dir.path().join("project.db")).unwrap();
    let tx = db.transaction().unwrap();
    let receipt = pads::retain(
        &tx,
        &contracts::Actor::user(),
        &contracts::pad::DeleteParams {
            name: "notes".into(),
            operation: Some("cascade".into()),
            expected_incarnation: None,
        },
    )
    .unwrap();
    assert_eq!(serde_json::to_value(receipt.pad).unwrap(), latest);
    drop(tx);
    assert_eq!(
        w.client
            .request("pad.getDeletion", json!({"operation":"cascade"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
}

#[tokio::test]
async fn u3787a_missing_original_home_refuses_without_consuming_the_operation() {
    let w = world().await;
    let home = call(&w, "rail.createWorkstream", json!({"name":"Home"})).await;
    call(&w, "pad.create", json!({"name":"notes"})).await;
    call(&w, "pad.move", json!({"name":"notes","home":home["id"]})).await;
    let receipt = call(
        &w,
        "pad.delete",
        json!({"name":"notes","operation":"missing-home"}),
    )
    .await;
    call(&w, "rail.remove", json!({"id":home["id"]})).await;
    let error = w
        .client
        .request("pad.restore", deletion_id(&receipt))
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    assert_eq!(
        serde_json::to_value(error.data).unwrap(),
        json!({"kind":"undo-parent","id":home["id"],"name":"Home"})
    );
    assert_eq!(
        call(&w, "pad.getDeletion", json!({"operation":"missing-home"})).await["restored"],
        false
    );
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([]));
}

#[tokio::test]
async fn u3787a_shared_pad_deletion_restore_preserves_publication_revocation() {
    let w = world().await;
    let home = call(&w, "rail.createWorkstream", json!({"name":"maker"})).await;
    identify(&w, home["id"].as_str().unwrap()).await;
    let pad = call(
        &w,
        "pad.create",
        json!({"name":"notes","text":"# Result\n\nexact"}),
    )
    .await;
    let publication = call(&w,"deliverable.publish",json!({"key":"result","title":"Result","target":{"kind":"pad","name":"notes","incarnation":pad["incarnation"],"revision":1}})).await;
    let receipt = call(&w, "pad.delete", json!({"name":"notes"})).await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let resolved = call(
        &w,
        "deliverable.resolve",
        json!({"project":publication["project"],"id":publication["id"]}),
    )
    .await;
    assert_eq!(resolved["kind"], "unavailable");
    assert_eq!(resolved["cause"], "access-revoked");
}

#[tokio::test]
async fn u3787a_restore_keeps_exact_existing_refs() {
    let w = world().await;
    let pad = call(
        &w,
        "pad.create",
        json!({"name":"notes","text":"# Result\n\nexact"}),
    )
    .await;
    let key = call(&w, "daemon.ping", Value::Null).await["projectKey"]
        .as_str()
        .unwrap()
        .to_owned();
    let url = format!("roundup://pad/notes?project={key}#Result");
    let todo = call(&w, "todo.create", json!({"title":"references"})).await;
    call(&w, "todo.addRef", json!({"id":todo["id"],"url":url})).await;
    let receipt = call(&w, "pad.delete", json!({"name":"notes"})).await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    assert_eq!(
        call(&w, "todo.refs", json!({"id":todo["id"]})).await,
        json!([{"url":url,"state":"ok"}])
    );
    assert_eq!(call(&w, "link.read", json!({"url":url})).await["pad"], pad);
}

#[tokio::test]
async fn u3787a_delete_after_rename_restores_the_authoritative_name_and_creation() {
    let w = world().await;
    let pad = call(&w, "pad.create", json!({"name":"first","text":"original"})).await;
    let renamed = call(
        &w,
        "pad.rename",
        json!({"name":"first","newName":"Moved","expectedIncarnation":pad["incarnation"]}),
    )
    .await;
    let receipt = call(
        &w,
        "pad.delete",
        json!({"name":"Moved","expectedIncarnation":pad["incarnation"]}),
    )
    .await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    assert_eq!(call(&w, "pad.read", json!({"name":"Moved"})).await, renamed);
    assert_eq!(
        w.client
            .request("pad.read", json!({"name":"first"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
}

#[tokio::test]
async fn u3787a_consumed_restore_does_not_reverse_a_later_rename() {
    let w = world().await;
    let (pad, receipt) = deleted(&w, "notes").await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let renamed = call(
        &w,
        "pad.rename",
        json!({"name":"notes","newName":"Moved","expectedIncarnation":pad["incarnation"]}),
    )
    .await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    assert_eq!(call(&w, "pad.read", json!({"name":"Moved"})).await, renamed);
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([renamed]));
}

#[tokio::test]
async fn u3787a_redo_retains_the_acknowledged_creation_for_another_undo() {
    let mut w = world().await;
    let (pad, receipt) = deleted(&w, "notes").await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let redo = json!({"project":receipt["project"],"restoredOperation":receipt["operation"],
        "operation":"redo-one","expectedIncarnation":pad["incarnation"],
        "expectedRevision":pad["revision"],"expectedHome":pad["home"]});
    let acknowledged = call(&w, "pad.redoDelete", redo.clone()).await;
    assert_eq!(acknowledged["pad"], pad);
    assert_eq!(acknowledged["operation"], "redo-one");
    // Lose the reply across a Daemon restart; readback still identifies exactly
    // the committed redo, without relying on a client-authored snapshot.
    w.server.abort();
    let socket = w._dir.path().join("redo-reopen.sock");
    let daemon = Arc::new(rupd::Daemon::open(w._dir.path()).unwrap());
    w.server = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    w.client = Client::connect(&socket).await.unwrap();
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([]));
    assert_eq!(
        call(&w, "pad.getDeletion", json!({"operation":"redo-one"})).await,
        acknowledged
    );
    let history = call(&w, "provenance.history", json!({"item":"pad:notes"})).await;
    assert_eq!(call(&w, "pad.redoDelete", redo.clone()).await, acknowledged);
    assert_eq!(
        call(&w, "provenance.history", json!({"item":"pad:notes"})).await,
        history
    );
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&acknowledged)).await["pad"],
        pad
    );
    // A lost redo reply replayed after Undo cannot delete again.
    assert_eq!(call(&w, "pad.redoDelete", redo).await["restored"], true);
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    // The original deletion key remains a readback, too.
    call(
        &w,
        "pad.delete",
        json!({"name":"notes","operation":"delete-notes",
        "expectedIncarnation":pad["incarnation"]}),
    )
    .await;
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    let second = call(
        &w,
        "pad.redoDelete",
        json!({"project":receipt["project"],
        "restoredOperation":"redo-one","operation":"redo-two",
        "expectedIncarnation":pad["incarnation"],"expectedRevision":pad["revision"],
        "expectedHome":pad["home"]}),
    )
    .await;
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&second)).await["pad"],
        pad
    );
}

fn redo_request(receipt: &Value, pad: &Value, operation: &str) -> Value {
    json!({"project":receipt["project"],"restoredOperation":receipt["operation"],
        "operation":operation,"expectedIncarnation":pad["incarnation"],
        "expectedRevision":pad["revision"],"expectedHome":pad["home"]})
}

#[tokio::test]
async fn u3787a_redo_refuses_stale_content_and_home_then_retains_acknowledged_edits() {
    let w = world().await;
    let (pad, receipt) = deleted(&w, "notes").await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let home = call(&w, "rail.createWorkstream", json!({"name":"Later Home"})).await;
    call(&w, "pad.move", json!({"name":"notes","home":home["id"]})).await;
    let edited = call(
        &w,
        "pad.write",
        json!({"name":"notes","text":"  newer 雪\n\n"}),
    )
    .await;
    assert_eq!(edited["incarnation"], pad["incarnation"]);
    assert_eq!(edited["revision"], 2);
    for observed in [
        &pad,
        &json!({"incarnation":edited["incarnation"],"revision":edited["revision"],"home":null}),
        &json!({"incarnation":edited["incarnation"],"revision":pad["revision"],"home":edited["home"]}),
    ] {
        assert_eq!(
            w.client
                .request(
                    "pad.redoDelete",
                    redo_request(&receipt, observed, "redo-edits")
                )
                .await
                .unwrap_err()
                .code,
            rpc::code::CONFLICT
        );
        assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, edited);
        assert_eq!(
            w.client
                .request("pad.getDeletion", json!({"operation":"redo-edits"}))
                .await
                .unwrap_err()
                .code,
            rpc::code::NOT_FOUND
        );
    }
    let redone = call(
        &w,
        "pad.redoDelete",
        redo_request(&receipt, &edited, "redo-edits"),
    )
    .await;
    assert_eq!(redone["pad"], edited);
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&redone)).await["pad"],
        edited
    );
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, edited);
}

#[tokio::test]
async fn u3787a_redo_refuses_replacement_and_retries_only_the_retained_incarnation() {
    let w = world().await;
    let (pad, receipt) = deleted(&w, "notes").await;
    let request = redo_request(&receipt, &pad, "redo-original");
    assert_eq!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let renamed = call(
        &w,
        "pad.rename",
        json!({"name":"notes","newName":"Moved","expectedIncarnation":pad["incarnation"]}),
    )
    .await;
    assert_eq!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(call(&w, "pad.read", json!({"name":"Moved"})).await, renamed);
    call(
        &w,
        "pad.rename",
        json!({"name":"Moved","newName":"notes","expectedIncarnation":pad["incarnation"]}),
    )
    .await;

    let later = call(
        &w,
        "pad.delete",
        json!({"name":"notes","operation":"later"}),
    )
    .await;
    let replacement = call(
        &w,
        "pad.create",
        json!({"name":"NOTES","text":"keep replacement"}),
    )
    .await;
    assert_ne!(replacement["incarnation"], pad["incarnation"]);
    assert_eq!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(
        call(&w, "pad.read", json!({"name":"NOTES"})).await,
        replacement
    );
    assert_eq!(
        w.client
            .request("pad.getDeletion", json!({"operation":"redo-original"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    call(&w, "pad.delete", json!({"name":"NOTES"})).await;
    call(&w, "pad.restore", deletion_id(&later)).await;
    let redone = call(&w, "pad.redoDelete", request).await;
    assert_eq!(redone["pad"], pad);
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([]));
}

#[tokio::test]
async fn u3787a_redo_checks_original_project_actor_and_current_authority() {
    let w = world().await;
    let a = call(&w, "rail.createWorkstream", json!({"name":"Maker"})).await;
    let b = call(&w, "rail.createWorkstream", json!({"name":"New authority"})).await;
    identify(&w, a["id"].as_str().unwrap()).await;
    let (pad, receipt) = deleted(&w, "notes").await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let request = redo_request(&receipt, &pad, "redo-authority");
    user(&w).await;
    call(&w, "pad.setOwner", json!({"name":"notes","owner":b["id"]})).await;
    identify(&w, a["id"].as_str().unwrap()).await;
    assert_eq!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    let current = call(&w, "pad.read", json!({"name":"notes"})).await;
    assert_eq!(current["owner"]["id"], b["id"]);
    identify(&w, b["id"].as_str().unwrap()).await;
    assert_eq!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    let other = world().await;
    assert_eq!(
        other
            .client
            .request("pad.redoDelete", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    user(&w).await;
    call(&w, "pad.setOwner", json!({"name":"notes","owner":a["id"]})).await;
    identify(&w, a["id"].as_str().unwrap()).await;
    let redone = call(&w, "pad.redoDelete", request.clone()).await;
    let mut changed_request = request;
    changed_request["restoredOperation"] = json!("different");
    assert_eq!(
        w.client
            .request("pad.redoDelete", changed_request)
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&redone)).await["pad"]["owner"],
        pad["owner"]
    );
}

#[tokio::test]
async fn u3787a_redo_mirror_refusal_is_atomic_and_external_edits_remain_recoverable() {
    let w = world().await;
    call(&w, "pad.setStorage", json!({"files":true})).await;
    let (pad, receipt) = deleted(&w, "notes").await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let file = w._dir.path().join("pads/notes.md");
    let request = redo_request(&receipt, &pad, "redo-mirror");
    let db = rusqlite::Connection::open(w._dir.path().join("project.db")).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_redo BEFORE DELETE ON pads BEGIN SELECT RAISE(ABORT, 'storage refusal'); END;").unwrap();
    assert!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .is_err()
    );
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        pad["text"].as_str().unwrap()
    );
    assert_eq!(
        w.client
            .request("pad.getDeletion", json!({"operation":"redo-mirror"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    db.execute_batch("DROP TRIGGER refuse_redo").unwrap();

    std::fs::remove_file(&file).unwrap();
    std::fs::create_dir(&file).unwrap();
    assert!(
        w.client
            .request("pad.redoDelete", request.clone())
            .await
            .is_err()
    );
    assert!(file.is_dir());
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    assert_eq!(
        w.client
            .request("pad.getDeletion", json!({"operation":"redo-mirror"}))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    std::fs::remove_dir(&file).unwrap();
    std::fs::write(&file, "external 雪\n").unwrap();
    assert_eq!(
        w.client
            .request("pad.redoDelete", request)
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "external 雪\n");
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    call(&w, "pad.setStorage", json!({"files":false})).await;
    let imported = call(&w, "pad.read", json!({"name":"notes"})).await;
    assert_eq!(imported["text"], "external 雪\n");
    assert_eq!(imported["revision"], 2);
    call(&w, "pad.setStorage", json!({"files":true})).await;
    let redone = call(
        &w,
        "pad.redoDelete",
        redo_request(&receipt, &imported, "redo-mirror"),
    )
    .await;
    assert!(!file.exists());
    assert_eq!(call(&w, "pad.list", Value::Null).await, json!([]));
    assert_eq!(
        call(&w, "pad.restore", deletion_id(&redone)).await["pad"],
        imported
    );
    assert_eq!(std::fs::read_to_string(file).unwrap(), "external 雪\n");
}

#[tokio::test]
async fn u3787a_redo_revokes_current_publications_without_substituting_sources() {
    let w = world().await;
    let (pad, receipt) = deleted(&w, "notes").await;
    call(&w, "pad.restore", deletion_id(&receipt)).await;
    let publication = call(&w, "deliverable.publish", json!({"key":"after-undo","title":"Result",
        "target":{"kind":"pad","name":"notes","incarnation":pad["incarnation"],"revision":pad["revision"]}})).await;
    let id = json!({"project":publication["project"],"id":publication["id"]});
    assert_eq!(
        call(&w, "deliverable.resolve", id.clone()).await["kind"],
        "retained"
    );
    let redo = call(
        &w,
        "pad.redoDelete",
        redo_request(&receipt, &pad, "redo-published"),
    )
    .await;
    assert_eq!(
        call(&w, "deliverable.resolve", id.clone()).await,
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
    call(&w, "pad.restore", deletion_id(&redo)).await;
    assert_eq!(call(&w, "pad.read", json!({"name":"notes"})).await, pad);
    assert_eq!(
        call(&w, "deliverable.resolve", id).await,
        json!({"kind":"unavailable","cause":"access-revoked"})
    );
}
