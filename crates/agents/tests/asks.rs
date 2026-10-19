use agents::{
    Asks,
    placement::{AskPart, Destination, Placement, Request},
};
use async_trait::async_trait;
use contracts::{Actor, ActorKind};
use rpc::{Bus, Ctx, Module, code};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

struct Call {
    request: Request,
    answer: oneshot::Sender<Vec<AskPart>>,
}
struct Controlled {
    calls: mpsc::UnboundedSender<Call>,
    count: Arc<AtomicUsize>,
}
#[async_trait]
impl Placement for Controlled {
    async fn call(&self, _: &str, request: &Request) -> Result<Vec<AskPart>, String> {
        self.count.fetch_add(1, Ordering::SeqCst);
        let (answer, result) = oneshot::channel();
        self.calls
            .send(Call {
                request: request.clone(),
                answer,
            })
            .unwrap();
        result.await.map_err(|_| "observer ended".into())
    }
}
struct Harness {
    asks: Asks,
    agents: Arc<agents::Agents>,
    ctx: Ctx,
    calls: mpsc::UnboundedReceiver<Call>,
    count: Arc<AtomicUsize>,
}
impl Harness {
    fn open(dir: &std::path::Path) -> Self {
        let bus = Bus::new();
        let terminals = Arc::new(terminal::Terminals::open(dir, bus.clone()).unwrap());
        let agents = Arc::new(
            agents::Agents::open_with(
                dir,
                bus.clone(),
                terminals,
                agents::claude_code::Launcher::new(
                    "false",
                    dir.join("config"),
                    dir.join("rup"),
                    None,
                ),
                agents::worktree::Git::from_env(),
            )
            .unwrap(),
        );
        let (tx, calls) = mpsc::unbounded_channel();
        let count = Arc::new(AtomicUsize::new(0));
        let asks = Asks::open(
            dir,
            bus.clone(),
            agents.clone(),
            Arc::new(Controlled {
                calls: tx,
                count: count.clone(),
            }),
        )
        .unwrap();
        let ctx = Ctx {
            actor: Actor::user(),
            bus,
            touches: Arc::new(provenance::Touches::open(&dir.join("touches.db")).unwrap()),
        };
        Self {
            asks,
            agents,
            ctx,
            calls,
            count,
        }
    }
    async fn send(&self, text: &str) -> Value {
        self.asks
            .call(&self.ctx, "ask.send", json!({"text":text}))
            .await
            .unwrap()
    }
    async fn list(&self) -> Value {
        self.asks
            .call(&self.ctx, "ask.list", Value::Null)
            .await
            .unwrap()
    }
    async fn waiting(&mut self, text: &str) -> Value {
        let mut events = self.ctx.bus.subscribe();
        let ask = self.send(text).await;
        let call = self.calls.recv().await.unwrap();
        call.answer
            .send(vec![AskPart {
                text: text.into(),
                destination: Destination::Unclear {
                    question: "Where?".into(),
                    candidates: vec![],
                },
            }])
            .unwrap();
        loop {
            let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap();
            if let contracts::EventData::AskChanged { ask: changed } = event.data {
                let changed = serde_json::to_value(changed).unwrap();
                if changed["id"] == ask["id"] && changed["parts"][0]["state"] == "waiting" {
                    return changed;
                }
            }
        }
    }
}

#[tokio::test]
async fn a40_send_returns_at_once_and_the_parts_follow() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let ask = tokio::time::timeout(Duration::from_secs(1), h.send("keep my words"))
        .await
        .unwrap();
    assert_eq!(ask["parts"][0]["state"], "placing");
    assert_eq!(h.list().await[0], ask);
    let call = h.calls.recv().await.unwrap();
    assert_eq!(
        serde_json::to_value(&call.request).unwrap()["text"],
        "keep my words"
    );
    let mut events = h.ctx.bus.subscribe();
    call.answer
        .send(vec![AskPart {
            text: "keep my words".into(),
            destination: Destination::Unclear {
                question: "Which work?".into(),
                candidates: vec![],
            },
        }])
        .unwrap();
    let changed = tokio::time::timeout(Duration::from_secs(1), events.recv())
        .await
        .unwrap()
        .unwrap();
    let wire = serde_json::to_value(changed).unwrap();
    assert_eq!(wire["name"], "ask.changed");
    assert_eq!(wire["data"]["ask"]["parts"][0]["state"], "waiting");
    assert_eq!(
        h.list().await[0]["parts"][0]["placement"]["question"],
        "Which work?"
    );
}

