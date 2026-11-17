//! LK1 to LK6 (`scenarios/rup-ext.md`): `link.read` on the real `rupd`, the way `rup link read` calls it.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use std::process::Stdio;
use std::time::Duration;

use contracts::{Actor, ActorKind, IdentifyParams};
use rpc::{Client, code};
use serde_json::{Value, json};

async fn key(client: &Client) -> String {
    let ping = client.request("daemon.ping", Value::Null).await.unwrap();
    ping["projectKey"].as_str().unwrap().to_owned()
}

fn link(kind: &str, id: &str, key: &str) -> String {
    format!("roundup://{kind}/{id}?project={key}")
}

async fn read(client: &Client, url: &str) -> Result<Value, rpc::RpcError> {
    client.request("link.read", json!({ "url": url })).await
}

async fn screen_with(client: &Client, id: &str, text: &str) -> Value {
    for _ in 0..200 {
        let screen = client
            .request("terminal.screen", json!({ "id": id }))
            .await
            .unwrap();
        // The echoed input also holds `text`; the output line is the one equal to it,
        // and the prompt after it means the screen has stopped changing.
        let lines = screen["lines"].as_array().unwrap();
        if lines
            .iter()
            .position(|l| l == text)
            .is_some_and(|at| at + 1 < lines.len())
        {
            return screen;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the Terminal never showed {text}");
}

async fn rail(client: &Client) -> Vec<Value> {
    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    tree.as_array().unwrap().clone()
}

#[tokio::test]
async fn lk1_a_malformed_link_is_invalid_params_naming_the_part() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    for (url, part) in [
        (format!("https://pad/notes?project={key}"), "scheme"),
        (format!("roundup://note/notes?project={key}"), "kind"),
        ("roundup://pad/notes".to_owned(), "project"),
        (
            format!("roundup://pad/notes?project={key}&project={key}"),
            "twice",
        ),
        (format!("roundup://todo/one?project={key}"), "whole number"),
        (
            format!("roundup://pad/notes/more?project={key}"),
            "extra segment",
        ),
        (format!("roundup://pad/notes?project={key}&x=1"), "`x`"),
        (format!("roundup://pad/?project={key}"), "id"),
    ] {
        let err = read(&client, &url).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{url}");
        assert!(err.message.contains(part), "{url}: {}", err.message);
    }
}

#[tokio::test]
async fn pl1_link_read_of_a_shelf_link_is_invalid_params() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    let err = read(&client, &format!("roundup://shelf/pads?project={key}"))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("`shelf`"), "{}", err.message);
}

#[tokio::test]
async fn pl2_link_read_of_a_settings_link_is_invalid_params() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    let err = read(
        &client,
        &format!("roundup://settings/agents?project={key}#model"),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("`settings`"), "{}", err.message);
}

#[tokio::test]
async fn lk1_a_link_for_another_project_is_not_found_and_never_resolved_here() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    client
        .request("pad.create", json!({"name": "notes", "text": "here"}))
        .await
        .unwrap();
    let own = key(&client).await;
    // The App's own connection keeps this answer (LK6); it registers as the App does.
    let mut app = project.client().await;
    app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    assert!(own.starts_with(&format!(
        "{}-",
        project.dir.path().canonicalize().unwrap().file_name().unwrap().to_string_lossy()
    )));

    let err = read(&client, &link("pad", "notes", "other-0123456789abcdef"))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
    assert!(err.message.contains("another Project"), "{}", err.message);
    assert_eq!(err.data, Some(contracts::RpcErrorData::OtherProject));
    assert!(
        err.message.contains("other-0123456789abcdef"),
        "{}",
        err.message
    );
    assert!(read(&client, &link("pad", "notes", &own)).await.is_ok());

    // A publication checks its own stored Project, and still marks the answer as another Project's.
    let err = read(
        &client,
        &link("deliverable", "d1", "other-0123456789abcdef"),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert_eq!(err.data, Some(contracts::RpcErrorData::OtherProject));
}

