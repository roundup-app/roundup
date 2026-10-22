//! U3078d-h, j: explicit Resume of unfinished work through the real Daemon and public callers.
#[path = "evidence_support/mod.rs"]
#[allow(dead_code)]
mod evidence_support;
use evidence_support::{Evidence, Source, receipt, successor};
use serde_json::{Value, json};

#[tokio::test]
async fn u3078d_explicit_resume_continues_only_eligible_unfinished_work() {
    let mut e = Evidence::start().await;
    e.accept().await;
    e.client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    let plan = e.reconcile().await;
    assert_eq!(plan["actions"].as_array().unwrap().len(), 1);
    assert_eq!(
        plan["actions"][0]["next"],
        "Repair login; then run final checks"
    );
    assert_eq!(plan["context"].as_array().unwrap().len(), 1);
    assert_eq!(plan["blocked"].as_array().unwrap().len(), 3);
    for blocked in plan["blocked"].as_array().unwrap() {
        assert!(!blocked["cause"].as_str().unwrap().is_empty());
        assert!(!blocked["action"].as_str().unwrap().is_empty());
    }
    let (launches, prompts, before) = (e.log("launches"), e.log("prompts"), e.messages().await);

    let first = e.resume("r1").await.unwrap();
    let after = e.messages().await;
    assert_eq!(after.len(), before.len() + 1);
    let body = successor(&after, &first)["body"]
        .as_str()
        .unwrap()
        .to_string();
    // The repair is ordered once; the accepted and verified V1 is context, not work to redo.
    assert_eq!(body.matches("Repair login").count(), 1, "{body}");
    assert!(
        body.contains("do not redo") && body.contains("accepted by the user"),
        "{body}"
    );
    assert!(body.contains("never issue these again"), "{body}");

    // Repeat, a fresh client request after an unknown reply, and replay after reopen: one decision.
    assert_eq!(e.resume("r1").await.unwrap()["decision"], first["decision"]);
    assert_eq!(e.resume("r2").await.unwrap()["decision"], first["decision"]);
    e.reopen();
    e.client = e.project.client().await;
    assert_eq!(e.resume("r3").await.unwrap()["decision"], first["decision"]);
    let ids = |all: &[Value]| all.iter().map(|m| m["id"].clone()).collect::<Vec<_>>();
    assert_eq!(ids(&e.messages().await), ids(&after));
    assert_eq!(e.log("launches"), launches);
    assert!(e.log("prompts").starts_with(&prompts));
}

#[tokio::test]
async fn u3078d_an_older_version_never_verifies_the_replacement() {
    let e = Evidence::with("replace").await;
    e.accept().await;
    let plan = e.reconcile().await;
    let older: Vec<&Value> = plan["context"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["report"] == e.report["report"])
        .collect();
    assert_eq!(older.len(), 1);
    assert_eq!(older[0]["current"], false);
    // Only current reports owe checks, so V1's acceptance leaves the replacement's check pending.
    assert!(
        plan["pending_checks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == "login")
    );
    let decision = e.resume("replace").await.unwrap();
    let body = successor(&e.messages().await, &decision)["body"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(body.contains("an older version"), "{body}");
    assert!(body.contains("Checks still pending"), "{body}");
}

#[tokio::test]
async fn u3078d_document_work_uses_the_same_recovery_path() {
    let e = Evidence::with("document").await;
    let reports = e.progress().await["results"].clone();
    for index in [1, 2] {
        let mut q = e.query();
        q["report"] = reports[index]["report"]["report"].clone();
        q["evidence"] = json!("Reviewed");
        e.client
            .request("message.acceptResult", q.clone())
            .await
            .unwrap();
        q.as_object_mut().unwrap().remove("evidence");
        e.client.request("message.verifyResult", q).await.unwrap();
    }
    let plan = e.reconcile().await;
    let actions = plan["actions"].as_array().unwrap();
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0]["target"]["id"], "diagram");
    let pending: Vec<&str> = plan["pending_checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    assert!(
        pending.contains(&"export") && pending.contains(&"diagram"),
        "{pending:?}"
    );
    assert!(!pending.contains(&"outline") && !pending.contains(&"document"));
    let decision = e.resume("doc").await.unwrap();
    let body = successor(&e.messages().await, &decision)["body"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        body.contains("Prepare the diagram") && body.contains("outline@r1"),
        "{body}"
    );
}