#[tokio::test]
async fn a40_a_two_topic_message_becomes_two_parts() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let mut events = h.ctx.bus.subscribe();
    h.send("fix café; ship 🚀").await;
    let call = h.calls.recv().await.unwrap();
    call.answer
        .send(
            ["fix café", "ship 🚀"]
                .map(|text| AskPart {
                    text: text.into(),
                    destination: Destination::Unclear {
                        question: "Where?".into(),
                        candidates: vec![],
                    },
                })
                .to_vec(),
        )
        .unwrap();
    loop {
        let wire = serde_json::to_value(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if wire["data"]["ask"]["parts"]
            .as_array()
            .is_some_and(|parts| parts.len() == 2)
        {
            assert_eq!(wire["data"]["ask"]["parts"][0]["text"], "fix café");
            assert_eq!(wire["data"]["ask"]["parts"][1]["text"], "ship 🚀");
            break;
        }
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a40_naming_a_workstream_makes_no_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let mut events = h.ctx.bus.subscribe();
    h.send("@missing /skill café\n x").await;
    loop {
        let wire = serde_json::to_value(
            tokio::time::timeout(Duration::from_secs(1), events.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if wire["data"]["ask"]["parts"][0]["state"] == "waiting" {
            assert_eq!(wire["data"]["ask"]["parts"][0]["text"], "/skill café\n x");
            assert_eq!(
                wire["data"]["ask"]["parts"][0]["placement"]["question"],
                "No Workstream is named missing"
            );
            break;
        }
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
    assert_eq!(
        h.agents
            .call(&h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn a40_bounds_store_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    for text in [" \n\t".to_string(), "é".repeat(16_385)] {
        let err = h
            .asks
            .call(&h.ctx, "ask.send", json!({"text":text}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    assert_eq!(h.list().await, json!([]));
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[test]
fn a40_asks_survive_a_restart_and_placing_becomes_unclear() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    };
    let id = runtime().block_on(async {
        let mut h = Harness::open(dir.path());
        h.waiting("first").await;
        h.send("second").await["id"].clone()
    });
    runtime().block_on(async {
        let h = Harness::open(dir.path());
        let asks = h.list().await;
        assert_eq!(asks.as_array().unwrap().len(), 2);
        assert_eq!(asks[0]["id"], id);
        assert_eq!(
            asks[0]["parts"][0]["placement"]["question"],
            "roundup restarted before placing this"
        );
        assert_eq!(asks[0]["parts"][0]["state"], "waiting");
        assert_eq!(asks[1]["text"], "first");
        assert_eq!(h.count.load(Ordering::SeqCst), 0);
    });
}

#[tokio::test]
async fn a40_an_agent_cannot_call_the_ask_methods() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    h.ctx.actor = Actor {
        kind: ActorKind::Agent,
        id: "door".into(),
        parent: None,
    };
    for method in ["ask.send", "ask.list", "ask.pick"] {
        assert_eq!(
            h.asks
                .call(&h.ctx, method, json!({}))
                .await
                .unwrap_err()
                .code,
            code::FORBIDDEN
        );
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a42_a_pick_can_drop_without_usage_and_cannot_repeat() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let ask = h.waiting("/skill x").await;
    let picked = h
        .asks
        .call(
            &h.ctx,
            "ask.pick",
            json!({"id":ask["id"],"part":0,"target":{"kind":"drop"}}),
        )
        .await
        .unwrap();
    assert_eq!(picked["parts"][0]["state"], "dropped");
    assert_eq!(
        h.asks
            .call(
                &h.ctx,
                "ask.pick",
                json!({"id":ask["id"],"part":0,"target":{"kind":"drop"}})
            )
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    assert_eq!(h.count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a42_an_invalid_pick_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::open(dir.path());
    let ask = h.waiting("work").await;
    for target in [
        json!({"kind":"workstream","id":"missing"}),
        json!({"kind":"new","title":"one two three four five six seven"}),
    ] {
        assert_eq!(
            h.asks
                .call(
                    &h.ctx,
                    "ask.pick",
                    json!({"id":ask["id"],"part":0,"target":target})
                )
                .await
                .unwrap_err()
                .code,
            code::INVALID_PARAMS
        );
        assert_eq!(h.list().await[0], ask);
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 1);
}

struct Recorder {
    refuse: Arc<AtomicBool>,
    writer: Box<dyn std::io::Write + Send>,
    tx: mpsc::UnboundedSender<Vec<u8>>,
    bytes: Vec<u8>,
}
impl std::io::Write for Recorder {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.refuse.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("Terminal refused the write"));
        }
        let n = self.writer.write(bytes)?;
        self.bytes.extend_from_slice(&bytes[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.writer.flush()?;
        self.tx.send(std::mem::take(&mut self.bytes)).unwrap();
        Ok(())
    }
}
const ASK_BOUND: Duration = Duration::from_secs(1);

struct DoorHarness {
    h: Harness,
    bytes: mpsc::UnboundedReceiver<Vec<u8>>,
    terminals: Arc<terminal::Terminals>,
    refuse: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
}
impl DoorHarness {
    fn open(dir: &std::path::Path) -> Self {
        Self::open_with_bound(dir, ASK_BOUND)
    }
    fn open_with_bound(dir: &std::path::Path, bound: Duration) -> Self {
        use std::os::unix::fs::PermissionsExt;
        let bin = dir.join("program");
        let rup = dir.join("rup");
        std::fs::write(&rup, "").unwrap();
        std::fs::write(&bin,"#!/bin/sh\nif [ \"$1\" = plugin ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nstty raw -echo\nprintf '\\033]0;✳ Claude Code\\007'\nexec cat >/dev/null\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let bus = Bus::new();
        let (tx, bytes) = mpsc::unbounded_channel();
        let refuse = Arc::new(AtomicBool::new(false));
        let refused = refuse.clone();
        let ended = Arc::new(AtomicBool::new(false));
        let gone = ended.clone();
        let terminals = Arc::new(
            terminal::Terminals::open(dir, bus.clone())
                .unwrap()
                .with_input_writer(move |writer| {
                    Box::new(Recorder {
                        refuse: refused.clone(),
                        writer,
                        tx: tx.clone(),
                        bytes: vec![],
                    })
                }),
        );
        let agents = Arc::new(
            agents::Agents::open_with(
                dir,
                bus.clone(),
                terminals.clone(),
                agents::claude_code::Launcher::new(
                    bin.to_str().unwrap(),
                    dir.join("config"),
                    rup,
                    None,
                ),
                agents::worktree::Git::from_env(),
            )
            .unwrap()
            .with_context(|_, _| async { Ok("Context must not enter a new Ask's Steer".into()) })
            .with_steer_bound(bound)
            .with_steer_effect(move |_| {
                if gone.load(Ordering::SeqCst) {
                    Err(rpc::RpcError::not_found("Door ended before write"))
                } else {
                    Ok(())
                }
            }),
        );
        let (tx, calls) = mpsc::unbounded_channel();
        let count = Arc::new(AtomicUsize::new(0));
        let asks = Asks::open(
            dir,
            bus.clone(),
            agents.clone(),
            Arc::new(Controlled {
                calls: tx,
                count: count.clone(),
            }),
        )
        .unwrap();
        let ctx = Ctx {
            actor: Actor::user(),
            bus,
            touches: Arc::new(provenance::Touches::open(&dir.join("touches.db")).unwrap()),
        };
        Self {
            h: Harness {
                asks,
                agents,
                ctx,
                calls,
                count,
            },
            bytes,
            terminals,
            refuse,
            ended,
        }
    }
    async fn signal(&self, id: &str, event: &str) {
        let tree = self
            .h
            .agents
            .call(&self.h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap();
        let node = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == id)
            .unwrap();
        self.h
            .agents
            .call(
                &self.h.ctx,
                "agent.signal",
                json!({"id":id,"attempt":node["attempt"],"payload":{"hook_event_name":event}}),
            )
            .await
            .unwrap();
    }
    async fn read_write(&mut self) -> Vec<u8> {
        tokio::time::timeout(Duration::from_secs(5), self.bytes.recv())
            .await
            .unwrap()
            .unwrap()
    }
    /// Every write of one Steer, joined: they end with the `\r` that submits it.
    async fn read(&mut self) -> Vec<u8> {
        let mut steer = vec![];
        while !steer.ends_with(b"\r") {
            steer.extend(self.read_write().await);
        }
        steer
    }
    async fn workstream(&self) -> String {
        self.h.agents.call(&self.h.ctx,"rail.createWorkstream",json!({"name":"Work","order":{"kind":"work","title":"Work","ask":"initial","limits":[]}})).await.unwrap()["id"].as_str().unwrap().into()
    }
    async fn start(&mut self, id: &str) {
        let node = self
            .h
            .agents
            .call(&self.h.ctx, "rail.startDoor", json!({"id":id}))
            .await
            .unwrap();
        self.signal(id, "SessionStart").await;
        let initial = self.read().await;
        assert!(String::from_utf8_lossy(&initial).contains("initial"));
        self.signal(id, "UserPromptSubmit").await;
        assert_eq!(
            self.h
                .agents
                .first_steer_completion(id, node["attempt"].as_str().unwrap())
                .await
                .unwrap(),
            agents::FirstSteerCompletion::Submitted
        );
        self.signal(id, "Stop").await;
    }
    async fn changed(
        &self,
        events: &mut tokio::sync::broadcast::Receiver<contracts::Event>,
        id: &Value,
        state: &str,
    ) -> Value {
        loop {
            let wire = serde_json::to_value(
                tokio::time::timeout(Duration::from_secs(5), events.recv())
                    .await
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
            if wire["data"]["ask"]["id"] == *id && wire["data"]["ask"]["parts"][0]["state"] == state
            {
                return wire["data"]["ask"].clone();
            }
        }
    }
    async fn stop(&self) {
        for terminal in self.terminals.list() {
            if terminal.running {
                self.terminals.kill(&terminal.id).await.unwrap();
            }
        }
    }
}
fn paste(text: &str) -> Vec<u8> {
    format!("\x1b[200~{text}\x1b[201~\r").into_bytes()
}

#[tokio::test]
async fn a41_the_door_gets_the_users_words_byte_for_byte() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    f.h.agents
        .call(&f.h.ctx, "rail.rename", json!({"id":id,"name":"Café Work"}))
        .await
        .unwrap();
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@CAFÉ WORK /skill café\n  🚀  ").await;
    assert_eq!(f.read().await, paste("/skill café\n  🚀  "));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    assert_eq!(f.h.count.load(Ordering::SeqCst), 0);
    f.stop().await;
}

#[tokio::test]
async fn a41_the_enter_is_its_own_write_after_the_paste() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work hello").await;
    assert_eq!(f.read_write().await, b"\x1b[200~hello\x1b[201~");
    assert_eq!(f.read_write().await, b"\r");
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    f.stop().await;
}

#[tokio::test]
async fn a41_a_busy_door_gets_the_part_at_its_next_idle() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    f.signal(&id, "UserPromptSubmit").await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work later").await;
    f.changed(&mut events, &ask["id"], "queued").await;
    assert!(f.bytes.try_recv().is_err());
    f.signal(&id, "Stop").await;
    assert_eq!(f.read().await, paste("later"));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    f.stop().await;
}

#[tokio::test]
async fn a41_two_parts_for_one_door_go_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    f.signal(&id, "UserPromptSubmit").await;
    let mut events = f.h.ctx.bus.subscribe();
    let one = f.h.send("@Work one").await;
    f.changed(&mut events, &one["id"], "queued").await;
    let two = f.h.send("@Work two").await;
    f.changed(&mut events, &two["id"], "queued").await;
    f.signal(&id, "Stop").await;
    assert_eq!(f.read().await, paste("one"));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &one["id"], "typed").await;
    assert!(f.bytes.try_recv().is_err());
    assert_eq!(f.h.list().await[0]["parts"][0]["state"], "queued");
    f.signal(&id, "Stop").await;
    assert_eq!(f.read().await, paste("two"));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &two["id"], "typed").await;
    f.stop().await;
}

#[tokio::test]
async fn a41_a_stopped_door_is_started_first() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work later").await;
    loop {
        if matches!(
            tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .unwrap()
                .unwrap()
                .data,
            contracts::EventData::RailChanged
        ) {
            break;
        }
    }
    f.signal(&id, "SessionStart").await;
    assert!(String::from_utf8_lossy(&f.read().await).contains("initial"));
    f.signal(&id, "UserPromptSubmit").await;
    assert!(f.bytes.try_recv().is_err());
    f.signal(&id, "Stop").await;
    assert_eq!(f.read().await, paste("later"));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    f.stop().await;
}

#[tokio::test]
async fn a42_a_new_part_makes_and_starts_one_workstream_with_the_ask_alone() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("/skill café").await;
    f.h.calls
        .recv()
        .await
        .unwrap()
        .answer
        .send(vec![AskPart {
            text: "/skill café".into(),
            destination: Destination::New {
                title: "Café".into(),
            },
        }])
        .unwrap();
    let id = loop {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .unwrap()
            .unwrap();
        if matches!(event.data, contracts::EventData::RailChanged) {
            let tree =
                f.h.agents
                    .call(&f.h.ctx, "rail.tree", Value::Null)
                    .await
                    .unwrap();
            if tree[0]["terminal_id"].is_string() {
                break tree[0]["id"].as_str().unwrap().to_owned();
            }
        }
    };
    f.signal(&id, "SessionStart").await;
    assert_eq!(f.read().await, paste("/skill café"));
    f.signal(&id, "UserPromptSubmit").await;
    let typed = f.changed(&mut events, &ask["id"], "typed").await;
    assert_eq!(typed["parts"][0]["placement"]["workstream"], id);
    let tree =
        f.h.agents
            .call(&f.h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap();
    assert_eq!(tree.as_array().unwrap().len(), 1);
    assert_eq!(tree[0]["work"]["ask"], "/skill café");
    f.stop().await;
}

#[tokio::test]
async fn a42_a_pick_routes_the_original_words_without_a_placement_call() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    let ask = f.h.waiting("/skill picked café").await;
    let mut events = f.h.ctx.bus.subscribe();
    f.h.asks
        .call(
            &f.h.ctx,
            "ask.pick",
            json!({"id":ask["id"],"part":0,"target":{"kind":"workstream","id":id}}),
        )
        .await
        .unwrap();
    assert_eq!(f.read().await, paste("/skill picked café"));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    assert_eq!(f.h.count.load(Ordering::SeqCst), 1);
    f.stop().await;
}

#[tokio::test]
async fn a42_a_failed_start_leaves_no_workstream_and_can_be_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    std::fs::remove_file(dir.path().join("program")).unwrap();
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("new work").await;
    f.h.calls
        .recv()
        .await
        .unwrap()
        .answer
        .send(vec![AskPart {
            text: "new work".into(),
            destination: Destination::New {
                title: "New work".into(),
            },
        }])
        .unwrap();
    let failed = f.changed(&mut events, &ask["id"], "failed").await;
    assert!(failed["parts"][0]["reason"].is_string());
    assert_eq!(
        f.h.agents
            .call(&f.h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap(),
        json!([])
    );
    let dropped =
        f.h.asks
            .call(
                &f.h.ctx,
                "ask.pick",
                json!({"id":ask["id"],"part":0,"target":{"kind":"drop"}}),
            )
            .await
            .unwrap();
    assert_eq!(dropped["parts"][0]["state"], "dropped");
    assert_eq!(f.h.count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a41_removing_a_workstream_fails_its_queued_part() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    f.signal(&id, "UserPromptSubmit").await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work later").await;
    f.changed(&mut events, &ask["id"], "queued").await;
    f.h.agents
        .call(&f.h.ctx, "rail.remove", json!({"id":id}))
        .await
        .unwrap();
    let failed = f.changed(&mut events, &ask["id"], "failed").await;
    assert_eq!(failed["parts"][0]["reason"], "the Workstream was removed");
    // Removal ends Claude Code with its exit keys and types nothing of the part.
    let mut typed = vec![];
    while let Ok(chunk) = f.bytes.try_recv() {
        typed.extend(chunk);
    }
    assert_eq!(
        typed,
        agents::claude_code::EXIT_KEY.repeat(agents::claude_code::EXIT_PRESSES)
    );
    f.stop().await;
}

#[test]
fn a41_a_killed_daemon_never_types_a_part_twice() {
    const OBSERVER: &str = "ROUNDUP_A41_CRASH_STORE";
    let runtime = || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    };
    if let Some(path) = std::env::var_os(OBSERVER) {
        runtime().block_on(async {
            let mut f = DoorHarness::open(std::path::Path::new(&path));
            let id = f.workstream().await;
            f.start(&id).await;
            f.h.send("@Work once").await;
            assert_eq!(f.read().await, paste("once"));
            // No submit acknowledgement or destructors: kill the process after physical bytes.
            std::process::exit(0);
        });
        unreachable!();
    }
    let dir = tempfile::tempdir().unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "a41_a_killed_daemon_never_types_a_part_twice",
            "--nocapture",
        ])
        .env(OBSERVER, dir.path())
        .status()
        .unwrap();
    assert!(status.success());
    runtime().block_on(async {
        let h = Harness::open(dir.path());
        let asks = h.list().await;
        assert_eq!(asks[0]["parts"][0]["state"], "typed");
        assert_eq!(asks[0]["parts"][0]["text"], "once");
        assert_eq!(h.count.load(Ordering::SeqCst), 0);
        let tree = h
            .agents
            .call(&h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap();
        assert_eq!(tree[0]["status"]["kind"], "done");
    });
}

#[tokio::test]
async fn a40_an_ambiguous_name_waits_without_a_call() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    for _ in 0..2 {
        h.agents
            .call(&h.ctx, "rail.createWorkstream", json!({"name":"Same"}))
            .await
            .unwrap();
    }
    let mut events = h.ctx.bus.subscribe();
    let ask = h.send("@same words").await;
    loop {
        let wire = serde_json::to_value(
            tokio::time::timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        if wire["data"]["ask"]["id"] == ask["id"]
            && wire["data"]["ask"]["parts"][0]["state"] == "waiting"
        {
            assert_eq!(
                wire["data"]["ask"]["parts"][0]["placement"]["question"],
                "2 Workstreams are named same"
            );
            assert_eq!(
                wire["data"]["ask"]["parts"][0]["placement"]["candidates"]
                    .as_array()
                    .unwrap()
                    .len(),
                2
            );
            break;
        }
    }
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a42_picking_new_uses_the_first_six_words_as_its_title() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let ask = f.h.waiting("one two three four five six seven").await;
    let mut events = f.h.ctx.bus.subscribe();
    f.h.asks
        .call(
            &f.h.ctx,
            "ask.pick",
            json!({"id":ask["id"],"part":0,"target":{"kind":"new"}}),
        )
        .await
        .unwrap();
    let id = loop {
        if matches!(
            tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .unwrap()
                .unwrap()
                .data,
            contracts::EventData::RailChanged
        ) {
            let tree =
                f.h.agents
                    .call(&f.h.ctx, "rail.tree", Value::Null)
                    .await
                    .unwrap();
            if tree[0]["terminal_id"].is_string() {
                assert_eq!(tree[0]["work"]["title"], "one two three four five six");
                break tree[0]["id"].as_str().unwrap().to_owned();
            }
        }
    };
    f.signal(&id, "SessionStart").await;
    assert_eq!(f.read().await, paste("one two three four five six seven"));
    f.signal(&id, "UserPromptSubmit").await;
    f.changed(&mut events, &ask["id"], "typed").await;
    assert_eq!(f.h.count.load(Ordering::SeqCst), 1);
    f.stop().await;
}

#[tokio::test]
async fn a2703a_failed_ask_reason_uses_rail_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open_with_bound(dir.path(), Duration::from_millis(100));
    rusqlite::Connection::open(dir.path().join("agents.db")).unwrap()
        .execute_batch("DELETE FROM sqlite_sequence WHERE name = 'nodes'; INSERT INTO sqlite_sequence(name,seq) VALUES('nodes',7012)").unwrap();
    let id = f.workstream().await;
    f.start(&id).await;
    for name in ["sad", "glad"] {
        f.h.agents
            .call(&f.h.ctx, "rail.rename", json!({"id":id,"name":name}))
            .await
            .unwrap();
        let mut events = f.h.ctx.bus.subscribe();
        let ask = f.h.send(&format!("@{name} hello")).await;
        f.read().await;
        let failed = f.changed(&mut events, &ask["id"], "failed").await;
        assert_eq!(
            failed["parts"][0]["reason"],
            format!("{name} did not accept the prompt")
        );
    }
    f.stop().await;
}

#[tokio::test]
async fn a41_the_part_reads_typed_before_the_wait_ends() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work hello").await;
    assert_eq!(f.read().await, paste("hello"));
    f.changed(&mut events, &ask["id"], "typed").await;
    f.signal(&id, "UserPromptSubmit").await;
    f.stop().await;
}