#[tokio::test]
async fn lk2_each_kind_reads_what_its_own_method_reads() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    client
        .request("pad.create", json!({"name": "my notes", "text": "hello"}))
        .await
        .unwrap();
    let todo = client
        .request("todo.create", json!({"title": "Fix login"}))
        .await
        .unwrap();
    let agent = project.spawn_agent(&client).await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "ws", "parent": null}),
        )
        .await
        .unwrap();
    let ws = workstream["id"].as_str().unwrap();
    let opened = client.request("terminal.open", json!({})).await.unwrap();
    let terminal = opened["terminal_id"].as_str().unwrap();
    client
        .request(
            "terminal.write",
            json!({"id": terminal, "data": "ZWNobyBsazIK"}), // `echo lk2\n`
        )
        .await
        .unwrap();
    let screen = screen_with(&client, terminal, "lk2").await;

    let pad = read(&client, &link("pad", "my%20notes", &key))
        .await
        .unwrap();
    assert_eq!(pad["kind"], "pad");
    assert_eq!(pad["id"], "my notes");
    assert_eq!(
        pad["pad"],
        client
            .request("pad.read", json!({"name": "my notes"}))
            .await
            .unwrap()
    );

    let found = read(&client, &link("todo", &todo["id"].to_string(), &key))
        .await
        .unwrap();
    assert_eq!(
        found["todo"],
        client
            .request("todo.get", json!({"id": todo["id"]}))
            .await
            .unwrap()
    );

    let found = read(&client, &link("agent", &agent.id, &key))
        .await
        .unwrap();
    let row = rail(&client)
        .await
        .into_iter()
        .find(|n| n["id"] == agent.id)
        .unwrap();
    assert_eq!((&found["kind"], &found["node"]), (&json!("agent"), &row));
    assert_eq!(found["digest"], Value::Null);

    let found = read(&client, &link("workstream", ws, &key)).await.unwrap();
    let row = rail(&client)
        .await
        .into_iter()
        .find(|n| n["id"] == ws)
        .unwrap();
    assert_eq!(
        (&found["kind"], &found["node"]),
        (&json!("workstream"), &row)
    );
    assert_eq!(found["children"], json!([]));

    let found = read(&client, &link("terminal", terminal, &key))
        .await
        .unwrap();
    assert_eq!(found["kind"], "terminal");
    assert_eq!(found["screen"]["lines"], screen["lines"]);

    let rup = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args([
            "link",
            "read",
            &link("pad", "my%20notes", &key),
            "--agent",
            &agent.id,
        ])
        .env("RUPD_SOCKET", project.socket())
        .stdin(Stdio::null())
        .output()
        .await
        .unwrap();
    assert_eq!(
        rup.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&rup.stderr)
    );
    assert!(String::from_utf8_lossy(&rup.stdout).contains("hello"));
}

#[tokio::test]
async fn lk2_a_pad_edit_between_two_reads_shows_in_the_second() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let url = link("pad", "notes", &key(&client).await);
    client
        .request("pad.create", json!({"name": "notes", "text": "one"}))
        .await
        .unwrap();
    let first = read(&client, &url).await.unwrap();

    client
        .request("pad.append", json!({"name": "notes", "text": "\ntwo"}))
        .await
        .unwrap();
    let second = read(&client, &url).await.unwrap();

    assert_eq!(first["pad"]["text"], "one");
    assert_eq!(second["pad"]["text"], "one\ntwo");
    assert!(second["pad"]["revision"].as_u64() > first["pad"]["revision"].as_u64());
}

#[tokio::test]
async fn lk2_an_unknown_object_is_not_found() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    for (kind, id) in [
        ("pad", "ghost"),
        ("todo", "999"),
        ("agent", "ghost"),
        ("workstream", "ghost"),
        ("terminal", "ghost"),
    ] {
        let err = read(&client, &link(kind, id, &key)).await.unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND, "{kind}");
        assert!(
            err.message.contains(kind) && err.message.contains(id),
            "{kind}: {}",
            err.message
        );
    }
}

#[tokio::test]
async fn lk2_link_read_gives_no_caller_more_than_the_method_it_composes() {
    let project = daemon::start(&[]);
    let user = project.client().await;
    let key = key(&user).await;
    let agent = project.spawn_agent(&user).await;
    let ext = project.client().await;
    ext.request(
        "daemon.identify",
        IdentifyParams {
            actor: Actor {
                kind: ActorKind::Ext,
                id: "ext:claude-code".into(),
                parent: None,
            },
        },
    )
    .await
    .unwrap();
    let before = user
        .request("provenance.touched", json!({"actor_id": "ext:claude-code"}))
        .await
        .unwrap();

    let err = read(&ext, &link("agent", &agent.id, &key))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    let after = user
        .request("provenance.touched", json!({"actor_id": "ext:claude-code"}))
        .await
        .unwrap();
    assert_eq!(before, after);
}

