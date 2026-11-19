use super::*;

#[tokio::test]
async fn p7499a_a_pad_created_by_an_agent_is_internal_by_default() {
    let rig = Rig::new();
    let made = rig
        .ok(&agent("a"), "pad.create", json!({"name": "n"}))
        .await;
    assert_eq!(made["visibility"], "internal");
}

#[tokio::test]
async fn p7499a_a_pad_created_by_the_user_is_shown_by_default() {
    let rig = Rig::new();
    let made = rig
        .ok(&Actor::user(), "pad.create", json!({"name": "n"}))
        .await;
    assert_eq!(made["visibility"], "shown");
}

#[tokio::test]
async fn p7499a_an_explicit_visibility_wins_over_the_caller_default() {
    let rig = Rig::new();
    let shown = rig
        .ok(
            &agent("a"),
            "pad.create",
            json!({"name": "s", "visibility": "shown"}),
        )
        .await;
    let internal = rig
        .ok(
            &Actor::user(),
            "pad.create",
            json!({"name": "i", "visibility": "internal"}),
        )
        .await;
    assert_eq!(
        (shown["visibility"].clone(), internal["visibility"].clone()),
        (json!("shown"), json!("internal"))
    );
}

#[tokio::test]
async fn p7499a_set_visibility_keeps_revision_and_updated_at_and_emits_once() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    let before = rig
        .ok(&agent("a"), "pad.read", json!({"name": "notes"}))
        .await;
    let mut events = rig.bus.subscribe();
    let set = rig
        .ok(
            &agent("b"),
            "pad.setVisibility",
            json!({"name": "notes", "visibility": "shown"}),
        )
        .await;
    assert_eq!(set["visibility"], "shown");
    assert_eq!(
        (&set["revision"], &set["updatedAt"]),
        (&before["revision"], &before["updatedAt"])
    );
    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "notes");
    assert!(events.try_recv().is_err());
    let touches = rig.touches.history("pad:notes").unwrap();
    assert_eq!(touches.last().unwrap().verb, Verb::Wrote);
}

#[tokio::test]
async fn p7499a_setting_the_same_visibility_is_silent() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    let touches = rig.touches.history("pad:notes").unwrap().len();
    let mut events = rig.bus.subscribe();
    rig.ok(
        &agent("a"),
        "pad.setVisibility",
        json!({"name": "notes", "visibility": "internal"}),
    )
    .await;
    assert!(events.try_recv().is_err());
    assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);
}

#[tokio::test]
async fn p7499a_a_rejected_set_leaves_no_trace() {
    let rig = Rig::new();
    let mut events = rig.bus.subscribe();
    let missing = rig
        .fail(
            &agent("a"),
            "pad.setVisibility",
            json!({"name": "ghost", "visibility": "shown"}),
        )
        .await;
    let bad = rig
        .fail(
            &agent("a"),
            "pad.setVisibility",
            json!({"name": "../x", "visibility": "shown"}),
        )
        .await;
    assert_eq!(
        (missing.code, bad.code),
        (code::NOT_FOUND, code::INVALID_PARAMS)
    );
    assert!(events.try_recv().is_err());
    assert!(rig.touches.history("pad:ghost").unwrap().is_empty());
}

#[tokio::test]
async fn p7499a_the_visibility_survives_open_and_an_old_pad_reads_shown() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    rig.store_row("old");
    let again = Pads::open(rig.dir.path(), Bus::new()).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: rig.bus.clone(),
        touches: Arc::clone(&rig.touches),
    };
    let list = again.call(&ctx, "pad.list", json!(null)).await.unwrap();
    let seen: Vec<_> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|pad| {
            (
                pad["name"].as_str().unwrap().to_string(),
                pad["visibility"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert!(seen.contains(&("notes".into(), "internal".into())));
    assert!(seen.contains(&("old".into(), "shown".into())));
}

#[tokio::test]
async fn p7499a_the_mirrored_file_holds_only_the_text() {
    let rig = Rig::new();
    rig.ok(&agent("a"), "pad.setStorage", json!({"files": true}))
        .await;
    rig.create("notes", "just text").await;
    assert_eq!(rig.file_text("notes.md"), "just text");
}

#[tokio::test]
async fn p7499a_an_internal_pad_lists_reads_and_resolves_like_a_shown_one() {
    let rig = Rig::new();
    rig.create("notes", "# Head\nx").await;
    let list = rig.ok(&Actor::user(), "pad.list", json!(null)).await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let read = rig
        .ok(&Actor::user(), "pad.read", json!({"name": "notes"}))
        .await;
    assert_eq!(read["visibility"], "internal");
    let link = pads::reference::PadRef {
        project: String::new(),
        name: "notes".into(),
        heading: Some("Head".into()),
    };
    assert!(rig.pads.holds(&link).unwrap());
}

#[tokio::test]
async fn u7499c_a_long_pad_name_still_creates() {
    let rig = Rig::new();
    let name = "a".repeat(120);
    let made = rig
        .ok(&agent("a"), "pad.create", json!({"name": name}))
        .await;
    assert_eq!(made["name"], name.as_str());
}