#[tokio::test]
async fn u3078d_complete_work_sends_nothing() {
    let e = Evidence::with("complete").await;
    let (before, prompts) = (e.messages().await, e.log("prompts"));
    for request in ["a", "b"] {
        let result = e.resume(request).await.unwrap();
        assert!(result["decision"].is_null(), "{result}");
    }
    assert_eq!(e.messages().await, before);
    assert_eq!(e.log("prompts"), prompts);
}

#[tokio::test]
async fn u3078e_concurrent_and_conflicting_requests_keep_one_identity() {
    let e = Evidence::start().await;
    let a = e.resume("one").await.unwrap();
    let (b, c) = tokio::join!(e.resume("two"), e.resume("three"));
    let (b, c) = (b.unwrap(), c.unwrap());
    assert_eq!(a["decision"], b["decision"]);
    assert_eq!(a["decision"], c["decision"]);
    let sent = e.messages().await;
    assert_eq!(
        sent.iter()
            .filter(|m| m["id"] == a["decision"]["message"])
            .count(),
        1
    );
    let count = sent.len();
    // The same request id naming another resume is refused without changing anything.
    let mut q = e.query();
    q["request"] = json!("one");
    q["action"] = json!("not-the-same");
    let refused = e.client.request("message.resumeWork", q).await.unwrap_err();
    assert_eq!(refused.code, rpc::code::CONFLICT);
    assert_eq!(e.messages().await.len(), count);
    assert_eq!(e.resume("one").await.unwrap()["decision"], a["decision"]);
}

#[tokio::test]
async fn u3078f_reopen_reconciles_unknown_acceptance() {
    let mut e = Evidence::start().await;
    let before = e.messages().await;
    // A write failure exposes its cause and the retry, and claims nothing.
    let db = rusqlite::Connection::open(e.project.data_dir().join("project.db")).unwrap();
    db.execute_batch(
        "CREATE TRIGGER no_decisions BEFORE INSERT ON continuation_decisions
         BEGIN SELECT RAISE(ABORT, 'disk is full'); END;",
    )
    .unwrap();
    let failed = e.resume("keep").await.unwrap_err();
    assert!(
        failed.message.contains("not accepted") && failed.message.contains("retry"),
        "{}",
        failed.message
    );
    assert_eq!(e.messages().await, before);
    assert!(e.reconcile().await["actions"][0]["decision"].is_null());
    db.execute_batch("DROP TRIGGER no_decisions").unwrap();
    // The reply is lost: the client drops it, the Daemon restarts, and a fresh request reconciles.
    let lost = e.resume("keep").await.unwrap();
    drop(db);
    e.reopen();
    e.client = e.project.client().await;
    let plan = e.reconcile().await;
    assert_eq!(plan["actions"][0]["decision"], lost["decision"]["id"]);
    assert_eq!(
        e.resume("fresh").await.unwrap()["decision"],
        lost["decision"]
    );
    assert_eq!(e.messages().await.len(), before.len() + 1);
}

#[tokio::test]
async fn u3078g_resume_preserves_stop_holds_authority_and_attempts() {
    let e = Evidence::start().await;
    let id = e.report["author"]["id"].clone();
    // A Takeover holds the successor like any Daemon Message; nothing is typed past it.
    e.client
        .request("takeover.begin", json!({"agent": id}))
        .await
        .unwrap();
    let held = e.resume("held").await.unwrap();
    let message = successor(&e.messages().await, &held).clone();
    assert_eq!(message["status"], "held");
    assert_eq!(message["from"]["id"], "rupd");
    e.client
        .request("takeover.end", json!({"agent": id}))
        .await
        .unwrap();

    // A stopped Agent stays stopped: no program starts, and the cause names the separate action.
    let other = Evidence::start().await;
    let (launches, before) = (other.log("launches"), other.messages().await);
    other
        .client
        .request("agent.stop", json!({"id": other.report["author"]["id"]}))
        .await
        .unwrap();
    let refused = other.resume("stopped").await.unwrap_err();
    assert!(
        refused.message.contains("not accepted"),
        "{}",
        refused.message
    );
    assert_eq!(other.messages().await, before);
    assert_eq!(other.log("launches"), launches);
    assert!(other.reconcile().await["actions"][0]["decision"].is_null());
}

