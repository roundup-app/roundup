use super::*;

#[tokio::test]
async fn u2773b_submission_replay_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let request = json!({"text":" exact 🌿\n ","submission":"revision-a"});
    let first = {
        let h = Harness::open(dir.path());
        h.asks
            .call(&h.ctx, "ask.send", request.clone())
            .await
            .unwrap()
    };
    let h = Harness::open(dir.path());
    let replay = h.asks.call(&h.ctx, "ask.send", request).await.unwrap();
    assert_eq!(first["id"], replay["id"]);
    assert_eq!(replay["submission"], "revision-a");
    assert_eq!(replay["text"], " exact 🌿\n ");
    assert_eq!(h.list().await.as_array().unwrap().len(), 1);
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn u2773b_conflicting_submission_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    h.asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"original","submission":"a"}),
        )
        .await
        .unwrap();
    let err = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"changed","submission":"a"}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(h.list().await[0]["text"], "original");
    assert_eq!(h.list().await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn u2773b_equal_text_can_be_two_intentional_submissions() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let first = h
        .asks
        .call(&h.ctx, "ask.send", json!({"text":"same","submission":"a"}))
        .await
        .unwrap();
    let other = h
        .asks
        .call(&h.ctx, "ask.send", json!({"text":"same","submission":"b"}))
        .await
        .unwrap();
    assert_ne!(first["id"], other["id"]);
}

#[tokio::test]
async fn u2773a_captured_target_keeps_exact_text_across_concurrent_rename() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let original = f.workstream().await;
    f.start(&original).await;
    f.h.send("hold placement").await;
    let blocked = f.h.calls.recv().await.unwrap();
    let mut events = f.h.ctx.bus.subscribe();
    let exact = "  @Work /skill e\u{301} 🌿\n  ";
    let accepted =
        f.h.asks
            .call(
                &f.h.ctx,
                "ask.send",
                json!({"text":exact,"submission":"captured","workstream":original}),
            )
            .await
            .unwrap();
    f.h.agents
        .call(
            &f.h.ctx,
            "rail.rename",
            json!({"id":original,"name":"Renamed"}),
        )
        .await
        .unwrap();
    let replacement = f.workstream().await;
    assert!(
        f.bytes.try_recv().is_err(),
        "later captured Ask must wait for earlier placement"
    );
    blocked
        .answer
        .send(vec![AskPart {
            text: "hold placement".into(),
            destination: Destination::Unclear {
                question: "Where?".into(),
                candidates: vec![],
            },
        }])
        .unwrap();
    assert_eq!(f.read().await, paste(exact));
    assert_eq!(accepted["parts"][0]["placement"]["workstream"], original);
    f.signal(&original, "UserPromptSubmit").await;
    f.changed(&mut events, &accepted["id"], "typed").await;
    let tree =
        f.h.agents
            .call(&f.h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == replacement)
            .unwrap()["terminal_id"]
            .is_null()
    );
    assert_eq!(f.h.count.load(Ordering::SeqCst), 1);
    f.stop().await;
}

#[tokio::test]
async fn u2773a_removed_original_refuses_equal_named_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let f = DoorHarness::open(dir.path());
    let original = f.workstream().await;
    f.h.agents
        .call(&f.h.ctx, "rail.remove", json!({"id":original}))
        .await
        .unwrap();
    let replacement = f.workstream().await;
    let error =
        f.h.asks
            .call(
                &f.h.ctx,
                "ask.send",
                json!({"text":"@Work exact","submission":"removed","workstream":original}),
            )
            .await
            .unwrap_err();
    assert_eq!(error.code, code::NOT_FOUND);
    assert!(f.h.list().await.as_array().unwrap().is_empty());
    assert!(
        f.terminals.list().await.is_empty(),
        "no bytes can reach replacement {replacement}"
    );
}

#[tokio::test]
async fn u2773a_removal_between_intake_and_placement_retains_original_work() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let original = f.workstream().await;
    f.h.send("hold placement").await;
    let blocked = f.h.calls.recv().await.unwrap();
    let mut events = f.h.ctx.bus.subscribe();
    let exact = "  @Work e\u{301} 🌿\n  ";
    let accepted =
        f.h.asks
            .call(
                &f.h.ctx,
                "ask.send",
                json!({"text":exact,"submission":"removed-during-placement","workstream":original}),
            )
            .await
            .unwrap();
    f.h.agents
        .call(&f.h.ctx, "rail.remove", json!({"id":original}))
        .await
        .unwrap();
    let replacement = f.workstream().await;
    blocked
        .answer
        .send(vec![AskPart {
            text: "hold placement".into(),
            destination: Destination::Unclear {
                question: "Where?".into(),
                candidates: vec![],
            },
        }])
        .unwrap();
    let failed = f.changed(&mut events, &accepted["id"], "failed").await;
    assert_eq!(failed["text"], exact);
    assert_eq!(failed["parts"][0]["text"], exact);
    assert_eq!(failed["parts"][0]["placement"]["workstream"], original);
    assert_eq!(failed["parts"][0]["reason"], "the Workstream was removed");
    assert!(
        f.terminals.list().await.is_empty(),
        "replacement {replacement} receives no bytes"
    );
}

#[tokio::test]
async fn u2773b_submission_cannot_be_replayed_to_another_destination() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let first = h
        .agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":"First"}))
        .await
        .unwrap();
    let second = h
        .agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":"Second"}))
        .await
        .unwrap();
    h.asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"exact","submission":"a","workstream":first["id"]}),
        )
        .await
        .unwrap();
    let err = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"exact","submission":"a","workstream":second["id"]}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(
        h.list().await[0]["parts"][0]["placement"]["workstream"],
        first["id"]
    );
    assert_eq!(h.list().await.as_array().unwrap().len(), 1);
}
