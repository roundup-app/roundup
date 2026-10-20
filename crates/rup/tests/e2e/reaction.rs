//! NR1 (`scenarios/named-reactions.md`) through a real Daemon: a reaction records the exact
//! authority it was created under, and a refusal saves nothing.

use contracts::ActorKind;
use contracts::reaction::Reaction;
use rpc::code;
use serde_json::{Value, json};

use super::wake::{messages, scene};
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
