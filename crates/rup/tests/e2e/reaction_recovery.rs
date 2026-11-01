//! NR3/NR5: durable recovery, source gaps and failed observation writes.
use super::*;
use crate::daemon::storage::{PROJECT_V35, legacy_reaction};

#[tokio::test]
async fn nr5_gaps_require_condition_specific_evidence() {
    let mut s = scene(&[]).await;
    // A named Agent that is gone: nothing matches, and inspection says why.
    let gone = watching(&s, "gone", &[&s.a, &s.b], json!({})).await;
    s.user
        .request("rail.remove", json!({ "id": s.b }))
        .await
        .unwrap();
    drive(&s.user, &s.a, STOP).await;
    still(&s.user, &s.w, "gone", 0).await;
    let seen = current(&s, &gone).await;
    assert_eq!(seen.observation.health, "unavailable");
    assert!(seen.observation.gap.is_some() && seen.observation.recovery.is_some());

    // Expired history with current state that is sufficient reconciles, and the gap stays recorded.
    drive(&s.user, &s.a, WORK).await;
    let mut body = definition(&s.door, "expired");
    body["condition"]["ids"] = json!([s.a]);
    let live = made(&s.user, "reaction.create", body).await;
    still(&s.user, &s.door, "expired", 0).await;
    drop(s.user);
    s.project.crash();
    project_db(&s.project)
        .execute("DELETE FROM events", [])
        .unwrap();
    project_db(&s.project)
        .execute(
            "UPDATE reaction_watch SET state = json_set(state, '$.seen', 0)",
            [],
        )
        .unwrap();
    s.project.restart(&[]);
    let user = s.project.client().await;
    start_again(&user, &s.door).await;
    notes(&user, &s.door, "expired", 1).await;
    let after = made(&user, "reaction.get", json!({ "id": live.id })).await;
    assert!(after.observation.gap.unwrap().contains("expired"));
    assert_eq!(after.firings.len(), 1);
}

#[tokio::test]
async fn nr3_automatic_write_failure_is_inspectable_and_recovers() {
    let mut s = scene(&[]).await;
    s.w = s.door.clone();
    let saved = watching(&s, "failed firing", &[&s.a], json!({})).await;
    project_db(&s.project).execute_batch("CREATE TRIGGER refuse_reaction BEFORE INSERT ON reaction_firings BEGIN SELECT RAISE(ABORT, 'reaction write refused'); END;").unwrap();
    drive(&s.user, &s.a, STOP).await;
    let failed = crate::daemon::h21_poll("reaction observes failed acceptance", async || {
        let seen = current(&s, &saved).await;
        let completed = seen
            .observation
            .evidence
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .is_some_and(|evidence| {
                evidence["finished"]
                    .as_array()
                    .is_some_and(|ids| ids.contains(&json!(s.a)))
            });
        (completed && seen.observation.health == "acceptance-failed").then_some(seen)
    })
    .await;
    assert_ne!(
        failed.observation.health, "observing",
        "write failure hidden: {failed:?}"
    );
    assert!(
        failed
            .observation
            .cause
            .as_deref()
            .unwrap()
            .contains("reaction write refused")
    );
    assert!(failed.observation.recovery.is_some());
    assert_eq!(failed.remaining, 1);
    // Atomicity itself is proved by messages::tests::b_fault_tests::nr3_firing_and_message_commit_together.
    // Reopening must retain an inspectable failure and the unspent bound. A Project refuses to open
    // with a trigger its migrations did not build (N5420a), so the fault is lifted for the reopen
    // and set again before anything can fire: a reopen alone fires nothing, only a started Door does.
    drop(s.user);
    s.project.crash();
    project_db(&s.project)
        .execute_batch("DROP TRIGGER refuse_reaction")
        .unwrap();
    s.project.restart(&[]);
    project_db(&s.project).execute_batch("CREATE TRIGGER refuse_reaction BEFORE INSERT ON reaction_firings BEGIN SELECT RAISE(ABORT, 'reaction write refused'); END;").unwrap();
    s.user = s.project.client().await;
    let kept = current(&s, &saved).await;
    assert!(
        kept.observation
            .cause
            .as_deref()
            .unwrap()
            .contains("reaction write refused")
    );
    assert!(kept.observation.recovery.is_some());
    assert_eq!(kept.remaining, 1);
    project_db(&s.project)
        .execute_batch("DROP TRIGGER refuse_reaction")
        .unwrap();
    start_again(&s.user, &s.door).await;
    let sent = notes(&s.user, &s.w, "failed firing", 1).await;
    let recovered = crate::wake::cleared_cause(&s.user, &saved.id).await;
    assert_eq!((recovered.firings.len(), recovered.remaining), (1, 0));
    let firing = &recovered.firings[0];
    assert_eq!(sent[0]["id"], json!(firing.message));
    assert!(firing.matched);
    let definition: Value = serde_json::from_str(&firing.definition).unwrap();
    assert_eq!(definition["instruction"], saved.instruction);
    assert_eq!(
        definition["condition"],
        serde_json::to_value(&saved.condition).unwrap()
    );
    let evidence: Value = serde_json::from_str(&firing.evidence).unwrap();
    assert!(
        evidence["finished"]
            .as_array()
            .unwrap()
            .contains(&json!(s.a))
    );
    drop(s.user);
    s.project.restart(&[]);
    s.user = s.project.client().await;
    let replayed = current(&s, &saved).await;
    assert_eq!(replayed.firings, recovered.firings);
    let sent = messages(&s.user, &s.w, "failed firing").await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["id"], json!(firing.message));
}

