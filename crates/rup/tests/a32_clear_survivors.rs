//! A32: what a Clear keeps, archives or loses.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};
use daemon::{next, rail_tree};
use serde_json::{Value, json};

#[path = "common/clear_fixture.rs"]
#[allow(dead_code)]
mod clear_fixture;

use clear_fixture::clear_fixture;

#[tokio::test]
async fn a32_the_workstream_and_its_terminals_survive() {
    let (project, mut client, door) = clear_fixture("a32_terminals", &[]).await;
    let model = project.model.as_ref().unwrap();
    let opened = client
        .request("terminal.open", json!({"workstream": door}))
        .await
        .unwrap();
    let terminal = opened["terminal_id"]
        .as_str()
        .expect("the opened Terminal")
        .to_owned();
    let before = rail_tree(&client)
        .await
        .into_iter()
        .find(|node| node.id == door)
        .unwrap();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "preserve the terminals"})
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door => Some(status),
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    // Peer digests start turns of their own, so the Clear prompt's turn may end after the first idle.
    daemon::h21_poll("Clear to reach real Claude", async || {
        (model.journal().iter().any(|entry| {
            entry["body"]["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
                && entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| {
                        messages.iter().any(|message| {
                            message["role"] == "user"
                                && message["content"].as_str().is_some_and(|text| {
                                    text.contains("preserve the terminals")
                                        && text.contains("workstream_handoff")
                                })
                        })
                    })
        }))
        .then_some(())
    })
    .await;
    let actor = project.client().await;
    actor
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: door.clone(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    actor
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Terminals survived", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.attempt == "2" => {
                Some(status)
            }
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"].as_str().is_some_and(
                            |text| text.contains("Follow this instruction: Terminals survived")
                        ))
                )),
        "the real Door must receive the valid Handoff: {:#?}",
        model.journal()
    );
    let tree = rail_tree(&client).await;
    let after = tree.iter().find(|node| node.id == door).unwrap();
    assert_eq!(
        (&after.name, &after.parent, after.order),
        (&before.name, &before.parent, before.order)
    );
    let terminals = client.request("terminal.list", Value::Null).await.unwrap();
    let kept = terminals
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == terminal)
        .expect("the Terminal stays");
    assert_eq!(kept["running"], true);
    assert!(project.dir.path().join("README").is_file());
    model.assert_matched();
}

#[tokio::test]
async fn a32_worktrees_and_branches_survive_even_dirty() {
    let (project, mut client, door) = clear_fixture("a32_worktrees", &[]).await;
    let model = project.model.as_ref().unwrap();
    let trees: Vec<_> = rail_tree(&client)
        .await
        .into_iter()
        .filter(|node| node.id != door)
        .map(|node| node.worktree.expect("child has a Worktree"))
        .collect();
    assert_eq!(trees.len(), 2);
    std::fs::write(
        std::path::Path::new(&trees[1].path).join("dirty.txt"),
        "unlanded",
    )
    .unwrap();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "preserve dirty worktrees"})
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door => Some(status),
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    // Peer digests start turns of their own, so the Clear prompt's turn may end after the first idle.
    daemon::h21_poll("Clear to reach real Claude", async || {
        (model.journal().iter().any(|entry| {
            entry["body"]["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
                && entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| {
                        messages.iter().any(|message| {
                            message["role"] == "user"
                                && message["content"].as_str().is_some_and(|text| {
                                    text.contains("preserve dirty worktrees")
                                        && text.contains("workstream_handoff")
                                })
                        })
                    })
        }))
        .then_some(())
    })
    .await;
    let actor = project.client().await;
    actor
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: door.clone(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    actor
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Worktrees survived", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.attempt == "2" => {
                Some(status)
            }
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    let branches = std::process::Command::new("git")
        .current_dir(project.dir.path())
        .args(["branch", "--list"])
        .output()
        .unwrap();
    assert!(branches.status.success());
    let branches = String::from_utf8(branches.stdout).unwrap();
    for tree in &trees {
        assert!(
            std::path::Path::new(&tree.path).is_dir(),
            "{} was removed",
            tree.path
        );
        assert!(branches.contains(&tree.branch), "{branches}");
    }
    assert!(
        std::path::Path::new(&trees[1].path)
            .join("dirty.txt")
            .is_file()
    );
    let journal = model.journal();
    let handoff = journal
        .iter()
        .filter(|entry| entry["body"]["tools"].is_array())
        .flat_map(|entry| entry["body"]["messages"].as_array().into_iter().flatten())
        .filter(|message| message["role"] == "user")
        .filter_map(|message| message["content"].as_str())
        .find(|text| text.contains("Follow this instruction: Worktrees survived"))
        .expect("the real Door receives the Handoff");
    for tree in &trees {
        assert!(
            handoff.contains(&tree.path) && handoff.contains(&tree.branch),
            "{handoff}"
        );
    }
    model.assert_matched();
}

