use super::*;

fn overview_transcript(f: &Fixture, text: &str) -> std::path::PathBuf {
    let cwd = f.dir.path().canonicalize().unwrap();
    let project: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let path = f
        .dir
        .path()
        .join("projects")
        .join(project)
        .join(format!("{CONVERSATION}.jsonl"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
    path
}

/// RO2: the overview of a closed node arrives with `rail.changed`, not with the first tree.
async fn with_overview(f: &Fixture, id: &str) -> RailNode {
    f.until(|tree| tree.iter().any(|n| n.id == id && n.overview.is_some()))
        .await
        .into_iter()
        .find(|n| n.id == id)
        .unwrap()
}

#[tokio::test]
async fn a2681a_closed_node_has_identity_without_history_path() {
    let f = Fixture::running("sleep 30");
    let path = overview_transcript(
        &f,
        "{\"type\":\"ai-title\",\"aiTitle\":\"A conversation\"}\n",
    );
    let node = exited_with_conversation(&f, CONVERSATION).await;
    with_overview(&f, &node.id).await;
    let tree = f.call("rail.tree", json!({})).await.unwrap();
    let node = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == node.id)
        .unwrap();
    assert_eq!(
        node["overview"],
        json!({"program": "Claude Code", "id": CONVERSATION, "name": "A conversation"})
    );
    assert!(!tree.to_string().contains(path.to_str().unwrap()));
    assert!(!tree.to_string().contains("aiTitle"));
}

#[tokio::test]
async fn a2681a_missing_or_unreadable_transcript_has_no_parts() {
    for unreadable in [false, true] {
        let f = Fixture::running("sleep 30");
        let path = overview_transcript(&f, "{}\n");
        std::fs::remove_file(&path).unwrap();
        if unreadable {
            std::fs::create_dir(path).unwrap();
        }
        let node = exited_with_conversation(&f, CONVERSATION).await;
        assert!(node.overview.is_none());
    }
}

#[tokio::test]
async fn a2681a_no_saved_data_has_no_parts() {
    let f = Fixture::running("sleep 30");
    overview_transcript(&f, "{\"type\":\"ai-title\",\"aiTitle\":\"Do not infer\"}\n");
    let node = f.spawn(None, None).await.unwrap();
    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
    assert!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .overview
            .is_none()
    );
}

#[tokio::test]
async fn a2681a_reopen_reads_closed_parts() {
    let f = Fixture::running("sleep 30");
    overview_transcript(&f, "{\"type\":\"ai-title\",\"aiTitle\":\"Kept\"}\n");
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let f = f.reopen();
    let reopened = with_overview(&f, &node.id).await;
    assert!(reopened.overview.is_some());
    assert!(reopened.terminal_id.is_none());
}

#[tokio::test]
async fn a2681a_live_attempt_hides_parts_including_on_resume() {
    let f = Fixture::running("sleep 30");
    overview_transcript(
        &f,
        "{\"type\":\"ai-title\",\"aiTitle\":\"Hidden while live\"}\n",
    );
    let node = f.spawn(None, None).await.unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    assert!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .overview
            .is_none()
    );
    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
    let closed = f
        .until(|tree| {
            tree.iter()
                .any(|n| n.id == node.id && n.can_resume && n.overview.is_some())
        })
        .await;
    assert!(
        closed
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .overview
            .is_some()
    );
    let f = Arc::new(f);
    let resuming = {
        let f = Arc::clone(&f);
        let id = node.id.clone();
        tokio::spawn(async move { f.resume(&id).await })
    };
    let pending = f
        .until_attempt_changed(&node.id, node.attempt.as_deref().unwrap())
        .await;
    assert!(
        pending
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .overview
            .is_none()
    );
    f.session_start(&node.id, CONVERSATION, "resume")
        .await
        .unwrap();
    let resumed = resuming.await.unwrap().unwrap();
    assert_eq!(resumed.status.as_ref().unwrap().kind, Kind::Idle);
    assert!(resumed.overview.is_none(), "an idle program is live");
    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
}