#[tokio::test]
async fn nr3_legacy_firings_keep_identity_on_upgrade_and_replay() {
    let acceptance = |f: &contracts::reaction::Firing| {
        (
            f.id.clone(),
            f.ordinal,
            f.message,
            f.matched,
            f.evidence.clone(),
            f.definition.clone(),
        )
    };
    for manual_first in [true, false] {
        let mut s = scene(&[]).await;
        s.w = crate::start_door(&s.user).await;
        let mut body = definition(&s.w, "legacy firing");
        body["condition"]["ids"] = json!([s.a]);
        body["rearm"] = json!(true);
        body["max_firings"] = json!(2);
        let saved = made(&s.user, "reaction.create", body.clone()).await;
        let watch: String = project_db(&s.project)
            .query_row(
                "SELECT state FROM reaction_watch WHERE reaction=?1",
                [&saved.id],
                |r| r.get(0),
            )
            .unwrap();
        let run = json!({ "id": saved.id, "operation": "auto-1" });
        let first = if manual_first {
            made(&s.user, "reaction.run", run.clone()).await
        } else {
            drive(&s.user, &s.a, STOP).await;
            // Retried creation waits for the evaluator, including its saved Watch.
            made(&s.user, "reaction.create", body.clone()).await
        };
        assert_eq!(first.firings.len(), 1);
        drop(s.user);
        s.project.crash();
        {
            legacy_reaction(&s.project.data_dir().join("project.db"), PROJECT_V35[18]);
            if !manual_first {
                let db = project_db(&s.project);
                // NR3's crash between firing commit and Watch save: automatic replay must reuse it.
                db.execute(
                    "UPDATE reaction_watch SET state=?1 WHERE reaction=?2",
                    [&watch, &saved.id],
                )
                .unwrap();
            }
        }
        s.project.restart(&[]);
        s.user = s.project.client().await;
        start_again(&s.user, &s.w).await;
        let replayed = made(&s.user, "reaction.create", body).await;
        assert_eq!(
            acceptance(&replayed.firings[0]),
            acceptance(&first.firings[0])
        );
        assert_eq!(
            replayed.firings.len(),
            if manual_first { 2 } else { 1 },
            "{replayed:?}"
        );
        let ran = made(&s.user, "reaction.run", run.clone()).await;
        assert_eq!(ran.firings.len(), 2);
        assert_eq!(ran.remaining, 0);
        assert_eq!(acceptance(&ran.firings[0]), acceptance(&first.firings[0]));
        assert_eq!(ran.firings[1].matched, manual_first);
        let retry = made(&s.user, "reaction.run", run).await;
        assert_eq!(
            retry.firings.iter().map(acceptance).collect::<Vec<_>>(),
            ran.firings.iter().map(acceptance).collect::<Vec<_>>()
        );
        let sent = messages(&s.user, &s.w, "legacy firing").await;
        assert_eq!(sent.len(), 2);
        for firing in &ran.firings {
            assert!(
                sent.iter()
                    .any(|message| message["id"] == json!(firing.message))
            );
        }
    }
}

