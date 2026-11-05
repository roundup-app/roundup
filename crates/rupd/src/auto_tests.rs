// T4902 retires T29 setup; A3308 still proves ordered once-only Auto delivery.
use super::*;
use crate::tests::{ask, daemon_in, daemon_with_launcher};

pub(crate) async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let response = ask(
        daemon,
        &json!({"id":1,"method":method,"params":params}).to_string(),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

#[tokio::test]
async fn a3308_set_auto_persists_and_emits_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let mut events = daemon.bus.subscribe();
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":node["id"],"auto":true}),
    )
    .await;
    let mut updates = 0;
    while let Ok(event) = events.try_recv() {
        if serde_json::to_value(event).unwrap()["name"] == "workstream.updated" {
            updates += 1;
        }
    }
    assert_eq!(updates, 1);
    drop(daemon);
    let reopened = daemon_in(dir.path());
    let rail = call(&reopened, "rail.tree", Value::Null).await;
    assert_eq!(rail[0]["auto"], true);
}

pub(crate) fn running_daemon(project: &std::path::Path) -> Daemon {
    use std::os::unix::fs::PermissionsExt;
    let data = project.join("data");
    let fake = project.join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.join("rup");
    std::fs::write(&rup, "").unwrap();
    daemon_with_launcher(
        project,
        &data,
        agents::claude_code::Launcher::new(
            fake.to_str().unwrap(),
            project.join("claude.json"),
            rup,
            None,
        ),
    )
}

pub(crate) async fn door(daemon: &Daemon) -> String {
    let node = call(daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    call(daemon, "rail.startDoor", json!({"id":node["id"]})).await;
    node["id"].as_str().unwrap().into()
}

async fn todo(daemon: &Daemon, home: &str, title: &str, owner: Value) -> Value {
    let todo = call(daemon, "todo.create", json!({"title":title,"owner":owner})).await;
    call(daemon, "todo.move", json!({"id":todo["id"],"home":home})).await
}

async fn notices(daemon: &Daemon, home: &str) -> Vec<Value> {
    call(daemon, "message.list", json!({"to":home}))
        .await
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| {
            m["from"] == json!(Actor::daemon()) && m["body"].as_str().unwrap().starts_with("[auto ")
        })
        .cloned()
        .collect()
}

#[tokio::test]
async fn a3308_auto_on_sends_each_unassigned_todo_to_the_door_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let first = todo(&daemon, &home, "First task", Value::Null).await;
    let second = todo(&daemon, &home, "Second task", Value::Null).await;
    call(
        &daemon,
        "todo.reorder",
        json!({"id":second["id"],"before":first["id"]}),
    )
    .await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let sent = notices(&daemon, &home).await;
    assert_eq!(sent.len(), 2);
    for (message, todo) in sent.iter().zip([&second, &first]) {
        let body = message["body"].as_str().unwrap();
        assert!(body.contains(todo["title"].as_str().unwrap()), "{body}");
        assert!(body.contains(&format!("Todo #{}", todo["id"])), "{body}");
        assert!(!body.to_lowercase().contains("estimate"), "{body}");
        assert!(!body.contains(" min"), "{body}");
    }
    call(
        &daemon,
        "todo.update",
        json!({"id":first["id"],"title":"Retitled"}),
    )
    .await;
    assert_eq!(notices(&daemon, &home).await.len(), 2);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_setting_the_same_value_emits_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let mut events = daemon.bus.subscribe();
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":node["id"],"auto":false}),
    )
    .await;
    assert!(events.try_recv().is_err());
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await[0]["auto"],
        false
    );
}

#[tokio::test]
async fn a3308_an_unknown_workstream_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let result = ask(
        &daemon,
        r#"{"id":1,"method":"workstream.setAuto","params":{"id":"404","auto":true}}"#,
    )
    .await;
    assert_eq!(result["error"]["code"], code::NOT_FOUND);
}

