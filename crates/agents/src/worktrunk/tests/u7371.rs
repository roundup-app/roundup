//! U7371: the Rail's finished-work facts reach `agent.worktreeState`.
use super::*;

/// An Agent over a repository whose worktrunk row is `row` plus `extra`, with `gh pr view` stubbed.
/// The returned guards keep the repository and stub alive.
async fn published(extra: Value, gh_view: &str) -> (crate::Agents, String, [tempfile::TempDir; 3]) {
    let repo = repository();
    let (data, _bus, mut shared) =
        super::super::super::store::tests::shared_over_temp_dir(Arc::new(|| 0));
    let fixture = tempfile::tempdir().unwrap();
    let gh = fixture.path().join("gh");
    std::fs::write(
        &gh,
        format!("#!/bin/sh\ncase \"$1 $2\" in\n\"pr view\") echo '{gh_view}';;\n\"pr checks\") echo '[{{\"name\":\"check\",\"bucket\":\"pass\"}}]';;\nesac\n"),
    )
    .unwrap();
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
    Arc::get_mut(&mut shared).unwrap().project_dir = repo.path().to_owned();
    git(repo.path(), &["branch", "base"]);
    let node = shared
        .rail()
        .insert(contracts::agent::NodeKind::Agent, "fixture", None, None)
        .unwrap();
    shared
        .rail()
        .set_worktree(
            crate::rail::agent_id(&node.id).unwrap(),
            &contracts::agent::Worktree {
                path: repo.path().to_string_lossy().into_owned(),
                branch: "main".into(),
                base: "base".into(),
            },
        )
        .unwrap();
    for lane in &mut shared.worktrunk.state.lock().unwrap().lanes {
        lane.since = Some(Instant::now());
    }
    let agents = super::super::super::store::tests::owner_agents(shared.clone(), data.path());
    let ids = identities(&shared).unwrap();
    let mut item = row(repo.path());
    item.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let recorded = parse(&envelope(json!([item]))).unwrap();
    let mut results = BTreeMap::from([(ids[0].clone(), recorded.items[0].facts())]);
    attach_evidence(&gh, &mut results, &shared.worktrunk.cancelled);
    publish(
        &shared.worktrunk.state,
        true,
        Ok(results),
        ids,
        &shared.worktrunk.cancelled,
        Instant::now(),
    );
    (agents, node.id.clone(), [repo, data, fixture])
}

async fn wire(agents: &crate::Agents, id: &str) -> Value {
    serde_json::to_value(agents.worktree_state(id).await.unwrap()).unwrap()
}

#[tokio::test]
async fn u7371a_gh_is_draft_reaches_the_contract() {
    let (head, url) = ("1".repeat(40), "https://github.com/acme/one/pull/23");
    for (is_draft, want) in [
        (r#","isDraft":true"#, Some(true)),
        (r#","isDraft":false"#, Some(false)),
        (r#","isDraft":null"#, None),
        ("", None),
    ] {
        let view = format!(r#"{{"number":23,"headRefOid":"{head}","url":"{url}"{is_draft}}}"#);
        let (agents, id, _keep) = published(json!({}), &view).await;
        let pr = wire(&agents, &id).await["pr"].clone();
        assert_eq!(pr["number"], 23);
        assert_eq!(pr["draft"].as_bool(), want, "{is_draft}");
    }
}

#[tokio::test]
async fn u7371b_integrated_state_reaches_the_contract() {
    let view = r#"{"number":23,"headRefOid":"abc","url":"https://github.com/acme/one/pull/23"}"#;
    for (state, want) in [
        ("integrated", Some(true)),
        ("empty", None),
        ("is_main", None),
    ] {
        let (agents, id, _keep) = published(json!({"display":{"state":state}}), view).await;
        let wire = wire(&agents, &id).await;
        assert_eq!(wire["integrated"].as_bool(), want, "{state}");
    }
}
