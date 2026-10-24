use super::*;

#[tokio::test]
async fn b37_a_live_error_preserves_routes_takeover_and_order() {
    let dir = tempfile::tempdir().unwrap();
    let mut receiver = agent_node("b", Kind::Working);
    receiver.terminal_id = Some("live-terminal".into());
    let h = Held2::new(dir.path(), vec![receiver]);
    h.call("takeover.begin", json!({"agent":"b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "two").await;
    h.route("b", "drop").await;
    h.send_as(agent("a"), "b", "never").await;
    h.rail.0.lock().unwrap()[0].status.as_mut().unwrap().kind = Kind::Error;
    h.rail.0.lock().unwrap()[0].status_revision = Some("2".into());
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Error).await;
    assert!(h.calls.lock().unwrap().is_empty());
    assert_eq!(h.get(1).await["reason"], "takeover");
    assert_eq!(h.get(2).await["reason"], "ask-first");
    assert_eq!(h.get(3).await["status"], "dropped");
    h.call("takeover.end", json!({"agent":"b"})).await.unwrap();
    h.call("message.deliver", json!({"id":2})).await.unwrap();
    assert_eq!(
        *h.calls.lock().unwrap(),
        [
            ("b".into(), "[from an Agent that is gone, note] one".into()),
            ("b".into(), "[from an Agent that is gone, note] two".into())
        ]
    );
}

#[tokio::test]
async fn b37_an_exited_error_stays_ended() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(agent("a"), "b", "two").await;
    h.seen();
    h.rail.0.lock().unwrap()[0].status.as_mut().unwrap().kind = Kind::Error;
    h.rail.0.lock().unwrap()[0].status_revision = Some("2".into());
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Error).await;
    let ids: Vec<_> = h
        .seen()
        .into_iter()
        .filter(|(name, _)| name == "message.dropped")
        .map(|(_, data)| data["id"].clone())
        .collect();
    assert_eq!(ids, [json!(1), json!(2)]);
    assert_eq!(
        h.call(
            "message.send",
            json!({"to":"b", "kind":"note", "body":"late"})
        )
        .await
        .unwrap_err()
        .code,
        code::CONFLICT
    );
    assert!(h.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn b37_a_late_error_cannot_change_the_current_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Error)]);
    assert!(
        h.call(
            "message.send",
            json!({"to":"b", "kind":"note", "body":"ended"})
        )
        .await
        .is_err()
    );
    // An old error cannot reopen an ended Attempt.
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Error).await;
    assert!(
        h.call(
            "message.send",
            json!({"to":"b", "kind":"note", "body":"still ended"})
        )
        .await
        .is_err()
    );
    {
        let mut nodes = h.rail.0.lock().unwrap();
        nodes[0].attempt = Some("2".into());
        nodes[0].status_revision = Some("1".into());
        nodes[0].status.as_mut().unwrap().kind = Kind::Working;
        nodes[0].terminal_id = Some("new-terminal".into());
    }
    let sent = h.send_as(agent("a"), "b", "new attempt").await;
    super::super::on_status(&h.messages.inner, "b", "1", "3", Kind::Error).await;
    assert_eq!(
        h.get(sent["id"].as_u64().unwrap() as u32).await["status"],
        "pending"
    );
    assert!(h.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn b37_a_busy_error_delivery_returns_to_pending_until_the_next_turn() {
    let dir = tempfile::tempdir().unwrap();
    let rail = FakeRail::new(vec![RailNode {
        terminal_id: Some("live-terminal".into()),
        ..agent_node("b", Kind::Working)
    }]);
    let calls: Calls = Arc::default();
    let accepted = calls.clone();
    let busy = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let deliver: Deliver = Arc::new(move |id, text| {
        let refusal = busy.swap(false, std::sync::atomic::Ordering::SeqCst);
        if !refusal {
            accepted.lock().unwrap().push((id, shown(text)));
        }
        Box::pin(async move { if refusal { Err(Refusal::Busy) } else { Ok(()) } })
    });
    let h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(agent("a"), "b", "try next turn").await;
    for revision in ["2", "3"] {
        {
            let mut nodes = h.rail.0.lock().unwrap();
            nodes[0].status.as_mut().unwrap().kind = Kind::Error;
            nodes[0].status_revision = Some(revision.into());
        }
        super::super::on_status(&h.messages.inner, "b", "1", revision, Kind::Error).await;
        assert_eq!(
            h.get(1).await["status"],
            if revision == "2" {
                "pending"
            } else {
                "delivered"
            }
        );
    }
    assert_eq!(
        *h.calls.lock().unwrap(),
        [(
            "b".into(),
            "[from an Agent that is gone, note] try next turn".into()
        )]
    );
}