#[tokio::test]
async fn u3078g_removed_targets_are_never_substituted() {
    let e = Evidence::start().await;
    let before = e.messages().await;
    e.client
        .request("rail.remove", json!({"id": e.report["author"]["id"]}))
        .await
        .unwrap();
    // Another Agent with the same name cannot stand in for the removed one.
    e.client
        .request("agent.spawn", json!({"cwd": e.project.dir.path(), "parent": e.home, "name": "Login", "order": e.report["instruction"]["order"]}))
        .await
        .unwrap();
    let refused = e.resume("gone").await.unwrap_err();
    assert_eq!(refused.code, rpc::code::NOT_FOUND);
    assert!(e.messages().await.len() <= before.len() + 1);
    assert!(e.messages().await.iter().all(|m| {
        !m["body"]
            .as_str()
            .unwrap()
            .contains("resume this unfinished work")
    }));
}

#[tokio::test]
async fn u3078h_unknown_external_effects_require_authoritative_resolution_to_continue() {
    let e = Evidence::with("complete").await;
    let (effects, prompts, before) = (
        e.log("report.effects"),
        e.log("prompts"),
        e.messages().await,
    );
    // Unresolved effects are not work: resume sends nothing and orders nothing again.
    assert!(e.resume("unknown").await.unwrap()["decision"].is_null());
    assert_eq!(e.messages().await, before);
    let outcomes = [
        json!({"kind":"completed"}),
        json!({"kind":"not-performed"}),
        json!({"kind":"inconclusive","cause":"still reconciling"}),
    ];
    for (report, outcome) in e.effects.as_array().unwrap().iter().zip(outcomes) {
        let source = Source::new(receipt(report, outcome), 200).await;
        let mut q = e.query();
        q["report"] = report["report"].clone();
        q["source"] = json!(source.url);
        e.client.request("message.resolveResult", q).await.unwrap();
    }
    let plan = e.reconcile().await;
    let actions = plan["actions"].as_array().unwrap();
    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0]["target"]["id"], "payment");
    assert_eq!(plan["blocked"].as_array().unwrap().len(), 1);
    assert_eq!(plan["blocked"][0]["target"]["id"], "push");
    let decision = e.resume("payment").await.unwrap();
    let body = successor(&e.messages().await, &decision)["body"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(body.contains("read it again before you issue it"), "{body}");
    assert!(
        body.contains("push@v1") && body.contains("never issue these again"),
        "{body}"
    );
    assert_eq!(body.matches("payment@v1 (output").count(), 1, "{body}");
    assert!(!body.contains("deployment@v1 (output"), "{body}");
    // A repeat is the same decision; no fake external call and no extra prompt happened.
    assert_eq!(
        e.resume("again").await.unwrap()["decision"],
        decision["decision"]
    );
    assert_eq!(e.log("report.effects"), effects);
    assert!(e.log("prompts").starts_with(&prompts));
}

#[tokio::test]
async fn u3078j_passive_recovery_and_owned_handoff_do_not_duplicate_usage() {
    let mut e = Evidence::start().await;
    let todo = e
        .client
        .request(
            "todo.create",
            json!({"title":"Fix login","owner":{"kind":"agent","id":e.report["author"]["id"],"parent":null}}),
        )
        .await;
    let todo = todo.unwrap()["id"].clone();
    let handoffs = |messages: &[Value]| {
        messages
            .iter()
            .filter(|m| m["body"].as_str().unwrap().starts_with("Next:"))
            .count()
    };
    // Whatever the existing hand-off did before recovery, passive recovery adds nothing to it.
    let (launches, prompts) = (e.log("launches"), e.log("prompts"));
    let settled = e.messages().await;
    for _ in 0..2 {
        e.reconcile().await;
        e.progress().await;
    }
    let history = e
        .client
        .request("todo.getHistory", json!({"id": todo}))
        .await
        .unwrap();
    assert_eq!(e.messages().await, settled);
    assert_eq!(e.log("launches"), launches);
    assert_eq!(e.log("prompts"), prompts);
    // Explicit resume adds exactly its own Message and neither selects nor hands another Todo.
    let decision = e.resume("j").await.unwrap();
    let after = e.messages().await;
    assert_eq!(after.len(), settled.len() + 1);
    assert_eq!(handoffs(&after), handoffs(&settled));
    assert!(
        !successor(&after, &decision)["body"]
            .as_str()
            .unwrap()
            .contains("Next:")
    );
    assert_eq!(
        e.client
            .request("todo.getHistory", json!({"id": todo}))
            .await
            .unwrap(),
        history
    );
    // Reopening replays nothing: no launch, prompt or Message beyond the one decision.
    e.reopen();
    e.client = e.project.client().await;
    e.reconcile().await;
    assert_eq!(e.messages().await, after);
    assert_eq!(e.log("launches"), launches);
}
