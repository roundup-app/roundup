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
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;

use clear_fixture::clear_fixture;
use doors::as_door;
use waiting::received;

/// One Clear with a Terminal, a dirty Worktree, a kept Todo blocked by an unkept one, a kept Pad of a
/// removed Subagent and an unkept Pad: each of A32's survivors and its archive is read after it.
#[tokio::test]
async fn a32_a_clear_archives_the_unkept_and_keeps_the_rest_where_it_was() {
    let (project, mut client, door) = clear_fixture("a32_archive", &[]).await;
    let db = rusqlite::Connection::open(project.data_dir().join("project.db")).unwrap();
    let scratch = pads::source(&db, "scratch").unwrap().unwrap();
    let model = project.model.as_ref().unwrap();
    let nodes = rail_tree(&client).await;
    let trees: Vec<_> = nodes
        .iter()
        .filter(|node| node.id != door)
        .map(|node| node.worktree.clone().expect("child has a Worktree"))
        .collect();
    assert_eq!(trees.len(), 2);
    std::fs::write(
        std::path::Path::new(&trees[1].path).join("dirty.txt"),
        "unlanded",
    )
    .unwrap();
    let grandchild = nodes
        .iter()
        .find(|node| node.parent.as_ref().is_some_and(|parent| parent != &door))
        .unwrap()
        .id
        .clone();
    as_door(&project, &grandchild)
        .await
        .request(
            "pad.create",
            json!({"name": "ledger", "text": "ledger text"}),
        )
        .await
        .unwrap();
    let opened = client
        .request("terminal.open", json!({"workstream": door}))
        .await
        .unwrap();
    let terminal = opened["terminal_id"]
        .as_str()
        .expect("the opened Terminal")
        .to_owned();
    let door_before = nodes.iter().find(|node| node.id == door).unwrap().clone();
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
    client
        .request(
            "todo.setBlockers",
            json!({"id": keep, "blockers": [fluff_id]}),
        )
        .await
        .unwrap();
    let kept_before = client
        .request("todo.list", Value::Null)
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|todo| todo["id"] == keep)
        .unwrap()
        .clone();
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
        // A33: the kept Todo is blocked until Clear archives its blocker.
        if working && status.status.kind == Kind::Blocked {
            break;
        }
    }
    // Peer digests start turns of their own, so the Clear prompt's turn may end after the first idle.
    received(model, "archive unkept items").await;
    // The restarted Door can emit Working before workstream.cleared (clear::apply).
    // Keep those statuses while the other subscription waits for the clear result.
    let mut restarted = project.subscribed().await;
    as_door(&project, &door)
        .await
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Kept items survived", "keep_todos": [keep], "keep_pads": ["notes", "ledger"]}),
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
    // The Door and its Terminals stay.
    let tree = rail_tree(&client).await;
    let door_after = tree.iter().find(|node| node.id == door).unwrap();
    assert_eq!(
        (&door_after.name, &door_after.parent, door_after.order),
        (&door_before.name, &door_before.parent, door_before.order)
    );
    let terminals = client.request("terminal.list", Value::Null).await.unwrap();
    let kept = terminals
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == terminal)
        .expect("the Terminal stays");
    assert_eq!(kept["running"], true);
    // Worktrees and branches stay, dirty or not, and the Handoff names them.
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
    let handoff = model
        .journal()
        .iter()
        .filter(|entry| entry["body"]["tools"].is_array())
        .flat_map(|entry| entry["body"]["messages"].as_array().into_iter().flatten())
        .filter(|message| message["role"] == "user")
        .filter_map(|message| message["content"].as_str())
        .find(|text| text.contains("Kept items survived"))
        .map(str::to_owned)
        .expect("the real Door receives the Handoff");
    for tree in &trees {
        assert!(
            handoff.contains(&tree.path) && handoff.contains(&tree.branch),
            "{handoff}"
        );
    }
    // The kept Todo keeps its identity and loses its archived blocker; the unkept Todo is gone.
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    let todos = todos.as_array().unwrap();
    assert_eq!(
        todos
            .iter()
            .map(|todo| todo["id"].clone())
            .collect::<Vec<_>>(),
        std::slice::from_ref(&keep)
    );
    assert_eq!(
        todos[0]["blockers"],
        json!([]),
        "an archived blocker leaves the list"
    );
    assert_eq!(
        (&todos[0]["title"], &todos[0]["creator"], &todos[0]["home"]),
        (
            &kept_before["title"],
            &kept_before["creator"],
            &kept_before["home"]
        )
    );
    // The unkept Pad and Todo are in the archive, not lost; a kept Pad of a removed Subagent is the user's.
    let pads_list = client.request("pad.list", Value::Null).await.unwrap();
    let pads_list = pads_list.as_array().unwrap();
    assert_eq!(pads_list.len(), 3);
    let archive = pads_list
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
    let ledger = pads_list
        .iter()
        .find(|pad| pad["name"] == "ledger")
        .unwrap();
    assert_eq!(
        ledger["owner"]["kind"], "user",
        "a Pad of a removed Subagent becomes the user's"
    );
    assert_eq!(ledger["home"], json!(door));
    model.assert_matched();
}
