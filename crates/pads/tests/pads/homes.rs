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
        .ok(
            &agent("b"),
            "pad.move",
            json!({"name": "notes", "home": "r1"}),
        )
        .await;
    assert_eq!(moved["home"], "r1");
    let EventData::PadChanged(changed) = events.try_recv().unwrap().data else {
        panic!("expected pad.changed");
    };
    assert_eq!(changed.name, "notes");
    let touches = rig.touches.history("pad:notes").unwrap().len();

    rig.ok(
        &agent("b"),
        "pad.move",
        json!({"name": "notes", "home": "r1"}),
    )
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

#[tokio::test]
async fn p10_rejected_calls_leave_no_trace() {
    for files in [false, true] {
        let rig = Rig::new();
        let caller = agent("b");
        rig.create("notes", "original").await;
        rig.ok(&caller, "pad.move", json!({"name":"notes","home":"home"}))
            .await;
        rig.ok(&Actor::user(), "pad.setStorage", json!({"files":files}))
            .await;
        let before = rig.ok(&caller, "pad.list", Value::Null).await;
        let touches = rig.touches.history("pad:notes").unwrap();
        let mut events = rig.bus.subscribe();
        for (method, params, expected) in [
            (
                "pad.create",
                json!({"name":"Notes","text":"replacement"}),
                code::CONFLICT,
            ),
            ("pad.read", json!({"name":"../x"}), code::INVALID_PARAMS),
            (
                "pad.append",
                json!({"name":"../x","text":"replacement"}),
                code::INVALID_PARAMS,
            ),
            ("pad.delete", json!({"name":"../x"}), code::INVALID_PARAMS),
            (
                "pad.write",
                json!({"name":"missing","text":"replacement"}),
                code::NOT_FOUND,
            ),
        ] {
            assert_eq!(rig.fail(&caller, method, params).await.code, expected);
            assert_eq!(rig.ok(&caller, "pad.list", Value::Null).await, before);
            assert!(events.try_recv().is_err());
            assert_eq!(rig.touches.history("pad:notes").unwrap(), touches);
            let directory = rig.dir.path().join("pads");
            let entries: Vec<_> = if directory.exists() {
                std::fs::read_dir(&directory)
                    .unwrap()
                    .map(|entry| entry.unwrap().file_name())
                    .collect()
            } else {
                Vec::new()
            };
            if files {
                assert_eq!(entries, [std::ffi::OsString::from("notes.md")]);
                assert_eq!(rig.file_text("notes.md"), "original");
            } else {
                assert!(entries.is_empty());
            }
        }
    }
}
