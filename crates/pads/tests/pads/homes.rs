use super::*;

#[tokio::test]
async fn p12_a_pad_made_here_is_at_the_project_root_whatever_its_params_say() {
    let rig = Rig::new();
    let made = rig
        .ok(
            &agent("a"),
            "pad.create",
            json!({"name": "notes", "home": "r1"}),
        )
        .await;
    assert_eq!(made["home"], Value::Null);
}

#[tokio::test]
async fn p12_move_sets_the_home_once_and_other_writes_keep_it() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    let user = Actor::user();
    let mut events = rig.bus.subscribe();

    let moved = rig
        .ok(&user, "pad.move", json!({"name": "notes", "home": "r1"}))
        .await;
    assert_eq!(moved["home"], "r1");
    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "notes");
    let touches = rig.touches.history("pad:notes").unwrap().len();

    rig.ok(&user, "pad.move", json!({"name": "notes", "home": "r1"}))
        .await;
    assert!(events.try_recv().is_err());
    assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);

    rig.ok(
        &agent("a"),
        "pad.write",
        json!({"name": "notes", "text": "y"}),
    )
    .await;
    rig.ok(
        &agent("b"),
        "pad.append",
        json!({"name": "notes", "text": "z"}),
    )
    .await;
    rig.ok(
        &user,
        "pad.setOwner",
        json!({"name": "notes", "owner": user}),
    )
    .await;
    assert_eq!(
        rig.ok(&user, "pad.read", json!({"name": "notes"})).await["home"],
        "r1"
    );
    let out = TempDir::new().unwrap();
    rig.ok(
        &user,
        "pad.export",
        json!({"name": "notes", "path": out.path().join("notes.md")}),
    )
    .await;
    rig.ok(&user, "pad.setStorage", json!({"files": true}))
        .await;
    assert_eq!(
        rig.ok(&user, "pad.list", json!(null)).await[0]["home"],
        "r1"
    );
    rig.ok(&user, "pad.setStorage", json!({"files": false}))
        .await;
    assert_eq!(
        rig.ok(&user, "pad.read", json!({"name": "notes"})).await["home"],
        "r1"
    );

    rig.ok(&user, "pad.move", json!({"name": "notes", "home": null}))
        .await;
    assert_eq!(
        rig.ok(&user, "pad.list", json!(null)).await[0]["home"],
        Value::Null
    );
}

#[tokio::test]
async fn p12_a_rejected_move_leaves_no_trace() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    let mut events = rig.bus.subscribe();
    let touches = rig.touches.history("pad:notes").unwrap().len();

    let by_agent = rig
        .fail(
            &agent("a"),
            "pad.move",
            json!({"name": "notes", "home": "r1"}),
        )
        .await;
    let unknown = rig
        .fail(
            &Actor::user(),
            "pad.move",
            json!({"name": "ghost", "home": "r1"}),
        )
        .await;
    let refused = rig
        .fail(
            &Actor::user(),
            "pad.move",
            json!({"name": "a/b", "home": "r1"}),
        )
        .await;

    assert_eq!(by_agent.code, code::FORBIDDEN);
    assert_eq!(unknown.code, code::NOT_FOUND);
    assert_eq!(refused.code, code::INVALID_PARAMS);
    assert!(events.try_recv().is_err());
    assert_eq!(rig.touches.history("pad:notes").unwrap().len(), touches);
}

#[tokio::test]
async fn p12_the_home_survives_open() {
    let rig = Rig::new();
    rig.create("notes", "x").await;
    rig.ok(
        &Actor::user(),
        "pad.move",
        json!({"name": "notes", "home": "r1"}),
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
    assert_eq!(listed[0]["home"], "r1");
}