#[tokio::test]
async fn a32_unkept_todos_and_pads_are_archived_not_lost() {
    let (project, mut client, door) = clear_fixture("a32_archive", &[]).await;
    let db = rusqlite::Connection::open(project.data_dir().join("project.db")).unwrap();
    let scratch = pads::source(&db, "scratch").unwrap().unwrap();
    let model = project.model.as_ref().unwrap();
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let todos = todos.as_array().unwrap();
    let keep = todos
        .iter()
        .find(|todo| todo["title"] == "build the login page")
        .unwrap()["id"]
        .clone();
    let fluff = todos
        .iter()
        .find(|todo| todo["title"] == "refactor everything")
        .unwrap();
    let fluff_id = fluff["id"].clone();
    let owner = fluff["creator"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "archive unkept items"})
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door => Some(status),
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    // Peer digests start turns of their own, so the Clear prompt's turn may end after the first idle.
    daemon::h21_poll("Clear to reach real Claude", async || {
        (model.journal().iter().any(|entry| {
            entry["body"]["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
                && entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| {
                        messages.iter().any(|message| {
                            message["role"] == "user"
                                && message["content"].as_str().is_some_and(|text| {
                                    text.contains("archive unkept items")
                                        && text.contains("workstream_handoff")
                                })
                        })
                    })
        }))
        .then_some(())
    })
    .await;
    let actor = project.client().await;
    actor
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: door.clone(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    // The restarted Door can emit Working before workstream.cleared (clear::apply).
    // Keep those statuses while the other subscription waits for the clear result.
    let mut restarted = project.subscribed().await;
    actor
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Kept items survived", "keep_todos": [keep], "keep_pads": ["notes"]}),
        )
        .await
        .unwrap();
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    let mut working = false;
    loop {
        let status = next(&mut restarted, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.attempt == "2" => {
                Some(status)
            }
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"]
                            .as_str()
                            .is_some_and(|text| text
                                .contains("Follow this instruction: Kept items survived")))
                )),
        "the real Door must receive the valid Handoff: {:#?}",
        model.journal()
    );
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    assert_eq!(
        todos
            .as_array()
            .unwrap()
            .iter()
            .map(|todo| todo["id"].clone())
            .collect::<Vec<_>>(),
        [keep]
    );
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    let pads = pads.as_array().unwrap();
    assert_eq!(pads.len(), 2);
    let archive = pads
        .iter()
        .find(|pad| pad["name"] == "archive-1")
        .expect("the archive Pad");
    assert_eq!(archive["owner"]["kind"], "user");
    let text = archive["text"].as_str().unwrap();
    assert!(
        text.contains(&format!(
            "## refactor everything (todo {fluff_id}, owner {owner})"
        )),
        "{text}"
    );
    assert!(text.contains("refactor everything body"), "{text}");
    assert!(text.contains("## scratch (pad, owner "), "{text}");
    assert!(text.contains("scratch text"), "{text}");
    assert!(!text.contains("build the login page"), "{text}");
    assert_eq!(
        pads::source_state(&db, scratch.incarnation).unwrap(),
        pads::PadSourceState::Deleted(pads::PadDeletion::Cleanup)
    );
    model.assert_matched();
}

