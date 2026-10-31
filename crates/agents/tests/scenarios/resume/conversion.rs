//! A5214a, A5214b: turn an Agent into a Workstream or a Mode.
use super::*;
use contracts::agent::NodeKind;
use rpc::Module;

async fn make(f: &Fixture, id: &str) -> Result<RailNode, rpc::RpcError> {
    let node = f.call("agent.makeWorkstream", json!({"id": id})).await?;
    Ok(serde_json::from_value(node).unwrap())
}

#[tokio::test]
async fn a5214a_the_agent_becomes_a_workstream_with_its_conversation() {
    let f = Fixture::running("sleep 30");
    let agent = exited_with_conversation(&f, CONVERSATION).await;
    let node = make(&f, &agent.id).await.unwrap();
    assert_eq!(node.kind, NodeKind::Workstream);
    assert_eq!(
        (&node.id, &node.name, &node.parent, node.order),
        (&agent.id, &agent.name, &agent.parent, agent.order)
    );
    assert!(node.can_resume, "the conversation is the Door's");
    let child = f.spawn(Some(&node.id), None).await.unwrap();
    assert_eq!(child.parent.as_deref(), Some(node.id.as_str()));
}

#[tokio::test]
async fn a5214a_a_running_agent_restarts_once_on_its_conversation() {
    let f = Arc::new(Fixture::running(
        r#"echo "$@" >> "$(dirname "$0")/argv.txt"; sleep 30"#,
    ));
    let agent = f.spawn(None, None).await.unwrap();
    f.session_start(&agent.id, CONVERSATION, "startup")
        .await
        .unwrap();
    let pending = {
        let (f, id) = (Arc::clone(&f), agent.id.clone());
        tokio::spawn(async move { make(&f, &id).await })
    };
    f.until_attempt_changed(&agent.id, agent.attempt.as_deref().unwrap())
        .await;
    f.session_start(&agent.id, CONVERSATION, "resume")
        .await
        .unwrap();
    let node = pending.await.unwrap().unwrap();
    assert_eq!(node.kind, NodeKind::Workstream);
    assert!(until_resumed(&f).await.contains("--resume"));
    assert_eq!(f.terminals.list().await.len(), 2, "one launch");
}

#[tokio::test]
async fn a5214a_an_exited_agent_converts_without_starting() {
    let f = Arc::new(Fixture::running("sleep 30"));
    let agent = exited_with_conversation(&f, CONVERSATION).await;
    let node = make(&f, &agent.id).await.unwrap();
    assert_eq!(f.terminals.list().await.len(), 1, "no launch");
    let resumed = resume_in_mode(&f, &node, Some("normal")).await;
    assert_eq!(resumed.id, agent.id);
}

#[tokio::test]
async fn a5214a_other_nodes_are_refused_unchanged() {
    let f = Fixture::running("sleep 30");
    let ws = f.workstream("work", None).await;
    let child = f.spawn(Some(&ws), None).await.unwrap();
    f.session_start(&child.id, CONVERSATION, "startup")
        .await
        .unwrap();
    let fresh = f.spawn(None, None).await.unwrap();
    for id in [&ws, &child.id, &fresh.id] {
        let err = make(&f, id).await.unwrap_err();
        assert_eq!(err.code, code::CONFLICT, "{id}");
    }
    let tree = f.tree().await;
    assert_eq!(
        tree.iter().find(|n| n.id == child.id).unwrap().kind,
        NodeKind::Agent
    );
    assert_eq!(
        tree.iter().find(|n| n.id == fresh.id).unwrap().kind,
        NodeKind::Agent
    );
}

/// An Agent that `lead` starts, so it launches lean (LC6).
async fn lean_child(f: &Fixture, lead: &str, extra: Value) -> RailNode {
    let mut ctx = f.ctx();
    ctx.actor = contracts::Actor {
        kind: contracts::ActorKind::Agent,
        id: lead.to_owned(),
        parent: None,
    };
    let mut params = json!({"cwd": f.dir.path(), "parent": lead});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(f.agents.call(&ctx, "agent.spawn", params).await.unwrap()).unwrap()
}

fn lean(f: &Fixture, id: &str) -> Value {
    let text = std::fs::read(f.dir.path().join("agents").join(format!("{id}.lean.json")));
    serde_json::from_slice(&text.unwrap()).unwrap()
}

async fn save(f: &Fixture, id: &str, name: &str) -> Result<RailNode, rpc::RpcError> {
    let node = f
        .call("agent.saveAsMode", json!({"id": id, "name": name}))
        .await?;
    Ok(serde_json::from_value(node).unwrap())
}

