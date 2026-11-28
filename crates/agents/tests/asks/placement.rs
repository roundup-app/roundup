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
            project: None,
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
                    project: None,
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

#[tokio::test]
async fn u6271a_place_is_a_pure_call_that_names_each_parts_project() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let projects = json!([{"name":"alpha","tree":[]},{"name":"beta","tree":[]}]);
    let (placed, call) = tokio::join!(
        h.asks.call(
            &h.ctx,
            "ask.place",
            json!({"text":"ship the docs","projects":projects,"project":"beta"})
        ),
        async {
            let call = h.calls.recv().await.unwrap();
            let wire = serde_json::to_value(&call.request).unwrap();
            call.answer
                .send(vec![AskPart {
                    project: None,
                    text: "ship the docs".into(),
                    destination: Destination::New {
                        title: "Docs".into(),
                    },
                }])
                .unwrap();
            wire
        }
    );
    assert_eq!(call["projects"], json!(["beta"]));
    let placed = placed.unwrap();
    assert_eq!(placed[0]["placement"]["project"], "beta");
    assert_eq!(placed[0]["placement"]["title"], "Docs");
    assert_eq!(h.list().await, json!([]));
}

#[tokio::test]
async fn u6271a_send_stores_placed_parts_without_a_second_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let ask = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"one; two","parts":[
                {"text":"one","placement":{"kind":"unclear","question":"Which?","candidates":[]}},
                {"text":"two","placement":{"kind":"unclear","question":"Which?","candidates":[]}}
            ]}),
        )
        .await
        .unwrap();
    assert_eq!(ask["parts"][1]["text"], "two");
    assert_eq!(ask["parts"][1]["state"], "waiting");
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

async fn tree_with(h: &Harness, name: &str) -> Value {
    h.agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":name}))
        .await
        .unwrap();
    h.agents
        .call(&h.ctx, "rail.tree", Value::Null)
        .await
        .unwrap()
}

async fn sent(h: &Harness, text: &str, projects: Value) -> Value {
    let ask = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":text,"projects":projects}),
        )
        .await
        .unwrap();
    for _ in 0..100 {
        let listed = h.list().await;
        let found = listed
            .as_array()
            .unwrap()
            .iter()
            .find(|each| each["id"] == ask["id"])
            .unwrap()
            .clone();
        if found["parts"][0]["state"] != "placing" {
            return found;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the Ask stayed placing");
}

#[tokio::test]
async fn u8045d_a_mid_text_at_name_makes_no_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let tree = tree_with(&h, "Loop").await;
    let projects = json!([{"name":"Education","tree":tree},{"name":"Work","tree":[]}]);
    let ask = sent(&h, "tell @loop to stop", projects).await;
    assert_eq!(ask["parts"][0]["text"], "tell @loop to stop");
    assert_eq!(ask["parts"][0]["placement"]["kind"], "routed");
    assert_eq!(ask["parts"][0]["placement"]["project"], "Education");
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn u8045d_an_unknown_mid_text_at_name_asks_back() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let tree = tree_with(&h, "Loop").await;
    let projects = json!([{"name":"Education","tree":tree},{"name":"Work","tree":[]}]);
    let ask = sent(&h, "tell @nobody to stop", projects.clone()).await;
    assert_eq!(ask["parts"][0]["state"], "waiting");
    assert_eq!(
        ask["parts"][0]["placement"]["question"],
        "No Workstream is named nobody"
    );
    // Loop lives in Education only; `#Work` fixes the Project it is read in.
    let ask = sent(&h, "#Work tell @loop to stop", projects).await;
    assert_eq!(ask["parts"][0]["state"], "waiting");
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn u8045d_two_at_workstreams_offer_only_those_to_placement() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    tree_with(&h, "Loop").await;
    tree_with(&h, "Docs").await;
    let tree = tree_with(&h, "Other").await;
    let projects = json!([{"name":"Education","tree":tree},{"name":"Work","tree":[]}]);
    let (_, call) = tokio::join!(
        h.asks.call(
            &h.ctx,
            "ask.send",
            json!({"text":"ask @loop and @docs","projects":projects})
        ),
        async {
            let call = h.calls.recv().await.unwrap();
            let wire = serde_json::to_value(&call.request).unwrap();
            call.answer.send(vec![]).unwrap();
            wire
        }
    );
    let mut names: Vec<_> = call["workstreams"]
        .as_array()
        .unwrap()
        .iter()
        .map(|each| each["name"].as_str().unwrap().to_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["Docs", "Loop"]);
}

#[tokio::test]
async fn u8045d_hash_and_at_together_route_with_no_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let tree = tree_with(&h, "Loop").await;
    let projects = json!([{"name":"Education","tree":tree},{"name":"Work","tree":[]}]);
    let ask = sent(&h, "#education fix it, tell @Loop", projects).await;
    assert_eq!(ask["parts"][0]["placement"]["kind"], "routed");
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn u8045c_one_hash_project_fixes_every_part() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let tree = tree_with(&h, "Loop").await;
    let projects = json!([{"name":"Education","tree":tree},{"name":"Work","tree":[]}]);
    let (_, call) = tokio::join!(
        h.asks.call(
            &h.ctx,
            "ask.send",
            json!({"text":"ship #Work docs","projects":projects})
        ),
        async {
            let call = h.calls.recv().await.unwrap();
            let wire = serde_json::to_value(&call.request).unwrap();
            call.answer
                .send(vec![AskPart {
                    project: None,
                    text: "ship #Work docs".into(),
                    destination: Destination::New { title: "Docs".into() },
                }])
                .unwrap();
            wire
        }
    );
    assert_eq!(call["projects"], json!(["Work"]));
    assert_eq!(call["workstreams"], json!([]));
    for _ in 0..100 {
        let listed = h.list().await;
        if listed[0]["parts"][0]["state"] != "placing" {
            assert_eq!(listed[0]["parts"][0]["placement"]["project"], "Work");
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the Ask stayed placing");
}

#[tokio::test]
async fn u8045c_two_hash_projects_each_part_takes_its_own() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let projects = json!([{"name":"Education","tree":[]},{"name":"Work","tree":[]}]);
    let part = |text: &str| AskPart {
        project: None,
        text: text.into(),
        destination: Destination::New { title: text.into() },
    };
    let (_, _) = tokio::join!(
        h.asks.call(
            &h.ctx,
            "ask.send",
            json!({"text":"#Education a b #work c","projects":projects})
        ),
        async {
            let call = h.calls.recv().await.unwrap();
            call.answer
                .send(vec![part("#Education a"), part("b #work"), part("c")])
                .unwrap();
        }
    );
    for _ in 0..100 {
        let listed = h.list().await;
        if listed[0]["parts"][0]["state"] != "placing" {
            let projects: Vec<_> = (0..3)
                .map(|i| listed[0]["parts"][i]["placement"]["project"].clone())
                .collect();
            assert_eq!(projects, [json!("Education"), json!("Work"), json!("Education")]);
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the Ask stayed placing");
}