#[tokio::test]
async fn lk3_pad_todo_agent_and_workstream_links_read_the_same_after_a_restart() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    client
        .request("pad.create", json!({"name": "notes", "text": "kept"}))
        .await
        .unwrap();
    let todo = client
        .request("todo.create", json!({"title": "Keep"}))
        .await
        .unwrap();
    let agent = project.spawn_agent(&client).await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "ws", "parent": null}),
        )
        .await
        .unwrap();
    let links = [
        link("pad", "notes", &key),
        link("todo", &todo["id"].to_string(), &key),
        link("agent", &agent.id, &key),
        link("workstream", workstream["id"].as_str().unwrap(), &key),
    ];
    let mut before = Vec::new();
    for url in &links {
        before.push(read(&client, url).await.unwrap());
    }
    drop(client);

    project.restart(&[]);
    let client = project.client().await;

    assert_eq!(self::key(&client).await, key);
    for (url, before) in links.iter().zip(&before) {
        let after = read(&client, url).await.unwrap();
        assert_eq!(after["kind"], before["kind"], "{url}");
        assert_eq!(after["id"], before["id"], "{url}");
        for part in ["pad", "todo", "children"] {
            assert_eq!(after[part], before[part], "{url}");
        }
        if after.get("node").is_some() {
            assert_eq!(after["node"]["name"], before["node"]["name"], "{url}");
        }
    }
}

#[tokio::test]
async fn lk3_a_terminal_link_fails_loud_after_a_restart() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    let opened = client.request("terminal.open", json!({})).await.unwrap();
    let url = link("terminal", opened["terminal_id"].as_str().unwrap(), &key);
    read(&client, &url).await.unwrap();
    drop(client);

    project.restart(&[]);
    let err = read(&project.client().await, &url).await.unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
    assert!(
        err.message.contains("ends with the Daemon"),
        "{}",
        err.message
    );
}

