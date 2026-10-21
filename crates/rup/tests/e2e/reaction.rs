//! NR1 (`scenarios/named-reactions.md`) through a real Daemon: a reaction records the exact
//! authority it was created under, and a refusal saves nothing.

use contracts::ActorKind;
use contracts::reaction::Reaction;
use rpc::code;
use serde_json::{Value, json};

use super::wake::{STOP, WORK, drive, messages, notes, project_db, scene, start_again, still};
use super::{actor, agent_in_as, client_as};

fn definition(target: &str, instruction: &str) -> Value {
    json!({
        "operation": "op-1",
        "name": "when done",
        "target": target,
        "instruction": instruction,
        "condition": { "kind": "agents", "ids": [] },
        "expires_at": "2099-01-01T00:00:00Z",
    })
}

async fn listed(client: &rpc::Client) -> Vec<Reaction> {
    serde_json::from_value(client.request("reaction.list", Value::Null).await.unwrap()).unwrap()
}

#[tokio::test]
async fn nr1_authority_and_retry_preserve_exact_definition() {
    let s = scene(&[]).await;
    let other = scene(&[]).await;
    let mut body = definition(&s.w, "tell me");
    body["condition"]["ids"] = json!([s.a, s.b]);
    let first: Reaction = serde_json::from_value(
        s.user
            .request("reaction.create", body.clone())
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(first.actor.kind, ActorKind::User);
    assert_eq!(
        (first.target.as_str(), first.instruction.as_str()),
        (s.w.as_str(), "tell me")
    );
    assert_eq!(
        (first.max_firings, first.remaining, first.rearm),
        (1, 1, false)
    );
    let home: Reaction = serde_json::from_value(
        s.user
            .request("reaction.create", {
                let mut b = body.clone();
                b["operation"] = json!("op-2");
                b["target"] = json!(s.a);
                b
            })
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(home.home.as_deref(), Some(s.door.as_str()));

    // The same operation and payload return the first definition; another payload refuses.
    let again: Reaction = serde_json::from_value(
        s.user
            .request("reaction.create", body.clone())
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(again, first);
    let mut changed = body.clone();
    changed["instruction"] = json!("something else");
    let err = s
        .user
        .request("reaction.create", changed)
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(listed(&s.user).await.len(), 2);

    // An Agent of another Project's id is not in this Project.
    let mut stray = body.clone();
    stray["operation"] = json!("op-3");
    stray["target"] = json!(agent_in_as(&other.project, &other.w).await);
    let err = s.user.request("reaction.create", stray).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);

    // An Agent may create for itself, never for an Agent outside its Reach, and never touch another's.
    let mut outside = body.clone();
    outside["operation"] = json!("op-4");
    outside["target"] = json!(s.a);
    let err = s
        .as_w
        .request("reaction.create", outside)
        .await
        .unwrap_err();
    assert_eq!(err.code, code::FORBIDDEN);
    let mut own = body.clone();
    own["operation"] = json!("op-5");
    let mine: Reaction =
        serde_json::from_value(s.as_w.request("reaction.create", own).await.unwrap()).unwrap();
    assert_eq!(mine.actor.id, s.w);
    assert_eq!(listed(&s.as_w).await, vec![mine.clone()]);
    for method in ["reaction.get", "reaction.stop"] {
        let err = s
            .as_w
            .request(method, json!({ "id": first.id }))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN, "{method}");
    }
    let err = s
        .as_w
        .request("reaction.run", json!({ "id": first.id, "operation": "r" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::FORBIDDEN);
    let intruder = client_as(&s.project, actor(ActorKind::Ext, "x")).await;
    let err = intruder
        .request("reaction.list", Value::Null)
        .await
        .unwrap_err();
    assert_eq!(err.code, code::FORBIDDEN);

    // The user stops it, and a stopped reaction refuses to run; nothing was ever delivered.
    let stopped: Reaction = serde_json::from_value(
        s.user
            .request("reaction.stop", json!({ "id": first.id }))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(serde_json::to_value(stopped.state).unwrap(), "stopped");
    let err = s
        .user
        .request("reaction.run", json!({ "id": first.id, "operation": "r" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert!(messages(&s.user, &s.w, "").await.is_empty());
}

#[tokio::test]
async fn nr1_invalid_bounds_save_nothing() {
    let s = scene(&[]).await;
    let ok = |s_a: &str| {
        let mut b = definition(&s.w, "go");
        b["condition"]["ids"] = json!([s_a]);
        b
    };
    let mut cases: Vec<(&str, Value, i64)> = Vec::new();
    let mut missing = ok(&s.a);
    missing["condition"]["ids"] = json!(["gone"]);
    cases.push(("missing condition Agent", missing, code::NOT_FOUND));
    let mut target = ok(&s.a);
    target["target"] = json!("gone");
    cases.push(("missing target", target, code::NOT_FOUND));
    let mut twice = ok(&s.a);
    twice["condition"]["ids"] = json!([s.a, s.a]);
    cases.push(("duplicate Agent ids", twice, code::INVALID_PARAMS));
    let mut source = ok(&s.a);
    source["condition"] = json!({ "kind": "publication", "id": "x" });
    cases.push(("unsupported source", source, code::INVALID_PARAMS));
    let mut expiry = ok(&s.a);
    expiry.as_object_mut().unwrap().remove("expires_at");
    cases.push(("missing expiry", expiry, code::INVALID_PARAMS));
    let mut past = ok(&s.a);
    past["expires_at"] = json!("2001-01-01T00:00:00Z");
    cases.push(("past expiry", past, code::INVALID_PARAMS));
    let mut zero = ok(&s.a);
    zero["max_firings"] = json!(0);
    cases.push(("zero bound", zero, code::INVALID_PARAMS));
    let mut many = ok(&s.a);
    many["max_firings"] = json!(3);
    cases.push(("many without rearm", many, code::INVALID_PARAMS));
    let mut pr = ok(&s.a);
    pr["condition"] = json!({ "kind": "pr-checks", "repository": "o/r", "number": 4 });
    pr["rearm"] = json!(true);
    cases.push(("repeating PR", pr, code::INVALID_PARAMS));
    let mut instant = ok(&s.a);
    instant["condition"] =
        json!({ "kind": "instant", "at": "2099-06-01T09:00:00+01:00", "late": "skip" });
    instant["expires_at"] = json!("2099-05-01T00:00:00Z");
    cases.push(("instant after expiry", instant, code::INVALID_PARAMS));
    let mut naive = ok(&s.a);
    naive["condition"] = json!({ "kind": "instant", "at": "2099-06-01T09:00", "late": "skip" });
    cases.push(("instant without offset", naive, code::INVALID_PARAMS));
    for (name, body, expected) in cases {
        let err = s.user.request("reaction.create", body).await.unwrap_err();
        assert_eq!(err.code, expected, "{name}: {}", err.message);
    }
    assert!(listed(&s.user).await.is_empty());
    assert!(messages(&s.user, &s.w, "").await.is_empty());
}

async fn made(client: &rpc::Client, method: &str, body: Value) -> Reaction {
    serde_json::from_value(client.request(method, body).await.unwrap()).unwrap()
}

#[tokio::test]
async fn nr3_reopen_preserves_accepted_definition_and_message() {
    let mut s = scene(&[]).await;
    let mut body = definition(&s.w, "ship it");
    body["condition"]["ids"] = json!([s.a]);
    let saved = made(&s.user, "reaction.create", body.clone()).await;
    let run = json!({ "id": saved.id, "operation": "go" });
    let fired = made(&s.user, "reaction.run", run.clone()).await;
    let again = made(&s.user, "reaction.run", run.clone()).await;
    assert_eq!(fired.firings, again.firings);
    assert_eq!((fired.firings.len(), fired.remaining), (1, 0));
    let firing = fired.firings[0].clone();
    assert!(!firing.matched);
    assert!(firing.definition.contains("ship it"));
    assert_eq!(messages(&s.user, &s.w, "ship it").await.len(), 1);

    // Stopping and creating another never touches what was accepted.
    made(&s.user, "reaction.stop", json!({ "id": saved.id })).await;
    body["operation"] = json!("op-2");
    body["instruction"] = json!("something else");
    made(&s.user, "reaction.create", body).await;
    let err = s
        .user
        .request(
            "reaction.run",
            json!({ "id": saved.id, "operation": "again" }),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);

    drop(s.user);
    s.project.restart(&[]);
    let user = s.project.client().await;
    let kept = made(&user, "reaction.get", json!({ "id": saved.id })).await;
    assert_eq!(kept.firings, vec![firing.clone()]);
    let sent = messages(&user, &s.w, "ship it").await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["id"], json!(firing.message));
    assert!(messages(&user, &s.w, "something else").await.is_empty());
}

#[tokio::test]
async fn nr8_existing_delivery_guards_and_reported_outcomes() {
    let s = scene(&[]).await;
    let mut body = definition(&s.w, "report back");
    body["condition"]["ids"] = json!([s.a]);
    let saved = made(&s.as_w, "reaction.create", body).await;
    let fired = made(
        &s.as_w,
        "reaction.run",
        json!({ "id": saved.id, "operation": "go" }),
    )
    .await;
    let firing = &fired.firings[0];
    let sent = messages(&s.user, &s.w, "report back").await;
    // The firing links to the Message and shows the status the Message history holds.
    assert_eq!(sent[0]["id"], json!(firing.message));
    assert_eq!(sent[0]["status"], json!(firing.outcome));
    // An Agent's run is labeled reported, and it claims no match.
    let evidence: Value = serde_json::from_str(&firing.evidence).unwrap();
    assert_eq!(evidence["reported"], json!(true));
    assert!(!firing.matched);
}

/// `YYYY-MM-DD` and `HH:MM:SS` in UTC, `secs` from now.
fn utc_in(secs: u64) -> (String, String) {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + secs;
    let (days, rest) = ((t / 86_400) as i64, t % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!(
            "{:02}:{:02}:{:02}",
            rest / 3600,
            rest % 3600 / 60,
            rest % 60
        ),
    )
}

#[tokio::test]
async fn nr6_preview_requires_unambiguous_time() {
    let s = scene(&[]).await;
    let preview = |date: &str, time: &str, offset: &str| {
        s.user.request(
            "reaction.preview",
            json!({ "date": date, "time": time, "offset": offset }),
        )
    };
    let ok = preview("2098-06-01", "09:00", "+01:00").await.unwrap();
    assert_eq!(ok["at"], "2098-06-01T09:00:00+01:00");
    assert_eq!(ok["utc"], "2098-06-01T08:00:00Z");
    for (date, time, offset) in [
        ("2098-06-01", "09:00", ""),
        ("2098-06-01", "09:00", "Europe/London"),
        ("2098-06-01", "09:00", "+0100"),
        ("2098-02-30", "09:00", "Z"),
        ("2098-06-01", "24:30", "Z"),
        ("every monday", "9am", "Z"),
    ] {
        let err = preview(date, time, offset).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{date} {time} {offset}");
    }

    // Activation keeps exactly what the preview resolved and nothing else.
    let mut body = definition(&s.w, "at nine");
    body["condition"] = json!({ "kind": "instant", "at": ok["at"], "late": "skip" });
    let saved = made(&s.user, "reaction.create", body.clone()).await;
    assert_eq!(
        serde_json::to_value(&saved.condition).unwrap()["at"],
        ok["at"]
    );
    for (n, at) in [
        "2098-06-01T08:00:00.0Z",
        "2098-06-01T09:00+01:00",
        "2001-01-01T00:00:00Z",
    ]
    .into_iter()
    .enumerate()
    {
        body["operation"] = json!(format!("bad-{n}"));
        body["condition"]["at"] = json!(at);
        let err = s
            .user
            .request("reaction.create", body.clone())
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{at}");
    }
    assert_eq!(listed(&s.user).await.len(), 1);
}

#[tokio::test]
async fn nr6_instant_fires_once_and_survives_reopen() {
    let mut s = scene(&[]).await;
    let (date, time) = utc_in(2);
    let at = s
        .user
        .request(
            "reaction.preview",
            json!({ "date": date, "time": time, "offset": "Z" }),
        )
        .await
        .unwrap();
    let mut body = definition(&s.w, "it is time");
    body["condition"] = json!({ "kind": "instant", "at": at["at"], "late": "once-before-expiry" });
    let saved = made(&s.user, "reaction.create", body).await;
    assert_eq!(saved.observation.health, "waiting");
    assert!(messages(&s.user, &s.w, "it is time").await.is_empty());

    let mut fired = saved.clone();
    for _ in 0..100 {
        fired = made(&s.user, "reaction.get", json!({ "id": saved.id })).await;
        if !fired.firings.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(fired.firings.len(), 1);
    assert!(fired.firings[0].matched);
    let evidence: Value = serde_json::from_str(&fired.firings[0].evidence).unwrap();
    assert_eq!(
        (evidence["late"].clone(), evidence["at"].clone()),
        (json!(false), at["at"].clone())
    );
    assert_eq!(messages(&s.user, &s.w, "it is time").await.len(), 1);

    // Reopening re-reads the saved instant and fires nothing more.
    drop(s.user);
    s.project.restart(&[]);
    let user = s.project.client().await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let kept = made(&user, "reaction.get", json!({ "id": saved.id })).await;
    assert_eq!(kept.firings, fired.firings);
    assert_eq!(messages(&user, &s.w, "it is time").await.len(), 1);
}

async fn watching(s: &super::wake::Scene, name: &str, ids: &[&String], extra: Value) -> Reaction {
    let mut body = definition(&s.w, name);
    body["operation"] = json!(name);
    body["condition"]["ids"] = json!(ids);
    for (key, value) in extra.as_object().unwrap() {
        if key == "any" {
            body["condition"]["any"] = value.clone();
        } else {
            body[key] = value.clone();
        }
    }
    made(&s.user, "reaction.create", body).await
}

async fn current(s: &super::wake::Scene, r: &Reaction) -> Reaction {
    made(&s.user, "reaction.get", json!({ "id": r.id })).await
}

#[tokio::test]
async fn nr2_agent_conditions_match_once_without_a_model() {
    let s = scene(&[]).await;
    let all = watching(&s, "all-done", &[&s.a, &s.b], json!({})).await;
    drive(&s.user, &s.a, STOP).await;
    still(&s.user, &s.w, "all-done", 0).await;
    drive(&s.user, &s.b, STOP).await;
    let sent = notes(&s.user, &s.w, "all-done", 1).await;
    // A finish seen again, a flip and a second finish add nothing.
    drive(&s.user, &s.a, WORK).await;
    drive(&s.user, &s.a, STOP).await;
    still(&s.user, &s.w, "all-done", 1).await;
    let fired = current(&s, &all).await;
    assert_eq!((fired.firings.len(), fired.remaining), (1, 0));
    assert_eq!(
        fired.firings[0].message,
        sent[0]["id"].as_u64().unwrap() as u32
    );
    assert!(fired.firings[0].matched);
    let evidence: Value = serde_json::from_str(&fired.firings[0].evidence).unwrap();
    assert_eq!(evidence["agents"][0]["name"], json!("alpha"));
    assert_eq!(evidence["reported"], json!(true));

    // Already finished Agents match on activation, once, for `any` and for `all`.
    watching(&s, "any-now", &[&s.a, &s.b], json!({ "any": true })).await;
    watching(&s, "all-now", &[&s.a, &s.b], json!({})).await;
    assert_eq!(messages(&s.user, &s.w, "any-now").await.len(), 1);
    still(&s.user, &s.w, "all-now", 1).await;
}

#[tokio::test]
async fn nr4_bounds_rearm_stop_and_target_races() {
    let s = scene(&[]).await;
    let twice = watching(
        &s,
        "twice",
        &[&s.a],
        json!({ "rearm": true, "max_firings": 2 }),
    )
    .await;
    drive(&s.user, &s.a, STOP).await;
    notes(&s.user, &s.w, "twice", 1).await;
    // Still finished: a refresh does not re-arm.
    drive(&s.user, &s.a, STOP).await;
    still(&s.user, &s.w, "twice", 1).await;
    drive(&s.user, &s.a, WORK).await;
    drive(&s.user, &s.a, STOP).await;
    notes(&s.user, &s.w, "twice", 2).await;
    let spent = current(&s, &twice).await;
    assert_eq!(
        spent.firings.iter().map(|f| f.ordinal).collect::<Vec<_>>(),
        [1, 2]
    );
    assert_eq!(spent.remaining, 0);
    let refused = s
        .user
        .request("reaction.run", json!({ "id": twice.id, "operation": "x" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, code::CONFLICT);

    // An explicit run spends the one firing; the condition then adds none.
    let once = watching(&s, "once-run", &[&s.a, &s.b], json!({})).await;
    let ran = made(
        &s.user,
        "reaction.run",
        json!({ "id": once.id, "operation": "go" }),
    )
    .await;
    assert_eq!(ran.remaining, 0);
    drive(&s.user, &s.b, STOP).await;
    still(&s.user, &s.w, "once-run", 1).await;

    // Stopped first: a later finish is accepted by nothing.
    drive(&s.user, &s.b, WORK).await;
    let stopped = watching(&s, "stopped", &[&s.b], json!({})).await;
    made(&s.user, "reaction.stop", json!({ "id": stopped.id })).await;
    drive(&s.user, &s.b, STOP).await;
    still(&s.user, &s.w, "stopped", 0).await;
    assert!(current(&s, &stopped).await.firings.is_empty());
}

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
async fn nr7_a_pr_without_worktree_evidence_saves_nothing() {
    let s = scene(&[]).await;
    let mut body = definition(&s.w, "ship it");
    body["condition"] =
        json!({ "kind": "pr-checks", "repository": "github.com/acme/one", "number": 23 });
    let err = s.user.request("reaction.create", body).await.unwrap_err();
    assert!(err.message.contains("pr-checks"), "{}", err.message);
    assert!(listed(&s.user).await.is_empty());
}

#[tokio::test]
async fn nr8_automatic_firing_refuses_a_target_moved_out_of_reach() {
    let s = scene(&[]).await;
    let author = client_as(&s.project, actor(ActorKind::Agent, &s.door)).await;
    let mut body = definition(&s.a, "revoked reaction instruction");
    body["condition"]["ids"] = json!([s.b]);
    let saved = made(&author, "reaction.create", body).await;
    s.user
        .request(
            "rail.move",
            json!({ "id": s.a, "parent": null, "index": 0 }),
        )
        .await
        .unwrap();
    let refused = author
        .request(
            "reaction.run",
            json!({ "id": saved.id, "operation": "manual" }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, code::FORBIDDEN);
    drive(&s.user, &s.b, STOP).await;
    let seen = super::daemon::h21_poll(
        "reaction observes completion after revocation",
        async || {
            let seen = current(&s, &saved).await;
            let completed = seen
                .observation
                .evidence
                .as_deref()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .is_some_and(|evidence| {
                    evidence["finished"]
                        .as_array()
                        .is_some_and(|ids| ids.contains(&json!(s.b)))
                });
            completed.then_some(seen)
        },
    )
    .await;
    assert!(seen.firings.is_empty(), "unauthorized firing: {seen:?}");
    assert_eq!(seen.remaining, 1);
    assert_eq!(seen.target, s.a);
    assert_eq!(seen.observation.health, "unavailable");
    assert!(seen.observation.gap.as_deref().unwrap().contains("Reach"));
    assert!(seen.observation.recovery.is_some());
    assert!(
        messages(&s.user, &s.a, "revoked reaction instruction")
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn nr1_agent_access_requires_current_reach_while_user_access_remains() {
    for removed in [false, true] {
        let s = scene(&[]).await;
        let author = client_as(&s.project, actor(ActorKind::Agent, &s.door)).await;
        let mut body = definition(&s.a, "explicit reaction instruction");
        body["condition"]["ids"] = json!([s.b]);
        body["max_firings"] = json!(2);
        body["rearm"] = json!(true);
        let saved = made(&author, "reaction.create", body.clone()).await;
        let replayed = made(&author, "reaction.create", body.clone()).await;
        assert_eq!(replayed.id, saved.id);
        let original = json!({"id": saved.id, "operation": "original"});
        let first = made(&author, "reaction.run", original.clone()).await;
        if removed {
            s.user
                .request("rail.remove", json!({"id": s.a}))
                .await
                .unwrap();
        } else {
            s.user
                .request("rail.move", json!({"id": s.a, "parent": null, "index": 0}))
                .await
                .unwrap();
        }
        for (method, args) in [
            ("reaction.create", body),
            ("reaction.get", json!({"id": saved.id})),
            ("reaction.stop", json!({"id": saved.id})),
            ("reaction.run", original),
            ("reaction.run", json!({"id": saved.id, "operation": "new"})),
        ] {
            let error = author.request(method, args).await.unwrap_err();
            assert_eq!(
                error.code,
                if removed {
                    code::NOT_FOUND
                } else {
                    code::FORBIDDEN
                },
                "{method}"
            );
        }
        assert!(listed(&author).await.is_empty());
        let kept = current(&s, &saved).await;
        assert_eq!(kept.firings.len(), 1);
        assert_eq!(kept.firings[0].id, first.firings[0].id);
        assert_eq!(kept.remaining, 1);
        assert_eq!(serde_json::to_value(kept.state).unwrap(), "active");
        let run = json!({"id": saved.id, "operation": "user"});
        if removed {
            let error = s.user.request("reaction.run", run).await.unwrap_err();
            assert_eq!(error.code, code::NOT_FOUND);
        } else {
            let ran = made(&s.user, "reaction.run", run).await;
            assert_eq!(ran.firings.len(), 2);
            assert_eq!(ran.remaining, 0);
        }
        let stopped = made(&s.user, "reaction.stop", json!({"id": saved.id})).await;
        assert_eq!(serde_json::to_value(stopped.state).unwrap(), "stopped");
    }
}

#[tokio::test]
async fn nr3_automatic_write_failure_is_inspectable_and_recovers() {
    let mut s = scene(&[]).await;
    s.w = s.door.clone();
    let saved = watching(&s, "failed firing", &[&s.a], json!({})).await;
    project_db(&s.project).execute_batch("CREATE TRIGGER refuse_reaction BEFORE INSERT ON reaction_firings BEGIN SELECT RAISE(ABORT, 'reaction write refused'); END;").unwrap();
    drive(&s.user, &s.a, STOP).await;
    let failed = super::daemon::h21_poll("reaction observes failed acceptance", async || {
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
        completed.then_some(seen)
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
    // Reopening with the fault still present must retain an inspectable failure and the unspent bound.
    drop(s.user);
    s.project.restart(&[]);
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
    let recovered = current(&s, &saved).await;
    assert_eq!((recovered.firings.len(), recovered.remaining), (1, 0));
    assert!(recovered.observation.cause.is_none());
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
async fn nr6_failed_acceptance_retries_on_timer_wake_and_reopen() {
    let mut s = scene(&[]).await;
    let (date, time) = utc_in(2);
    let preview = s
        .user
        .request(
            "reaction.preview",
            json!({
                "date": date, "time": time, "offset": "Z"
            }),
        )
        .await
        .unwrap();
    let mut body = definition(&s.w, "retry time");
    body["condition"] =
        json!({ "kind": "instant", "at": preview["at"], "late": "once-before-expiry" });
    project_db(&s.project).execute_batch("CREATE TRIGGER refuse_reaction BEFORE INSERT ON reaction_firings BEGIN SELECT RAISE(ABORT, 'reaction write refused'); END;").unwrap();
    let saved = made(&s.user, "reaction.create", body.clone()).await;
    let failed = super::daemon::h21_poll("timer acceptance failure", async || {
        let seen = current(&s, &saved).await;
        (seen.observation.health != "waiting").then_some(seen)
    })
    .await;
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
    project_db(&s.project)
        .execute_batch("DROP TRIGGER refuse_reaction")
        .unwrap();
    // reaction.create notifies Timer::run: a new future instant wakes observation of the failed one.
    body["operation"] = json!("wake-timer");
    body["condition"]["at"] = json!("2098-06-01T09:00:00Z");
    made(&s.user, "reaction.create", body).await;
    let sent = notes(&s.user, &s.w, "retry time", 1).await;
    // Timer::fire records successful observation after fire_reaction finishes delivery.
    let recovered = super::daemon::h21_poll("timer records successful acceptance", async || {
        let seen = current(&s, &saved).await;
        matches!(seen.observation.health.as_str(), "fired" | "fired late").then_some(seen)
    })
    .await;
    assert_eq!((recovered.firings.len(), recovered.remaining), (1, 0));
    assert!(recovered.observation.cause.is_none());
    assert!(recovered.observation.recovery.is_none());
    let firing = &recovered.firings[0];
    assert_eq!(sent[0]["id"], json!(firing.message));
    let evidence: Value = serde_json::from_str(&firing.evidence).unwrap();
    assert_eq!(evidence["at"], preview["at"]);
    let definition: Value = serde_json::from_str(&firing.definition).unwrap();
    assert_eq!(
        definition["condition"],
        serde_json::to_value(&saved.condition).unwrap()
    );
    drop(s.user);
    s.project.restart(&[]);
    s.user = s.project.client().await;
    assert_eq!(current(&s, &saved).await.firings, recovered.firings);
    let sent = messages(&s.user, &s.w, "retry time").await;
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["id"], json!(firing.message));
}

#[tokio::test]
async fn nr4_explicit_retry_key_cannot_consume_automatic_identity() {
    for manual_first in [true, false] {
        let mut s = scene(&[]).await;
        let saved = watching(
            &s,
            "manual and automatic",
            &[&s.a],
            json!({ "rearm": true, "max_firings": 2 }),
        )
        .await;
        let run = json!({ "id": saved.id, "operation": "auto-1" });
        if manual_first {
            let manual = made(&s.user, "reaction.run", run.clone()).await;
            assert!(!manual.firings[0].matched);
            let retry = made(&s.user, "reaction.run", run.clone()).await;
            assert_eq!(retry.firings, manual.firings);
            assert_eq!(retry.remaining, 1);
        }
        drive(&s.user, &s.a, STOP).await;
        let observed = super::daemon::h21_poll("automatic completion evaluated", async || {
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
            completed.then_some(seen)
        })
        .await;
        let accepted = if manual_first {
            observed
        } else {
            assert_eq!(observed.firings.len(), 1);
            made(&s.user, "reaction.run", run.clone()).await
        };
        assert_eq!(
            accepted.firings.len(),
            2,
            "automatic/manual collision: {accepted:?}"
        );
        assert_eq!(accepted.remaining, 0);
        assert_eq!(
            accepted
                .firings
                .iter()
                .map(|f| (f.ordinal, f.matched))
                .collect::<Vec<_>>(),
            [(1, !manual_first), (2, manual_first)]
        );
        assert_ne!(accepted.firings[0].message, accepted.firings[1].message);
        let retry = made(&s.user, "reaction.run", run.clone()).await;
        assert_eq!(retry.firings, accepted.firings);
        drop(s.user);
        s.project.restart(&[]);
        s.user = s.project.client().await;
        let replayed = made(&s.user, "reaction.run", run).await;
        assert_eq!(replayed.firings, accepted.firings);
        assert_eq!(replayed.remaining, 0);
        assert_eq!(
            messages(&s.user, &s.w, "manual and automatic").await.len(),
            2
        );
    }
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
        s.w = super::start_door(&s.user).await;
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
            let db = project_db(&s.project);
            // Recreate the pre-upgrade database with the accepted row's original bytes and ids.
            db.execute_batch("ALTER TABLE reaction_firings RENAME TO accepted_firings;")
                .unwrap();
            db.execute_batch(super::REACTION_FIRINGS_V1).unwrap();
            db.execute_batch(
                "INSERT INTO reaction_firings SELECT * FROM accepted_firings;
                DROP TABLE accepted_firings;
                PRAGMA user_version = 23;",
            )
            .unwrap();
            if !manual_first {
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
async fn nr4_every_participant_rearms_before_a_new_completion() {
    let s = scene(&[]).await;
    drive(&s.user, &s.a, STOP).await;
    drive(&s.user, &s.b, STOP).await;
    let saved = watching(
        &s,
        "two-agent-rearm",
        &[&s.a, &s.b],
        json!({ "any": true, "rearm": true, "max_firings": 2 }),
    )
    .await;
    notes(&s.user, &s.w, "two-agent-rearm", 1).await;
    drive(&s.user, &s.a, WORK).await;
    drive(&s.user, &s.a, STOP).await;
    still(&s.user, &s.w, "two-agent-rearm", 1).await;
    // B becoming working completes re-arm, but no Agent has finished after it.
    drive(&s.user, &s.b, WORK).await;
    still(&s.user, &s.w, "two-agent-rearm", 1).await;
    assert_eq!(current(&s, &saved).await.remaining, 1);
    drive(&s.user, &s.b, STOP).await;
    assert_eq!(notes(&s.user, &s.w, "two-agent-rearm", 2).await.len(), 2);
}

#[tokio::test]
async fn nr4_all_keeps_pre_rearm_finishes_excluded_after_reopen_and_expiry() {
    for expired in [false, true] {
        let mut s = scene(&[]).await;
        // Doors can be started explicitly after reopen, preserving the watched and target ids.
        s.a = s.door.clone();
        s.w = super::start_door(&s.user).await;
        drive(&s.user, &s.a, STOP).await;
        drive(&s.user, &s.b, STOP).await;
        let mode = json!({ "rearm": true, "max_firings": 2 });
        let first = watching(&s, "all-rearm", &[&s.a, &s.b], mode.clone()).await;
        assert_eq!(first.firings.len(), 1);
        drive(&s.user, &s.a, WORK).await;
        drive(&s.user, &s.a, STOP).await;
        drive(&s.user, &s.b, WORK).await;
        drive(&s.user, &s.b, STOP).await;
        // Retried creation waits for evaluation and its Watch save, rather than racing the observer.
        let waiting = watching(&s, "all-rearm", &[&s.a, &s.b], mode.clone()).await;
        assert_eq!(waiting.firings, first.firings);
        assert_eq!(waiting.remaining, 1);
        drop(s.user);
        s.project.crash();
        if expired {
            project_db(&s.project)
                .execute_batch(
                    "DELETE FROM events;
                 UPDATE reaction_watch SET state=json_set(state, '$.seen', 0);",
                )
                .unwrap();
        }
        s.project.restart(&[]);
        s.user = s.project.client().await;
        let replayed = watching(&s, "all-rearm", &[&s.a, &s.b], mode.clone()).await;
        assert_eq!(replayed.firings, first.firings);
        assert_eq!(replayed.remaining, 1);
        assert_eq!(messages(&s.user, &s.w, "all-rearm").await.len(), 1);
        if expired {
            assert!(
                replayed
                    .observation
                    .gap
                    .as_deref()
                    .unwrap()
                    .contains("expired")
            );
        }
        start_again(&s.user, &s.w).await;
        start_again(&s.user, &s.a).await;
        drive(&s.user, &s.a, WORK).await;
        drive(&s.user, &s.a, STOP).await;
        let completed = watching(&s, "all-rearm", &[&s.a, &s.b], mode).await;
        assert_eq!((completed.firings.len(), completed.remaining), (2, 0));
        assert_eq!(completed.firings[0], first.firings[0]);
        assert_eq!(completed.firings[1].ordinal, 2);
        assert_eq!(messages(&s.user, &s.w, "all-rearm").await.len(), 2);
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
