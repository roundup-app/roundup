use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;

use agents::claude_code::Launcher;
use contracts::agent::StatusEvent;
use contracts::{Actor, EventData, Kind, Status};
use rpc::{Bus, Client, Module};
use serde_json::{Value, json};
use tokio::net::UnixListener;

use super::{Daemon, serve};

#[tokio::test]
async fn a7_b1_b9_real_daemon_fences_old_status_after_door_restart() {
    let project = tempfile::tempdir().unwrap();
    let dir = project.path().join(".roundup");
    std::fs::create_dir(&dir).unwrap();
    let fake = project.path().join("fake-claude");
    std::fs::write(
        &fake,
        r#"#!/usr/bin/env python3
import json, pathlib, shlex, sys
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
# A20: read the Attempt from the hook's shell words, not the program's env.
settings = json.load(open(sys.argv[sys.argv.index('--settings') + 1]))
command = settings['hooks']['Stop'][0]['hooks'][0]['command']
assignment = shlex.split(command)[0]
assert assignment.startswith('ROUNDUP_ATTEMPT=')
attempt = assignment.removeprefix('ROUNDUP_ATTEMPT=')
for line in sys.stdin:
    with open(pathlib.Path(__file__).with_name('input'), 'a') as output:
        output.write(f'{attempt}:{line}')
"#,
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.path().join("rup");
    std::fs::write(&rup, "").unwrap();
    crate::storage::open(&dir).unwrap();
    let bus = Bus::new();
    let terminals = Arc::new(terminal::Terminals::open(&dir, bus.clone()).unwrap());
    let agents = Arc::new(
        agents::Agents::open_with(
            &dir,
            bus.clone(),
            terminals.clone(),
            Launcher::new(
                fake.to_str().unwrap(),
                project.path().join("claude.json"),
                rup,
                None,
            ),
            agents::worktree::Git::from_env(),
        )
        .unwrap(),
    );
    let touches = Arc::new(provenance::Touches::open(&dir.join("provenance.db")).unwrap());
    let mut daemon = Daemon {
        naming: Arc::new(std::sync::Mutex::new(
            crate::data::open_naming(&crate::data::naming_path(&dir)).unwrap(),
        )),
        terminals: terminals.clone(),
        program_changes: Default::default(),
        program_statuses: Default::default(),
        modules: Default::default(),
        todos: Arc::new(todos::Todos::open(&dir, bus.clone()).unwrap()),
        pads: Arc::new(pads::Pads::open(&dir, bus.clone()).unwrap()),
        specialists: Default::default(),
        bus: bus.clone(),
        project: dir.to_path_buf(),
        project_key: String::new(),
        touches,
        digests: Default::default(),
        pushes: Default::default(),
        waits: Default::default(),
        resources: Default::default(),
        publications: crate::deliverables::Publications::in_memory(dir.join("deliverables")),
        reactions: std::sync::Arc::new(crate::reaction::Reactions::in_memory()),
        prompt_effect_gate: None,
        actions: Default::default(),
        extensions: crate::extensions::Host::new(std::path::PathBuf::new()),
        agents: agents.clone(),
        renames: std::sync::Mutex::new(None),
        owner_events: std::sync::Mutex::new(None),
        wake_events: Default::default(),
        wake_gate: Default::default(),
        sender: Default::default(),
        restarting: Default::default(),
        queue: Default::default(),
        auto: crate::auto::Auto::new(&bus),
    };
    daemon.register(Arc::new(
        messages::Messages::open(&dir, bus.clone(), agents.clone()).unwrap(),
    ));
    daemon.register(agents);
    daemon.register(terminals);
    let daemon = Arc::new(daemon);
    let socket = project.path().join("rupd.sock");
    let serving = tokio::spawn(serve(UnixListener::bind(&socket).unwrap(), daemon.clone()));
    let client = Client::connect(&socket).await.unwrap();
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name":"workstream","parent":null}),
        )
        .await
        .unwrap();
    let id = workstream["id"].as_str().unwrap();
    let child = client
        .request(
            "agent.spawn",
            json!({"cwd":project.path(),"prompt":null,"parent":id}),
        )
        .await
        .unwrap();
    let first = client
        .request("rail.startDoor", json!({"id":id}))
        .await
        .unwrap();
    let send = json!({"to":id,"kind":"note","body":"pending"});
    let old = client.request("message.send", send.clone()).await.unwrap();
    client
        .request("agent.stop", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(
        client
            .request("message.send", send.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    let second = client
        .request("rail.startDoor", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(second["id"], first["id"]);
    assert_eq!(second["attempt"], "2");
    assert_ne!(second["terminal_id"], first["terminal_id"]);
    client
        .request(
            "terminal.write",
            json!({"id":second["terminal_id"],"data":"aGVsbG8K"}),
        )
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if std::fs::read_to_string(project.path().join("input"))
                .is_ok_and(|text| text.contains("2:hello"))
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let new = client.request("message.send", send.clone()).await.unwrap();
    assert_eq!(new["status"], "pending");
    let ext = Client::connect(&socket).await.unwrap();
    ext.request(
        "daemon.identify",
        json!({"actor":{"kind":"ext","id":"observer","parent":null}}),
    )
    .await
    .unwrap();
    let from_ext = ext.request("message.send", send).await.unwrap();
    assert_eq!(from_ext["status"], "pending");
    let mut events = Client::connect(&socket).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    bus.emit(
        Actor::daemon(),
        EventData::AgentStatus(Box::new(StatusEvent {
            ended: false,
            id: id.into(),
            attempt: "1".into(),
            status_revision: "1".into(),
            status: Status {
                kind: Kind::Done,
                label: "old exit".into(),
                since: 0,
                finished: "0".into(),
            },
        })),
    );
    // This subscription and Messages consume the same bus in FIFO order; a current-generation
    // status plus its dropped Message is the barrier that proves the old event was consumed.
    let barrier = client
        .request(
            "message.send",
            json!({"to":child["id"],"kind":"note","body":"barrier"}),
        )
        .await
        .unwrap();
    client
        .request("agent.stop", json!({"id":child["id"]}))
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let EventData::MessageDropped(message) = events.next_event().await.unwrap().data
                && json!(message.id) == barrier["id"]
            {
                break;
            }
        }
    })
    .await
    .unwrap();
    for (message, expected) in [(&old, "dropped"), (&new, "pending"), (&from_ext, "pending")] {
        let found = client
            .request("message.get", json!({"id":message["id"]}))
            .await
            .unwrap();
        assert_eq!(found["status"], expected);
    }
    let stale = client
        .request(
            "agent.signal",
            json!({"id":id,"attempt":"1","payload":{"hook_event_name":"Stop"}}),
        )
        .await
        .unwrap();
    // A20: the earlier Attempt's Signal is ignored, never an error to the caller.
    assert_eq!(stale, Value::Null);
    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    let nodes = tree.as_array().unwrap();
    assert_eq!(
        nodes.iter().find(|n| n["id"] == child["id"]).unwrap()["parent"],
        id
    );
    assert_eq!(
        nodes.iter().find(|n| n["id"] == workstream["id"]).unwrap()["terminal_id"],
        second["terminal_id"]
    );
    daemon.stop_terminals().await.unwrap();
    serving.abort();
}

/// Use the real stores, routing, lifecycle fold and vendor socket; only launch is controlled.
struct IdleDoor {
    _project: tempfile::TempDir,
    daemon: Daemon,
    launcher: Launcher,
    config: std::path::PathBuf,
    steers: Arc<std::sync::atomic::AtomicUsize>,
}

impl IdleDoor {
    fn new() -> Self {
        let project = tempfile::tempdir().unwrap();
        let config = project.path().join("vendor");
        std::fs::create_dir_all(config.join("sessions")).unwrap();
        let launcher = Launcher::new(
            "unused",
            config.join("claude.json"),
            project.path().join("rup"),
            None,
        );
        let steers = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recording = Arc::clone(&steers);
        let daemon =
            Daemon::open_stores(project.path(), &project.path().join(".roundup"), |agents| {
                agents
                    .with_launcher_for_test(launcher.clone())
                    .with_steer_effect(move |_| {
                        recording.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(())
                    })
            })
            .unwrap();
        Self {
            _project: project,
            daemon,
            launcher,
            config,
            steers,
        }
    }

    async fn call(&self, method: &str, params: Value) -> Value {
        let reply = crate::tests::ask(
            &self.daemon,
            &json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        )
        .await;
        assert!(reply.get("error").is_none(), "{reply}");
        reply["result"].clone()
    }

    async fn start(
        &self,
        kind: &str,
        parent: Option<&str>,
    ) -> (String, std::os::unix::net::UnixListener) {
        let id = if kind == "workstream" {
            self.call(
                "rail.createWorkstream",
                json!({"name":"Waiting","parent":null}),
            )
            .await["id"]
                .as_str()
                .unwrap()
                .to_owned()
        } else {
            let db = rusqlite::Connection::open(self.daemon.project.join(".roundup/project.db"))
                .unwrap();
            db.execute(
                "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','Direct',?,0)",
                [parent],
            )
            .unwrap();
            db.last_insert_rowid().to_string()
        };
        let socket = self.launcher.socket_path(&id);
        let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        listener.set_nonblocking(true).unwrap();
        let pid = std::process::id();
        std::fs::write(
            self.config.join(format!("sessions/{id}.json")),
            json!({"pid":pid,"peerProtocol":1,"messagingSocketPath":socket}).to_string(),
        )
        .unwrap();
        std::fs::write(
            self.config.join(format!("sessions/{id}.fixture.key")),
            json!({"peerToken":"isolated"}).to_string(),
        )
        .unwrap();
        self.daemon.agents.start_for_test(&id, None).unwrap();
        self.call(
            "agent.signal",
            json!({"id":id,"attempt":"1","payload":{"hook_event_name":"SessionStart"}}),
        )
        .await;
        self.daemon
            .agents
            .call(
                &self.daemon.ctx(Actor {
                    kind: contracts::ActorKind::Agent,
                    id: id.clone(),
                    parent: None,
                }),
                "agent.channelUp",
                json!({"id":id}),
            )
            .await
            .unwrap();
        (id, listener)
    }

    fn read(listener: &std::os::unix::net::UnixListener) -> Vec<Value> {
        use std::io::Read;
        let mut records = Vec::new();
        while let Ok((mut stream, _)) = listener.accept() {
            let mut text = String::new();
            stream.read_to_string(&mut text).unwrap();
            records.extend(
                text.lines()
                    .map(|line| serde_json::from_str::<Value>(line).unwrap())
                    .filter(|line| line["type"] == "user"),
            );
        }
        records
    }

    async fn idle(&self, id: &str, tick: u32) {
        self.call(
            "agent.signal",
            json!({"id":id,"attempt":"1","payload":{"hook_event_name":"Stop"}}),
        )
        .await;
        // A synchronous send drives the delivery worker through admission, not a timed absence.
        self.daemon
            .agents
            .coordinate(id, format!("automatic readiness note {tick}"))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn o3_an_unordered_workstream_sends_no_input_before_the_user() {
    let run = IdleDoor::new();
    let (id, listener) = run.start("workstream", None).await;
    for tick in 0..3 {
        run.idle(&id, tick).await;
    }
    assert!(IdleDoor::read(&listener).is_empty());
    assert_eq!(run.steers.load(std::sync::atomic::Ordering::SeqCst), 0);
    assert!(!run.daemon.agents.input_started(&id));
    let node = run.call("rail.tree", Value::Null).await;
    assert_eq!(node[0]["status"]["kind"], "idle");
    let note = run
        .call(
            "message.send",
            json!({"to":id,"kind":"note","body":"my first request"}),
        )
        .await;
    let records = IdleDoor::read(&listener);
    assert_eq!(records.len(), 1);
    assert!(
        records[0]["message"]["content"]
            .as_str()
            .unwrap()
            .contains("my first request")
    );
    assert_eq!(note["status"], "pending"); // Physical delivery is not a transcript receipt.
    assert!(run.daemon.agents.input_started(&id));
}

#[tokio::test]
async fn a5556a_user_started_agents_receive_no_automatic_first_input() {
    for (kind, in_home) in [("agent", false), ("agent", true), ("workstream", false)] {
        let run = IdleDoor::new();
        let home = run
            .call(
                "rail.createWorkstream",
                json!({"name":"Home","parent":null}),
            )
            .await;
        let (id, listener) = run
            .start(kind, in_home.then(|| home["id"].as_str().unwrap()))
            .await;
        for tick in 0..3 {
            run.idle(&id, tick).await;
        }
        assert!(IdleDoor::read(&listener).is_empty());
        assert_eq!(run.steers.load(std::sync::atomic::Ordering::SeqCst), 0);
        run.call(
            "message.send",
            json!({"to":id,"kind":"note","body":"begin with this"}),
        )
        .await;
        assert_eq!(IdleDoor::read(&listener).len(), 1);
        assert!(run.daemon.agents.input_started(&id));
    }
}

#[tokio::test(start_paused = true)]
async fn a5556b_automatic_delivery_waits_for_first_user_input() {
    for first_order in [false, true] {
        let run = IdleDoor::new();
        let (id, listener) = run.start("workstream", None).await;
        let messages = run.daemon.sender.get().unwrap();
        let mut observed = run.daemon.bus.subscribe();
        async fn produced(
            events: &mut tokio::sync::broadcast::Receiver<contracts::Event>,
            needle: &str,
        ) -> Value {
            tokio::time::timeout(std::time::Duration::from_secs(2), async {
                loop {
                    if let EventData::MessageSent(note) = events.recv().await.unwrap().data
                        && note.body.contains(needle)
                    {
                        return json!(note.id);
                    }
                }
            })
            .await
            .unwrap()
        }
        let mut pending = Vec::new();
        run.call("rail.rename", json!({"id":id,"name":"Waiting renamed"}))
            .await;
        pending.push(produced(&mut observed, "you are now called").await);
        let todo = run
            .call("todo.create", json!({"title":"owned task","owner":id}))
            .await;
        pending.push(produced(&mut observed, "assigned to you").await);
        run.call(
            "todo.comment",
            json!({"id":todo["id"],"body":"please check this"}),
        )
        .await;
        pending.push(produced(&mut observed, "please check this").await);
        let (source, source_socket) = run.start("agent", Some(&id)).await;
        let peer = run.daemon.ctx(Actor {
            kind: contracts::ActorKind::Agent,
            id: source.clone(),
            parent: Some(id.clone()),
        });
        let note = messages
            .call(
                &peer,
                "message.send",
                json!({"to":id,"kind":"note","body":"peer message"}),
            )
            .await
            .unwrap();
        pending.push(note["id"].clone());
        messages
            .push_digest(
                &id,
                "peer",
                &contracts::agent::DigestEntry {
                    name: "Peer".into(),
                    kind: Kind::Error,
                    last: "result needs attention".into(),
                    todos: 1,
                    pads: vec![],
                },
            )
            .await;
        pending.push(produced(&mut observed, "[digest]").await);
        // O13 allows an Agent to change its own order, but that never sends it an instruction.
        run.daemon
            .agents
            .call(
                &peer,
                "agent.setOrder",
                json!({"id":source,"order":{"kind":"work","ask":"stored only","limits":[]}}),
            )
            .await
            .unwrap();
        assert!(IdleDoor::read(&source_socket).is_empty());
        run.call("reaction.create", json!({
        "operation":"idle-admission", "name":"Continue later", "reason":"Observe delivery before first input",
        "target":id, "instruction":"reaction firing", "condition":{"kind":"agents","ids":[source]},
        "expires_at":"2099-01-01T00:00:00Z"
    })).await;
        pending.push(produced(&mut observed, "reaction firing").await);
        for tick in 0..3 {
            run.idle(&id, tick).await;
        }
        assert!(IdleDoor::read(&listener).is_empty());
        assert_eq!(run.steers.load(std::sync::atomic::Ordering::SeqCst), 0);
        for message in &pending {
            assert_eq!(
                run.call("message.get", json!({"id":message})).await["status"],
                "pending"
            );
        }
        if first_order {
            run.call(
                "agent.setOrder",
                json!({"id":id,"order":{"kind":"work","ask":"start now","limits":[]}}),
            )
            .await;
        } else {
            run.call(
                "message.send",
                json!({"to":id,"kind":"note","body":"start now"}),
            )
            .await;
        }
        let first = IdleDoor::read(&listener);
        assert_eq!(first.len(), 1);
        assert!(
            first[0]["message"]["content"]
                .as_str()
                .unwrap()
                .contains("start now")
        );
        // The first input itself schedules pending delivery, without another event.
        let listener = tokio::net::UnixListener::from_std(listener).unwrap();
        let later = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            use tokio::io::AsyncReadExt;
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut text = String::new();
            stream.read_to_string(&mut text).await.unwrap();
            text.lines()
                .map(|line| serde_json::from_str::<Value>(line).unwrap())
                .filter(|line| line["type"] == "user")
                .collect::<Vec<_>>()
        })
        .await
        .unwrap();
        assert!(later.len() >= pending.len());
        let transcript = run._project.path().join("transcript.jsonl");
        let receipts = later
            .iter()
            .map(|line| json!({"origin":{"kind":"peer","msg_id":line["msg_id"]}}).to_string())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        std::fs::write(&transcript, receipts).unwrap();
        run.call("agent.signal", json!({"id":id,"attempt":"1","payload":{"hook_event_name":"Stop","transcript_path":transcript}})).await;
        for message in pending {
            assert_eq!(
                run.call("message.get", json!({"id":message})).await["status"],
                "delivered"
            );
        }
    }
}
