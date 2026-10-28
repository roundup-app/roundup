use super::*;

#[tokio::test]
async fn u2875c_unpublished_resources_are_reconciled_at_every_durable_step() {
    // The first three node/source writes share a SQLite transaction (Rail test below).
    // These are every durable resource step after that transaction.
    for mode in 0..3 {
        for boundary in 0..14 {
            if mode == 0 && matches!(boundary, 1..=4 | 10 | 13) {
                continue;
            }
            let (dir, agents, existing) = fixture();
            if mode == 0 {
                agents
                    .shared
                    .rail()
                    .set_worktrees(&contracts::project::Worktrees {
                        on: false,
                        check: None,
                    })
                    .unwrap();
            }
            let prepared = if mode == 2 {
                Some(enroll(&agents, dir.path(), "true").await)
            } else {
                None
            };
            let (workstream, agent) = agents
                .shared
                .rail()
                .reserve_closed("interrupted", "hidden")
                .unwrap();
            let mut effective = dir.path().join("src");
            let mut provision = None;
            if mode != 0 && boundary >= 1 {
                let mut plan = agents.shared.git.plan(dir.path(), &agent).unwrap();
                if let Some(path) = &prepared {
                    plan.worktree.path = path.clone();
                }
                if mode == 2 {
                    assert!(
                        agents
                            .shared
                            .rail()
                            .reserve_prepared(&agent, &plan)
                            .unwrap()
                    );
                } else {
                    agents
                        .shared
                        .rail()
                        .mark_worktree_provisioning(&agent, &plan)
                        .unwrap();
                }
                if boundary == 2 {
                    git(
                        dir.path(),
                        &[
                            "update-ref",
                            &format!("refs/heads/{}", plan.worktree.branch),
                            &plan.commit,
                        ],
                    );
                    git(dir.path(), &["update-ref", &plan.owner, &plan.commit]);
                }
                if boundary >= 3 {
                    if mode == 2 {
                        agents
                            .shared
                            .git
                            .assign_prepared(dir.path(), &plan)
                            .unwrap();
                    } else {
                        agents.shared.git.provision(dir.path(), &plan).unwrap();
                    }
                    effective = plan.worktree.path.join("src");
                }
                if boundary >= 4 {
                    agents
                        .shared
                        .rail()
                        .set_worktree(
                            &agent,
                            &contracts::agent::Worktree {
                                path: plan.worktree.path.to_string_lossy().into_owned(),
                                branch: plan.worktree.branch.clone(),
                                base: plan.worktree.base.clone(),
                            },
                        )
                        .unwrap();
                }
                provision = Some(plan);
            }
            let mut retained = None;
            if boundary >= 5 {
                let (id, ownership) = agents
                    .launcher
                    .prepare_conversation(&effective, RETAINED)
                    .unwrap();
                agents
                    .shared
                    .rail()
                    .closed_copy("interrupted", &ownership)
                    .unwrap();
                if boundary >= 6 {
                    agents.launcher.write_conversation(&ownership).unwrap();
                }
                if boundary >= 8 {
                    agents
                        .shared
                        .rail()
                        .save_conversation(&agent, &id, &effective.to_string_lossy())
                        .unwrap();
                }
                if boundary == 6 {
                    agents.launcher.interrupt_copy_for_test(&ownership);
                }
                retained = Some((id, effective.clone(), ownership));
            }
            if boundary >= 9 {
                agents.shared.rail().publish_closed("interrupted").unwrap();
            }
            if boundary >= 9 {
                if let Some((id, cwd, _)) = &retained {
                    agents
                        .launcher
                        .replace_retained_for_test(
                            cwd,
                            id,
                            b"{\"type\":\"user\",\"message\":\"published user edit\"}\n",
                        )
                        .unwrap();
                }
                if let Some(plan) = &provision {
                    std::fs::write(
                        plan.worktree.path.join("user-file"),
                        "keep after publication",
                    )
                    .unwrap();
                }
            }
            if boundary >= 10
                && let Some(plan) = &provision
            {
                agents.shared.git.finish(dir.path(), plan).unwrap();
            }
            if boundary >= 11
                && let Some((_, _, ownership)) = &retained
            {
                agents.launcher.finish_conversation(ownership).unwrap();
            }
            if boundary >= 12 {
                agents
                    .shared
                    .rail()
                    .release_closed_copy("interrupted")
                    .unwrap();
            }
            if boundary >= 13 {
                agents
                    .shared
                    .rail()
                    .clear_provisioning_owner(&agent)
                    .unwrap();
            }
            let before = agents.shared.rail().tree().unwrap();
            assert_eq!(
                before.len(),
                if boundary < 9 { 1 } else { 3 },
                "mode {mode} boundary {boundary}"
            );
            if boundary < 9 {
                assert!(
                    agents
                        .provision_worktree(&existing, dir.path())
                        .await
                        .is_err()
                );
                assert!(
                    agents
                        .shared
                        .rail()
                        .reserve_closed("other source", "other")
                        .is_err()
                );
                assert!(agents.shared.node(&workstream).is_err());
                assert!(agents.shared.node(&agent).is_err());
                assert!(agents.shared.rail().has_conversation(&agent).is_err());
            }
            let agents = reopen(agents);
            let after = agents.shared.rail().tree().unwrap();
            assert_eq!(
                after.len(),
                if boundary < 9 { 1 } else { 3 },
                "mode {mode} boundary {boundary}"
            );
            assert_eq!(after[0].id, existing);
            if let Some((id, cwd, ownership)) = retained {
                assert_eq!(
                    agents.launcher.retained_copy_exists_for_test(&ownership),
                    boundary >= 9
                );
                assert!(!agents.launcher.copy_owner_exists_for_test(&ownership));
                if boundary >= 9 {
                    agents.launcher.assert_retained_for_test(
                        &cwd,
                        &id,
                        b"{\"type\":\"user\",\"message\":\"published user edit\"}\n",
                    );
                }
                assert_eq!(
                    agents.launcher.record_conversation(&cwd, &id).is_ok(),
                    boundary >= 9
                );
            }
            assert!(agents.shared.rail().provisioning().unwrap().is_empty());
            assert_eq!(
                git(dir.path(), &["for-each-ref", "refs/roundup/provisioning"]),
                ""
            );
            if boundary < 9 {
                assert_eq!(git(dir.path(), &["branch", "--list", "roundup/*"]), "");
                if let Some(plan) = provision {
                    assert_eq!(plan.worktree.path.exists(), mode == 2);
                }
                let result = agents
                    .prepare_closed(
                        "interrupted",
                        "retry",
                        &dir.path().join("src"),
                        RETAINED,
                        None,
                    )
                    .await
                    .unwrap();
                assert_ne!(result.1, agent);
            }
            if let Some(path) = prepared {
                assert_eq!(
                    std::fs::read_to_string(path.join(".cache/user-dependency")).unwrap(),
                    "keep"
                );
            }
        }
    }
}