#[tokio::test]
async fn a3308_me_and_agent_owned_todos_never_move() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let mine = todo(&daemon, &home, "Mine", json!(Actor::user())).await;
    let child = subagent(&daemon, &home, dir.path()).await;
    let theirs = todo(
        &daemon,
        &home,
        "Theirs",
        json!({"kind":"agent","id":child["id"]}),
    )
    .await;
    let done = todo(&daemon, &home, "Done", Value::Null).await;
    call(&daemon, "todo.complete", json!({"id":done["id"]})).await;
    let elsewhere = todo(&daemon, &home, "Elsewhere", Value::Null).await;
    call(
        &daemon,
        "todo.move",
        json!({"id":elsewhere["id"],"home":null}),
    )
    .await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    assert!(notices(&daemon, &home).await.is_empty());
    for before in [mine, theirs] {
        assert_eq!(
            call(&daemon, "todo.get", json!({"id":before["id"]})).await["owner"],
            before["owner"]
        );
    }
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_auto_off_sends_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    todo(&daemon, &home, "Before", Value::Null).await;
    assert!(notices(&daemon, &home).await.is_empty());
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let before = notices(&daemon, &home).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":false}),
    )
    .await;
    todo(&daemon, &home, "After", Value::Null).await;
    assert_eq!(notices(&daemon, &home).await, before);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_a_todo_is_sent_again_only_when_it_becomes_unassigned() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let todo = todo(&daemon, &home, "New task", Value::Null).await;
    assert_eq!(notices(&daemon, &home).await.len(), 1);
    call(
        &daemon,
        "todo.assign",
        json!({"id":todo["id"],"owner":Actor::user()}),
    )
    .await;
    call(
        &daemon,
        "todo.assign",
        json!({"id":todo["id"],"owner":null}),
    )
    .await;
    assert_eq!(notices(&daemon, &home).await.len(), 2);
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":false}),
    )
    .await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    assert_eq!(notices(&daemon, &home).await.len(), 2);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_a_restart_resends_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    todo(&daemon, &home, "Persistent task", Value::Null).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let before = notices(&daemon, &home).await;
    assert_eq!(before.len(), 1);
    daemon.stop_terminals().await.unwrap();
    drop(daemon);
    let reopened = running_daemon(dir.path());
    call(&reopened, "rail.startDoor", json!({"id":home})).await;
    let after = notices(&reopened, &home).await;
    assert_eq!(
        after.iter().map(|m| &m["id"]).collect::<Vec<_>>(),
        before.iter().map(|m| &m["id"]).collect::<Vec<_>>()
    );
    reopened.stop_terminals().await.unwrap();
}

pub(crate) async fn as_door(daemon: &Daemon, home: &str, method: &str, params: Value) -> Value {
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: home.into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    daemon.route(&mut conn, method, params).await.unwrap()
}

#[tokio::test]
async fn a3308_the_door_assign_is_recorded_in_history() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let todo = todo(&daemon, &home, "Assign this", Value::Null).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let child = subagent(&daemon, &home, dir.path()).await;
    let owner = json!({"kind":"agent","id":child["id"],"parent":null});
    let actor = json!({"kind":"agent","id":home,"parent":null});
    let mut events = daemon.bus.subscribe();
    as_door(
        &daemon,
        &home,
        "todo.assign",
        json!({"id":todo["id"],"owner":owner}),
    )
    .await;
    let history = call(&daemon, "todo.getHistory", json!({"id":todo["id"]})).await;
    let change = history["changes"].as_array().unwrap().last().unwrap();
    assert_eq!(change["actor"], actor);
    assert_eq!(change["before"]["owner"], Value::Null);
    assert_eq!(change["after"]["owner"], owner);
    let mut updates = vec![];
    while let Ok(event) = events.try_recv() {
        if let contracts::EventData::TodoUpdated(todo) = event.data {
            updates.push(todo.owner);
        }
    }
    assert_eq!(updates, vec![Some(serde_json::from_value(owner).unwrap())]);
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_a_subagent_start_obeys_the_cap() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    call(&daemon, "project.setWorkstreamCap", json!({"cap":1})).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let todo = todo(&daemon, &home, "Delegate this", Value::Null).await;
    let child = as_door(&daemon, &home, "agent.spawn", json!({"cwd":dir.path(),"role":"job","order":{"kind":"work","ask":"Implement the Todo","done":"The Todo is implemented","limits":[]}})).await;
    as_door(
        &daemon,
        &home,
        "todo.assign",
        json!({"id":todo["id"],"owner":{"kind":"agent","id":child["id"]}}),
    )
    .await;
    let queue = call(&daemon, "workstream.queue", json!({})).await;
    assert_eq!(queue["running"], 1);
    assert_eq!(queue["cap"], 1);
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":todo["id"]})).await["owner"]["id"],
        child["id"]
    );
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3308_an_agent_cannot_authorize_auto() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: node["id"].as_str().unwrap().into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let error = daemon
        .route(
            &mut conn,
            "workstream.setAuto",
            json!({"id":node["id"],"auto":true}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, code::FORBIDDEN);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await[0]["auto"],
        false
    );
}

