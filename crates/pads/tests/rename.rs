use std::sync::Arc;
use contracts::{Actor, EventData};
use pads::Pads;
use provenance::Touches;
use rpc::{Bus, Ctx, Module};
use serde_json::json;

#[tokio::test]
async fn u3789a_rename_retains_creation_and_content_after_restart() {
    for files in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let ctx = Ctx { actor: Actor::user(), bus: bus.clone(), touches: Arc::new(Touches::in_memory().unwrap()) };
        let pads = Pads::open(dir.path(), bus.clone()).unwrap();
        let original = pads.call(&ctx, "pad.create", json!({"name":"Notes","text":"exact\n text 🌱\n"})).await.unwrap();
        pads.call(&ctx, "pad.move", json!({"name":"Notes","home":"home"})).await.unwrap();
        pads.call(&ctx, "pad.setStorage", json!({"files":files})).await.unwrap();
        let mut events = bus.subscribe();
        let renamed = pads.call(&ctx, "pad.rename", json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]})).await.unwrap();
        let mut expected = original;
        expected["name"] = json!("Plan");
        expected["home"] = json!("home");
        assert_eq!(renamed, expected);
        assert!(matches!(events.try_recv().unwrap().data, EventData::PadChanged(_)));
        drop(pads);
        let pads = Pads::open(dir.path(), bus).unwrap();
        assert_eq!(pads.call(&ctx, "pad.read", json!({"name":"plan"})).await.unwrap(), expected);
        assert!(pads.call(&ctx, "pad.read", json!({"name":"Notes"})).await.is_err());
        if files {
            assert!(!dir.path().join("pads/Notes.md").exists());
            assert_eq!(std::fs::read_to_string(dir.path().join("pads/Plan.md")).unwrap(), "exact\n text 🌱\n");
        }
        let db = rusqlite::Connection::open(dir.path().join("pads.db")).unwrap();
        let source = pads::source(&db, "Plan").unwrap().unwrap();
        assert_eq!(pads::source_state(&db, source.incarnation).unwrap(), pads::PadSourceState::Live(source));
    }
}