async fn as_agent(project: &daemon::Project, id: &str) -> Client {
    let client = project.client().await;
    client
        .request(
            "daemon.identify",
            IdentifyParams {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: id.into(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    client
}

/// A Door `m` with one child Agent, and an Agent outside both.
async fn door_family(project: &daemon::Project, user: &Client) -> (String, String, String) {
    let m = user
        .request(
            "rail.createWorkstream",
            json!({"name": "m", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({ "id": m }))
        .await
        .unwrap();
    let spawn = |parent: Option<String>| async move {
        let node = user
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": null, "parent": parent}),
            )
            .await
            .unwrap();
        node["id"].as_str().unwrap().to_owned()
    };
    let child = spawn(Some(m.clone())).await;
    let outsider = spawn(None).await;
    (m, child, outsider)
}

#[tokio::test]
async fn lk5_a_door_reads_its_child_agent_link() {
    let project = daemon::start(&[]);
    let user = project.client().await;
    let key = key(&user).await;
    let (m, child, _) = door_family(&project, &user).await;
    let door = as_agent(&project, &m).await;

    let read = read(&door, &link("agent", &child, &key)).await.unwrap();

    assert_eq!(read["kind"], "agent");
    assert_eq!(read["id"], child.as_str());
    assert!(read["digest"].is_null(), "{read}");
}

/// A Door is a Workstream, so no `agent` link names one and `agent.digest` answers every Agent link
/// `CONFLICT` (LK2): the own-link read keeps that reply, with the digest the method gives, none.
#[tokio::test]
async fn lk5_a_door_reads_its_own_link_with_its_digest() {
    let project = daemon::start(&[]);
    let user = project.client().await;
    let key = key(&user).await;
    let (_, child, _) = door_family(&project, &user).await;
    let own = as_agent(&project, &child).await;
    let digest = own.request("agent.digest", json!({"id": child})).await;

    let read = read(&own, &link("agent", &child, &key)).await.unwrap();

    assert_eq!(digest.unwrap_err().code, code::CONFLICT);
    assert!(read["digest"].is_null(), "{read}");
}

#[tokio::test]
async fn lk5_an_agent_outside_the_reach_is_forbidden() {
    let project = daemon::start(&[]);
    let user = project.client().await;
    let key = key(&user).await;
    let (m, _, outsider) = door_family(&project, &user).await;
    let door = as_agent(&project, &m).await;

    let err = read(&door, &link("agent", &outsider, &key))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
}

fn ext(id: &str) -> IdentifyParams {
    IdentifyParams {
        actor: Actor {
            kind: ActorKind::Ext,
            id: id.into(),
            parent: None,
        },
    }
}

/// An App registered with `a`'s Daemon that answers a relayed `link.read` as the App does: from the
/// open Project the link's key names, as an Ext Actor there, or NOT_FOUND naming the key.
async fn app_for(a: &daemon::Project, open: Vec<(String, std::path::PathBuf)>) {
    let mut app = a.client().await;
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    tokio::spawn(async move {
        while let Some(request) = requests.recv().await {
            let url = request["params"]["url"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let wanted = url.rsplit("project=").next().unwrap_or_default().to_owned();
            let line = match open.iter().find(|(key, _)| *key == wanted) {
                None => json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":code::NOT_FOUND,
                    "message":format!("Project {wanted} is not open")}}),
                Some((_, socket)) => {
                    let b = Client::connect(socket).await.unwrap();
                    b.request("daemon.identify", ext("app")).await.unwrap();
                    match read(&b, &url).await {
                        Ok(result) => json!({"jsonrpc":"2.0","id":request["id"],"result":result}),
                        Err(err) => json!({"jsonrpc":"2.0","id":request["id"],
                            "error":{"code":err.code,"message":err.message}}),
                    }
                }
            };
            app.reply(&line).await.unwrap();
        }
    });
}

#[tokio::test]
async fn lk6_each_kind_of_an_open_projects_link_reads_what_b_reads() {
    let a = daemon::start(&[]);
    let b = daemon::start(&[]);
    let b_user = b.client().await;
    let b_key = key(&b_user).await;
    app_for(&a, vec![(b_key.clone(), b.socket().to_path_buf())]).await;
    b_user
        .request("pad.create", json!({"name": "notes", "text": "from b"}))
        .await
        .unwrap();
    let todo = b_user
        .request("todo.create", json!({"title": "In B"}))
        .await
        .unwrap();
    let ws = b_user
        .request(
            "rail.createWorkstream",
            json!({"name": "ws", "parent": null}),
        )
        .await
        .unwrap();
    let ws = ws["id"].as_str().unwrap();
    let opened = b_user.request("terminal.open", json!({})).await.unwrap();
    let terminal = opened["terminal_id"].as_str().unwrap();
    let caller = a.client().await;
    caller
        .request("daemon.identify", ext("caller"))
        .await
        .unwrap();
    let outside = b.client().await;
    outside
        .request("daemon.identify", ext("caller"))
        .await
        .unwrap();

    for url in [
        link("pad", "notes", &b_key),
        link("todo", &todo["id"].to_string(), &b_key),
        link("workstream", ws, &b_key),
        link("terminal", terminal, &b_key),
    ] {
        let through_a = read(&caller, &url).await.unwrap();
        assert_eq!(through_a, read(&outside, &url).await.unwrap(), "{url}");
    }

    b_user
        .request("pad.write", json!({"name": "notes", "text": "edited"}))
        .await
        .unwrap();
    let again = read(&caller, &link("pad", "notes", &b_key)).await.unwrap();
    assert_eq!(again["pad"]["text"], "edited");
}

#[tokio::test]
async fn lk6_a_foreign_agent_link_gives_no_more_than_an_outside_caller_gets() {
    let a = daemon::start(&[]);
    let b = daemon::start(&[]);
    let (a_user, b_user) = (a.client().await, b.client().await);
    let b_key = key(&b_user).await;
    app_for(&a, vec![(b_key.clone(), b.socket().to_path_buf())]).await;
    let b_agent = b.spawn_agent(&b_user).await;
    let a_agent = a.spawn_agent(&a_user).await;
    let caller = as_agent(&a, &a_agent.id).await;

    let err = read(&caller, &link("agent", &b_agent.id, &b_key))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
}

#[tokio::test]
async fn lk6_a_link_to_a_project_that_is_not_open_names_it() {
    let a = daemon::start(&[]);
    app_for(&a, vec![]).await;
    let caller = a.client().await;
    caller
        .request("daemon.identify", ext("caller"))
        .await
        .unwrap();

    let err = read(&caller, &link("pad", "notes", "gone-0123456789abcdef"))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
    assert!(
        err.message.contains("gone-0123456789abcdef"),
        "{}",
        err.message
    );
    assert!(err.message.contains("not open"), "{}", err.message);
}

#[tokio::test]
async fn lk6_no_app_is_app_closed() {
    let a = daemon::start(&[]);
    let a_user = a.client().await;

    let err = read(&a_user, &link("pad", "notes", "b-0123456789abcdef"))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::APP_CLOSED);
}

#[tokio::test]
async fn lk6_no_write_reaches_another_project() {
    let a = daemon::start(&[]);
    let b = daemon::start(&[]);
    let (a_user, b_user) = (a.client().await, b.client().await);
    let b_key = key(&b_user).await;
    app_for(&a, vec![(b_key.clone(), b.socket().to_path_buf())]).await;
    b_user
        .request("pad.create", json!({"name": "notes", "text": "b"}))
        .await
        .unwrap();
    let a_agent = a.spawn_agent(&a_user).await;
    let caller = as_agent(&a, &a_agent.id).await;

    // The relay carries link.read only: a write method of A's Daemon never reaches B.
    let err = caller
        .request("action.run", json!({"name": "pad.write", "args": []}))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::FORBIDDEN);
    let pad = b_user
        .request("pad.read", json!({"name": "notes"}))
        .await
        .unwrap();
    assert_eq!(pad["text"], "b");
}
