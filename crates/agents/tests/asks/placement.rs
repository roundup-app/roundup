use super::*;

#[tokio::test]
async fn a40_send_returns_at_once_and_the_parts_follow() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let ask = tokio::time::timeout(Duration::from_secs(1), h.send("keep my words"))
        .await
        .unwrap();
    assert_eq!(ask["parts"][0]["state"], "placing");
    assert_eq!(h.list().await[0], ask);
    let call = h.calls.recv().await.unwrap();
    assert_eq!(
        serde_json::to_value(&call.request).unwrap()["text"],
        "keep my words"
    );
    let mut events = h.ctx.bus.subscribe();
    call.answer
        .send(vec![AskPart {
            text: "keep my words".into(),
            destination: Destination::Unclear {
                question: "Which work?".into(),
                candidates: vec![],
            },
        }])
        .unwrap();
    let changed = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .unwrap()
        .unwrap();
    let wire = serde_json::to_value(changed).unwrap();
    assert_eq!(wire["name"], "ask.changed");
    assert_eq!(wire["data"]["ask"]["parts"][0]["state"], "waiting");
    assert_eq!(
        h.list().await[0]["parts"][0]["placement"]["question"],
        "Which work?"
    );
}

#[tokio::test]
async fn a40_a_two_topic_message_becomes_two_parts() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let mut events = h.ctx.bus.subscribe();
    h.send("fix café; ship 🚀").await;
    let call = h.calls.recv().await.unwrap();
    call.answer
        .send(
            ["fix café", "ship 🚀"]
                .map(|text| AskPart {
                    text: text.into(),
                    destination: Destination::Unclear {
                        question: "Where?".into(),
                        candidates: vec![],
                    },
                })
                .to_vec(),
        )
        .unwrap();
    loop {
        let wire = serde_json::to_value(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if wire["data"]["ask"]["parts"]
            .as_array()
            .is_some_and(|parts| parts.len() == 2)
        {
            assert_eq!(wire["data"]["ask"]["parts"][0]["text"], "fix café");
            assert_eq!(wire["data"]["ask"]["parts"][1]["text"], "ship 🚀");
            break;
        }
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a40_naming_a_workstream_makes_no_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let mut events = h.ctx.bus.subscribe();
    h.send("@missing /skill café\n x").await;
    loop {
        let wire = serde_json::to_value(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if wire["data"]["ask"]["parts"][0]["state"] == "waiting" {
            assert_eq!(wire["data"]["ask"]["parts"][0]["text"], "/skill café\n x");
            assert_eq!(
                wire["data"]["ask"]["parts"][0]["placement"]["question"],
                "No Workstream is named missing"
            );
            break;
        }
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
    assert_eq!(
        h.agents
            .call(&h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn a40_bounds_store_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    for text in [" \n\t".to_string(), "é".repeat(16_385)] {
        let err = h
            .asks
            .call(&h.ctx, "ask.send", json!({"text":text}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    assert_eq!(h.list().await, json!([]));
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[test]
fn a40_asks_survive_a_restart_and_placing_becomes_unclear() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    };
    let id = runtime().block_on(async {
        let mut h = Harness::open(dir.path());
        h.waiting("first").await;
        h.send("second").await["id"].clone()
    });
    runtime().block_on(async {
        let h = Harness::open(dir.path());
        let asks = h.list().await;
        assert_eq!(asks.as_array().unwrap().len(), 2);
        assert_eq!(asks[0]["id"], id);
        assert_eq!(
            asks[0]["parts"][0]["placement"]["question"],
            "roundup restarted before placing this"
        );
        assert_eq!(asks[0]["parts"][0]["state"], "waiting");
        assert_eq!(asks[1]["text"], "first");
        assert_eq!(h.count.load(Ordering::SeqCst), 0);
    });
}

#[tokio::test]
async fn a40_an_agent_cannot_call_the_ask_methods() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    h.ctx.actor = Actor {
        kind: ActorKind::Agent,
        id: "door".into(),
        parent: None,
    };
    for method in ["ask.send", "ask.list", "ask.pick"] {
        assert_eq!(
            h.asks
                .call(&h.ctx, method, json!({}))
                .await
                .unwrap_err()
                .code,
            code::FORBIDDEN
        );
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a42_a_pick_can_drop_without_usage_and_cannot_repeat() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let ask = h.waiting("/skill x").await;
    let picked = h
        .asks
        .call(
            &h.ctx,
            "ask.pick",
            json!({"id":ask["id"],"part":0,"target":{"kind":"drop"}}),
        )
        .await
        .unwrap();
    assert_eq!(picked["parts"][0]["state"], "dropped");
    assert_eq!(
        h.asks
            .call(
                &h.ctx,
                "ask.pick",
                json!({"id":ask["id"],"part":0,"target":{"kind":"drop"}})
            )
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    assert_eq!(h.count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a42_an_invalid_pick_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let ask = h.waiting("work").await;
    for target in [
        json!({"kind":"workstream","id":"missing"}),
        json!({"kind":"new","title":"one two three four five six seven"}),
    ] {
        assert_eq!(
            h.asks
                .call(
                    &h.ctx,
                    "ask.pick",
                    json!({"id":ask["id"],"part":0,"target":target})
                )
                .await
                .unwrap_err()
                .code,
            code::INVALID_PARAMS
        );
        assert_eq!(h.list().await[0], ask);
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a40_an_ambiguous_name_waits_without_a_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    for _ in 0..2 {
        h.agents
            .call(&h.ctx, "rail.createWorkstream", json!({"name":"Same"}))
            .await
            .unwrap();
    }
    let mut events = h.ctx.bus.subscribe();
    let ask = h.send("@same words").await;
    loop {
        let wire = serde_json::to_value(
            tokio::time::timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if wire["data"]["ask"]["id"] == ask["id"]
            && wire["data"]["ask"]["parts"][0]["state"] == "waiting"
        {
            assert_eq!(
                wire["data"]["ask"]["parts"][0]["placement"]["question"],
                "2 Workstreams are named same"
            );
            assert_eq!(
                wire["data"]["ask"]["parts"][0]["placement"]["candidates"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
            break;
        }
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}