#[tokio::test]
async fn nr5_gap_recovery_cannot_reuse_a_pre_rearm_finish() {
    for rearmed in [false, true] {
        let s = scene(&[]).await;
        drive(&s.user, &s.a, STOP).await;
        drive(&s.user, &s.b, STOP).await;
        let mode = json!({ "any": true, "rearm": true, "max_firings": 2 });
        let first = watching(&s, "gap-rearm", &[&s.b, &s.a], mode.clone()).await;
        drive(&s.user, &s.a, WORK).await;
        watching(&s, "gap-rearm", &[&s.b, &s.a], mode.clone()).await;
        let before: String = project_db(&s.project)
            .query_row(
                "SELECT state FROM reaction_watch WHERE reaction=?1",
                [&first.id],
                |r| r.get(0),
            )
            .unwrap();
        drive(&s.user, &s.a, STOP).await;
        drive(&s.user, &s.b, WORK).await;
        watching(&s, "gap-rearm", &[&s.b, &s.a], mode.clone()).await;
        // Expire history either before the observer saved A's finish and B's re-arm, or after it.
        // B comes first in the definition, so a snapshot cannot depend on participant order.
        let mut db = project_db(&s.project);
        let tx = db.transaction().unwrap();
        if !rearmed {
            tx.execute(
                "UPDATE reaction_watch SET state=?1 WHERE reaction=?2",
                [&before, &first.id],
            )
            .unwrap();
        }
        // Advance the retained head beyond every pre-gap cursor. Resetting only the Watch's
        // cursor races an evaluator that loaded the old Watch before this fixture write.
        tx.execute_batch(
            "INSERT INTO events (id, event)
                 SELECT id + 2, event FROM events ORDER BY id DESC LIMIT 1;
             DELETE FROM events WHERE id < (SELECT MAX(id) FROM events);",
        )
        .unwrap();
        tx.commit().unwrap();
        drop(db);
        let recovered = watching(&s, "gap-rearm", &[&s.b, &s.a], mode.clone()).await;
        assert!(
            recovered
                .observation
                .gap
                .as_deref()
                .unwrap()
                .contains("expired")
        );
        assert_eq!(recovered.firings, first.firings);
        assert_eq!(recovered.remaining, 1);
        assert_eq!(messages(&s.user, &s.w, "gap-rearm").await.len(), 1);
        drive(&s.user, &s.b, STOP).await;
        let completed = watching(&s, "gap-rearm", &[&s.b, &s.a], mode).await;
        assert_eq!((completed.firings.len(), completed.remaining), (2, 0));
        assert_eq!(messages(&s.user, &s.w, "gap-rearm").await.len(), 2);
    }
}

