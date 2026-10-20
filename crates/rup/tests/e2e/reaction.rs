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