#[tokio::test]
async fn a41_a_clear_ask_ends_typed_never_failed() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work /clear").await;
    assert_eq!(f.read().await, paste("/clear"));
    f.signal(&id, "SessionStart").await;
    // Observe past H11's acceptance bound: no late failure may replace typed.
    let observed = tokio::time::timeout(ASK_BOUND * 2, async {
        loop {
            let wire = serde_json::to_value(events.recv().await.unwrap()).unwrap();
            if wire["data"]["ask"]["id"] == ask["id"] {
                assert_ne!(wire["data"]["ask"]["parts"][0]["state"], "failed");
            }
        }
    })
    .await;
    assert!(observed.is_err());
    assert_eq!(f.h.list().await[0]["parts"][0]["state"], "typed");
    assert!(f.bytes.try_recv().is_err());
    f.stop().await;
}

#[tokio::test]
async fn a41_a_real_non_acceptance_still_fails() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask = f.h.send("@Work /model").await;
    assert_eq!(f.read().await, paste("/model"));
    f.changed(&mut events, &ask["id"], "typed").await;
    let failed = f.changed(&mut events, &ask["id"], "failed").await;
    assert_eq!(
        failed["parts"][0]["reason"],
        "Work did not accept the prompt".to_owned()
    );
    assert!(f.bytes.try_recv().is_err());
    f.stop().await;
}

