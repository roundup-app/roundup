//! A4688a: global preferences are shared without an App connection.
use super::*;
use crate::tests::{ask, daemon_in};

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    ask(
        daemon,
        &json!({"id":1,"method":method,"params":params}).to_string(),
    )
    .await
}

#[tokio::test]
async fn a4688a_saved_off_is_shared_and_survives_reopen() {
    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("projects/first");
    let second = root.path().join("projects/second");
    let a = daemon_in(&first);
    let b = daemon_in(&second);
    let settings =
        json!({"automaticRenaming":false,"namingGuide":"角色-checks-tests\nKeep exact text"});
    let saved = call(&a, "daemon.setNaming", settings.clone()).await;
    assert!(saved.get("error").is_none(), "{saved}");
    assert_eq!(
        call(&b, "daemon.getNaming", Value::Null).await["result"],
        settings
    );
    drop(a);
    let reopened = daemon_in(&first);
    assert_eq!(
        call(&reopened, "daemon.getNaming", Value::Null).await["result"],
        settings
    );
}

#[tokio::test]
async fn u4688a_blank_guide_preserves_committed_preferences() {
    let root = tempfile::tempdir().unwrap();
    let daemon = daemon_in(root.path());
    let before = call(&daemon, "daemon.getNaming", Value::Null).await;
    assert!(before.get("error").is_none(), "{before}");
    let refused = call(
        &daemon,
        "daemon.setNaming",
        json!({"automaticRenaming":false,"namingGuide":" \n\t"}),
    )
    .await;
    assert_eq!(refused["error"]["code"], code::INVALID_PARAMS);
    assert_eq!(call(&daemon, "daemon.getNaming", Value::Null).await, before);
}

fn running(project: &Path, data: &Path) -> Daemon {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(project).unwrap();
    let fake = project.join("claude");
    std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.join("rup");
    std::fs::write(&rup, "").unwrap();
    crate::tests::daemon_with_launcher(
        project,
        data,
        agents::claude_code::Launcher::new(
            fake.to_str().unwrap(),
            project.join("config.json"),
            rup,
            None,
        ),
    )
}

async fn spawn(daemon: &Daemon, name: Option<&str>) -> Value {
    let reply = call(
        daemon,
        "agent.spawn",
        json!({"name":name,"cwd":daemon.project}),
    )
    .await;
    assert!(reply.get("error").is_none(), "{reply}");
    reply["result"].clone()
}

async fn submit(daemon: &Daemon, node: &Value, prompt: &str) {
    let reply = call(daemon,"agent.signal",json!({"id":node["id"],"attempt":node["attempt"],"payload":{"hook_event_name":"UserPromptSubmit","prompt":prompt}})).await;
    assert!(reply.get("error").is_none(), "{reply}");
}

async fn name(daemon: &Daemon, node: &Value) -> String {
    let tree = call(daemon, "rail.tree", Value::Null).await;
    tree["result"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == node["id"])
        .unwrap()["name"]
        .as_str()
        .unwrap()
        .into()
}

async fn set(daemon: &Daemon, enabled: bool) {
    let reply = call(
        daemon,
        "daemon.setNaming",
        json!({"automaticRenaming":enabled,"namingGuide":"Use role-verb-object"}),
    )
    .await;
    assert!(reply.get("error").is_none(), "{reply}");
}

#[tokio::test]
async fn a4688a_off_consumes_the_first_prompt_across_running_and_future_agents() {
    let root = tempfile::tempdir().unwrap();
    let a = running(&root.path().join("a"), &root.path().join("projects/a"));
    let b = running(&root.path().join("b"), &root.path().join("projects/b"));
    let before = spawn(&a, None).await;
    set(&b, false).await;
    let after = spawn(&b, None).await;
    for (daemon, node) in [(&a, &before), (&b, &after)] {
        submit(daemon, node, "Fix the refresh race in token.ts").await;
        assert_eq!(name(daemon, node).await, node["name"].as_str().unwrap());
    }
    set(&a, true).await;
    for (daemon, node) in [(&a, &before), (&b, &after)] {
        submit(daemon, node, "now write the docs").await;
        assert_eq!(name(daemon, node).await, node["name"].as_str().unwrap());
    }
    let fresh = spawn(&b, None).await;
    submit(&b, &fresh, "Fix the refresh race in token.ts").await;
    assert_eq!(name(&b, &fresh).await, "fix-refresh-race");
    a.stop_terminals().await.unwrap();
    b.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a4688b_explicit_names_and_manual_renames_win_with_either_switch_value() {
    let root = tempfile::tempdir().unwrap();
    let daemon = running(root.path(), &root.path().join("data"));
    for enabled in [false, true] {
        set(&daemon, enabled).await;
        let given = spawn(&daemon, Some("  reviewer-checks-tests  ")).await;
        submit(&daemon, &given, "Fix the refresh race").await;
        assert_eq!(name(&daemon, &given).await, given["name"].as_str().unwrap());
        let unnamed = spawn(&daemon, None).await;
        let renamed = call(
            &daemon,
            "rail.rename",
            json!({"id":unnamed["id"],"name":"my-name"}),
        )
        .await;
        assert!(renamed.get("error").is_none(), "{renamed}");
        submit(&daemon, &unnamed, "Fix the refresh race").await;
        assert_eq!(name(&daemon, &unnamed).await, "my-name");
    }
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a4688a_agents_cannot_change_global_naming_preferences() {
    let root = tempfile::tempdir().unwrap();
    let daemon = daemon_in(root.path());
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let error = daemon
        .route(
            &mut conn,
            "daemon.setNaming",
            json!({"automaticRenaming":false,"namingGuide":"Replace names"}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, code::FORBIDDEN);
    let saved = call(&daemon, "daemon.getNaming", Value::Null).await;
    assert_eq!(saved["result"]["automaticRenaming"], true);
}
