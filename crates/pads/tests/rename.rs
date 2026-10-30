use contracts::{Actor, EventData};
use pads::Pads;
use provenance::Touches;
use rpc::{Bus, Ctx, Module};
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
async fn u3789a_rename_retains_creation_and_content_after_restart() {
    for files in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: Arc::new(Touches::in_memory().unwrap()),
        };
        let pads = Pads::open(dir.path(), bus.clone()).unwrap();
        let original = pads
            .call(
                &ctx,
                "pad.create",
                json!({"name":"Notes","text":"exact\n text 🌱\n"}),
            )
            .await
            .unwrap();
        pads.call(&ctx, "pad.move", json!({"name":"Notes","home":"home"}))
            .await
            .unwrap();
        pads.call(&ctx, "pad.setStorage", json!({"files":files}))
            .await
            .unwrap();
        let mut events = bus.subscribe();
        let renamed = pads.call(&ctx, "pad.rename", json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]})).await.unwrap();
        let mut expected = original;
        expected["name"] = json!("Plan");
        expected["home"] = json!("home");
        assert_eq!(renamed, expected);
        assert!(matches!(
            events.try_recv().unwrap().data,
            EventData::PadChanged(_)
        ));
        let EventData::PadRenamed {
            incarnation,
            name,
            previous_name,
        } = events.try_recv().unwrap().data
        else {
            panic!("expected accepted rename identity");
        };
        assert_eq!(
            (incarnation.as_str(), name.as_str(), previous_name.as_str()),
            (expected["incarnation"].as_str().unwrap(), "Plan", "Notes")
        );
        drop(pads);
        let pads = Pads::open(dir.path(), bus).unwrap();
        assert_eq!(
            pads.call(&ctx, "pad.read", json!({"name":"plan"}))
                .await
                .unwrap(),
            expected
        );
        assert!(
            pads.call(&ctx, "pad.read", json!({"name":"Notes"}))
                .await
                .is_err()
        );
        if files {
            assert!(!dir.path().join("pads/Notes.md").exists());
            assert_eq!(
                std::fs::read_to_string(dir.path().join("pads/Plan.md")).unwrap(),
                "exact\n text 🌱\n"
            );
        }
        let db = rusqlite::Connection::open(dir.path().join("pads.db")).unwrap();
        let source = pads::source(&db, "Plan").unwrap().unwrap();
        assert_eq!(
            pads::source_state(&db, source.incarnation).unwrap(),
            pads::PadSourceState::Live(source)
        );
    }
}

#[tokio::test]
async fn u3789a_rename_refusals_leave_pads_mirrors_touches_and_events_unchanged() {
    for files in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let touches = Arc::new(Touches::in_memory().unwrap());
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: touches.clone(),
        };
        let pads = Pads::open(dir.path(), bus.clone()).unwrap();
        let original = pads
            .call(
                &ctx,
                "pad.create",
                json!({"name":"Notes","text":"original"}),
            )
            .await
            .unwrap();
        pads.call(&ctx, "pad.create", json!({"name":"Café","text":"other"}))
            .await
            .unwrap();
        pads.call(&ctx, "pad.setStorage", json!({"files":files}))
            .await
            .unwrap();
        let before = pads.call(&ctx, "pad.list", json!(null)).await.unwrap();
        let mut events = bus.subscribe();
        for (name, new_name, incarnation, code) in [
            (
                "Notes",
                "cafe\u{301}",
                original["incarnation"].clone(),
                rpc::code::CONFLICT,
            ),
            (
                "Notes",
                "CAFÉ",
                original["incarnation"].clone(),
                rpc::code::CONFLICT,
            ),
            (
                "notes",
                "Plan",
                original["incarnation"].clone(),
                rpc::code::CONFLICT,
            ),
            ("Notes", "Plan", json!("stale"), rpc::code::CONFLICT),
            (
                "Missing",
                "Plan",
                original["incarnation"].clone(),
                rpc::code::NOT_FOUND,
            ),
            (
                "Notes",
                "../bad",
                original["incarnation"].clone(),
                rpc::code::INVALID_PARAMS,
            ),
            (
                "Notes",
                "",
                original["incarnation"].clone(),
                rpc::code::INVALID_PARAMS,
            ),
        ] {
            let error = pads
                .call(
                    &ctx,
                    "pad.rename",
                    json!({"name":name,"newName":new_name,"expectedIncarnation":incarnation}),
                )
                .await
                .unwrap_err();
            assert_eq!(error.code, code, "{name} -> {new_name}");
        }

        assert_eq!(
            pads.call(&ctx, "pad.list", json!(null)).await.unwrap(),
            before
        );
        assert!(events.try_recv().is_err());
        assert_eq!(touches.history("pad:Notes").unwrap().len(), 1);
        assert!(touches.history("pad:Plan").unwrap().is_empty());
        if files {
            assert_eq!(
                std::fs::read_to_string(dir.path().join("pads/Notes.md")).unwrap(),
                "original"
            );
            assert_eq!(
                std::fs::read_to_string(dir.path().join("pads/Café.md")).unwrap(),
                "other"
            );
        }
    }
}