#[tokio::test]
async fn a41_a_failed_write_or_ended_door_fails_without_sent() {
    for ended in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let mut f = DoorHarness::open(dir.path());
        let id = f.workstream().await;
        f.start(&id).await;
        f.refuse.store(!ended, Ordering::SeqCst);
        f.ended.store(ended, Ordering::SeqCst);
        let mut events = f.h.ctx.bus.subscribe();
        let ask = f.h.send("@Work /clear").await;
        let failed = loop {
            let wire = serde_json::to_value(
                tokio::time::timeout(ASK_BOUND * 2, events.recv())
                    .await
                    .unwrap()
                    .unwrap(),
            )
            .unwrap();
            if wire["data"]["ask"]["id"] == ask["id"] {
                let part = &wire["data"]["ask"]["parts"][0];
                assert_ne!(part["state"], "typed");
                if part["state"] == "failed" {
                    break part.clone();
                }
            }
        };
        let reason = if ended {
            "the Door ended before this reached it".to_owned()
        } else {
            "Work did not accept the prompt".to_owned()
        };
        assert_eq!(failed["reason"], reason);
        assert!(f.bytes.try_recv().is_err());
        f.stop().await;
    }
}

#[tokio::test]
async fn u2773b_submission_replay_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let request = json!({"text":" exact 🌿\n ","submission":"revision-a"});
    let first = {
        let h = Harness::open(dir.path());
        h.asks
            .call(&h.ctx, "ask.send", request.clone())
            .await
            .unwrap()
    };
    let h = Harness::open(dir.path());
    let replay = h.asks.call(&h.ctx, "ask.send", request).await.unwrap();
    assert_eq!(first["id"], replay["id"]);
    assert_eq!(replay["submission"], "revision-a");
    assert_eq!(replay["text"], " exact 🌿\n ");
    assert_eq!(h.list().await.as_array().unwrap().len(), 1);
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn u2773b_conflicting_submission_refuses() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    h.asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"original","submission":"a"}),
        )
        .await
        .unwrap();
    let err = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"changed","submission":"a"}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(h.list().await[0]["text"], "original");
    assert_eq!(h.list().await.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn u2773b_equal_text_can_be_two_intentional_submissions() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let first = h
        .asks
        .call(&h.ctx, "ask.send", json!({"text":"same","submission":"a"}))
        .await
        .unwrap();
    let other = h
        .asks
        .call(&h.ctx, "ask.send", json!({"text":"same","submission":"b"}))
        .await
        .unwrap();
    assert_ne!(first["id"], other["id"]);
}