#[tokio::test]
async fn a32_kept_items_keep_their_ids_and_owners() {
    let (project, mut client, door) = clear_fixture("a32_kept_items", &[]).await;
    let model = project.model.as_ref().unwrap();
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let todos = todos.as_array().unwrap();
    let keep = todos
        .iter()
        .find(|todo| todo["title"] == "build the login page")
        .unwrap()["id"]
        .clone();
    let fluff = todos
        .iter()
        .find(|todo| todo["title"] == "refactor everything")
        .unwrap();
    let fluff_id = fluff["id"].clone();
    client
        .request(
            "todo.setBlockers",
            json!({"id": keep, "blockers": [fluff_id]}),
        )
        .await
        .unwrap();
    let before = client.request("todo.list", Value::Null).await.unwrap();
    let before = before
        .as_array()
        .unwrap()
        .iter()
        .find(|todo| todo["id"] == keep)
        .unwrap();
    assert_eq!(
        client
            .request(
                "workstream.clear",
                json!({"id": door, "reason": "preserve kept items"})
            )
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door => Some(status),
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        // A33: the kept Todo is blocked until Clear archives its blocker.
        if working && status.status.kind == Kind::Blocked {
            break;
        }
    }
    // Peer digests start turns of their own, so the Clear prompt's turn may end after the first idle.
    daemon::h21_poll("Clear to reach real Claude", async || {
        (model.journal().iter().any(|entry| {
            entry["body"]["tools"]
                .as_array()
                .is_some_and(|tools| !tools.is_empty())
                && entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| {
                        messages.iter().any(|message| {
                            message["role"] == "user"
                                && message["content"].as_str().is_some_and(|text| {
                                    text.contains("preserve kept items")
                                        && text.contains("workstream_handoff")
                                })
                        })
                    })
        }))
        .then_some(())
    })
    .await;
    let actor = project.client().await;
    actor
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: door.clone(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    actor
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Kept items survived", "keep_todos": [keep], "keep_pads": ["scratch"]}),
        )
        .await
        .unwrap();
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    let mut working = false;
    loop {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.attempt == "2" => {
                Some(status)
            }
            _ => None,
        })
        .await;
        working |= status.status.kind == Kind::Working;
        if working && status.status.kind == Kind::Idle {
            break;
        }
    }
    assert!(
        model.journal().iter().any(|entry| entry["body"]["tools"]
            .as_array()
            .is_some_and(|tools| !tools.is_empty())
            && entry["body"]["messages"]
                .as_array()
                .is_some_and(
                    |messages| messages.iter().any(|message| message["role"] == "user"
                        && message["content"]
                            .as_str()
                            .is_some_and(|text| text
                                .contains("Follow this instruction: Kept items survived")))
                )),
        "the real Door must receive the valid Handoff: {:#?}",
        model.journal()
    );
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let after = todos
        .as_array()
        .unwrap()
        .iter()
        .find(|todo| todo["id"] == keep)
        .unwrap();
    assert_eq!(
        after["blockers"],
        json!([]),
        "an archived blocker leaves the list"
    );
    assert_eq!(
        (&after["title"], &after["creator"], &after["home"]),
        (&before["title"], &before["creator"], &before["home"])
    );
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    let scratch = pads
        .as_array()
        .unwrap()
        .iter()
        .find(|pad| pad["name"] == "scratch")
        .unwrap();
    assert_eq!(
        scratch["owner"]["kind"], "user",
        "a Pad of a removed Subagent becomes the user's"
    );
    assert_eq!(scratch["home"], json!(door));
    model.assert_matched();
}
