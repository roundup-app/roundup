#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
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

async fn listed_names(pads: &Pads, ctx: &Ctx) -> Vec<String> {
    pads.call(ctx, "pad.list", json!(null))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|pad| pad["name"].as_str().unwrap().to_owned())
        .collect()
}

async fn pads_named(names: &[&str]) -> (tempfile::TempDir, Pads, Ctx) {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let pads = Pads::open(dir.path(), bus).unwrap();
    for name in names {
        pads.call(&ctx, "pad.create", json!({"name":name,"text":""}))
            .await
            .unwrap();
    }
    (dir, pads, ctx)
}

#[tokio::test]
async fn p17_unordered_pads_list_by_name_ignoring_case_and_by_number() {
    let (_dir, pads, ctx) = pads_named(&["engine pass 10", "Engine pass 2", "PR 86", "hum"]).await;
    assert_eq!(
        listed_names(&pads, &ctx).await,
        ["Engine pass 2", "engine pass 10", "hum", "PR 86"]
    );
}

#[tokio::test]
async fn p17_positioned_pads_keep_their_order_before_the_rest() {
    let (_dir, pads, ctx) = pads_named(&["b", "A", "c"]).await;
    let a = pads
        .call(&ctx, "pad.read", json!({"name":"A"}))
        .await
        .unwrap();
    pads.call(
        &ctx,
        "pad.reorder",
        json!({"name":"A","before":"b","expectedIncarnation":a["incarnation"]}),
    )
    .await
    .unwrap();
    pads.call(&ctx, "pad.create", json!({"name":"Z","text":""}))
        .await
        .unwrap();
    assert_eq!(listed_names(&pads, &ctx).await, ["A", "b", "c", "Z"]);
}

#[tokio::test]
async fn p17b_mixed_positioned_and_unpositioned_pads_list_positioned_first() {
    let names: Vec<String> = (0..210).map(|n| format!("pad {n:03}")).collect();
    let refs: Vec<&str> = names.iter().rev().map(String::as_str).collect();
    let (dir, pads, ctx) = pads_named(&refs).await;
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    let positioned: Vec<&String> = names.iter().step_by(3).collect();
    for (position, name) in positioned.iter().rev().enumerate() {
        db.execute(
            "UPDATE pads SET position = ?2 WHERE key = ?1",
            rusqlite::params![name, position as i64],
        )
        .unwrap();
    }
    let mut expected: Vec<String> = positioned.iter().rev().map(|n| (*n).clone()).collect();
    expected.extend(names.iter().filter(|n| !positioned.contains(n)).cloned());
    assert_eq!(listed_names(&pads, &ctx).await, expected);
}