#[tokio::test]
async fn u2773a_captured_destination_ignores_rename_before_placement() {
    let dir = tempfile::tempdir().unwrap();
    let mut f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    f.start(&id).await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask =
        f.h.asks
            .call(
                &f.h.ctx,
                "ask.send",
                json!({"text":" exact 🌿\n ","submission":"a","workstream":id}),
            )
            .await
            .unwrap();
    f.h.agents
        .call(&f.h.ctx, "rail.rename", json!({"id":id,"name":"Renamed"}))
        .await
        .unwrap();
    let replacement =
        f.h.agents
            .call(&f.h.ctx, "rail.createWorkstream", json!({"name":"Work"}))
            .await
            .unwrap();
    assert_eq!(f.read().await, paste(" exact 🌿\n "));
    let typed = f.changed(&mut events, &ask["id"], "typed").await;
    assert_eq!(typed["parts"][0]["placement"]["workstream"], id);
    let tree =
        f.h.agents
            .call(&f.h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == replacement["id"])
            .unwrap()["terminal_id"]
            .is_null()
    );
    assert_eq!(f.h.count.load(Ordering::SeqCst), 0);
    f.stop().await;
}

#[tokio::test]
async fn u2773a_removed_captured_destination_refuses_without_retargeting() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let original = h
        .agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":"Work"}))
        .await
        .unwrap();
    h.agents
        .call(&h.ctx, "rail.remove", json!({"id":original["id"]}))
        .await
        .unwrap();
    h.agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":"Work"}))
        .await
        .unwrap();
    let err = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"exact","submission":"a","workstream":original["id"]}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert_eq!(h.list().await, json!([]));
    assert_eq!(h.count.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn u2773a_removal_after_intake_never_routes_to_a_replacement() {
    let dir = tempfile::tempdir().unwrap();
    let f = DoorHarness::open(dir.path());
    let id = f.workstream().await;
    let mut events = f.h.ctx.bus.subscribe();
    let ask =
        f.h.asks
            .call(
                &f.h.ctx,
                "ask.send",
                json!({"text":"exact","submission":"a","workstream":id}),
            )
            .await
            .unwrap();
    f.h.agents
        .call(&f.h.ctx, "rail.remove", json!({"id":id}))
        .await
        .unwrap();
    let replacement =
        f.h.agents
            .call(&f.h.ctx, "rail.createWorkstream", json!({"name":"Work"}))
            .await
            .unwrap();
    let failed = f.changed(&mut events, &ask["id"], "failed").await;
    assert_eq!(failed["parts"][0]["placement"]["workstream"], id);
    assert_eq!(failed["parts"][0]["text"], "exact");
    assert!(f.bytes.is_empty());
    let tree =
        f.h.agents
            .call(&f.h.ctx, "rail.tree", Value::Null)
            .await
            .unwrap();
    assert_eq!(tree[0]["id"], replacement["id"]);
    assert!(tree[0]["terminal_id"].is_null());
    f.stop().await;
}

#[tokio::test]
async fn u2773b_submission_cannot_be_replayed_to_another_destination() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::open(dir.path());
    let first = h
        .agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":"First"}))
        .await
        .unwrap();
    let second = h
        .agents
        .call(&h.ctx, "rail.createWorkstream", json!({"name":"Second"}))
        .await
        .unwrap();
    h.asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"exact","submission":"a","workstream":first["id"]}),
        )
        .await
        .unwrap();
    let err = h
        .asks
        .call(
            &h.ctx,
            "ask.send",
            json!({"text":"exact","submission":"a","workstream":second["id"]}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(h.list().await[0]["workstream"], first["id"]);
    assert_eq!(h.list().await.as_array().unwrap().len(), 1);
}