#[tokio::test]
async fn a2681d_live_attempt_hides_context_parts() {
    let f = Fixture::running("sleep 30");
    let context = include_str!("../../fixtures/overview/2.1.296-context.jsonl");
    overview_transcript(
        &f,
        &format!(
            "{{\"type\":\"assistant\",\"message\":{{\"usage\":{{\"input_tokens\":20000}}}}}}\n{}\n",
            context.trim()
        ),
    );
    let node = f.spawn(None, None).await.unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    assert!(
        f.tree()
            .await
            .iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .overview
            .is_none()
    );
    f.call("agent.stop", json!({"id":node.id})).await.unwrap();
    let closed = f
        .until(|tree| {
            tree.iter()
                .any(|n| n.id == node.id && n.can_resume && n.overview.is_some())
        })
        .await;
    let overview = closed
        .iter()
        .find(|n| n.id == node.id)
        .unwrap()
        .overview
        .as_ref()
        .unwrap();
    assert!(overview.context_parts.is_some());
}

#[tokio::test]
async fn a2681a_natural_exit_exposes_parts() {
    let f = Fixture::running("while [ ! -f release ]; do sleep 0.01; done");
    overview_transcript(&f, "{}\n");
    let node = f.spawn(None, None).await.unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    std::fs::write(f.dir.path().join("release"), "").unwrap();
    let tree = f
        .until(|tree| {
            tree.iter()
                .any(|n| n.id == node.id && n.can_resume && n.overview.is_some())
        })
        .await;
    assert!(
        tree.iter()
            .find(|n| n.id == node.id)
            .unwrap()
            .overview
            .is_some()
    );
}

#[tokio::test]
async fn ro2_an_uncached_overview_appears_with_rail_changed() {
    let mut f = Fixture::running("sleep 30");
    overview_transcript(&f, "{\"type\":\"ai-title\",\"aiTitle\":\"Later\"}\n");
    let node = exited_with_conversation(&f, CONVERSATION).await;
    assert!(node.can_resume);
    assert!(
        node.overview.is_none(),
        "the first tree reads no transcript"
    );
    f.until(|tree| tree.iter().any(|n| n.id == node.id && n.overview.is_some()))
        .await;
    assert!(f.changed() > 0);
}

#[tokio::test]
async fn ro2_a_growing_transcript_updates_without_a_caller() {
    let f = Fixture::running("sleep 30");
    let path = overview_transcript(&f, "{\"type\":\"ai-title\",\"aiTitle\":\"Grows\"}\n");
    let node = exited_with_conversation(&f, CONVERSATION).await;
    with_overview(&f, &node.id).await;
    let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    std::io::Write::write_all(
        &mut file,
        b"{\"type\":\"assistant\",\"message\":{\"usage\":{\"input_tokens\":4242}}}\n",
    )
    .unwrap();
    f.until(|tree| {
        tree.iter()
            .any(|n| n.id == node.id && n.overview.as_ref().is_some_and(|o| o.used == Some(4242)))
    })
    .await;
}

#[tokio::test]
async fn ro3_calls_answer_while_a_large_transcript_is_read() {
    let f = Fixture::running("sleep 30");
    let filler = format!(
        "{{\"type\":\"user\",\"message\":{{\"content\":\"{}\"}}}}\n",
        "x".repeat(1000)
    );
    overview_transcript(&f, &filler.repeat(31_000));
    let node = exited_with_conversation(&f, CONVERSATION).await;
    assert!(
        node.overview.is_none(),
        "rail.tree did not wait for the read"
    );
    f.call("rail.rename", json!({"id": node.id, "name": "renamed"}))
        .await
        .unwrap();
    let tree = f.tree().await;
    assert!(tree.iter().any(|n| n.id == node.id && n.name == "renamed"));
    with_overview(&f, &node.id).await;
}