#[tokio::test]
async fn u2875c_recovery_refusal_keeps_user_work_hidden_and_blocks_reuse() {
    for prepared in [false, true] {
        for changed in ["files", "ownership", "copy"] {
            let (dir, agents, existing) = fixture();
            if prepared {
                enroll(&agents, dir.path(), "true").await;
            }
            let (workstream, agent) = agents
                .shared
                .rail()
                .reserve_closed("unfinished", "hidden")
                .unwrap();
            let (_, made) = agents
                .provision_worktree(&agent, dir.path())
                .await
                .unwrap()
                .unwrap();
            let (id, ownership) = agents
                .launcher
                .prepare_conversation(&made.path, RETAINED)
                .unwrap();
            agents
                .shared
                .rail()
                .closed_copy("unfinished", &ownership)
                .unwrap();
            agents.launcher.write_conversation(&ownership).unwrap();
            match changed {
                "files" => std::fs::write(made.path.join("user-file"), "keep").unwrap(),
                "ownership" => {
                    let proof = agents
                        .shared
                        .rail()
                        .provisioning()
                        .unwrap()
                        .into_iter()
                        .find(|(node, _, _)| node.id == agent)
                        .unwrap()
                        .1
                        .unwrap();
                    git(dir.path(), &["update-ref", "-d", &proof.owner]);
                }
                "copy" => agents
                    .launcher
                    .replace_retained_for_test(&made.path, &id, b"changed by user")
                    .unwrap(),
                _ => unreachable!(),
            }
            let agents = reopen(agents);
            assert!(agents.shared.node(&workstream).is_err());
            assert!(agents.shared.node(&agent).is_err());
            assert_eq!(agents.shared.rail().tree().unwrap().len(), 1);
            let error = agents
                .prepare_closed("another", "another", dir.path(), RETAINED, None)
                .await
                .unwrap_err();
            assert!(error.message.contains("recovery refused"));
            assert!(
                agents
                    .provision_worktree(&existing, dir.path())
                    .await
                    .unwrap_err()
                    .message
                    .contains("recovery refused")
            );
            assert!(made.path.exists());
            if changed == "files" {
                assert_eq!(
                    std::fs::read_to_string(made.path.join("user-file")).unwrap(),
                    "keep"
                );
            }
            if changed == "copy" {
                assert!(
                    agents
                        .launcher
                        .record_conversation(&made.path, &id)
                        .unwrap_err()
                        .message
                        .contains("complete records")
                );
                // The file remains with its exact changed bytes, as the Adapter observer asserts.
                agents
                    .launcher
                    .assert_retained_for_test(&made.path, &id, b"changed by user");
            }
            if prepared {
                assert_eq!(
                    agents
                        .shared
                        .rail()
                        .worktree_owner_of(made.path.to_str().unwrap())
                        .unwrap(),
                    Some(agent)
                );
            }
        }
    }
}