#[tokio::test]
async fn a3308_an_idle_auto_workstream_cannot_start_over_the_cap() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":home,"auto":true}),
    )
    .await;
    let node = call(&daemon, "rail.tree", Value::Null).await[0].clone();
    call(
        &daemon,
        "agent.signal",
        json!({"id":home,"attempt":node["attempt"],"payload":{"hook_event_name":"Stop"}}),
    )
    .await;
    let other = door(&daemon).await;
    call(&daemon, "project.setWorkstreamCap", json!({"cap":1})).await;
    let before = call(&daemon, "rail.tree", Value::Null).await;
    assert_ne!(home, other);
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: home.clone(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let result = daemon.route(&mut conn, "agent.spawn", json!({"cwd":dir.path(),"role":"job","order":{"kind":"work","ask":"Implement the Todo","done":"The Todo is implemented","limits":[]}})).await;
    assert_eq!(result.unwrap_err().code, code::CONFLICT);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null)
            .await
            .as_array()
            .unwrap()
            .len(),
        before.as_array().unwrap().len()
    );
    daemon.stop_terminals().await.unwrap();
}

async fn subagent(daemon: &Daemon, home: &str, cwd: &std::path::Path) -> Value {
    as_door(daemon, home, "agent.spawn", json!({"cwd":cwd,"role":"job","order":{"kind":"work","ask":"Implement the Todo","done":"The Todo is implemented","limits":[]}})).await
}

