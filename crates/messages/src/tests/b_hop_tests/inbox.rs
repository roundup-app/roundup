use super::*;

// B13: rejects rebuilding ancestors at pass time, changing the origin, or typing a hop.
#[tokio::test]
async fn b13_inbox_hops_preserve_the_frozen_chain_and_origin() {
    for (from, first, recipients) in [
        ("c", "sub", vec!["sub", "mid", "top"]),
        ("mid", "sub", vec!["sub", "top"]),
        ("c", "r", vec!["r"]),
        ("c", "top", vec!["top"]),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        h.ask(from, first).await;
        h.rail
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .find(|n| n.id == first)
            .unwrap()
            .parent = Some("r".into());
        for (index, to) in recipients.iter().enumerate() {
            let id = u32::try_from(index + 1).unwrap();
            h.receive(&inbox, to, id).await;
            let message = h.get(id).await;
            assert_eq!(message["from"]["id"], from);
            assert_eq!(message["kind"], "question");
            assert_eq!(message["body"], "which?");
            assert_eq!(message["replyTo"], Value::Null);
            assert_eq!(
                message["passedFrom"],
                if id == 1 { Value::Null } else { json!(id - 1) }
            );
            h.at(i64::from(id) * 60_000).await;
            assert_eq!(h.all().await.len(), index + 2);
        }
        let all = h.all().await;
        assert_eq!(all.last().unwrap().0, "you");
        assert_eq!(all.last().unwrap().2, "escalated");
        assert_eq!(inbox.entries().len(), recipients.len());
        h.at(600_000).await;
        assert_eq!(h.all().await, all);
    }
}

// B17: rejects accepting an earlier hop's reply or a reply before the current receipt.
#[tokio::test]
async fn b17_only_the_current_delivered_inbox_hop_can_answer() {
    for (answerer, reply_to, received, stops) in [
        ("sub", 1, true, false),
        ("mid", 2, false, false),
        ("mid", 2, true, true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        h.ask("c", "sub").await;
        h.receive(&inbox, "sub", 1).await;
        h.at(60_000).await;
        if received {
            h.receive(&inbox, "mid", 2).await;
        }
        h.call_as(
            agent(answerer),
            "message.send",
            json!({"to":"c", "kind":"note", "body":"answer", "replyTo":reply_to}),
        )
        .await
        .unwrap();
        h.at(120_000).await;
        assert_eq!(h.all().await.len(), if stops { 3 } else { 4 });
    }
}

// B51(g): rejects silent peer repeat discard when releasing a held question or making a hop.
// B14: rejects starting the bound while the inbox is unavailable or restarting it on receipt.
#[tokio::test]
async fn b14_inbox_question_bounds_wait_for_the_inbox() {
    for receipt in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let (h, inbox) = Hops::with_inbox(dir.path()).await;
        idle(&h, &["sub"]);
        inbox.set(contracts::agent::Inbox::Missing);
        h.ask("c", "sub").await;
        h.at(600_000).await;
        assert_eq!(h.all().await.len(), 1);
        assert_eq!(h.get(1).await["status"], "pending");
        assert!(inbox.entries().is_empty());
        inbox.set(contracts::agent::Inbox::Ok);
        nudge(&h.messages.inner, "sub").await;
        h.at(600_001).await;
        assert_eq!(h.all().await.len(), 1);
        assert_eq!(inbox.entries().len(), 1);
        if receipt {
            h.messages.confirm_inbox("sub", &[1]);
        }
        h.at(659_999).await;
        assert_eq!(h.all().await.len(), 1);
        h.at(660_000).await;
        assert_eq!(h.all().await.len(), 2);
    }
}

// B52(b), B39/B40: rejects losing the in-flight retry identity or advancing a stored chain twice.
#[tokio::test]
async fn b52_question_restart_replays_receipts_and_escalation_once() {
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
        h.at(59_999).await;
        assert_eq!(h.all().await.len(), 1);
        h.at(60_000).await;
        assert_eq!(h.get(2).await["to"], "mid");
        assert_eq!(h.get(2).await["passedFrom"], 1);
        let (h, _) = h.restarted().attach_inbox().await;
        h.at(60_000).await;
        assert_eq!(h.all().await.len(), 2);
        h.at(120_000).await;
        assert_eq!(h.get(3).await["to"], "top");
        h.at(180_000).await;
        let all = h.all().await;
        assert_eq!(all.len(), 4);
        assert_eq!(
            all[3],
            row("you", "delivered", json!("escalated"), json!(3))
        );
        h.at(600_000).await;
        assert_eq!(h.all().await, all);
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
