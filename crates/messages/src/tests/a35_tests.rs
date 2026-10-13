use super::*;

#[tokio::test]
async fn a35_reserved_messages_wait_for_the_next_attempt_release() {
    let dir = tempfile::tempdir().unwrap();
    let rail = FakeRail::new(vec![agent_node("door", Kind::Working)]);
    let bus = Bus::new();
    let typed: Arc<StdMutex<Vec<String>>> = Arc::default();
    let seen = typed.clone();
    let deliver: Deliver = Arc::new(move |_, text| {
        seen.lock().unwrap().push(text);
        Box::pin(async { Ok(()) })
    });
    let m = Messages::open(dir.path(), bus.clone(), rail.clone(), deliver).unwrap();
    let ctx = Ctx { actor: Actor::user(), bus, touches: Arc::new(Touches::in_memory().unwrap()) };
    m.call(&ctx, "message.send", json!({"to":"door","kind":"note","body":"queued"})).await.unwrap();
    m.reserve_restart("door", "rewind-c", None).await.unwrap();
    *rail.0.lock().unwrap() = vec![agent_node("door", Kind::Done)];
    // A public read/operation reconciles the stopped Rail without delivering anything.
    assert!(m.release_restart("door", "rewind-c", "2").await.is_err());
    let next = RailNode { attempt: Some("2".into()), status_revision: Some("2".into()), ..agent_node("door", Kind::Idle) };
    *rail.0.lock().unwrap() = vec![next];
    m.reserve_restart("door", "rewind-c", None).await.unwrap();
    assert!(typed.lock().unwrap().is_empty());
    m.release_restart("door", "rewind-c", "2").await.unwrap();
    m.release_restart("door", "rewind-c", "2").await.unwrap();
    assert_eq!(*typed.lock().unwrap(), vec!["[from you, note] queued"]);
    assert_eq!(m.thread("door").unwrap()[0].status, MessageStatus::Delivered);
}
