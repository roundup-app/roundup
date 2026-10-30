use super::*;
use crate::steer::SteerError;
use crate::tests::{Watched, owner_agents};
use std::io::Write;
use tokio::sync::mpsc;

struct Input(mpsc::UnboundedSender<Vec<u8>>);
impl Write for Input {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.send(bytes.to_vec()).unwrap();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
struct Unused;
#[async_trait]
impl Placement for Unused {
    async fn call(&self, _: &str, _: &Request) -> Result<Vec<placement::AskPart>, String> {
        panic!("explicit recipient needs no placement")
    }
}

async fn fixture() -> (Watched, Asks, Ctx, mpsc::UnboundedReceiver<Vec<u8>>) {
    let mut w = Watched::named();
    let _ = (&mut w.watcher).await;
    let (tx, rx) = mpsc::unbounded_channel();
    let terminals = Terminals::open(w._dir.path(), w.shared.bus.clone())
        .unwrap()
        .with_test_input(Input(tx));
    Arc::get_mut(&mut w.shared).unwrap().terminals = Arc::new(terminals);
    rusqlite::Connection::open(w._dir.path().join("agents.db"))
        .unwrap()
        .execute(
            "UPDATE nodes SET kind='workstream', terminal_id='1' WHERE id=7013",
            [],
        )
        .unwrap();
    w.shared
        .observe(
            Actor::daemon(),
            "7013",
            "1",
            Observation::Signal(serde_json::json!({"hook_event_name":"Stop"})),
        )
        .unwrap();
    let agents = Arc::new(owner_agents(w.shared.clone(), w._dir.path()));
    let asks = Asks::open(
        w._dir.path(),
        w.shared.bus.clone(),
        agents,
        Arc::new(Unused),
    )
    .unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: w.shared.bus.clone(),
        touches: Arc::new(provenance::Touches::open(&w._dir.path().join("touches.db")).unwrap()),
    };
    (w, asks, ctx, rx)
}

#[tokio::test]
async fn a4899a_an_already_idle_door_takes_the_queued_part_without_another_event() {
    for blocked in [false, true] {
        let (w, asks, ctx, mut input) = fixture().await;
        if blocked {
            w.shared.set_waits(HashMap::from([("7013".into(), 4)]));
        }
        let mut events = ctx.bus.subscribe();
        asks.call(
            &ctx,
            "ask.send",
            serde_json::json!({
                "text":"hello café\n  🚀", "workstream":"7013"
            }),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_millis(500), async {
            assert_eq!(
                input.recv().await.unwrap(),
                "\x1b[200~hello café\n  🚀\x1b[201~".as_bytes()
            );
            assert_eq!(input.recv().await.unwrap(), b"\r");
            loop {
                if let EventData::AskChanged { ask } = events.recv().await.unwrap().data
                    && ask.parts[0].state == State::Typed
                {
                    break;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("no delivery for blocked={blocked}"));
        assert!(input.try_recv().is_err());
        assert_eq!(w.shared.wait_of("7013"), blocked.then_some(4));
        // Sent precedes acceptance; no later Signal made delivery possible.
    }
}

#[tokio::test]
async fn a4899a_readiness_at_the_wait_boundary_is_not_lost() {
    for first_pending in [false, true] {
        let (w, asks, ctx, mut input) = fixture().await;
        if first_pending {
            if let Some(Slot::Running(run)) = w.shared.runs().get_mut("7013") {
                run.first_pending = true;
            }
        } else {
            w.shared
                .observe(
                    Actor::daemon(),
                    "7013",
                    "1",
                    Observation::Signal(serde_json::json!({"hook_event_name":"UserPromptSubmit"})),
                )
                .unwrap();
        }
        let refused = w
            .shared
            .prompt("7013", "stale input", Some("earlier"), true, None)
            .await;
        assert!(matches!(
            refused,
            Err(SteerError::Refused(PromptError::NotFound { .. }))
        ));
        assert!(input.try_recv().is_err());
        let shared = w.shared.clone();
        *asks.shared.before_wait.lock().unwrap() = Some(Box::new(move || {
            if first_pending {
                if let Some(Slot::Running(run)) = shared.runs().get_mut("7013") {
                    run.first_pending = false;
                }
                // Same completion boundary as steer_first_prompt: no Kind or bus Event.
                shared.events.observed.notify_waiters();
            } else {
                shared
                    .observe(
                        Actor::daemon(),
                        "7013",
                        "1",
                        Observation::Signal(serde_json::json!({"hook_event_name":"Stop"})),
                    )
                    .unwrap();
            }
        }));
        let mut events = ctx.bus.subscribe();
        asks.call(
            &ctx,
            "ask.send",
            serde_json::json!({
                "text":"boundary", "workstream":"7013"
            }),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_millis(500), async {
            assert_eq!(input.recv().await.unwrap(), b"\x1b[200~boundary\x1b[201~");
            assert_eq!(input.recv().await.unwrap(), b"\r");
            loop {
                if let EventData::AskChanged { ask } = events.recv().await.unwrap().data
                    && ask.parts[0].state == State::Typed
                {
                    break;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("lost readiness with first_pending={first_pending}"));
        assert!(input.try_recv().is_err());
    }
}

#[tokio::test]
async fn a4899a_an_unacknowledged_steer_releases_input_without_replay() {
    let (w, asks, ctx, mut input) = fixture().await;
    let agents = asks.shared.agents.clone();
    let earlier = tokio::spawn(async move { agents.prompt("7013", Steer::User("earlier")).await });
    assert_eq!(input.recv().await.unwrap(), b"\x1b[200~earlier\x1b[201~");
    assert_eq!(input.recv().await.unwrap(), b"\r");
    tokio::time::pause();
    let (waiting, waited) = oneshot::channel();
    *asks.shared.before_wait.lock().unwrap() = Some(Box::new(move || {
        waiting.send(()).unwrap();
    }));
    asks.call(
        &ctx,
        "ask.send",
        serde_json::json!({"text":"later", "workstream":"7013"}),
    )
    .await
    .unwrap();
    waited.await.unwrap();
    tokio::time::advance(w.shared.steer_bound).await;
    assert!(matches!(
        earlier.await.unwrap(),
        Err(PromptError::NotAccepted { .. })
    ));
    tokio::time::timeout(Duration::from_millis(500), async {
        assert_eq!(input.recv().await.unwrap(), b"\x1b[200~later\x1b[201~");
        assert_eq!(input.recv().await.unwrap(), b"\r");
    })
    .await
    .expect("clearing the old Steer must wake queued input");
    assert!(input.try_recv().is_err());
}
