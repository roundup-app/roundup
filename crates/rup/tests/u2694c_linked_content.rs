//! U2694c: real Claude quotes the linked content.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use daemon::aimock;

use base64::Engine;

use serde_json::{Value, json};

#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::conversation_entries;
use waiting::{turn_done, until, until_async};

#[tokio::test]
#[ignore = "U2694c outside-check observer: real Claude reads linked content"]
async fn u2694c_real_claude_quotes_the_linked_content() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir(&home).unwrap();
    aimock::configure(&dir.path().join("claude-config"), dir.path());
    let claude = aimock::routed_claude(dir.path());
    let mut project = daemon::start_in(
        dir,
        tempfile::tempdir().unwrap(),
        &[
            ("ROUNDUP_CLAUDE_BIN", claude.to_str().unwrap()),
            ("HOME", home.to_str().unwrap()),
            ("CLAUDE_CODE_OAUTH_TOKEN", ""),
        ],
    );
    let client = project.client().await;
    let ping = client.request("daemon.ping", Value::Null).await.unwrap();
    let key = ping["projectKey"].as_str().unwrap();
    client
        .request("pad.create", json!({"name":"notes","text":"obsolete pad"}))
        .await
        .unwrap();
    let todo = client
        .request("todo.create", json!({"title":"obsolete todo"}))
        .await
        .unwrap();
    let workstream = client.request("rail.createWorkstream", json!({
        "name":"receiver", "parent":null,
        "order":{"kind":"work","title":"Linked content","ask":"U2694 ready","done":"Quote current linked content","limits":[]}
    })).await.unwrap();
    let terminal = client
        .request("terminal.open", json!({"workstream":workstream["id"]}))
        .await
        .unwrap();
    let terminal = terminal["terminal_id"].as_str().unwrap();
    let objects = [
        ("pad", "notes".to_owned(), "U2694 current pad cobalt"),
        ("todo", todo["id"].to_string(), "U2694 current todo otter"),
        (
            "terminal",
            terminal.to_owned(),
            "U2694 current terminal maple",
        ),
    ];
    let mut fixtures = vec![
        json!({
            "match":{"userMessage":"<session>"},
            "response":{"content":"{\"title\":\"Linked content\"}"}
        }),
        json!({
            "match":{"userMessage":"U2694 ready","hasToolResult":false},
            "response":{"content":"Ready to read links."}
        }),
    ];
    for (kind, id, current) in &objects {
        let url = format!("roundup://{kind}/{id}?project={key}");
        let call = format!("toolu_u2694_{kind}");
        fixtures.push(json!({
            "match":{"userMessage":format!("{url}\nrup link read {url}"),"hasToolResult":false},
            "response":{"toolCalls":[{"id":call,"name":"Bash","arguments":json!({"command":format!("rup link read '{url}'")}).to_string()}]}
        }));
        fixtures.push(json!({
            "match":{"toolCallId":call,"toolResultContains":current},
            "response":{"content":format!("The current content is: {current}")}
        }));
    }
    let fixture = project.dir.path().join("linked-content.json");
    std::fs::write(&fixture, json!({"fixtures":fixtures}).to_string()).unwrap();
    let model = aimock::Model::start_at(&fixture);
    // The Daemon has not spawned Claude yet. Bind its isolated route after the Project supplies
    // the link identities; the wrapper still runs only the pinned, unmodified vendor binary.
    let wrapper = std::fs::read_to_string(&claude).unwrap();
    std::fs::write(&claude, wrapper.replace("$AIMOCK_URL", &model.url)).unwrap();
    project.model = Some(model);
    let model = project.model.as_ref().unwrap();
    let receiver = client
        .request("agent.spawn", json!({"cwd":project.dir.path(),"parent":workstream["id"],"name":"reader","prompt":"U2694 ready"}))
        .await
        .unwrap();
    let receiver = receiver["id"].as_str().unwrap();
    turn_done(project.bound(), model, &client, receiver, "U2694 ready").await;
    client
        .request("agent.resume", json!({"id":receiver,"mode":"yolo"}))
        .await
        .unwrap();
    client
        .request("pad.write", json!({"name":"notes","text":objects[0].2}))
        .await
        .unwrap();
    client
        .request("todo.update", json!({"id":todo["id"],"title":objects[1].2}))
        .await
        .unwrap();
    client.request("terminal.write", json!({"id":terminal,"data":base64::engine::general_purpose::STANDARD.encode(format!("printf '{}\\n'\n", objects[2].2))})).await.unwrap();
    until_async(project.bound(), "Terminal's current output", || async {
        let screen = client
            .request("terminal.screen", json!({"id":terminal}))
            .await
            .unwrap();
        screen["lines"]
            .as_array()
            .unwrap()
            .iter()
            .any(|line| line == objects[2].2)
            .then_some(())
    })
    .await;
    for (kind, id, current) in &objects {
        let url = format!("roundup://{kind}/{id}?project={key}");
        let body = format!("{url}\nrup link read {url}");
        client
            .request(
                "message.send",
                json!({"to":receiver,"kind":"note","body":body}),
            )
            .await
            .unwrap();
        let result = model.tool_result(&format!("toolu_u2694_{kind}")).await;
        assert!(result["content"].as_str().unwrap().contains(current));
        turn_done(project.bound(), model, &client, receiver, &body).await;
        until(project.bound(), "Claude quoted current content", || {
            conversation_entries(&project)
                .iter()
                .any(|entry| {
                    entry["type"] == "assistant"
                        && entry["message"]["content"]
                            .as_array()
                            .is_some_and(|blocks| {
                                blocks.iter().any(|block| {
                                    block["type"] == "text"
                                        && block["text"]
                                            .as_str()
                                            .is_some_and(|text| text.contains(current))
                                })
                            })
                })
                .then_some(())
        })
        .await;
    }
    model.assert_matched();
}
