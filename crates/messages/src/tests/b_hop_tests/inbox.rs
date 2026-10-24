use super::*;

// B52(b), B39/B40: rejects losing the in-flight retry identity.
#[tokio::test]
async fn b52_question_restart_replays_receipts_once() {
    for acknowledged in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        idle(&h, &["sub"]);
        h.ask("c", "sub").await;
        assert_eq!(inbox.entries().len(), 1);
        if acknowledged {
            h.messages.confirm_inbox("sub", &[1]);
        }
        {
            let mut rail = h.rail.0.lock().unwrap();
            let node = rail.iter_mut().find(|n| n.id == "sub").unwrap();
            node.attempt = Some("2".into());
        }
        let (h, inbox) = h.restarted().attach_inbox().await;
        nudge(&h.messages.inner, "sub").await;
        assert_eq!(inbox.entries().len(), usize::from(!acknowledged));
        assert_eq!(h.all().await.len(), 1);
        h.messages.confirm_inbox("sub", &[1]);
        h.messages.confirm_inbox("sub", &[1]);
        assert_eq!(h.get(1).await["status"], "delivered");
    }
}

// B51(g): rejects bypassing repeat refusal on automatic inbox/Terminal hold release.
// B50(b,d): rejects treating a Daemon question's authored digest prefix as a foldable note.
#[tokio::test]
async fn b50_a_daemon_question_keeps_its_full_body_in_the_inbox() {
    let dir = tempfile::tempdir().unwrap();
    let (h, inbox) = Hops::with_inbox(dir.path()).await;
    idle(&h, &["sub"]);
    let body = format!("[digest] {}", "é".repeat(300));
    h.call_as(
        Actor::daemon(),
        "message.send",
        json!({"to":"sub", "kind":"question", "body":body}),
    )
    .await
    .unwrap();
    assert_eq!(inbox.entries().len(), 1);
    assert_eq!(inbox.entries()[0].3, body);
    assert_eq!(h.get(1).await["body"], body);
    assert_eq!(h.get(1).await["status"], "pending");
    h.rail
        .0
        .lock()
        .unwrap()
        .iter_mut()
        .find(|n| n.id == "sub")
        .unwrap()
        .status
        .as_mut()
        .unwrap()
        .kind = Kind::Working;
    let question = "[digest] c is working\n  last: which?\n  open todos: 0";
    h.call_as(
        Actor::daemon(),
        "message.send",
        json!({"to":"sub", "kind":"question", "body":question}),
    )
    .await
    .unwrap();
    h.call_as(Actor::daemon(), "message.send", json!({"to":"sub", "kind":"note", "body":"[digest] c is idle\n  last: finished\n  open todos: 0"})).await.unwrap();
    assert_eq!(
        h.get(2).await["status"],
        "pending",
        "a later digest cannot drop a question"
    );
    idle(&h, &["sub"]);
    nudge(&h.messages.inner, "sub").await;
    assert!(
        inbox.entries().iter().any(|(_, id, kind, body)| *id == 2
            && *kind == MessageKind::Question
            && body == question)
    );
}

// B1/B50(b): rejects exempting questions from the open bound because their body resembles a note.
#[tokio::test]
async fn b1_daemon_questions_keep_the_open_bound_with_note_prefixes() {
    for prefix in ["[digest]", "[wake]"] {
        let dir = tempfile::tempdir().unwrap();
        let (h, _) = Hops::with_inbox(dir.path()).await;
        for index in 0..32 {
            h.call_as(
                Actor::daemon(),
                "message.send",
                json!({"to":"sub", "kind":"question", "body":format!("{prefix} which {index}?")}),
            )
            .await
            .unwrap();
        }
        let error = h
            .call_as(
                Actor::daemon(),
                "message.send",
                json!({"to":"sub", "kind":"question", "body":format!("{prefix} overflow?")}),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, code::CONFLICT);
        assert_eq!(h.all().await.len(), 32);
    }
}