#[tokio::test]
async fn nr3_watch_write_failure_is_visible_and_keeps_eligible_work() {
    for (reopen, accepted) in [(false, 1), (true, 1), (true, 2)] {
        let mut s = scene(&[]).await;
        // Doors keep their identity and can be explicitly started again after a reopen.
        s.a = s.door.clone();
        s.w = crate::start_door(&s.user).await;
        let mode = json!({ "rearm": true, "max_firings": 3 });
        watching(&s, "watch-write", &[&s.a], mode.clone()).await;
        project_db(&s.project)
            .execute_batch(
                "CREATE TRIGGER fail_watch BEFORE INSERT ON reaction_watch
             BEGIN SELECT RAISE(ABORT, 'injected watch write failure'); END;",
            )
            .unwrap();
        drive(&s.user, &s.a, STOP).await;
        // Retrying creation waits for evaluation and the attempted Watch save.
        let failed = watching(&s, "watch-write", &[&s.a], mode.clone()).await;
        assert_eq!(
            failed.firings.len(),
            1,
            "the firing committed before its Watch write"
        );
        assert!(
            failed.observation.health != "observing"
                && (failed.observation.cause.is_some() || failed.observation.gap.is_some())
                && failed.observation.recovery.is_some(),
            "a failed durable observation write must be inspectable: {failed:?}"
        );
        let mut failed = failed;
        for _ in 1..accepted {
            drive(&s.user, &s.a, WORK).await;
            watching(&s, "watch-write", &[&s.a], mode.clone()).await;
            drive(&s.user, &s.a, STOP).await;
            failed = watching(&s, "watch-write", &[&s.a], mode.clone()).await;
        }
        assert_eq!(failed.firings.len(), accepted);
        project_db(&s.project)
            .execute_batch("DROP TRIGGER fail_watch;")
            .unwrap();
        if reopen {
            drop(s.user);
            s.project.crash();
            s.project.restart(&[]);
            s.user = s.project.client().await;
        }
        let recovered = watching(&s, "watch-write", &[&s.a], mode.clone()).await;
        assert_eq!(recovered.firings, failed.firings);
        assert_eq!(recovered.remaining, 3 - u32::try_from(accepted).unwrap());
        assert!(recovered.observation.cause.is_none());
        assert!(recovered.observation.recovery.is_none());
        if reopen {
            start_again(&s.user, &s.w).await;
            start_again(&s.user, &s.a).await;
        }
        drive(&s.user, &s.a, WORK).await;
        watching(&s, "watch-write", &[&s.a], mode.clone()).await;
        drive(&s.user, &s.a, STOP).await;
        let next = watching(&s, "watch-write", &[&s.a], mode).await;
        assert_eq!(
            (next.firings.len(), next.remaining),
            (accepted + 1, 2 - u32::try_from(accepted).unwrap())
        );
        assert_eq!(&next.firings[..accepted], failed.firings.as_slice());
        assert_eq!(
            messages(&s.user, &s.w, "watch-write").await.len(),
            accepted + 1
        );
    }
}

#[tokio::test]
async fn nr5_failed_watch_save_retains_unmatched_evidence_in_memory() {
    let s = scene(&[]).await;
    project_db(&s.project)
        .execute_batch(
            "CREATE TRIGGER fail_watch BEFORE INSERT ON reaction_watch
         BEGIN SELECT RAISE(ABORT, 'injected watch write failure'); END;",
        )
        .unwrap();
    let initial = watching(&s, "unsaved-watch", &[&s.a, &s.b], json!({})).await;
    assert_ne!(initial.observation.health, "observing");
    assert!(
        initial
            .observation
            .cause
            .as_deref()
            .unwrap()
            .contains("injected watch write failure")
    );
    assert!(initial.observation.recovery.is_some());
    assert!(initial.firings.is_empty());
    drive(&s.user, &s.a, STOP).await;
    watching(&s, "unsaved-watch", &[&s.a, &s.b], json!({})).await;
    drive(&s.user, &s.a, WORK).await;
    let failed = watching(&s, "unsaved-watch", &[&s.a, &s.b], json!({})).await;
    let inspected = current(&s, &initial).await;
    assert_eq!(inspected.observation, failed.observation);
    let evidence: Value =
        serde_json::from_str(failed.observation.evidence.as_deref().unwrap()).unwrap();
    assert_eq!(evidence["finished"], json!([s.a]));
    assert!(failed.firings.is_empty());
    // Expire replay history: only the unsaved in-memory Watch still knows A finished.
    project_db(&s.project)
        .execute_batch(
            "INSERT INTO events (id, event)
             SELECT id + 2, event FROM events ORDER BY id DESC LIMIT 1;
         DELETE FROM events WHERE id < (SELECT MAX(id) FROM events);
         DROP TRIGGER fail_watch;",
        )
        .unwrap();
    let recovered = watching(&s, "unsaved-watch", &[&s.a, &s.b], json!({})).await;
    assert_eq!(recovered.observation.health, "observing");
    assert!(recovered.observation.cause.is_none());
    assert!(
        recovered
            .observation
            .gap
            .as_deref()
            .unwrap()
            .contains("expired")
    );
    drive(&s.user, &s.b, STOP).await;
    let completed = watching(&s, "unsaved-watch", &[&s.a, &s.b], json!({})).await;
    assert_eq!((completed.firings.len(), completed.remaining), (1, 0));
    assert_eq!(
        messages(&s.user, &s.w, "unsaved-watch").await[0]["id"],
        json!(completed.firings[0].message)
    );
}