#[tokio::test]
async fn u3789a_rename_equivalent_spelling_keeps_the_source() {
    for (name, new_name) in [
        ("Notes", "NOTES"),
        ("Café", "Cafe\u{301}"),
        ("Straße", "STRASSE"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: Arc::new(Touches::in_memory().unwrap()),
        };
        let pads = Pads::open(dir.path(), bus).unwrap();
        let original = pads
            .call(&ctx, "pad.create", json!({"name":name,"text":"original"}))
            .await
            .unwrap();
        pads.call(&ctx, "pad.setStorage", json!({"files":true}))
            .await
            .unwrap();
        let renamed = pads.call(&ctx, "pad.rename", json!({"name":name,"newName":new_name,"expectedIncarnation":original["incarnation"]})).await.unwrap();
        let mut expected = original;
        expected["name"] = json!(new_name);
        assert_eq!(renamed, expected);
        assert_eq!(
            pads.call(&ctx, "pad.read", json!({"name":name}))
                .await
                .unwrap(),
            expected
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(format!("pads/{new_name}.md"))).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_dir(dir.path().join("pads")).unwrap().count(),
            1
        );
    }
}

#[tokio::test]
async fn u3789a_failed_mirror_rename_restores_external_original_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let pads = Pads::open(dir.path(), bus.clone()).unwrap();
    let original = pads
        .call(
            &ctx,
            "pad.create",
            json!({"name":"Notes","text":"database"}),
        )
        .await
        .unwrap();
    pads.call(&ctx, "pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    std::fs::write(dir.path().join("pads/Notes.md"), "external\n unfinished 🌱").unwrap();
    std::fs::create_dir(dir.path().join("pads/Plan.md")).unwrap();
    let mut events = bus.subscribe();
    assert!(
        pads.call(
            &ctx,
            "pad.rename",
            json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]})
        )
        .await
        .is_err()
    );
    assert!(events.try_recv().is_err());
    assert_eq!(
        pads.call(&ctx, "pad.read", json!({"name":"Notes"}))
            .await
            .unwrap(),
        original
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads/Notes.md")).unwrap(),
        "external\n unfinished 🌱"
    );
    std::fs::remove_dir(dir.path().join("pads/Plan.md")).unwrap();
    pads.call(
        &ctx,
        "pad.rename",
        json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]}),
    )
    .await
    .unwrap();
    pads.call(&ctx, "pad.setStorage", json!({"files":false}))
        .await
        .unwrap();
    assert_eq!(
        pads.call(&ctx, "pad.read", json!({"name":"Plan"}))
            .await
            .unwrap()["text"],
        "external\n unfinished 🌱"
    );
}

#[tokio::test]
async fn u3789a_same_name_rename_is_not_a_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let pads = Pads::open(dir.path(), bus.clone()).unwrap();
    let original = pads
        .call(
            &ctx,
            "pad.create",
            json!({"name":"Notes","text":"original"}),
        )
        .await
        .unwrap();
    let mut events = bus.subscribe();
    assert_eq!(
        pads.call(
            &ctx,
            "pad.rename",
            json!({"name":"Notes","newName":"Notes","expectedIncarnation":original["incarnation"]})
        )
        .await
        .unwrap(),
        original
    );
    assert!(events.try_recv().is_err());
    assert_eq!(ctx.touches.history("pad:Notes").unwrap().len(), 1);
}

#[tokio::test]
async fn u3789a_missing_original_mirror_is_rebuilt_without_clobbering_destination() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let pads = Pads::open(dir.path(), bus.clone()).unwrap();
    let original = pads
        .call(
            &ctx,
            "pad.create",
            json!({"name":"Notes","text":"database"}),
        )
        .await
        .unwrap();
    pads.call(&ctx, "pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    std::fs::remove_file(dir.path().join("pads/Notes.md")).unwrap();
    std::fs::write(dir.path().join("pads/Plan.md"), "untracked external data").unwrap();
    let mut events = bus.subscribe();
    assert!(
        pads.call(
            &ctx,
            "pad.rename",
            json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]})
        )
        .await
        .is_err()
    );
    assert!(events.try_recv().is_err());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads/Plan.md")).unwrap(),
        "untracked external data"
    );
    assert_eq!(
        pads.call(&ctx, "pad.read", json!({"name":"Notes"}))
            .await
            .unwrap(),
        original
    );
    std::fs::remove_file(dir.path().join("pads/Plan.md")).unwrap();
    pads.call(
        &ctx,
        "pad.rename",
        json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]}),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads/Plan.md")).unwrap(),
        "database"
    );
}
