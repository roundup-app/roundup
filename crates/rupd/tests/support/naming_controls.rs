//! Rail rename awareness through the real Daemon and vendor inbox.
use super::*;

impl Run {
    async fn rename(&self, name: &str) -> u32 {
        self.user
            .request("rail.rename", json!({"id":self.child,"name":name}))
            .await
            .unwrap();
        let body = format!("you are now called \"{name}\" on the Rail");
        until("rename note queued", async || {
            let messages = self
                .user
                .request("message.list", json!({"to":self.child}))
                .await
                .unwrap();
            messages
                .as_array()
                .unwrap()
                .iter()
                .rev()
                .find(|m| m["body"] == body)
                .map(|m| m["id"].as_u64().unwrap() as u32)
        })
        .await
    }
}

#[tokio::test]
async fn b2704a_rename_updates_context_and_queues_one_note() {
    for (scout, agent_caller) in [(false, false), (true, false), (false, true)] {
        let mut run = Run::start_case(1, scout).await;
        let caller = Client::connect(&run.daemon.socket).await.unwrap();
        if agent_caller {
            caller
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":run.child}}),
                )
                .await
                .unwrap();
        }
        caller
            .request("rail.rename", json!({"id":run.child,"name":"sad-2"}))
            .await
            .unwrap();
        let id = until("rename note queued", async || {
            let messages = run
                .user
                .request("message.list", json!({"to":run.child}))
                .await
                .unwrap();
            messages
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["body"] == "you are now called \"sad-2\" on the Rail")
                .map(|m| m["id"].as_u64().unwrap() as u32)
        })
        .await;
        let context = run
            .user
            .request("agent.context", json!({"id":run.child}))
            .await
            .unwrap();
        assert_eq!(context["self"]["name"], "sad-2");
        run.assert_rename_delivery(&[id], &["sad-2"]).await;
    }
}

#[tokio::test]
async fn b2704a_busy_renames_arrive_once_in_order() {
    let mut run = Run::start().await;
    run.signal(json!({"hook_event_name":"PreToolUse","tool_name":"Bash"}))
        .await;
    let first = run.rename("sad-2").await;
    let second = run.rename("sad-3").await;
    assert!(run.entries().is_empty());
    run.signal(json!({"hook_event_name":"Stop"})).await;
    run.assert_rename_delivery(&[first, second], &["sad-2", "sad-3"])
        .await;
}

#[tokio::test]
async fn b2704a_workstream_rename_notifies_its_door() {
    let mut run = Run::open(1, false).await;
    let workstream = run
        .user
        .request("rail.createWorkstream", json!({"name":"sad","parent":null,"order":{"kind":"work","ask":"Wait for updates","limits":[]}}))
        .await
        .unwrap();
    let door = run
        .user
        .request("rail.startDoor", json!({"id":workstream["id"]}))
        .await
        .unwrap();
    run.child = door["id"].as_str().unwrap().into();
    run.terminal = door["terminal_id"].clone();
    run.attempt = door["attempt"].clone();
    run.ready().await;
    let id = run.rename("sad-2").await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["self"]["name"], "sad-2");
    assert_eq!(run.message(id).await["to"], run.child);
    run.assert_rename_delivery(&[id], &["sad-2"]).await;
}

#[tokio::test]
async fn b2704a_unchanged_names_produce_no_note() {
    let run = Run::start().await;
    run.user
        .request("rail.rename", json!({"id":run.child,"name":"child"}))
        .await
        .unwrap();
    assert!(
        run.user
            .request("rail.rename", json!({"id":"7013","name":"rejected"}))
            .await
            .is_err()
    );
    // Explicitly named Agents keep their name on the first prompt and on later prompts.
    for prompt in ["", "first words", "later words"] {
        run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":prompt}))
            .await;
    }
    run.user
        .request("rail.move", json!({"id":run.child,"parent":null,"index":0}))
        .await
        .unwrap();
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert!(messages.as_array().unwrap().is_empty(), "{messages}");
    assert!(run.entries().is_empty());
}

