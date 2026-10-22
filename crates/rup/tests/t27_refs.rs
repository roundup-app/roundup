//! T27, LK4 (`scenarios/todos.md`, `scenarios/rup-ext.md`): Pad refs of a Todo and section links, on the real `rupd`.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use rpc::{Client, code};
use serde_json::{Value, json};

async fn key(client: &Client) -> String {
    let ping = client.request("daemon.ping", Value::Null).await.unwrap();
    ping["projectKey"].as_str().unwrap().to_owned()
}

async fn pad(client: &Client, name: &str, text: &str) {
    client
        .request("pad.create", json!({"name": name, "text": text}))
        .await
        .unwrap();
}

async fn refs(client: &Client, id: u32) -> Value {
    client
        .request("todo.refs", json!({"id": id}))
        .await
        .unwrap()
}

#[tokio::test]
async fn lk4_a_pad_section_link_reads_the_heading_and_its_text() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    pad(
        &client,
        "notes",
        "# Top\nintro\n## plan  A\nstep one\n### detail\ndeep\n## Next\nlater\n",
    )
    .await;
    // The heading ignores case and whitespace runs; the reply gives it as the Pad writes it.
    let read = client
        .request(
            "link.read",
            json!({"url": format!("roundup://pad/notes?project={key}#PLAN%20%20a")}),
        )
        .await
        .unwrap();
    assert_eq!(read["pad"]["name"], "notes");
    assert_eq!(
        read["section"],
        json!({"heading": "plan  A", "text": "step one\n### detail\ndeep"})
    );
    let whole = client
        .request(
            "link.read",
            json!({"url": format!("roundup://pad/notes?project={key}")}),
        )
        .await
        .unwrap();
    assert!(whole.get("section").is_none());
}

#[tokio::test]
async fn lk4_a_missing_heading_is_not_found_and_a_fragment_on_another_kind_is_invalid() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    pad(&client, "notes", "## Plan\nx\n").await;
    client
        .request("todo.create", json!({"title": "t"}))
        .await
        .unwrap();
    let err = client
        .request(
            "link.read",
            json!({"url": format!("roundup://pad/notes?project={key}#Gone")}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(
        err.message.contains("notes") && err.message.contains("Gone"),
        "{}",
        err.message
    );
    let err = client
        .request(
            "link.read",
            json!({"url": format!("roundup://todo/1?project={key}#Part")}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.contains("#Part"), "{}", err.message);
}

#[tokio::test]
async fn t27_a_rejected_ref_leaves_no_trace() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    pad(&client, "notes", "## Plan\nx\n").await;
    client
        .request("todo.create", json!({"title": "t"}))
        .await
        .unwrap();
    let mut events = project.subscribed().await;
    for (url, id, want) in [
        (
            format!("roundup://todo/1?project={key}"),
            1,
            code::INVALID_PARAMS,
        ),
        (
            format!("roundup://pad/notes?project=other{key}"),
            1,
            code::INVALID_PARAMS,
        ),
        ("roundup://pad/notes".to_owned(), 1, code::INVALID_PARAMS),
        (
            format!("roundup://pad/ghost?project={key}"),
            1,
            code::NOT_FOUND,
        ),
        (
            format!("roundup://pad/notes?project={key}#Gone"),
            1,
            code::NOT_FOUND,
        ),
        (
            format!("roundup://pad/notes?project={key}"),
            9,
            code::NOT_FOUND,
        ),
    ] {
        let err = client
            .request("todo.addRef", json!({"id": id, "url": url}))
            .await
            .unwrap_err();
        assert_eq!(err.code, want, "{url}: {}", err.message);
    }
    assert_eq!(refs(&client, 1).await, json!([]));
    assert_eq!(
        client
            .request("provenance.history", json!({"item": "todo:1"}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1,
        "only the creation"
    );
    // The next event on the stream is the barrier: no refAdded came before it.
    client
        .request("todo.create", json!({"title": "barrier"}))
        .await
        .unwrap();
    daemon::next(&mut events, |event| match event {
        contracts::EventData::TodoCreated(_) => Some(()),
        contracts::EventData::TodoRefAdded(_) => panic!("a refused ref emitted refAdded"),
        _ => None,
    })
    .await;
}

#[tokio::test]
async fn t27_a_removed_pad_or_heading_reads_missing() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let key = key(&client).await;
    pad(&client, "notes", "## Plan\nx\n").await;
    client
        .request("todo.create", json!({"title": "t"}))
        .await
        .unwrap();
    let whole = format!("roundup://pad/notes?project={key}");
    let section = format!("{whole}#plan");
    for url in [&whole, &section] {
        client
            .request("todo.addRef", json!({"id": 1, "url": url}))
            .await
            .unwrap();
    }
    let touches = client
        .request("provenance.history", json!({"item": "todo:1"}))
        .await
        .unwrap();
    assert_eq!(
        refs(&client, 1).await,
        json!([{"url": whole, "state": "ok"}, {"url": section, "state": "ok"}])
    );
    client
        .request(
            "pad.write",
            json!({"name": "notes", "text": "no headings\n"}),
        )
        .await
        .unwrap();
    assert_eq!(
        refs(&client, 1).await,
        json!([{"url": whole, "state": "ok"}, {"url": section, "state": "missing"}])
    );
    client
        .request("pad.delete", json!({"name": "notes"}))
        .await
        .unwrap();
    assert_eq!(
        refs(&client, 1).await,
        json!([{"url": whole, "state": "missing"}, {"url": section, "state": "missing"}])
    );
    // The state is computed, not stored: the Pad under its name again makes both `ok`.
    pad(&client, "notes", "## Plan\nback\n").await;
    assert_eq!(
        refs(&client, 1).await,
        json!([{"url": whole, "state": "ok"}, {"url": section, "state": "ok"}])
    );
    // Reading logs no Touch.
    assert_eq!(
        client
            .request("provenance.history", json!({"item": "todo:1"}))
            .await
            .unwrap(),
        touches
    );
}