#[tokio::test]
async fn a3308_an_agent_cannot_enable_auto_by_claiming_user() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = running_daemon(dir.path());
    let home = door(&daemon).await;
    let peer = daemon
        .agents
        .running_programs()
        .into_iter()
        .find(|(id, _)| id == &home)
        .unwrap()
        .1;
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: Some(peer),
        events,
        output: None,
    };
    let response = daemon
        .dispatch(
            &mut conn,
            &json!({"id":1,"method":"workstream.setAuto","params":{"id":home,"auto":true}})
                .to_string(),
            None,
        )
        .await
        .unwrap()
        .into_value();
    assert_eq!(response["error"]["code"], code::FORBIDDEN);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await[0]["auto"],
        false
    );
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn u3523c_import_agent_receives_prompt_and_tools() {
    let root = tempfile::tempdir().unwrap();
    let daemon = running_daemon(root.path());
    let prompt = "  List recent sessions with import.list\nLeave confirmation to the user.  ";
    let node = call(
        &daemon,
        "agent.spawn",
        json!({"cwd":root.path(), "prompt":prompt, "parent":null, "name":"Import"}),
    )
    .await;
    assert_eq!(node["work"]["ask"], prompt);
    let id = node["id"].as_str().unwrap();
    let ctx = daemon.ctx(Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    });
    let refused = daemon.modules["project"]
        .call(&ctx, "project.importCommit", json!({"selections":[]}))
        .await;
    assert!(refused.is_err());
}
// In-memory Module fixtures keep the cost observer on the production Reader seam.
struct AutoFixture {
    todos: Vec<Value>,
    history: std::sync::Mutex<Vec<Value>>,
    sent: std::sync::Mutex<Vec<Value>>,
    changes: Value,
    fail: Option<&'static str>,
}
#[async_trait::async_trait]
impl Module for AutoFixture {
    fn namespaces(&self) -> &'static [&'static str] {
        &["rail", "todo", "message"]
    }
    async fn call(&self, _: &Ctx, method: &str, params: Value) -> Result<Value, RpcError> {
        if self.fail == Some(method) {
            return Err(RpcError::internal("required read failed"));
        }
        Ok(match method {
            "rail.tree" => {
                json!([{"id":"door","kind":"workstream","name":"Door","parent":null,"order":0,"status":{"kind":"idle","label":"","since":0,"finished":"0"},"attempt":"1","status_revision":"1","terminal_id":"t","worktree":null,"can_resume":false,"yolo":false,"stray":[],"auto":true}])
            }
            "todo.list" => json!(self.todos),
            "todo.getHistory" => self.changes.clone(),
            "message.list" => json!(*self.history.lock().unwrap()),
            "message.send" => {
                self.sent.lock().unwrap().push(params.clone());
                let message = auto_message(Actor::daemon(), params["body"].as_str().unwrap());
                self.history.lock().unwrap().push(message.clone());
                message
            }
            _ => return Err(RpcError::method_not_found(method)),
        })
    }
}
fn auto_message(from: Actor, body: &str) -> Value {
    json!({"id":1,"from":from,"to":"elsewhere","kind":"note","body":body,"replyTo":null,"status":"dropped","reason":null,"at":0})
}
fn auto_fixture(
    count: u32,
    history: Vec<Value>,
    changes: Vec<Value>,
) -> (Arc<AutoFixture>, digest::Reader) {
    let fixture = Arc::new(AutoFixture {
        todos: (1..=count).map(|id| json!({"id":id,"title":format!("Task {id}"),"body":"","done":false,"blocked":false,"blockers":[],"created_at":0,"updated_at":0,"creator":Actor::user(),"home":"door","owner":null,"refs":[],"priority":null})).collect(),
        history: std::sync::Mutex::new(history), sent: Default::default(), changes: json!({"changes":changes,"unread":null}), fail: None,
    });
    let modules = ["rail", "todo", "message"]
        .into_iter()
        .map(|name| (name, fixture.clone() as Arc<dyn Module>))
        .collect();
    let reader = digest::Reader::new(
        &modules,
        Bus::new(),
        Arc::new(provenance::Touches::in_memory().unwrap()),
        None,
        String::new(),
    );
    (fixture, reader)
}
fn auto_body(id: u32, seq: u32) -> String {
    format!(
        "[auto todo:{id} unassigned:{seq}]\nTodo #{id}: Task {id}\nTake this Todo with todo_assign {{\"id\": {id}, \"owner\": \"me\"}}. Delegate using a peer's Rail name as owner, or start a Subagent and assign it. Subagent starts obey the Workstream cap."
    )
}
#[tokio::test]
async fn ec5637d_auto_many_candidates_index_history_once() {
    let history = (1..=512)
        .map(|id| {
            auto_message(
                Actor::daemon(),
                &format!("[auto todo:{id} unassigned:0]\nold"),
            )
        })
        .collect();
    let (fixture, reader) = auto_fixture(128, history, vec![]);
    fixture.history.lock().unwrap().push(auto_message(
        Actor::user(),
        "[auto todo:1 unassigned:0]\nother author",
    ));
    // Half already told; the other half have a different retained firing identity.
    for row in fixture.history.lock().unwrap().iter_mut().take(64) {
        row["body"] = json!("[auto todo:999 unassigned:0]\nold");
    }
    let counts = auto::counts::measure(|| async { auto::tell(&reader).await.unwrap() }).await;
    assert_eq!(counts, (128, 512, 1));
    eprintln!("EC5637d [identity formations, eligible first lines, sorted indexes]: {counts:?}");
    let expected: Vec<_> = (1..=64)
        .map(|id| json!({"to":"door","kind":"note","body":auto_body(id,0)}))
        .collect();
    assert_eq!(*fixture.sent.lock().unwrap(), expected);
}
#[tokio::test]
async fn ec5637d_auto_zero_and_one_candidate_avoid_sorting() {
    for (candidates, body, sent, extracted) in [
        (0, "other\nold", false, 0),
        (1, "other\nold", true, 1),
        (1, "[auto todo:1 unassigned:0]\nold", false, 1),
    ] {
        let (fixture, reader) = auto_fixture(
            candidates,
            vec![auto_message(Actor::daemon(), body)],
            vec![],
        );
        let counts = auto::counts::measure(|| async { auto::tell(&reader).await.unwrap() }).await;
        assert_eq!(counts, (usize::try_from(candidates).unwrap(), extracted, 0));
        let expected = if sent {
            vec![json!({"to":"door","kind":"note","body":auto_body(1,0)})]
        } else {
            vec![]
        };
        assert_eq!(*fixture.sent.lock().unwrap(), expected);
    }
}
#[tokio::test]
async fn ec5637d_auto_identity_preserves_actor_and_history_predicates() {
    let key = "[auto todo:1 unassigned:7]";
    let mut different_kind = Actor::daemon();
    different_kind.kind = ActorKind::User;
    let mut different_id = Actor::daemon();
    different_id.id = "other".into();
    let mut different_parent = Actor::daemon();
    different_parent.parent = Some("other".into());
    for (actor, text, suppress) in [
        (Actor::daemon(), format!("{key}\nold"), true),
        (Actor::daemon(), key.into(), false),
        (Actor::daemon(), format!("{key}\r\nold"), false),
        (Actor::daemon(), format!("{key}longer\nold"), false),
        (
            Actor::daemon(),
            "[auto todo:1 unassigned:0]\nold".into(),
            false,
        ),
        (Actor::daemon(), format!("old\n{key}\n"), false),
        (Actor::daemon(), "Task 1\nTodo #1".into(), false),
        (different_kind, format!("{key}\nold"), false),
        (different_id, format!("{key}\nold"), false),
        (different_parent, format!("{key}\nold"), false),
    ] {
        let values = |owner: Value| json!({"title":"Task 1","body":"","done":false,"blockers":[],"home":"door","owner":owner,"refs":[],"priority":null});
        let change = |seq, before, after| json!({"seq":seq,"before":before,"after":after});
        let changes = vec![
            change(1, Value::Null, values(Value::Null)),
            change(5, values(Value::Null), values(json!(Actor::user()))),
            change(7, values(json!(Actor::user())), values(Value::Null)),
            change(9, values(Value::Null), values(Value::Null)),
            change(
                10,
                values(json!(Actor::user())),
                values(json!(Actor::user())),
            ),
        ];
        for count in [1, 2] {
            let (fixture, reader) = auto_fixture(
                count,
                vec![auto_message(actor.clone(), &text)],
                changes.clone(),
            );
            auto::tell(&reader).await.unwrap();
            let mut expected = if suppress {
                vec![]
            } else {
                vec![json!({"to":"door","kind":"note","body":auto_body(1,7)})]
            };
            if count == 2 {
                expected.push(json!({"to":"door","kind":"note","body":auto_body(2,7)}));
            }
            assert_eq!(*fixture.sent.lock().unwrap(), expected, "{text}");
            auto::tell(&reader).await.unwrap();
            assert_eq!(*fixture.sent.lock().unwrap(), expected, "repeat {text}");
        }
    }
}

#[tokio::test]
async fn ec5637d_auto_required_reads_propagate() {
    for method in [
        "rail.tree",
        "todo.list",
        "message.list",
        "todo.getHistory",
        "message.send",
    ] {
        let (mut fixture, _) = auto_fixture(1, vec![], vec![]);
        Arc::get_mut(&mut fixture).unwrap().fail = Some(method);
        let modules = ["rail", "todo", "message"]
            .into_iter()
            .map(|name| (name, fixture.clone() as Arc<dyn Module>))
            .collect();
        let reader = digest::Reader::new(
            &modules,
            Bus::new(),
            Arc::new(provenance::Touches::in_memory().unwrap()),
            None,
            String::new(),
        );
        assert!(auto::tell(&reader).await.is_err(), "{method}");
        assert!(fixture.sent.lock().unwrap().is_empty(), "{method}");
    }
}
