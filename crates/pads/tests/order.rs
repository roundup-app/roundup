use contracts::{Actor, EventData};
use pads::Pads;
use provenance::Touches;
use rpc::{Bus, Ctx, Module};
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
async fn u3800a_reorder_survives_refetch_and_restart_without_editing_content() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let pads = Pads::open(dir.path(), bus.clone()).unwrap();
    let mut originals = Vec::new();
    for name in ["A", "B", "C"] {
        originals.push(
            pads.call(
                &ctx,
                "pad.create",
                json!({"name":name,"text":"retained text"}),
            )
            .await
            .unwrap(),
        );
    }
    let mut events = bus.subscribe();
    assert_eq!(
        pads.call(
            &ctx,
            "pad.reorder",
            json!({"name":"A","before":"C","expectedIncarnation":originals[0]["incarnation"]})
        )
        .await
        .unwrap(),
        originals[0]
    );
    assert!(matches!(
        events.try_recv().unwrap().data,
        EventData::PadChanged(_)
    ));
    assert!(events.try_recv().is_err());
    drop(pads);
    let pads = Pads::open(dir.path(), bus).unwrap();
    assert_eq!(
        pads.call(&ctx, "pad.list", json!(null)).await.unwrap(),
        json!([originals[1], originals[0], originals[2]])
    );
}

#[tokio::test]
async fn u3800a_reorder_refuses_replaced_creation_without_changing_order() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let pads = Pads::open(dir.path(), bus.clone()).unwrap();
    for name in ["A", "B"] {
        pads.call(&ctx, "pad.create", json!({"name":name}))
            .await
            .unwrap();
    }
    let original = pads.call(&ctx, "pad.list", json!(null)).await.unwrap();
    let mut events = bus.subscribe();
    let error = pads
        .call(
            &ctx,
            "pad.reorder",
            json!({"name":"A","before":null,"expectedIncarnation":"retired"}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    assert_eq!(
        pads.call(&ctx, "pad.list", json!(null)).await.unwrap(),
        original
    );
    assert!(events.try_recv().is_err());
}
