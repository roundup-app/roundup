use super::*;

const DOC: &str = "# Notes\n\n## Plan\n- one\n\n### Detail\nmore\n\n## Done\n- x\n";

async fn section(rig: &Rig, who: &Actor, heading: &str, text: &str) -> Value {
    let params = json!({"name": "notes", "heading": heading, "text": text});
    rig.ok(who, "pad.appendSection", params).await
}

#[tokio::test]
async fn p15_appends_at_section_end() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    let a = agent("a");

    let pad = section(&rig, &a, "Done", "- y\n").await;
    assert_eq!(pad["text"], DOC.replace("- x\n", "- x\n- y\n"));

    rig.create("tail", "## A\nx").await;
    let tail = rig
        .ok(
            &a,
            "pad.appendSection",
            json!({"name": "tail", "heading": "a", "text": "y"}),
        )
        .await;
    assert_eq!(tail["text"], "## A\nx\ny");

    let blank = rig
        .ok(
            &a,
            "pad.appendSection",
            json!({"name": "tail", "heading": "a", "text": "z\n\n"}),
        )
        .await;
    assert_eq!(blank["text"], "## A\nx\ny\nz\n");
}

#[tokio::test]
async fn p15_deeper_heading_stays_inside_section() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;

    let pad = section(&rig, &agent("a"), "## Plan", "- two").await;

    assert_eq!(
        pad["text"],
        "# Notes\n\n## Plan\n- one\n\n### Detail\nmore\n- two\n\n## Done\n- x\n"
    );
    let inner = section(&rig, &agent("a"), "Detail", "deep").await;
    assert!(
        inner["text"]
            .as_str()
            .unwrap()
            .contains("more\n- two\ndeep\n\n## Done")
    );
}

#[tokio::test]
async fn p15_fenced_hash_is_no_heading() {
    let rig = Rig::new();
    rig.create(
        "notes",
        "## Plan\n```\n# not a heading\n```\nafter\n## Done\n",
    )
    .await;

    let pad = section(&rig, &agent("a"), "Plan", "added").await;
    assert_eq!(
        pad["text"],
        "## Plan\n```\n# not a heading\n```\nafter\nadded\n## Done\n"
    );
    let missing = rig
        .fail(
            &agent("a"),
            "pad.appendSection",
            json!({"name": "notes", "heading": "not a heading", "text": "x"}),
        )
        .await;
    assert_eq!(missing.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn p15_heading_match_ignores_case_and_space() {
    let rig = Rig::new();
    rig.create("notes", "## Plan  Ahead\n## Plan Ahead\n").await;
    let a = agent("a");

    for heading in ["  plan   ahead ", "PLAN AHEAD", "### Plan Ahead"] {
        section(&rig, &a, heading, "x").await;
    }

    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["text"], "## Plan  Ahead\nx\nx\nx\n## Plan Ahead\n");
}

#[tokio::test]
async fn p15_missing_heading_lists_headings() {
    let rig = Rig::new();
    rig.create("notes", "# Notes\n## Plan\n## Done\n").await;
    rig.create("bare", "no headings").await;
    let a = agent("a");

    let err = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "notes", "heading": "Risks", "text": "x"}),
        )
        .await;
    let bare = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "bare", "heading": "Risks", "text": "x"}),
        )
        .await;
    let empty_heading = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "notes", "heading": " # ", "text": "x"}),
        )
        .await;
    let empty_text = rig
        .fail(
            &a,
            "pad.appendSection",
            json!({"name": "notes", "heading": "Plan", "text": ""}),
        )
        .await;

    assert_eq!(err.code, code::INVALID_PARAMS);
    assert_eq!(
        err.message,
        r###"no heading "Risks" in pad notes; headings: "# Notes", "## Plan", "## Done""###
    );
    assert!(bare.message.ends_with("the pad has no headings"));
    assert_eq!(empty_heading.code, code::INVALID_PARAMS);
    assert_eq!(empty_text.code, code::INVALID_PARAMS);
    let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
    assert_eq!(pad["revision"], 1);
}

#[tokio::test]
async fn p15_any_actor_appends_with_touch_and_event() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    let mut events = rig.bus.subscribe();
    let b = agent("b");

    let pad = section(&rig, &b, "Plan", "- b").await;

    assert_eq!(pad["revision"], 2);
    assert!(matches!(
        events.try_recv().unwrap().data,
        EventData::PadChanged(_)
    ));
    assert!(events.try_recv().is_err());
    let by_b = rig.touches.touched("b").unwrap();
    assert_eq!(by_b.len(), 1);
    assert_eq!(by_b[0].verb, Verb::Wrote);
    assert_eq!(by_b[0].item, "pad:notes");
}