#[tokio::test]
async fn a5214b_the_mode_holds_the_agents_brief_tools_extras_and_model() {
    let f = Fixture::running("sleep 30");
    let lead = f.spawn(None, None).await.unwrap();
    let agent = lean_child(
        &f,
        &lead.id,
        json!({"model": "opus", "scout": true,
               "order": {"kind":"work","ask":"audit the parser","limits":[]}}),
    )
    .await;
    let mode = save(&f, &agent.id, " Parser audit ").await.unwrap();
    assert_eq!(mode.kind, NodeKind::Workstream);
    assert_eq!(mode.name, "Parser audit");
    assert_eq!(mode.parent, None);
    assert_eq!(mode.opening_prompt.as_deref(), Some("audit the parser"));
    assert_eq!(mode.model, agent.model);
    assert_eq!(mode.effort, agent.effort);
    assert_eq!(lean(&f, &mode.id), lean(&f, &agent.id));
    assert_eq!(lean(&f, &mode.id)["scout"], true);
}

#[tokio::test]
async fn a5214b_the_agent_is_unchanged() {
    let f = Fixture::running("sleep 30");
    let lead = f.spawn(None, None).await.unwrap();
    let agent = lean_child(&f, &lead.id, json!({})).await;
    f.session_start(&agent.id, CONVERSATION, "startup")
        .await
        .unwrap();
    let before = f.tree().await.into_iter().find(|n| n.id == agent.id);
    save(&f, &agent.id, "Mode").await.unwrap();
    let after = f.tree().await.into_iter().find(|n| n.id == agent.id);
    assert_eq!(before, after);
}

#[tokio::test]
async fn a5214b_a_bad_name_or_a_foreign_agent_creates_nothing() {
    let f = Fixture::running("sleep 30");
    let lead = f.spawn(None, None).await.unwrap();
    let agent = lean_child(&f, &lead.id, json!({})).await;
    let count = f.tree().await.len();
    let err = save(&f, &agent.id, "  ").await.unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    let foreign = f.spawn(None, None).await.unwrap();
    let err = save(&f, &foreign.id, "Mode").await.unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(f.tree().await.len(), count + 1, "only the foreign Agent");
}

async fn flags(f: &Fixture, id: &str) -> (bool, bool) {
    let node = f.tree().await.into_iter().find(|n| n.id == id).unwrap();
    (node.can_make_workstream, node.can_save_as_mode)
}

#[tokio::test]
async fn a5324_flags_match_the_guards() {
    let f = Fixture::running("sleep 30");
    let lead = f.spawn(None, None).await.unwrap();
    let ws = f.workstream("work", None).await;
    let child = f.spawn(Some(&ws), None).await.unwrap();
    f.session_start(&child.id, CONVERSATION, "startup")
        .await
        .unwrap();
    let unsaved = f.spawn(None, None).await.unwrap();
    let lean_unsaved = lean_child(&f, &lead.id, json!({})).await;
    let saved = f.spawn(None, None).await.unwrap();
    f.session_start(&saved.id, CONVERSATION, "startup")
        .await
        .unwrap();
    let exited = exited_with_conversation(&f, CONVERSATION).await;

    // A refused call leaves the node as it was, so the flag and the call can be compared.
    for (id, make_ok, save_ok) in [
        (&ws, false, false),
        (&child.id, false, false),
        (&unsaved.id, false, false),
        (&lean_unsaved.id, false, true),
    ] {
        assert_eq!(flags(&f, id).await, (make_ok, save_ok), "{id}");
        assert_eq!(make(&f, id).await.is_ok(), make_ok, "{id}");
        assert_eq!(save(&f, id, "Mode").await.is_ok(), save_ok, "{id}");
    }
    // A running Agent with a saved conversation passes the guard; calling it restarts the Agent.
    assert_eq!(flags(&f, &saved.id).await, (true, false));
    assert_eq!(flags(&f, &exited.id).await, (true, false));
    assert!(make(&f, &exited.id).await.is_ok());
    assert_eq!(
        flags(&f, &exited.id).await,
        (false, false),
        "now a Workstream"
    );
}

#[tokio::test]
async fn a5324_a_new_agent_gains_the_flag_when_its_conversation_saves() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    assert!(!flags(&f, &agent.id).await.0);
    f.session_start(&agent.id, CONVERSATION, "startup")
        .await
        .unwrap();
    assert!(flags(&f, &agent.id).await.0);
}
