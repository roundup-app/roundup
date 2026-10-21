//! NR7: a PrChecks reaction matches only complete, fresh `agent.worktreeState` evidence for the head it
//! pinned at activation. Anything less never matches and says why; a moved head invalidates it.
use std::sync::Arc;
use std::time::Duration;

use contracts::Actor;
use contracts::agent::{
    WorktreeCheckConclusion, WorktreeEvidence, WorktreeEvidenceState, WorktreeState,
};
use contracts::reaction::{Condition, Reaction, State};
use rpc::{Ctx, Module, RpcError};
use serde_json::{Value, json};

use crate::reaction::Reactions;

const EVERY: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// Every required check passed on the pinned head.
    Match,
    /// The head moved: the reaction ends, and a replacement is an explicit new one.
    Invalidate(String),
    /// No match now, and the cause the user can act on.
    Wait(String),
}

/// The evidence a state carries for `repository` and `number`, or the cause it has none a reaction may
/// trust: a missing, stale, other-repository, other-PR or incomplete read.
pub(crate) fn complete<'a>(
    state: &'a WorktreeState,
    repository: &str,
    number: u32,
) -> Result<&'a WorktreeEvidence, String> {
    let Some(pr) = state
        .pr
        .as_ref()
        .filter(|pr| pr.number.get() == u64::from(number))
    else {
        return Err(format!("the Worktree holds no PR {number}"));
    };
    let evidence = state
        .evidence
        .as_ref()
        .ok_or("no required-check evidence")?;
    if pr.stale || evidence.stale {
        return Err("the evidence is stale; the last refresh failed or is old".into());
    }
    if evidence.repository.as_deref() != Some(repository) {
        return Err(format!(
            "the PR is in {}, not {repository}",
            evidence
                .repository
                .as_deref()
                .unwrap_or("an unknown repository")
        ));
    }
    match evidence.state {
        WorktreeEvidenceState::Complete if evidence.head.is_some() => Ok(evidence),
        WorktreeEvidenceState::Complete => Err("the evidence names no head".into()),
        WorktreeEvidenceState::Incomplete => {
            Err("a required check is pending, or none is required".into())
        }
        WorktreeEvidenceState::StaleHead => {
            Err("the PR head moved while the checks were read".into())
        }
        WorktreeEvidenceState::Unknown => Err("the forge read failed without a reason".into()),
        WorktreeEvidenceState::Unavailable => {
            Err("no usable gh, login, GitHub remote or answer in time".into())
        }
    }
}

pub(crate) fn decide(
    pin: &str,
    repository: &str,
    number: u32,
    read: &Result<WorktreeState, RpcError>,
) -> Verdict {
    let state = match read {
        Ok(state) => state,
        Err(error) => return Verdict::Wait(format!("the Worktree read failed: {}", error.message)),
    };
    let evidence = match complete(state, repository, number) {
        Ok(evidence) => evidence,
        Err(cause) => return Verdict::Wait(cause),
    };
    let head = evidence.head.as_deref().unwrap_or_default();
    if head != pin {
        return Verdict::Invalidate(format!("the PR head moved from {pin} to {head}"));
    }
    if evidence.checks.is_empty() {
        return Verdict::Wait("no required check concluded".into());
    }
    if evidence
        .checks
        .iter()
        .any(|check| check.conclusion != WorktreeCheckConclusion::Passed)
    {
        return Verdict::Wait("a required check did not pass on the pinned head".into());
    }
    Verdict::Match
}

pub(crate) async fn read(
    agents: &agents::Agents,
    ctx: &Ctx,
    target: &str,
) -> Result<WorktreeState, RpcError> {
    let value = agents
        .call(ctx, "agent.worktreeState", json!({ "id": target }))
        .await?;
    serde_json::from_value(value).map_err(RpcError::internal)
}