#[tokio::test]
async fn b2704a_first_prompt_rename_notifies() {
    let mut run = Run::open(1, false).await;
    let node = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().into();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    run.ready().await;
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"sad"}))
        .await;
    let id = until("first prompt rename note", async || {
        let messages = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        messages
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["body"] == "you are now called \"sad\" on the Rail")
            .map(|m| m["id"].as_u64().unwrap() as u32)
    })
    .await;
    run.signal(json!({"hook_event_name":"Stop"})).await;
    run.assert_rename_delivery(&[id], &["sad"]).await;
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"later name"}))
        .await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["self"]["name"], "sad");
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert_eq!(messages.as_array().unwrap().len(), 1);
    // The other first-prompt branch consumes the name guard without emitting a rename.
    // Reuse the Daemon; only a new unnamed child is needed to exercise that branch.
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let node = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().into();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    run.ready().await;
    for prompt in ["   ", "later words"] {
        run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":prompt}))
            .await;
    }
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert!(messages.as_array().unwrap().is_empty(), "{messages}");
    assert!(run.entries().is_empty());
}

#[tokio::test]
async fn a4688b_manual_rename_while_off_notifies() {
    let mut run = Run::start().await;
    run.user
        .request(
            "daemon.setNaming",
            json!({"automaticRenaming":false,"namingGuide":"Use role-verb-object"}),
        )
        .await
        .unwrap();
    let id = run.rename("reviewer-checks-tests").await;
    run.assert_rename_delivery(&[id], &["reviewer-checks-tests"])
        .await;
}

#[tokio::test]
async fn a4688a_prompt_while_off_produces_no_rename_note_or_delayed_rename() {
    let mut run = Run::open(1, false).await;
    let node = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().into();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    run.ready().await;
    run.user
        .request(
            "daemon.setNaming",
            json!({"automaticRenaming":false,"namingGuide":"Use role-verb-object"}),
        )
        .await
        .unwrap();
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"Fix the refresh race"}))
        .await;
    run.user
        .request(
            "daemon.setNaming",
            json!({"automaticRenaming":true,"namingGuide":"Use role-verb-object"}),
        )
        .await
        .unwrap();
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"Now write the docs"}))
        .await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["self"]["name"], node["name"]);
    let messages = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    assert!(messages.as_array().unwrap().is_empty(), "{messages}");
    assert!(run.entries().is_empty());
}

#[tokio::test]
async fn a4688a_persisted_off_governs_the_first_prompt_after_daemon_restart() {
    let mut run = Run::start().await;
    run.user
        .request(
            "daemon.setNaming",
            json!({"automaticRenaming":false,"namingGuide":"Use role-verb-object"}),
        )
        .await
        .unwrap();
    run.restart().await;
    let node = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().into();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    run.ready().await;
    run.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"Fix the refresh race"}))
        .await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["self"]["name"], node["name"]);
}

#[tokio::test]
async fn a4688a_a_vendor_process_cannot_claim_the_users_naming_authority() {
    let mut run = Run::open(1, false).await;
    // The request originates in the launched vendor process, rather than a test client
    // which merely identifies as an Agent. Its default wire identity is the user.
    let probe = r#"
conn = socket.socket(socket.AF_UNIX)
conn.connect(os.environ['RUPD_SOCKET'])
conn.sendall((json.dumps({'id':4688,'method':'daemon.setNaming','params':{'automaticRenaming':False,'namingGuide':'Replace names'}}) + '\n').encode())
reply = json.loads(conn.makefile().readline())
json.dump(reply, open(here + '/naming-refusal.json', 'w'))
conn.close()
"#;
    std::fs::write(
        run.dir.path().join("claude"),
        FAKE.replace(
            "print('READY', flush=True)",
            &format!("{probe}\nprint('READY', flush=True)"),
        ),
    )
    .unwrap();
    run.spawn().await;
    let reply: Value =
        serde_json::from_slice(&std::fs::read(run.dir.path().join("naming-refusal.json")).unwrap())
            .unwrap();
    assert_eq!(reply["error"]["code"], rpc::code::FORBIDDEN);
    let saved = run
        .user
        .request("daemon.getNaming", Value::Null)
        .await
        .unwrap();
    assert_eq!(saved["automaticRenaming"], true);
}
