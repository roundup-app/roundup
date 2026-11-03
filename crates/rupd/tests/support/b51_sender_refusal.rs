//! B51: authenticated sender refusal and accepted question identities.
use super::*;

#[tokio::test]
async fn b51_a_note_repeating_the_last_one_is_refused_and_made_no_record() {
    // B51(g): rejects kind-scoped refusal across all authenticated non-user senders.
    for sender in ["agent", "ext", "daemon"] {
        for first_kind in ["note", "question"] {
            for next_kind in ["note", "question"] {
                let mut run = Run::start().await;
                run.identify_sender(sender).await;
                run.kind = first_kind;
                let first = run.note("same").await;
                until("taken up", async || {
                    (run.entries() == [format!("rup-{first}")]).then_some(())
                })
                .await;
                run.kind = next_kind;
                let err = run.try_note("same").await.unwrap_err();
                assert_eq!(err.code, rpc::code::CONFLICT);
                assert_eq!(
                    err.message,
                    "same text as your last Message; Claude Code drops repeats"
                );
                let listed = run
                    .user
                    .request("message.list", json!({"to":run.child}))
                    .await
                    .unwrap();
                assert_eq!(listed.as_array().unwrap().len(), 1, "no second record");
                // Another text, and the same text once another note came between, are taken up.
                let other = run.note("other").await;
                until("different entry reached the peer", async || {
                    run.entries()
                        .contains(&format!("rup-{other}"))
                        .then_some(())
                })
                .await;
                let again = run.note("same").await;
                until("taken up", async || {
                    (run.entries().len() == 3).then_some(())
                })
                .await;
                assert_eq!(
                    run.entries(),
                    [first, other, again].map(|id| format!("rup-{id}"))
                );
            }
        }
    }
}

// B51(g): rejects global/sender-independent refusal or merging the identities of accepted questions.
#[tokio::test]
async fn b51_other_senders_and_a_new_attempt_keep_distinct_messages() {
    let mut run = Run::start().await;
    run.kind = "question";
    let first = run.note("same").await;
    until("first", async || (run.entries().len() == 1).then_some(())).await;
    run.identify_sender("daemon").await;
    let second = run.note("same").await;
    until("different sender", async || {
        (run.entries().len() == 2).then_some(())
    })
    .await;
    assert_ne!(first, second);
    assert_eq!(run.message(first).await["from"]["kind"], "ext");
    assert_eq!(
        run.message(second).await["from"]["id"],
        contracts::Actor::daemon().id
    );
    run.record(&[first, second]).await;
    until("receipts", async || {
        (run.status(first).await.0 == "delivered" && run.status(second).await.0 == "delivered")
            .then_some(())
    })
    .await;
    run.restart().await;
    run.identify_sender("daemon").await;
    let third = run.note("same").await;
    until("new Attempt", async || {
        (run.entries().len() == 1).then_some(())
    })
    .await;
    assert_eq!(run.entries(), [format!("rup-{third}")]);
    assert!(third > second);
    assert_eq!(run.message(third).await["kind"], "question");
    assert_eq!(run.typed().await, 0);
}