/// The head a new reaction pins: the PR's current head, on complete fresh evidence only.
pub(crate) fn pin(
    read: Result<WorktreeState, RpcError>,
    repository: &str,
    number: u32,
) -> Result<String, RpcError> {
    let refuse = |cause: String| {
        RpcError::new(
            rpc::code::INVALID_PARAMS,
            format!("pr-checks needs complete current evidence to activate: {cause}"),
        )
    };
    let state = read.map_err(|e| refuse(format!("the Worktree read failed: {}", e.message)))?;
    let evidence = complete(&state, repository, number).map_err(refuse)?;
    if evidence.checks.is_empty() {
        return Err(refuse("no required check concluded".into()));
    }
    Ok(evidence.head.clone().unwrap_or_default())
}

#[derive(Clone)]
pub(crate) struct Watcher {
    pub reactions: Arc<Reactions>,
    pub agents: Arc<agents::Agents>,
    pub messages: Arc<messages::Messages>,
    pub bus: rpc::Bus,
    pub touches: Arc<crate::Touches>,
}

impl Watcher {
    pub(crate) async fn run(self) {
        let mut tick = tokio::time::interval(EVERY);
        loop {
            tick.tick().await;
            self.check().await;
        }
    }

    /// Decides every active PrChecks reaction once, from a fresh read of its target's Worktree.
    pub(crate) async fn check(&self) {
        self.check_with(|target: String, ctx: Ctx| async move {
            read(&self.agents, &ctx, &target).await
        })
        .await;
    }

    async fn check_with<F, Fut>(&self, state_of: F)
    where
        F: Fn(String, Ctx) -> Fut,
        Fut: std::future::Future<Output = Result<WorktreeState, RpcError>> + Send,
    {
        let active = match self.reactions.active() {
            Ok(active) => active,
            Err(error) => {
                eprintln!("reactions: {}", error.message);
                return;
            }
        };
        let now = time::OffsetDateTime::now_utc();
        for saved in active {
            let Condition::PrChecks { repository, number } = &saved.condition else {
                continue;
            };
            let expired = time::OffsetDateTime::parse(
                &saved.expires_at,
                &time::format_description::well_known::Rfc3339,
            )
            .map_or(true, |at| at <= now);
            let spent = self
                .messages
                .firings_of(&saved.id)
                .map_or(true, |f| f.len() >= saved.max_firings as usize);
            let Some(pin) = saved.observation.pinned_head.clone() else {
                continue;
            };
            if expired || spent {
                continue;
            }
            let ctx = Ctx {
                actor: Actor::daemon(),
                bus: self.bus.clone(),
                touches: Arc::clone(&self.touches),
            };
            let state = state_of(saved.target.clone(), ctx).await;
            let verdict = decide(&pin, repository, *number, &state);
            self.apply(saved, &pin, &state, verdict).await;
        }
    }

    async fn apply(
        &self,
        saved: Reaction,
        pin: &str,
        state: &Result<WorktreeState, RpcError>,
        verdict: Verdict,
    ) {
        match verdict {
            Verdict::Match => {
                let evidence = state.as_ref().ok().and_then(|s| s.evidence.as_ref());
                let facts: Value = json!({
                    "source": "pr-checks",
                    "condition": &saved.condition,
                    "head": pin,
                    "evidence": evidence,
                });
                let fired = self
                    .messages
                    .fire_reaction(messages::reaction::Fire {
                        reaction: saved.id.clone(),
                        operation: format!("pr-checks:{pin}"),
                        to: saved.target.clone(),
                        body: saved.instruction.clone(),
                        evidence: facts.to_string(),
                        matched: true,
                    })
                    .await;
                match fired {
                    Ok(_) => self.reactions.observe(&saved.id, "matched", None, None),
                    Err(error) => self.reactions.observe(
                        &saved.id,
                        "write-failed",
                        Some(format!("the firing was not accepted: {}", error.message)),
                        None,
                    ),
                }
            }
            Verdict::Invalidate(cause) => self.reactions.observe(
                &saved.id,
                "invalidated",
                Some(cause),
                Some(State::Invalidated),
            ),
            Verdict::Wait(cause) => self
                .reactions
                .observe(&saved.id, "waiting", Some(cause), None),
        }
    }
}