#[tokio::test]
async fn p15_stale_revision_conflicts() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    let a = agent("a");
    let send = |revision: u64| json!({"name": "notes", "heading": "Plan", "text": "x", "expectedRevision": revision});

    rig.ok(&a, "pad.appendSection", send(1)).await;
    let stale = rig.fail(&a, "pad.appendSection", send(1)).await;
    let ahead = rig.fail(&a, "pad.appendSection", send(9)).await;
    let current = rig.ok(&a, "pad.appendSection", send(2)).await;

    assert_eq!(stale.code, code::CONFLICT);
    assert!(stale.message.contains("revision 2"));
    assert_eq!(ahead.code, code::CONFLICT);
    assert_eq!(current["revision"], 3);
    assert!(current["text"].as_str().unwrap().contains("more\nx\nx\n"));
}

#[tokio::test]
async fn p15_two_writers_one_wins() {
    for order in [["a", "b"], ["b", "a"]] {
        let rig = Rig::new();
        rig.create("notes", DOC).await;
        let params = |who: &str| json!({"name": "notes", "heading": "Done", "text": who, "expectedRevision": 1});
        let first = rig
            .call(&agent(order[0]), "pad.appendSection", params(order[0]))
            .await;
        let second = rig
            .call(&agent(order[1]), "pad.appendSection", params(order[1]))
            .await;

        assert!(first.is_ok());
        assert_eq!(second.unwrap_err().code, code::CONFLICT);
        let pad = rig
            .ok(&agent("a"), "pad.read", json!({"name": "notes"}))
            .await;
        assert!(
            pad["text"]
                .as_str()
                .unwrap()
                .ends_with(&format!("- x\n{}\n", order[0]))
        );
    }
}

#[tokio::test]
async fn p15_rejected_call_leaves_no_trace() {
    for files in [false, true] {
        let rig = Rig::new();
        rig.create("notes", DOC).await;
        if files {
            rig.ok(&Actor::user(), "pad.setStorage", json!({"files": true}))
                .await;
        }
        let mut events = rig.bus.subscribe();
        let touches = rig.touches.history("pad:notes").unwrap().len();
        let a = agent("a");

        let unknown = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "ghost", "heading": "Plan", "text": "x"}),
            )
            .await;
        let bad_name = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "a/b", "heading": "Plan", "text": "x"}),
            )
            .await;
        let no_heading = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "notes", "heading": "Risks", "text": "x"}),
            )
            .await;
        let stale = rig
            .fail(
                &a,
                "pad.appendSection",
                json!({"name": "notes", "heading": "Plan", "text": "x", "expectedRevision": 7}),
            )
            .await;

        assert_eq!(unknown.code, code::NOT_FOUND);
        assert_eq!(bad_name.code, code::INVALID_PARAMS);
        assert_eq!(no_heading.code, code::INVALID_PARAMS);
        assert_eq!(stale.code, code::CONFLICT);
        assert!(events.try_recv().is_err());
        assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);
        let pad = rig.ok(&a, "pad.read", json!({"name": "notes"})).await;
        assert_eq!(
            (pad["text"].as_str().unwrap(), pad["revision"].clone()),
            (DOC, json!(1))
        );
        if files {
            assert_eq!(rig.file_text("notes.md"), DOC);
        }
    }
}

#[tokio::test]
async fn p15_file_storage_follows_the_section_append() {
    let rig = Rig::new();
    rig.create("notes", DOC).await;
    rig.ok(&Actor::user(), "pad.setStorage", json!({"files": true}))
        .await;

    let pad = section(&rig, &agent("a"), "Done", "- y").await;

    assert_eq!(rig.file_text("notes.md"), pad["text"].as_str().unwrap());
}

#[tokio::test]
async fn p15_revision_follows_text_changes() {
    let rig = Rig::new();
    rig.create("notes", "one").await;
    let (a, user) = (agent("a"), Actor::user());
    let revision = |pad: Value| pad["revision"].as_u64().unwrap();
    assert_eq!(
        revision(rig.ok(&a, "pad.read", json!({"name": "notes"})).await),
        1
    );

    let written = rig
        .ok(&a, "pad.write", json!({"name": "notes", "text": "two"}))
        .await;
    let same = rig
        .ok(&a, "pad.write", json!({"name": "notes", "text": "two"}))
        .await;
    let appended = rig
        .ok(&a, "pad.append", json!({"name": "notes", "text": "+"}))
        .await;
    let nothing = rig
        .ok(&a, "pad.append", json!({"name": "notes", "text": ""}))
        .await;
    let moved = rig
        .ok(&user, "pad.move", json!({"name": "notes", "home": "r1"}))
        .await;

    assert_eq!(
        [written, same, appended, nothing, moved].map(revision),
        [2, 2, 3, 3, 3]
    );
}

#[tokio::test]
async fn p15_revision_survives_reopen() {
    let rig = Rig::new();
    rig.create("notes", "one").await;
    rig.ok(
        &agent("a"),
        "pad.append",
        json!({"name": "notes", "text": "+"}),
    )
    .await;
    let Rig { dir, bus, .. } = rig;
    let reopened = Pads::open(dir.path(), bus.clone()).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };

    let listed = reopened.call(&ctx, "pad.list", Value::Null).await.unwrap();

    assert_eq!(listed[0]["revision"], 2);
}

