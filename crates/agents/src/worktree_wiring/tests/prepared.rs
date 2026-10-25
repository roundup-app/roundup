use super::*;

#[tokio::test]
async fn u2875b_closed_prepared_assignment_is_exclusive_without_launch() {
    let (dir, agents, id) = fixture();
    let path = enroll(&agents, dir.path(), "test -f src/file").await;
    let (cwd, made) = agents
        .provision_worktree(&id, &dir.path().join("src"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(made.path, path);
    assert_eq!(cwd, path.join("src"));
    let other = agents
        .shared
        .rail()
        .insert(NodeKind::Agent, "other", None, None)
        .unwrap();
    let error = agents
        .provision_worktree(&other.id, dir.path())
        .await
        .unwrap_err();
    assert!(error.message.starts_with("no_prepared_directory"));
    assert_eq!(
        agents
            .shared
            .rail()
            .worktree_owner_of(path.to_str().unwrap())
            .unwrap(),
        Some(id.clone())
    );
    let node = agents.shared.node(&id).unwrap();
    assert!(node.attempt.is_none());
    assert!(node.terminal_id.is_none());
    assert!(node.status_revision.is_none());
    assert!(agents.shared.terminals.list().is_empty());
    assert!(agents.shared.runs().is_empty());
    assert_eq!(
        std::fs::read_to_string(dir.path().join("src/file")).unwrap(),
        "base"
    );
}

#[tokio::test]
async fn u2875c_retained_closed_worktree_survives_each_commit_boundary() {
    for prepared in [false, true] {
        // Ready persisted, ownership ref released, ownership record released.
        for boundary in 0..3 {
            let (dir, agents, id) = fixture();
            if prepared {
                enroll(&agents, dir.path(), "true").await;
            }
            let (_, made) = agents
                .provision_worktree(&id, dir.path())
                .await
                .unwrap()
                .unwrap();
            let plan = agents
                .shared
                .rail()
                .provisioning()
                .unwrap()
                .pop()
                .unwrap()
                .1
                .unwrap();
            if boundary == 2 {
                agents.retain_worktree(&id).await.unwrap();
            } else {
                agents
                    .shared
                    .rail()
                    .set_worktree(
                        &id,
                        &contracts::agent::Worktree {
                            path: made.path.to_string_lossy().into_owned(),
                            branch: made.branch.clone(),
                            base: made.base.clone(),
                        },
                    )
                    .unwrap();
                if boundary == 1 {
                    agents.shared.git.finish(dir.path(), &plan).unwrap();
                }
            }
            std::fs::write(made.path.join("user-work"), "retained").unwrap();
            let agents = reopen(agents);
            let node = agents.shared.node(&id).unwrap();
            assert_eq!(node.worktree.unwrap().path, made.path.to_string_lossy());
            assert!(node.attempt.is_none());
            assert!(node.terminal_id.is_none());
            assert!(agents.shared.terminals.list().is_empty());
            assert_eq!(
                std::fs::read_to_string(made.path.join("user-work")).unwrap(),
                "retained"
            );
            assert!(agents.shared.rail().provisioning().unwrap().is_empty());
            assert_eq!(
                git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                ""
            );
        }
    }
}

#[tokio::test]
async fn u2875c_interrupted_closed_provisioning_releases_owned_resources_before_reuse() {
    for prepared in [false, true] {
        for boundary in 0..3 {
            let (dir, agents, id) = fixture();
            let path = if prepared {
                Some(enroll(&agents, dir.path(), "true").await)
            } else {
                None
            };
            let mut plan = agents.shared.git.plan(dir.path(), &id).unwrap();
            if let Some(path) = &path {
                plan.worktree.path = path.clone();
            }
            if prepared {
                assert!(agents.shared.rail().reserve_prepared(&id, &plan).unwrap());
            } else {
                agents
                    .shared
                    .rail()
                    .mark_worktree_provisioning(&id, &plan)
                    .unwrap();
            }
            if boundary == 1 {
                git(
                    dir.path(),
                    &[
                        "update-ref",
                        &format!("refs/heads/{}", plan.worktree.branch),
                        &plan.commit,
                    ],
                );
                git(dir.path(), &["update-ref", &plan.owner, &plan.commit]);
            } else if boundary == 2 {
                if prepared {
                    agents
                        .shared
                        .git
                        .assign_prepared(dir.path(), &plan)
                        .unwrap();
                } else {
                    agents.shared.git.provision(dir.path(), &plan).unwrap();
                }
            }
            if boundary == 2 {
                // Readiness completed, but the source has not committed retention.
                assert!(plan.worktree.path.join("src/file").is_file());
            }
            let agents = reopen(agents);
            assert!(agents.shared.rail().provisioning().unwrap().is_empty());
            assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
            assert_eq!(
                git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                ""
            );
            assert_eq!(plan.worktree.path.exists(), prepared);
            if prepared {
                assert_eq!(
                    std::fs::read_to_string(plan.worktree.path.join(".cache/user-dependency"))
                        .unwrap(),
                    "keep"
                );
            }
            let retry = agents
                .shared
                .rail()
                .insert(NodeKind::Agent, "retry", None, None)
                .unwrap();
            let (_, made) = agents
                .provision_worktree(&retry.id, dir.path())
                .await
                .unwrap()
                .unwrap();
            if let Some(path) = path {
                assert_eq!(made.path, path);
            }
            assert!(agents.shared.node(&retry.id).unwrap().attempt.is_none());
        }
    }
}

#[tokio::test]
async fn u2875b_missing_mapped_directory_refuses_closed_provisioning() {
    for prepared in [false, true] {
        let (dir, agents, id) = fixture();
        let path = if prepared {
            Some(enroll(&agents, dir.path(), "true").await)
        } else {
            None
        };
        std::fs::create_dir(dir.path().join("not-in-base")).unwrap();
        let error = agents
            .provision_worktree(&id, &dir.path().join("not-in-base"))
            .await
            .unwrap_err();
        assert!(error.message.starts_with("cwd_not_in_worktree"));
        assert!(agents.shared.node(&id).unwrap().worktree.is_none());
        assert!(agents.shared.node(&id).unwrap().attempt.is_none());
        assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
        assert_eq!(
            git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
            ""
        );
        if let Some(path) = path {
            assert!(path.is_dir());
        }
    }
}

#[tokio::test]
async fn u2875b_failed_readiness_releases_closed_assignment_and_requires_preparation() {
    let (dir, agents, id) = fixture();
    let path = enroll(&agents, dir.path(), "echo unavailable; exit 1").await;
    let error = agents
        .provision_worktree(&id, dir.path())
        .await
        .unwrap_err();
    assert!(error.message.contains("phase=readiness"));
    assert!(agents.shared.node(&id).unwrap().worktree.is_none());
    assert!(agents.shared.node(&id).unwrap().attempt.is_none());
    assert!(
        agents
            .shared
            .rail()
            .prepared_unavailable(path.to_str().unwrap())
            .unwrap()
            .is_some()
    );
    assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
    assert_eq!(
        git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
        ""
    );
    assert!(
        agents
            .provision_worktree(&id, dir.path())
            .await
            .unwrap_err()
            .message
            .contains("unavailable")
    );
    assert!(agents.shared.terminals.list().is_empty());
}

#[tokio::test]
async fn u2875c_prepared_recovery_preserves_user_files_and_changed_ownership() {
    for changed_owner in [false, true] {
        let (dir, agents, id) = fixture();
        let path = enroll(&agents, dir.path(), "true").await;
        agents.provision_worktree(&id, dir.path()).await.unwrap();
        if changed_owner {
            git(dir.path(), &["commit", "--allow-empty", "-m", "new base"]);
            let plan = agents
                .shared
                .rail()
                .provisioning()
                .unwrap()
                .pop()
                .unwrap()
                .1
                .unwrap();
            git(dir.path(), &["update-ref", &plan.owner, "HEAD"]);
        } else {
            std::fs::write(path.join("user-work"), "keep me").unwrap();
        }
        let agents = reopen(agents);
        assert_eq!(
            agents
                .shared
                .rail()
                .worktree_owner_of(path.to_str().unwrap())
                .unwrap(),
            Some(id.clone())
        );
        assert!(agents.shared.node(&id).unwrap().attempt.is_none());
        if !changed_owner {
            assert_eq!(
                std::fs::read_to_string(path.join("user-work")).unwrap(),
                "keep me"
            );
        }
        let other = agents
            .shared
            .rail()
            .insert(NodeKind::Agent, "other", None, None)
            .unwrap();
        assert!(
            agents
                .provision_worktree(&other.id, dir.path())
                .await
                .unwrap_err()
                .message
                .starts_with("no_prepared_directory")
        );
    }
}

#[tokio::test]
async fn u2875b_first_explicit_resume_launches_attempt_one_in_retained_cwd() {
    use rpc::Module;
    use serde_json::json;
    use std::os::unix::fs::PermissionsExt;
    for prepared in [false, true] {
        let (dir, mut agents, id) = fixture();
        if prepared {
            enroll(&agents, dir.path(), "true").await;
        }
        let bin = dir.path().join("fake-claude");
        std::fs::write(&bin, "#!/bin/sh\nif [ \"$1\" = plugin ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nprintf '%s\\n' \"$@\" > launch-argv\npwd > launch-cwd\nexec sleep 30\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(dir.path().join("rup"), "").unwrap();
        agents.launcher = Launcher::new(
            bin.to_string_lossy(),
            dir.path().join("claude.json"),
            dir.path().join("rup"),
            None,
        );
        let (cwd, made) = agents
            .provision_worktree(&id, &dir.path().join("src"))
            .await
            .unwrap()
            .unwrap();
        agents.retain_worktree(&id).await.unwrap();
        let conversation = "11111111-1111-1111-1111-111111111111";
        agents
            .shared
            .rail()
            .save_conversation(&id, conversation, cwd.to_str().unwrap())
            .unwrap();
        let agents = Arc::new(reopen(agents));
        assert!(agents.shared.terminals.list().is_empty());
        assert!(agents.shared.node(&id).unwrap().attempt.is_none());
        let ctx = rpc::Ctx {
            actor: contracts::Actor::user(),
            bus: Bus::new(),
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
        };
        let mut resuming = {
            let agents = Arc::clone(&agents);
            let ctx = rpc::Ctx {
                actor: ctx.actor.clone(),
                bus: ctx.bus.clone(),
                touches: Arc::clone(&ctx.touches),
            };
            let id = id.clone();
            tokio::spawn(async move { agents.call(&ctx, "agent.resume", json!({"id": id})).await })
        };
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let ready = matches!(
                    agents.shared.runs().get(&id),
                    Some(Slot::Resuming {
                        terminal_id: Some(_),
                        ..
                    })
                );
                if ready {
                    break;
                }
                if resuming.is_finished() {
                    panic!(
                        "resume ended before its launch was claimed: {:?}",
                        (&mut resuming).await
                    );
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        agents.call(&ctx, "agent.signal", json!({"id":id,"attempt":"1","payload":{"hook_event_name":"SessionStart","session_id":conversation,"source":"resume"}})).await.unwrap();
        let node: contracts::agent::RailNode =
            serde_json::from_value(resuming.await.unwrap().unwrap()).unwrap();
        assert_eq!(node.attempt.as_deref(), Some("1"));
        assert!(node.terminal_id.is_some());
        assert_eq!(node.worktree.unwrap().path, made.path.to_string_lossy());
        tokio::time::timeout(Duration::from_secs(10), async {
            while !cwd.join("launch-cwd").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let argv = std::fs::read_to_string(cwd.join("launch-argv")).unwrap();
        assert!(argv.contains(&format!("--resume\n{conversation}")));
        assert_eq!(
            std::fs::read_to_string(cwd.join("launch-cwd"))
                .unwrap()
                .trim(),
            cwd.to_str().unwrap()
        );
        agents
            .call(&ctx, "agent.stop", json!({"id":id}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn u2875c_stale_provisioning_cannot_reclaim_a_new_reservation() {
    for prepared in [false, true] {
        let (dir, agents, id) = fixture();
        if prepared {
            enroll(&agents, dir.path(), "true").await;
        }
        let (_, made) = agents
            .provision_worktree(&id, dir.path())
            .await
            .unwrap()
            .unwrap();
        let stale = agents
            .shared
            .rail()
            .provisioning()
            .unwrap()
            .pop()
            .unwrap()
            .1
            .unwrap();
        agents.discard_worktree(&id, made).await;
        let (_, made) = agents
            .provision_worktree(&id, dir.path())
            .await
            .unwrap()
            .unwrap();
        assert!(agents.shared.git.recover(dir.path(), &stale).is_err());
        assert!(made.path.is_dir());
        assert_eq!(git(&made.path, &["branch", "--show-current"]), made.branch);
        let agents = reopen(agents);
        assert!(agents.shared.rail().provisioning().unwrap().is_empty());
        assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
    }
}
