//! Retained execution evidence through the real Daemon and public callers.
#[path = "evidence_support/mod.rs"]
#[allow(dead_code)]
mod evidence_support;
use evidence_support::{Evidence, Source, daemon, receipt};
use serde_json::{Value, json};

#[tokio::test]
async fn u3078b_delivery_report_acceptance_and_verification_are_distinct() {
    let e = Evidence::start().await;
    let reported = e.progress().await;
    let r = &reported["results"][0];
    assert_eq!(r["report"], e.report);
    assert_eq!(r["report"]["instruction"]["order"]["done"], "Login passes");
    assert_eq!(r["report"]["instruction"]["workstream"], e.home);
    assert_eq!(r["acceptances"], json!([]));
    assert_eq!(r["observations"], json!([]));
    let accepted = e.accept().await;
    let progress = e.progress().await;
    assert_eq!(progress["results"][0]["acceptances"], json!([accepted]));
    assert_eq!(progress["results"][0]["observations"], json!([]));
    let verified = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    assert_eq!(verified["verdict"], "passed");
    assert_eq!(
        verified["revision"],
        "622e44dcf9a79b1243b22f75897645840444764efd9793a71e243458313d9ad4"
    );
    // Repeat verification is the same source fact; it neither accepts nor reports again.
    assert_eq!(
        e.client
            .request("message.verifyResult", e.result_id())
            .await
            .unwrap(),
        verified
    );
    let progress = e.progress().await;
    assert_eq!(progress["results"][0]["observations"], json!([verified]));
    assert_eq!(progress["results"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn u3078b_public_reports_cannot_forge_authority() {
    let e = Evidence::start().await;
    for refusal in e.bad.as_array().unwrap() {
        assert!(refusal["error"]["code"].is_number(), "{refusal}");
    }
    let before = e.progress().await;
    // An unowned process cannot become the reporting Agent by setting --agent or daemon.identify.
    e.client
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":e.report["author"]["id"],"parent":null}}),
        )
        .await
        .unwrap();
    assert_eq!(
        e.client
            .request("message.report", e.request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    e.client
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"user","id":"you","parent":null}}),
        )
        .await
        .unwrap();
    assert_eq!(e.progress().await, before);
    assert_eq!(before["results"][0]["acceptances"], json!([]));
    assert_eq!(before["results"][0]["observations"], json!([]));
}