#[cfg(test)]
mod tests {
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
        let messages = Arc::new(
            messages::Messages::open(
                &dir,
                bus.clone(),
                agents.clone(),
                Arc::new(|_, _| Box::pin(async { Err(messages::Refusal::Busy) })),
            )
            .unwrap(),
        );
        let sender = Arc::new(std::sync::OnceLock::new());
        sender.set(messages.clone()).ok();
        let touches = Arc::new(provenance::Touches::open(&dir.join("provenance.db")).unwrap());
        let mut daemon = crate::Daemon {
            terminals: terminals.clone(),
            modules: Default::default(),
            todos: Arc::new(todos::Todos::open(&dir, bus.clone()).unwrap()),
            pads: Arc::new(pads::Pads::open(&dir, bus.clone()).unwrap()),
            door_first_steers: Default::default(),
            child_effects: Default::default(),
            specialists: Default::default(),
            held_actions: crate::resize::HeldActions::open(&dir).unwrap(),
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
            agents: agents.clone(),
            notes: Default::default(),
            renames: std::sync::Mutex::new(None),
            owner_events: std::sync::Mutex::new(None),
            wake_events: Default::default(),
            wake_gate: Default::default(),
            sender,
            attachments: crate::attachment::Attachments::open(&dir),
            clears: Default::default(),
            checkpoints: Arc::new(checkpoints::Checkpoints::open(&dir).unwrap()),
            rewinding: Default::default(),
        };
        daemon.register(daemon.todos.clone());
        daemon.register(daemon.pads.clone());
        daemon.register(daemon.checkpoints.clone());
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
            "instruction": "ship it",
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
    async fn nr8_pr_checks_refuse_revoked_authority_without_accepting_work() {
        let (project, daemon, client, watcher, target) = daemon().await;
        let author = client
            .request(
                "agent.spawn",
                json!({
                    "cwd": project.path(), "prompt": null, "parent": null
                }),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        client
            .request(
                "rail.move",
                json!({"id": target, "parent": author, "index": 0}),
            )
            .await
            .unwrap();
        let actor = Actor {
            kind: contracts::ActorKind::Agent,
            id: author,
            parent: None,
        };
        let params = serde_json::from_value(json!({
            "operation": "revoked", "name": "ship", "target": target,
            "instruction": "ship it", "condition": {"kind": "pr-checks", "repository": REPO, "number": 23},
            "expires_at": "2099-01-01T00:00:00Z"
        })).unwrap();
        let world = daemon.reader().world().await.unwrap();
        let saved = daemon
            .reaction_create(&actor, &world, params, Some(Ok("a".into())))
            .unwrap();
        client
            .request(
                "rail.move",
                json!({"id": target, "parent": null, "index": 0}),
            )
            .await
            .unwrap();
        let feed = Arc::new(std::sync::Mutex::new(passed("a")));
        run(&watcher, &feed).await;
        run(&watcher, &feed).await;
        let seen = get(&client, &saved.id).await;
        assert_eq!(seen["firings"], json!([]));
        assert_eq!(seen["remaining"], 1);
        assert_eq!(seen["state"], "invalidated");
        assert!(
            seen["observation"]["cause"]
                .as_str()
                .unwrap()
                .contains("Reach")
        );
        let sent = client
            .request("message.list", json!({"to": target}))
            .await
            .unwrap();
        assert!(
            sent.as_array()
                .unwrap()
                .iter()
                .all(|m| m["body"] != "ship it")
        );
    }

    #[tokio::test]
    async fn nr7_checks_read_evidence_from_a_fake_gh_through_the_daemon() {
        use std::os::unix::fs::PermissionsExt;
        let (project, daemon, client, watcher, target) = daemon().await;
        // The Agents' project directory is the Worktree's git root.
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
        let head = "1".repeat(40);
        let gh = project.path().join("gh");
        std::fs::write(
            &gh,
            format!("#!/bin/sh\ncase \"$1 $2\" in\n\"pr view\") echo '{{\"number\":23,\"headRefOid\":\"{head}\",\"url\":\"https://github.com/acme/one/pull/23\"}}';;\n\"pr checks\") echo '[{{\"name\":\"check\",\"bucket\":\"pass\"}}]';;\nesac\n"),
        )
        .unwrap();
        std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
        daemon.agents.set_evidence_from_gh(&target, &repo, &gh);
        let state = client
            .request("agent.worktreeState", json!({ "id": target }))
            .await
            .unwrap();
        assert_eq!(state["evidence"]["state"], "complete");
        assert_eq!(state["evidence"]["repository"], REPO);
        assert_eq!(state["evidence"]["head"], head.as_str());
        // The Watcher's own read of that evidence, not a fed one, fires a reaction pinned to its head
        // once, and never one pinned to another head.
        let pinned = save(&daemon, &target, REPO, 23, &head).await;
        let moved = save(&daemon, &target, REPO, 23, &"2".repeat(40)).await;
        watcher.check().await;
        watcher.check().await;
        assert_eq!(
            get(&client, &pinned).await["firings"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(get(&client, &moved).await["firings"], json!([]));
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
        for kind in [
            WorktreeEvidenceState::Incomplete,
            WorktreeEvidenceState::StaleHead,
            WorktreeEvidenceState::Unknown,
            WorktreeEvidenceState::Unavailable,
        ] {
            gaps.push(state(kind, "a", WorktreeCheckConclusion::Passed));
        }
        for conclusion in [
            WorktreeCheckConclusion::Failed,
            WorktreeCheckConclusion::Skipped,
            WorktreeCheckConclusion::Cancelled,
        ] {
            gaps.push(state(WorktreeEvidenceState::Complete, "a", conclusion));
        }
        let mut stale = passed("a");
        stale.evidence.as_mut().unwrap().stale = true;
        gaps.push(stale);
        let mut no_ci = passed("a");
        no_ci.evidence.as_mut().unwrap().checks.clear();
        gaps.push(no_ci);
        let mut none = passed("a");
        none.evidence = None;
        gaps.push(none);
        for gap in gaps {
            *feed.lock().unwrap() = gap;
            run(&watcher, &feed).await;
            let saved = get(&client, &one).await;
            assert_eq!(saved["state"], "active");
            assert_eq!(saved["observation"]["health"], "waiting");
            assert!(saved["observation"]["cause"].as_str().unwrap().len() > 3);
            assert_eq!(saved["firings"], json!([]));
        }
        // A failed refresh waits with its cause too.
        watcher
            .check_with(|_, _| async { Err(RpcError::internal("offline")) })
            .await;
        assert!(
            get(&client, &one).await["observation"]["cause"]
                .as_str()
                .unwrap()
                .contains("offline")
        );

        // Complete passing evidence for the pinned head fires the reaction once, and again for nobody.
        *feed.lock().unwrap() = passed("a");
        run(&watcher, &feed).await;
        run(&watcher, &feed).await;
        let fired = get(&client, &one).await;
        assert_eq!(fired["firings"].as_array().unwrap().len(), 1);
        let evidence: Value =
            serde_json::from_str(fired["firings"][0]["evidence"].as_str().unwrap()).unwrap();
        assert_eq!(evidence["head"], "a");
        // The firing's operation is the pinned head: a replay of it adds nothing.
        let replay = watcher
            .messages
            .fire_reaction(messages::reaction::Fire {
                reaction: one.clone(),
                operation: "pr-checks:a".into(),
                to: target.clone(),
                body: "ship it".into(),
                evidence: String::new(),
                matched: true,
            })
            .await
            .unwrap();
        assert_eq!(replay.0.id, fired["firings"][0]["id"]);
        assert_eq!(
            get(&client, &one).await["firings"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
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
}