#[tokio::test]
async fn p15_a_pad_stored_before_revisions_reads_revision_1() {
    let rig = Rig::new();
    rig.store_row("old");

    let pad = rig
        .ok(&agent("a"), "pad.read", json!({"name": "old"}))
        .await;

    assert_eq!(pad["revision"], 1);
}

#[tokio::test]
async fn p2544d_write_revision_guard() {
    for files in [false, true] {
        let rig = Rig::new();
        rig.create("notes", "original").await;
        rig.ok(&Actor::user(), "pad.setStorage", json!({"files": files}))
            .await;
        let a = agent("a");
        let incarnation = rig.ok(&a, "pad.list", json!({})).await[0]["incarnation"].clone();
        let mut accepted_events = rig.bus.subscribe();
        let written = rig.ok(
            &a,
            "pad.write",
            json!({"name": "notes", "text": "winner", "expectedRevision": 1, "expectedIncarnation": incarnation}),
        )
        .await;
        assert_eq!(written["incarnation"], incarnation);
        assert_eq!(written["revision"], 2);
        assert!(matches!(
            accepted_events.try_recv().unwrap().data,
            EventData::PadChanged(_)
        ));
        assert!(accepted_events.try_recv().is_err());
        let before = rig.ok(&a, "pad.list", json!({})).await;
        let touches = rig.touches.history("pad:notes").unwrap();
        let mut events = rig.bus.subscribe();
        let error = rig
            .fail(
                &a,
                "pad.write",
                json!({"name": "notes", "text": "loser", "expectedRevision": 1, "expectedIncarnation": incarnation}),
            )
            .await;
        assert_eq!(error.code, code::CONFLICT);
        assert!(error.message.contains("revision 2"));
        assert_eq!(rig.ok(&a, "pad.list", json!({})).await, before);
        assert_eq!(
            rig.touches.history("pad:notes").unwrap().len(),
            touches.len()
        );
        assert!(events.try_recv().is_err());
        if files {
            assert_eq!(rig.file_text("notes.md"), "winner");
            assert_eq!(
                std::fs::read_dir(rig.dir.path().join("pads"))
                    .unwrap()
                    .count(),
                1
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn p2544d_two_connections_have_one_winner() {
    for files in [false, true] {
        let rig = Rig::new();
        rig.create("notes", "original").await;
        rig.ok(&Actor::user(), "pad.setStorage", json!({"files": files}))
            .await;
        let incarnation =
            rig.ok(&agent("a"), "pad.list", json!({})).await[0]["incarnation"].clone();
        let stores = [
            Pads::open(rig.dir.path(), rig.bus.clone()).unwrap(),
            Pads::open(rig.dir.path(), rig.bus.clone()).unwrap(),
        ];
        let barrier = std::sync::Barrier::new(2);
        let runtime = tokio::runtime::Handle::current();
        let results = std::thread::scope(|scope| {
            let calls: Vec<_> = stores
                .iter()
                .zip(["first", "second"])
                .map(|(pads, text)| {
                    let ctx = Ctx {
                        actor: agent("a"),
                        bus: rig.bus.clone(),
                        touches: rig.touches.clone(),
                    };
                    let incarnation = incarnation.clone();
                    let barrier = &barrier;
                    let runtime = &runtime;
                    scope.spawn(move || {
                        barrier.wait();
                        runtime.block_on(pads.call(
                            &ctx,
                            "pad.write",
                            json!({"name": "notes", "text": text, "expectedRevision": 1, "expectedIncarnation": incarnation}),
                        ))
                    })
                })
                .collect();
            calls
                .into_iter()
                .map(|call| call.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .find_map(|result| result.as_ref().err())
                .unwrap()
                .code,
            code::CONFLICT
        );
        let winner = results.into_iter().find_map(Result::ok).unwrap();
        assert_eq!(rig.ok(&agent("a"), "pad.list", json!({})).await[0], winner);
        if files {
            assert_eq!(rig.file_text("notes.md"), winner["text"].as_str().unwrap());
        }
    }
}

#[tokio::test]
async fn p2544d_guard_preserves_validation_and_shared_revision_conflicts() {
    let rig = Rig::new();
    rig.create("notes", "original").await;
    for (who, name, expected) in [
        (agent("b"), "notes", code::CONFLICT),
        (agent("a"), "missing", code::NOT_FOUND),
        (agent("a"), "../notes", code::INVALID_PARAMS),
    ] {
        let error = rig
            .fail(
                &who,
                "pad.write",
                json!({"name": name, "text": "refused", "expectedRevision": 99}),
            )
            .await;
        assert_eq!(error.code, expected);
    }
}