#[tokio::test]
async fn u3078a_reopen_retains_exact_progress_without_starting() {
    let mut e = Evidence::start().await;
    e.accept().await;
    e.client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    let moved = e
        .client
        .request("rail.createWorkstream", json!({"name":"Moved"}))
        .await
        .unwrap()["id"]
        .clone();
    e.client
        .request(
            "rail.move",
            json!({"id":e.report["author"]["id"],"parent":moved,"index":0}),
        )
        .await
        .unwrap();
    e.client
        .request("agent.stop", json!({"id":e.report["author"]["id"]}))
        .await
        .unwrap();
    let before = e.progress().await;
    assert_eq!(before["instructions"]["home"], moved);
    assert_eq!(
        before["results"][0]["report"]["instruction"]["workstream"],
        e.home
    );
    let launches = std::fs::read(e.logs.path().join("launches")).unwrap();
    let prompts = std::fs::read(e.logs.path().join("prompts")).unwrap();
    let messages = e.client.request("message.list", json!({})).await.unwrap();
    e.project.restart(&[
        (
            "FAKE_CLAUDE_LAUNCH_LOG",
            e.logs.path().join("launches").to_str().unwrap(),
        ),
        (
            "FAKE_CLAUDE_PROMPT_LOG",
            e.logs.path().join("prompts").to_str().unwrap(),
        ),
    ]);
    e.client = e.project.client().await;
    assert_eq!(e.progress().await, before);
    assert_eq!(
        e.client.request("message.list", json!({})).await.unwrap(),
        messages
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("launches")).unwrap(),
        launches
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("prompts")).unwrap(),
        prompts
    );
    assert_eq!(
        e.client
            .request("terminal.list", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u3078c_changed_revisions_and_unavailable_evidence_do_not_inherit_completion() {
    let e = Evidence::start().await;
    let accepted = e.accept().await;
    assert_eq!(e.progress().await["results"][0]["current"], true);
    let original = e.report["instruction"]["order"].clone();
    for (field, value) in [
        ("ask", json!("Fix another path")),
        ("done", json!("New checks pass")),
        ("limits", json!(["New limits"])),
    ] {
        let mut changed = original.clone();
        changed[field] = value;
        e.client
            .request(
                "agent.setOrder",
                json!({"id":e.report["author"]["id"],"order":changed}),
            )
            .await
            .unwrap();
        let progress = e.progress().await;
        assert_eq!(progress["results"][0]["current"], false);
        assert_eq!(progress["results"][0]["acceptances"], json!([accepted]));
    }
    e.client
        .request(
            "agent.setOrder",
            json!({"id":e.report["author"]["id"],"order":original}),
        )
        .await
        .unwrap();
    assert_eq!(e.progress().await["results"][0]["current"], false);
    // A mutable current file cannot replace a published output; removal stays effective.
    std::fs::write(e.project.dir.path().join("output.txt"), "replacement bytes").unwrap();
    let progress = e.progress().await;
    let path = progress["results"][0]["availability"]["path"]
        .as_str()
        .unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"login output V1");
    e.client
        .request("deliverable.remove", e.report["request"]["output"].clone())
        .await
        .unwrap();
    let progress = e.progress().await;
    assert_eq!(
        progress["results"][0]["availability"]["kind"],
        "unavailable"
    );
    assert_eq!(progress["results"][0]["acceptances"], json!([accepted]));
    let unknown = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    assert_eq!(unknown["verdict"], "unknown");
    assert!(!unknown["cause"].as_str().unwrap().is_empty());
    assert!(!unknown["action"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn u3078c_message_replacements_keep_acceptance_historical() {
    let mut e = Evidence::start().await;
    let accepted = e.accept().await;
    let verified = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    let before = e.progress().await;
    assert_eq!(before["results"][0]["current"], true);

    // Another Agent's accepted result has independent instruction history.
    let other = e
        .client
        .request(
            "agent.spawn",
            json!({
                "cwd": e.project.dir.path(), "parent": e.home, "name": "Unrelated",
                "order": e.report["instruction"]["order"]
            }),
        )
        .await
        .unwrap();
    daemon::next(&mut e.client, |event| match event {
        contracts::EventData::MessageDelivered(m) if m.body == "evidence-ready" => Some(()),
        _ => None,
    })
    .await;
    let data: Value =
        serde_json::from_slice(&std::fs::read(e.logs.path().join("report")).unwrap()).unwrap();
    let other_query = json!({"project": e.project.dir.path(), "id": other["id"]});
    e.client
        .request(
            "message.acceptResult",
            json!({
                "project": e.project.dir.path(), "id": other["id"],
                "report": data["report"]["report"], "evidence": "Unrelated V1 accepted"
            }),
        )
        .await
        .unwrap();
    let unrelated = e
        .client
        .request("message.progress", other_query.clone())
        .await
        .unwrap();
    assert_eq!(unrelated["results"][0]["current"], true);

    let original = before["instructions"]["deliveries"][0]["text"]
        .as_str()
        .unwrap();
    for body in [
        "Replace the implementation; done when the new checks pass",
        original,
    ] {
        let message = e
            .client
            .request(
                "message.send",
                json!({
                    "to": e.report["author"]["id"], "kind": "note", "body": body
                }),
            )
            .await
            .unwrap();
        daemon::next(&mut e.client, |event| match event {
            contracts::EventData::MessageDelivered(m) if json!(m.id) == message["id"] => Some(()),
            _ => None,
        })
        .await;
        let progress = e.progress().await;
        assert_eq!(
            progress["instructions"]["current"],
            before["instructions"]["current"]
        );
        assert_eq!(
            progress["instructions"]["revisions"]
                .as_array()
                .unwrap()
                .last()
                .unwrap()["message"],
            message["id"]
        );
        let result = &progress["results"][0];
        assert_eq!(result["current"], false);
        assert_eq!(result["report"], e.report);
        assert_eq!(result["acceptances"], json!([accepted]));
        assert_eq!(result["observations"], json!([verified]));
        assert_eq!(
            e.client
                .request("message.progress", other_query.clone())
                .await
                .unwrap(),
            unrelated
        );
    }
}

#[tokio::test]
async fn u3078h_unknown_external_effects_require_authoritative_resolution() {
    let e = Evidence::start().await;
    let calls = std::fs::read(e.logs.path().join("report.effects")).unwrap();
    assert_eq!(calls, b"deployment\npayment\npush\n");
    let prompts = std::fs::read(e.logs.path().join("prompts")).unwrap();
    let messages = e.client.request("message.list", json!({})).await.unwrap();
    for report in e.effects.as_array().unwrap() {
        let mut q = e.query();
        q["report"] = report["report"].clone();
        let unknown = e
            .client
            .request("message.verifyResult", q.clone())
            .await
            .unwrap();
        assert_eq!(unknown["verdict"], "unknown");
        assert!(unknown["cause"].as_str().unwrap().contains("unsupported"));
        assert!(!unknown["action"].as_str().unwrap().is_empty());
        assert_eq!(
            e.client.request("message.verifyResult", q).await.unwrap(),
            unknown
        );
    }
    assert_eq!(
        std::fs::read(e.logs.path().join("report.effects")).unwrap(),
        calls
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("prompts")).unwrap(),
        prompts
    );
    assert_eq!(
        e.client.request("message.list", json!({})).await.unwrap(),
        messages
    );
    let progress = e.progress().await;
    for r in &progress["results"].as_array().unwrap()[1..] {
        assert_eq!(r["report"]["request"]["state"], "unknown-effect");
        assert_eq!(r["observations"].as_array().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn u3078c_target_and_output_replacements_preserve_only_exact_version_acceptance() {
    let e = Evidence::with("replace").await;
    let accepted = e.accept().await;
    let mut q = e.result_id();
    q["report"] = e.progress().await["results"][4]["report"]["report"].clone();
    q["evidence"] = json!("Unchanged result accepted");
    let unrelated = e.client.request("message.acceptResult", q).await.unwrap();
    let progress = e.progress().await;
    let results = progress["results"].as_array().unwrap();
    assert_eq!(results[0]["current"], false);
    assert_eq!(results[0]["acceptances"], json!([accepted]));
    assert_eq!(results[4]["current"], true);
    assert_eq!(results[4]["acceptances"], json!([unrelated]));
    assert_eq!(results[5]["current"], false);
    assert_eq!(results[6]["current"], true);
    assert_ne!(
        results[6]["report"]["publication"]["id"],
        e.report["publication"]["id"]
    );
    assert_eq!(
        results[6]["report"]["publication"]["target"]["sha256"],
        e.report["publication"]["target"]["sha256"]
    );
    assert_eq!(results[6]["acceptances"], json!([]));
    assert_eq!(results[6]["observations"], json!([]));
}

#[tokio::test]
async fn u3078b_wrong_version_source_cannot_verify_a_report() {
    let e = Evidence::with("wrong-digest").await;
    let observed = e
        .client
        .request("message.verifyResult", e.result_id())
        .await
        .unwrap();
    assert_eq!(observed["verdict"], "unknown");
    assert!(observed["cause"].as_str().unwrap().contains("digest"));
    assert!(!observed["action"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn u3078b_public_reports_cannot_claim_an_earlier_attempt() {
    let mut e = Evidence::start().await;
    let original = e.progress().await["results"].clone();
    let script = r#"
import json,os,socket,sys
p=json.load(open(sys.argv[1]))['request'];s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('rb')
def call(id,method,p):
 s.sendall((json.dumps({'jsonrpc':'2.0','id':id,'method':method,'params':p})+'\n').encode());return json.loads(f.readline())
call(1,'daemon.identify',{'actor':{'kind':'agent','id':os.environ['ROUNDUP_AGENT'],'parent':None}})
r=call(2,'message.report',p);open(sys.argv[2],'w').write(json.dumps(r))
call(3,'message.send',{'to':'you','kind':'note','body':'old-attempt-refused'})
"#;
    let child = json!([
        "python3",
        "-c",
        script,
        e.logs.path().join("report"),
        e.logs.path().join("old-attempt")
    ])
    .to_string();
    e.project.restart(&[
        ("FAKE_CLAUDE_CHILD_PROCESS", &child),
        (
            "FAKE_CLAUDE_LAUNCH_LOG",
            e.logs.path().join("launches").to_str().unwrap(),
        ),
    ]);
    e.client = e.project.subscribed().await;
    let resumed = e
        .client
        .request("agent.resume", json!({"id":e.report["author"]["id"]}))
        .await
        .unwrap();
    assert_ne!(resumed["attempt"], e.report["attempt"]);
    daemon::next(&mut e.client, |event| match event {
        contracts::EventData::MessageDelivered(m) if m.body == "old-attempt-refused" => Some(()),
        _ => None,
    })
    .await;
    let reply: Value =
        serde_json::from_slice(&std::fs::read(e.logs.path().join("old-attempt")).unwrap()).unwrap();
    assert_eq!(reply["error"]["code"], rpc::code::CONFLICT);
    assert_eq!(e.progress().await["results"], original);
}

#[tokio::test]
async fn u3078c_a_late_report_cannot_borrow_the_current_instruction_revision() {
    let e = Evidence::with("late-report").await;
    let progress = e.progress().await;
    assert_ne!(
        progress["instructions"]["current"],
        e.report["instruction"]["revision"]
    );
    assert_eq!(progress["results"][0]["current"], false);
    assert_eq!(
        e.report["order_revision"],
        e.report["instruction"]["revision"]
    );
}

#[tokio::test]
async fn u3078h_later_claims_cannot_supersede_unresolved_effects() {
    let e = Evidence::with("effect-claim").await;
    let progress = e.progress().await;
    for effect in e.effects.as_array().unwrap() {
        let rows = progress["results"].as_array().unwrap();
        let original = rows
            .iter()
            .find(|r| r["report"]["report"] == effect["report"])
            .unwrap();
        assert_eq!(original["current"], true);
        let claim = rows
            .iter()
            .find(|r| {
                r["report"]["request"]["key"]
                    == format!(
                        "{}-claim",
                        effect["request"]["target"]["id"].as_str().unwrap()
                    )
            })
            .unwrap();
        assert_eq!(claim["current"], false);
        let mut q = e.query();
        q["report"] = claim["report"]["report"].clone();
        q["evidence"] = json!("Looks complete");
        e.client
            .request("message.acceptResult", q.clone())
            .await
            .unwrap();
        q.as_object_mut().unwrap().remove("evidence");
        let observed = e.client.request("message.verifyResult", q).await.unwrap();
        assert_eq!(observed["verdict"], "unknown");
        assert!(
            observed["cause"]
                .as_str()
                .unwrap()
                .contains("external effect")
        );
    }
}

#[tokio::test]
async fn u3078h_exact_external_resolution_survives_reopen() {
    let mut e = Evidence::with("effect-claim").await;
    let calls = std::fs::read(e.logs.path().join("report.effects")).unwrap();
    let prompts = std::fs::read(e.logs.path().join("prompts")).unwrap();
    let messages = e.client.request("message.list", json!({})).await.unwrap();
    for (index, report) in e.effects.as_array().unwrap().iter().enumerate() {
        let outcome = if index == 1 {
            "not-performed"
        } else {
            "completed"
        };
        {
            let evidence = receipt(report, json!({"kind":outcome}));
            let source = Source::new(evidence.clone(), 200).await;
            let mut q = e.query();
            q["report"] = report["report"].clone();
            q["source"] = json!(source.url);
            let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
                .args([
                    "message",
                    "resolve-result",
                    q["project"].as_str().unwrap(),
                    q["id"].as_str().unwrap(),
                    q["report"].as_str().unwrap(),
                    &source.url,
                    "--json",
                ])
                .env("RUPD_SOCKET", e.project.socket())
                .env_remove("ROUNDUP_AGENT")
                .kill_on_drop(true)
                .output()
                .await
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            let observed: Value = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(observed["verdict"], "resolved");
            assert_eq!(observed["evidence"], evidence);
            assert_eq!(observed["source"], source.url);
            assert_eq!(observed["authorizer"]["kind"], "user");
            drop(source);
            q.as_object_mut().unwrap().remove("source");
            assert_eq!(
                e.client.request("message.verifyResult", q).await.unwrap(),
                observed
            );
            let progress = e.progress().await;
            assert_eq!(progress["results"][1 + index * 2]["current"], false);
            assert_eq!(progress["results"][2 + index * 2]["current"], true);
            assert_eq!(
                progress["results"][1 + index * 2]["observations"]
                    .as_array()
                    .unwrap()
                    .last()
                    .unwrap(),
                &observed
            );
        }
    }
    let before = e.progress().await;
    e.project.restart(&[]);
    e.client = e.project.client().await;
    let after = e.progress().await;
    assert_eq!(after["results"], before["results"]);
    assert_eq!(
        e.client.request("message.list", json!({})).await.unwrap(),
        messages
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("report.effects")).unwrap(),
        calls
    );
    assert_eq!(
        std::fs::read(e.logs.path().join("prompts")).unwrap(),
        prompts
    );
}

#[tokio::test]
async fn u3078h_unusable_external_evidence_leaves_the_effect_unknown() {
    let e = Evidence::with("effect-claim").await;
    let report = &e.effects[0];
    let valid = receipt(report, json!({"kind":"completed"}));
    let mut gaps = vec![(json!({}), 200), (valid.clone(), 503)];
    for (field, value) in [
        ("target", json!({"id":"deployment","revision":"v2"})),
        ("target", json!({"id":"another-payment","revision":"v1"})),
        ("revision", json!("")),
        ("observed_at", json!(0)),
        (
            "outcome",
            json!({"kind":"inconclusive","cause":"provider still reconciling"}),
        ),
    ] {
        let mut gap = valid.clone();
        gap[field] = value;
        gaps.push((gap, 200));
    }
    for (body, status) in gaps {
        let source = Source::new(body, status).await;
        let mut q = e.query();
        q["report"] = report["report"].clone();
        q["source"] = json!(source.url);
        let observed = e.client.request("message.resolveResult", q).await.unwrap();
        assert_eq!(observed["verdict"], "unknown");
        assert!(!observed["cause"].as_str().unwrap().is_empty());
        assert!(!observed["action"].as_str().unwrap().is_empty());
        let progress = e.progress().await;
        assert_eq!(progress["results"][1]["current"], true);
        assert_eq!(progress["results"][2]["current"], false);
        assert_eq!(
            progress["results"][1]["observations"]
                .as_array()
                .unwrap()
                .last()
                .unwrap(),
            &observed
        );
    }
}
