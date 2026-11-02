//! B3692a, B3692b: a question is one ordinary Message, and a store from before that holds no bubbling.

use super::*;

fn count_and_statuses(all: &[(String, String, Value)]) -> Vec<(String, String)> {
    all.iter().map(|m| (m.0.clone(), m.1.clone())).collect()
}

#[tokio::test]
async fn b3692a_an_unanswered_question_makes_no_second_message() {
    let dir = tempfile::tempdir().unwrap();
    let mut nodes = tree();
    nodes.push(door("other", None));
    nodes.push(child("e", "other"));
    let h = Hops::over(dir.path(), FakeRail::new(nodes), Arc::default());
    h.ask("c", "sub").await;
    h.ask("e", "other").await;
    let sent = count_and_statuses(&h.all().await);
    assert_eq!(
        sent,
        [
            ("sub".into(), "pending".into()),
            ("other".into(), "pending".into())
        ]
    );
    for ms in [59_999, 60_000, 600_000] {
        h.at(ms).await;
        assert_eq!(count_and_statuses(&h.all().await), sent, "at {ms} ms");
    }

    h.becomes("sub", Kind::Idle).await;
    h.becomes("sub", Kind::Working).await;
    h.becomes("sub", Kind::Idle).await;
    h.at(1_200_000).await;
    let delivered = count_and_statuses(&h.all().await);
    assert_eq!(delivered[0], ("sub".into(), "delivered".into()));
    assert_eq!(delivered.len(), 2);

    let h = h.restarted();
    h.at(2_400_000).await;
    assert_eq!(count_and_statuses(&h.all().await), delivered);
    assert!(h.all().await.iter().all(|m| m.0 != Actor::user().id));
}

#[tokio::test]
async fn b3692a_a_question_to_an_agent_that_ends_stays_dropped_and_nothing_replaces_it() {
    let dir = tempfile::tempdir().unwrap();
    let h = Hops::new(dir.path());
    h.ask("c", "sub").await;
    h.becomes("sub", Kind::Done).await;
    h.at(600_000).await;
    let all = h.all().await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].1, "dropped");
    assert_eq!(all[0].2, "receiver gone");
}
