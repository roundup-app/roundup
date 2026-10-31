use super::*;
use contracts::agent::{WorktreePr, WorktreeRequiredCheck};

const REPO: &str = "github.com/acme/one";

fn state(
    evidence: WorktreeEvidenceState,
    head: &str,
    conclusion: WorktreeCheckConclusion,
) -> WorktreeState {
    WorktreeState {
        ahead: 0,
        behind: 0,
        dirty: false,
        ci: None,
        pr: Some(WorktreePr {
            number: std::num::NonZeroU64::new(23).unwrap(),
            stale: false,
        }),
        evidence: Some(WorktreeEvidence {
            state: evidence,
            stale: false,
            repository: Some(REPO.into()),
            head: Some(head.into()),
            checks: vec![WorktreeRequiredCheck {
                name: "check".into(),
                conclusion,
            }],
            read_at: Some(1),
            revision: Some("r".into()),
        }),
    }
}

fn passed(head: &str) -> WorktreeState {
    state(
        WorktreeEvidenceState::Complete,
        head,
        WorktreeCheckConclusion::Passed,
    )
}

/// The state each Worktree read returns, set by the test between checks.
type Feed = Arc<std::sync::Mutex<WorktreeState>>;

async fn daemon() -> (
    tempfile::TempDir,
    Arc<crate::Daemon>,
    rpc::Client,
    Watcher,
    String,
) {
    use std::os::unix::fs::PermissionsExt;
    let project = tempfile::tempdir().unwrap();
    let dir = project.path().join(".roundup");
    std::fs::create_dir(&dir).unwrap();
    let fake = project.path().join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.path().join("rup");
    std::fs::write(&rup, "").unwrap();
    crate::storage::open(&dir).unwrap();
    let bus = rpc::Bus::new();
    let terminals = Arc::new(terminal::Terminals::open(&dir, bus.clone()).unwrap());
    let agents = Arc::new(
        agents::Agents::open_with(
            &dir,
            bus.clone(),
            terminals.clone(),
            agents::claude_code::Launcher::new(
                fake.to_str().unwrap(),
                project.path().join("claude.json"),
                rup,
                None,
            ),
            agents::worktree::Git::from_env(),
        )
        .unwrap(),
    );
    let messages = Arc::new(messages::Messages::open(&dir, bus.clone(), agents.clone()).unwrap());
    let sender = Arc::new(std::sync::OnceLock::new());
    sender.set(messages.clone()).ok();
    let touches = Arc::new(provenance::Touches::open(&dir.join("provenance.db")).unwrap());
    let mut daemon = crate::Daemon {
        naming: Arc::new(std::sync::Mutex::new(
            crate::data::open_naming(&crate::data::naming_path(&dir)).unwrap(),
        )),
        terminals: terminals.clone(),
        program_changes: Default::default(),
        program_statuses: Default::default(),
        modules: Default::default(),
        todos: Arc::new(todos::Todos::open(&dir, bus.clone()).unwrap()),
        pads: Arc::new(pads::Pads::open(&dir, bus.clone()).unwrap()),
        specialists: Default::default(),
        bus: bus.clone(),
        project: dir.to_path_buf(),
        project_key: String::new(),
        touches: touches.clone(),
        digests: Default::default(),
        pushes: Default::default(),
        waits: Default::default(),
        resources: Default::default(),
        publications: crate::deliverables::Publications::in_memory(dir.join("deliverables")),
        reactions: Arc::new(Reactions::open(&dir).unwrap()),
        prompt_effect_gate: None,
        actions: Default::default(),
        agents: agents.clone(),
        renames: std::sync::Mutex::new(None),
        owner_events: std::sync::Mutex::new(None),
        wake_events: Default::default(),
        wake_gate: Default::default(),
        sender,
        attachments: crate::attachment::Attachments::open(&dir),
        restarting: Default::default(),
        queue: Default::default(),
        auto: crate::auto::Auto::new(&bus),
    };
    daemon.register(daemon.todos.clone());
    daemon.register(daemon.pads.clone());
    daemon.register(messages.clone());
    daemon.register(agents.clone());
    daemon.register(terminals);
    let daemon = Arc::new(daemon);
    let socket = project.path().join("daemon.sock");
    tokio::spawn(crate::serve(
        tokio::net::UnixListener::bind(&socket).unwrap(),
        daemon.clone(),
    ));
    let client = rpc::Client::connect(&socket).await.unwrap();
    let target = client
        .request(
            "agent.spawn",
            json!({"cwd":project.path(),"prompt":null,"parent":null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // The Daemon's own Watcher ticks once on the first request, then every 20 seconds: let that first
    // tick finish, with nothing saved, so only the fed reads below decide.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let watcher = Watcher {
        reactions: Arc::clone(&daemon.reactions),
        agents,
        messages,
        bus,
        touches,
    };
    (project, daemon, client, watcher, target)
}

async fn save(
    daemon: &crate::Daemon,
    target: &str,
    repository: &str,
    number: u32,
    pin: &str,
) -> String {
    let params: contracts::reaction::CreateParams = serde_json::from_value(json!({
        "operation": format!("{repository}#{number}#{}", pin),
        "name": "ship",
        "target": target,
        "reason": "Wait for the pinned checks.", "instruction": "ship it",
        "condition": {"kind": "pr-checks", "repository": repository, "number": number},
        "expires_at": "2099-01-01T00:00:00Z",
    }))
    .unwrap();
    let world = daemon.reader().world().await.unwrap();
    daemon
        .reaction_create(&Actor::user(), &world, params, Some(Ok(pin.into())))
        .unwrap()
        .id
}

async fn run(watcher: &Watcher, feed: &Feed) {
    let feed = Arc::clone(feed);
    watcher
        .check_with(|_, _| {
            let state = feed.lock().unwrap().clone();
            async move { Ok(state) }
        })
        .await;
}

async fn get(client: &rpc::Client, id: &str) -> Value {
    client
        .request("reaction.get", json!({ "id": id }))
        .await
        .unwrap()
}

#[tokio::test]
async fn nr8_checks_refuse_a_target_after_authority_or_lifecycle_loss() {
    for removed in [false, true] {
        let (project, daemon, client, watcher, author) = daemon().await;
        let actor = Actor {
            kind: contracts::ActorKind::Agent,
            id: author,
            parent: None,
        };
        let target = daemon
            .agents
            .call(
                &daemon.ctx(actor.clone()),
                "agent.spawn",
                json!({
                    "cwd": project.path(), "prompt": null,
                }),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let params = serde_json::from_value(json!({
            "operation": "authorized-checks", "name": "ship", "target": target,
            "reason": "Wait for the pinned checks.", "instruction": "revoked checks instruction",
            "condition": {"kind": "pr-checks", "repository": REPO, "number": 23},
            "expires_at": "2099-01-01T00:00:00Z",
        }))
        .unwrap();
        let world = daemon.reader().world().await.unwrap();
        let saved = daemon
            .reaction_create(&actor, &world, params, Some(Ok("a".into())))
            .unwrap();
        if removed {
            client
                .request("rail.remove", json!({"id": target}))
                .await
                .unwrap();
        } else {
            client
                .request(
                    "rail.move",
                    json!({"id": target, "parent": null, "index": 0}),
                )
                .await
                .unwrap();
        }
        let feed: Feed = Arc::new(std::sync::Mutex::new(passed("a")));
        run(&watcher, &feed).await;
        run(&watcher, &feed).await;
        let seen = get(&client, &saved.id).await;
        assert_eq!(seen["firings"], json!([]), "{seen}");
        assert_eq!(seen["remaining"], 1);
        assert_eq!(seen["target"], target);
        assert_eq!(seen["observation"]["health"], "unavailable");
        assert_eq!(
            seen["observation"]["cause_code"],
            if removed {
                "agent-unavailable"
            } else {
                "authority-refused"
            }
        );
        let cause = seen["observation"]["cause"].as_str().unwrap();
        assert!(
            cause.contains(if removed { "gone" } else { "Reach" }),
            "{cause}"
        );
        let sent = client
            .request("message.list", json!({"to": target}))
            .await
            .unwrap();
        assert!(
            !sent
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["body"] == "revoked checks instruction")
        );
    }
}

#[tokio::test]
async fn nr7_pending_checks_allow_activation_without_a_firing() {
    use std::os::unix::fs::PermissionsExt;
    let (project, daemon, client, watcher, target) = daemon().await;
    let repo = project.path().to_owned();
    for args in [
        &["init", "-b", "main"][..],
        &[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "x",
        ],
        &["branch", "base"],
    ] {
        let status = std::process::Command::new("git")
            .current_dir(&repo)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success());
    }
    let read_head = || {
        let out = std::process::Command::new("git")
            .current_dir(&repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        assert!(out.status.success());
        String::from_utf8(out.stdout).unwrap().trim().to_owned()
    };
    let head = read_head();
    let gh = project.path().join("gh");
    let forge = async |head: &str, bucket: &str| {
        std::fs::write(
            &gh,
            format!("#!/bin/sh\ncase \"$1 $2\" in\n\"pr view\") echo '{{\"number\":23,\"headRefOid\":\"{head}\",\"url\":\"https://github.com/acme/one/pull/23\"}}';;\n\"pr checks\") echo '[{{\"name\":\"check\",\"bucket\":\"{bucket}\"}}]';;\nesac\n"),
        ).unwrap();
        std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
        daemon
            .agents
            .set_evidence_from_gh(&target, &repo, &gh)
            .await;
    };
    forge(&head, "pending").await;
    let params = json!({
        "operation": "pending-head", "name": "when checks pass", "target": target,
        "reason": "Wait for the pinned checks.", "instruction": "review this PR",
        "condition": { "kind": "pr-checks", "repository": REPO, "number": 23 },
        "expires_at": "2099-01-01T00:00:00Z"
    });
    let created = client.request("reaction.create", params.clone()).await;
    let created = created.unwrap();
    let id = created["id"].as_str().unwrap();
    assert_eq!(created["observation"]["pinned_head"], head);
    watcher.check().await;
    assert_eq!(get(&client, id).await["firings"], json!([]));
    forge(&head, "pass").await;
    watcher.check().await;
    watcher.check().await;
    let replay = client
        .request("reaction.create", params.clone())
        .await
        .unwrap();
    assert_eq!(replay["id"], id);
    let fired = get(&client, id).await;
    assert_eq!(fired["firings"].as_array().unwrap().len(), 1);
    let sent = client
        .request("message.list", json!({"to": target}))
        .await
        .unwrap();
    let messages: Vec<_> = sent
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["body"] == "review this PR")
        .collect();
    assert_eq!(messages.len(), 1);
    assert_eq!(fired["firings"][0]["message"], messages[0]["id"]);

    // A second saved pin must invalidate even before the new head's checks conclude.
    forge(&head, "pending").await;
    let moved = client
        .request(
            "reaction.create",
            json!({
                "operation": "moved-head", "name": "when checks pass", "target": target,
                "reason": "Wait for the pinned checks.", "instruction": "do not deliver after a head change",
                "condition": { "kind": "pr-checks", "repository": REPO, "number": 23 },
                "expires_at": "2099-01-01T00:00:00Z"
            }),
        )
        .await
        .unwrap();
    let moved_id = moved["id"].as_str().unwrap();
    let status = std::process::Command::new("git")
        .current_dir(&repo)
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "fix",
        ])
        .status()
        .unwrap();
    assert!(status.success());
    let pushed = read_head();
    let mut replacement = params;
    replacement["operation"] = json!("pushed-head");
    let refused = client
        .request("reaction.create", replacement.clone())
        .await
        .unwrap_err();
    assert!(refused.message.contains("stale"), "{refused:?}");
    forge(&pushed, "pending").await;
    watcher.check().await;
    let ended = get(&client, moved_id).await;
    assert_eq!(ended["state"], "invalidated");
    assert_eq!(ended["observation"]["pinned_head"], head);
    assert_eq!(ended["firings"], json!([]));
    let fresh = client
        .request("reaction.create", replacement)
        .await
        .unwrap();
    assert_eq!(fresh["observation"]["pinned_head"], pushed);
    forge(&pushed, "pass").await;
    watcher.check().await;
    let fired = get(&client, fresh["id"].as_str().unwrap()).await;
    assert_eq!(fired["firings"].as_array().unwrap().len(), 1);

    for unavailable in [false, true] {
        // Neither a missing head nor a failed forge read supplies activation identity.
        forge("", "pending").await;
        if unavailable {
            std::fs::remove_file(&gh).unwrap();
            daemon
                .agents
                .set_evidence_from_gh(&target, &repo, &gh)
                .await;
        }
        let refused = client
            .request(
                "reaction.create",
                json!({
                    "operation": format!("no-identity-{unavailable}"), "name": "refused",
                    "target": target, "reason": "Wait for the pinned checks.", "instruction": "must not save",
                    "condition": { "kind": "pr-checks", "repository": REPO, "number": 23 },
                    "expires_at": "2099-01-01T00:00:00Z"
                }),
            )
            .await
            .unwrap_err();
        assert_eq!(refused.code, rpc::code::INVALID_PARAMS);
        assert!(
            refused.message.contains(if unavailable {
                "no usable gh"
            } else {
                "forge read failed"
            }),
            "{refused:?}"
        );
    }
    let saved = client.request("reaction.list", json!({})).await.unwrap();
    assert_eq!(saved.as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn nr7_checks_require_complete_pinned_head_evidence() {
    let (_project, daemon, client, watcher, target) = daemon().await;
    let feed: Feed = Arc::new(std::sync::Mutex::new(passed("a")));
    let one = save(&daemon, &target, REPO, 23, "a").await;
    // The same PR number, pinned in another repository, must never match this evidence.
    let two = save(&daemon, &target, "github.com/acme/two", 23, "a").await;
    // A reaction pinned to an earlier head.
    let old = save(&daemon, &target, REPO, 24, "a").await;

    // Each gap exposes its cause and never fires.
    let mut gaps = Vec::new();
    for (kind, cause) in [
        (WorktreeEvidenceState::Incomplete, "checks-pending"),
        (WorktreeEvidenceState::StaleHead, "head-moved"),
        (WorktreeEvidenceState::Unknown, "forge-read-failed"),
        (WorktreeEvidenceState::Unavailable, "checks-unavailable"),
    ] {
        gaps.push((state(kind, "a", WorktreeCheckConclusion::Passed), cause));
    }
    for conclusion in [
        WorktreeCheckConclusion::Failed,
        WorktreeCheckConclusion::Skipped,
        WorktreeCheckConclusion::Cancelled,
    ] {
        gaps.push((
            state(WorktreeEvidenceState::Complete, "a", conclusion),
            "checks-failed",
        ));
    }
    let mut stale = passed("a");
    stale.evidence.as_mut().unwrap().stale = true;
    gaps.push((stale, "evidence-stale"));
    let mut no_ci = passed("a");
    no_ci.evidence.as_mut().unwrap().checks.clear();
    gaps.push((no_ci, "checks-pending"));
    let mut none = passed("a");
    none.evidence = None;
    gaps.push((none, "evidence-missing"));
    for (gap, cause) in gaps {
        *feed.lock().unwrap() = gap;
        run(&watcher, &feed).await;
        let saved = get(&client, &one).await;
        assert_eq!(saved["state"], "active");
        assert_eq!(saved["observation"]["health"], "waiting");
        assert_eq!(saved["observation"]["cause_code"], cause);
        assert_eq!(saved["firings"], json!([]));
    }
    // Diagnostic wording cannot change a failed refresh's identity or authorize a match.
    for diagnostic in ["offline", "the PR head moved; unsupported"] {
        watcher
            .check_with(|_, _| async { Err(RpcError::internal(diagnostic)) })
            .await;
        let seen = get(&client, &one).await;
        assert_eq!(seen["observation"]["cause_code"], "worktree-read-failed");
        assert_eq!(seen["observation"]["recovery_code"], "check");
        assert!(
            seen["observation"]["cause"]
                .as_str()
                .unwrap()
                .contains(diagnostic)
        );
        assert_eq!(seen["firings"], json!([]));
    }

    // Complete passing evidence for the pinned head fires the reaction once, and again for nobody.
    *feed.lock().unwrap() = passed("a");
    run(&watcher, &feed).await;
    run(&watcher, &feed).await;
    let fired = get(&client, &one).await;
    assert_eq!(fired["firings"].as_array().unwrap().len(), 1);
    let evidence: Value =
        serde_json::from_str(fired["firings"][0]["evidence"].as_str().unwrap()).unwrap();
    assert_eq!(evidence["head"], "a");
    assert_eq!(fired["firings"][0]["matched"], true);
    let sent = client
        .request("message.list", json!({ "to": target }))
        .await
        .unwrap();
    assert_eq!(
        sent.as_array()
            .unwrap()
            .iter()
            .filter(|m| m["body"] == "ship it")
            .count(),
        1
    );

    // The other repository and the other PR waited, naming what the evidence was for.
    let cross = get(&client, &two).await;
    assert_eq!(cross["firings"], json!([]));
    assert!(
        cross["observation"]["cause"]
            .as_str()
            .unwrap()
            .contains(REPO)
    );
    assert_eq!(get(&client, &old).await["firings"], json!([]));

    // A moved head, even to a failing one, ends a reaction pinned to the old head.
    let moved = save(&daemon, &target, REPO, 23, "z").await;
    *feed.lock().unwrap() = state(
        WorktreeEvidenceState::Complete,
        "b",
        WorktreeCheckConclusion::Failed,
    );
    run(&watcher, &feed).await;
    let ended = get(&client, &moved).await;
    assert_eq!(ended["state"], "invalidated");
    assert!(
        ended["observation"]["cause"]
            .as_str()
            .unwrap()
            .contains("moved")
    );
    assert_eq!(ended["firings"], json!([]));
}
#[tokio::test]
async fn nr4_pr_observation_crossing_expiry_accepts_nothing() {
    let (_project, daemon, client, watcher, target) = daemon().await;
    let expires = time::OffsetDateTime::now_utc() + time::Duration::seconds(1);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
    let stamp = expires
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let params = serde_json::from_value(json!({
        "operation": "expiring-checks", "name": "ship", "target": target,
        "reason": "Wait for the pinned checks.", "instruction": "ship it",
        "condition": {"kind": "pr-checks", "repository": REPO, "number": 23},
        "expires_at": stamp,
    }))
    .unwrap();
    let world = daemon.reader().world().await.unwrap();
    let id = daemon
        .reaction_create(&Actor::user(), &world, params, Some(Ok("a".into())))
        .unwrap()
        .id;
    // The source read begins before expiry and completes at its saved expiry instant.
    // This is the NR4 expiry boundary itself, not a delay waiting for evaluator readiness.
    watcher
        .check_with(|_, _| async move {
            tokio::time::sleep_until(deadline).await;
            while time::OffsetDateTime::now_utc() < expires {
                tokio::task::yield_now().await;
            }
            Ok(passed("a"))
        })
        .await;
    // Replay the same evidence and explicitly run: neither can bypass the saved expiry.
    watcher.check_with(|_, _| async { Ok(passed("a")) }).await;
    let refused = client
        .request(
            "reaction.run",
            json!({"id": id, "operation": "expired-run"}),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::CONFLICT);
    let inspected = get(&client, &id).await;
    assert_eq!(inspected["expires_at"], stamp);
    assert_eq!(inspected["remaining"], 1);
    assert_eq!(
        inspected["firings"],
        json!([]),
        "expired source read accepted work: {inspected}"
    );
    let sent = client
        .request("message.list", json!({"to": target}))
        .await
        .unwrap();
    assert!(
        !sent
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["body"] == "ship it")
    );
}
