//! DTC2: a note about a child wakes the Door only when the Door must act.
use super::*;

impl Pushes {
    async fn quiet(&self, entry: &DigestEntry) {
        self.messages
            .push_digest("top", &entry.name, entry, false)
            .await;
    }

    async fn send_to_door(&self, body: &str) {
        for node in self.rail.0.lock().unwrap().iter_mut() {
            if node.id == "top" {
                node.status.as_mut().unwrap().kind = Kind::Idle;
            }
        }
        self.call_as(
            Actor::user(),
            "message.send",
            json!({"to":"top","kind":"note","body":body}),
        )
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn dtc2_a_status_flip_of_a_child_starts_no_door_turn() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for n in 0..12 {
        h.quiet(&entry("d", n)).await;
    }
    // Not even the window's end writes a quiet note.
    h.at(120_000).await;
    assert!(h.all().await.is_empty());
}

#[tokio::test]
async fn dtc2_quiet_notes_ride_in_the_next_waking_batch() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.quiet(&entry("d", 1)).await;
    h.quiet(&entry("d", 2)).await;
    h.quiet(&entry("mid", 3)).await;
    assert!(h.all().await.is_empty());
    let mut ended = entry("c", 0);
    ended.kind = Kind::Done;
    h.push(&ended).await;
    let sent = h.standing().await;
    assert_eq!(
        sent.len(),
        1,
        "one write holds the waking note and the quiet ones"
    );
    assert_eq!(h.pl(&sent[0]).weight(), 4);
    let names: Vec<_> = h
        .pl(&sent[0])
        .entries()
        .iter()
        .map(|e| e.name.clone())
        .collect();
    assert_eq!(names.len(), 3);
    for name in ["d", "mid", "c"] {
        assert!(names.contains(&name.to_owned()), "{names:?}");
    }
    let d = h
        .pl(&sent[0])
        .entries()
        .iter()
        .find(|e| e.name == "d")
        .unwrap()
        .todos;
    assert_eq!(d, 2, "each child's entry is folded to its newest");
}

#[tokio::test]
async fn dtc2_a_quiet_note_rides_in_a_turn_the_users_message_starts() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.quiet(&entry("d", 5)).await;
    assert!(h.all().await.is_empty());
    h.send_to_door("hello").await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(h.pl(&sent[0]).entries()[0].todos, 5);
}

#[tokio::test]
async fn dtc2_a_restart_keeps_the_waiting_quiet_notes() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.quiet(&entry("d", 7)).await;
    let h = h.restarted();
    h.at(120_000).await;
    assert!(h.all().await.is_empty(), "still quiet after the restart");
    h.send_to_door("wake").await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(h.pl(&sent[0]).entries()[0].todos, 7);
}

#[tokio::test]
async fn dtc2_a_report_wakes_the_door_within_2s() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.quiet(&entry("d", 1)).await;
    // The Door waits on the child `c`, whose own report is still a waking note.
    h.messages
        .save_wake("top", &["c".to_owned()], false, &[], 0)
        .unwrap();
    h.clock.store(10_000, Ordering::SeqCst);
    let mut ended = entry("c", 0);
    ended.kind = Kind::Done;
    h.push(&ended).await;
    // No flush and no later clock: the 2 s after the Stop have not passed, and the report is
    // written, with the quiet note, whatever the open request.
    h.clock.store(11_999, Ordering::SeqCst);
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(h.pl(&sent[0]).weight(), 2);
}

#[tokio::test]
async fn dtc2_error_and_needs_you_still_wake_the_door_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    for (n, kind) in [Kind::Error, Kind::NeedsYou].into_iter().enumerate() {
        let mut attention = entry(&format!("c{n}"), 0);
        attention.kind = kind;
        h.push(&attention).await;
        assert_eq!(
            h.standing().await.len(),
            n + 1,
            "{kind:?} is written at once"
        );
    }
}

#[tokio::test]
async fn dtc2_a_quiet_note_rides_in_a_turn_the_users_prompt_starts() {
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.quiet(&entry("d", 3)).await;
    assert!(h.all().await.is_empty());
    // Nothing else is pending for the Door: its status turns `working` as the prompt starts.
    pushes::release_quiet(&h.messages.inner, "top", true).await;
    let sent = h.standing().await;
    assert_eq!(sent.len(), 1);
    assert_eq!(h.pl(&sent[0]).entries()[0].todos, 3);
    // A Door at rest takes nothing for quiet notes alone.
    let dir = tempfile::tempdir().unwrap();
    let h = Pushes::new(dir.path());
    h.quiet(&entry("e", 1)).await;
    pushes::release_quiet(&h.messages.inner, "top", false).await;
    assert!(h.all().await.is_empty());
}
