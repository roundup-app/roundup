//! U6243a: a real Daemon over public RPC, a fake `claude`, hook Signals and the injected Agents
//! clock. No step is an Agent's own report: hooks, the Queue, a peer inbox that takes a note or
//! refuses it, and the clock only (U6243c).
use std::io::{BufRead, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use proptest::prelude::*;

use super::*;
use crate::dcl5_tests::{Run, call};
use crate::facts::STALL_MS;
use crate::workstream_state::{TELL_PERIOD, Told, told_of};

#[derive(Clone, Debug)]
enum Step {
    Hook(usize, &'static str),
    /// A background task starts, or is reaped, under the second child.
    Background(bool),
    /// A Workstream joins the Queue, or its first entry leaves it.
    Enqueue,
    Dequeue,
    /// A note to the first child while its inbox refuses the write.
    DeliveryFails,
    /// A note to the first child while its inbox takes it and its transcript records the receipt.
    DeliveryLands,
    /// The clock passes `STALL_MS` and one `TELL_PERIOD`, with no event.
    Clock,
}

fn step() -> impl Strategy<Value = Step> {
    prop_oneof![
        (
            0..3usize,
            prop::sample::select(vec![
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "Stop",
                "SessionEnd",
            ])
        )
            .prop_map(|(who, hook)| Step::Hook(who, hook)),
        any::<bool>().prop_map(Step::Background),
        Just(Step::Enqueue),
        Just(Step::Dequeue),
        Just(Step::DeliveryFails),
        Just(Step::DeliveryLands),
        Just(Step::Clock),
    ]
}

async fn fresh(run: &Run) -> Told {
    let rail = call(&run.daemon, "rail.tree", Value::Null).await;
    told_of(&serde_json::from_value::<Vec<contracts::agent::RailNode>>(rail).unwrap())
}

fn told(run: &Run) -> Told {
    run.daemon
        .rail_told
        .get()
        .expect("the watcher started with the first request")
        .told
        .lock()
        .unwrap()
        .clone()
}

/// Lets the watcher judge what the step sent.
async fn settle() {
    // The paused clock never waits for the reads on the blocking pool: real time does.
    tokio::task::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_millis(100)))
        .await
        .unwrap();
}

fn tells(events: &mut tokio::sync::broadcast::Receiver<contracts::Event>) -> usize {
    let mut count = 0;
    while let Ok(event) = events.try_recv() {
        count += usize::from(matches!(event.data, contracts::EventData::RailChanged));
    }
    count
}

/// The first child's messaging socket, session listing and transcript, as Claude Code keeps them.
struct Peer {
    socket: PathBuf,
    transcript: PathBuf,
    stop: Option<Arc<AtomicBool>>,
}

impl Peer {
    async fn open(run: &Run, id: &str) -> Self {
        let dir = run.dir.path();
        let wanted = format!("/{id}.sock");
        let socket = loop {
            let found = std::fs::read_dir(dir).unwrap().flatten().find_map(|file| {
                let text = std::fs::read_to_string(file.path()).ok()?;
                text.lines()
                    .find(|line| line.ends_with(&wanted))
                    .map(PathBuf::from)
            });
            if let Some(found) = found {
                break found;
            }
            settle().await;
        };
        let sessions = dir.join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let pid = std::process::id();
        std::fs::write(
            sessions.join(format!("{pid}.json")),
            serde_json::json!({
                "pid": pid, "sessionId": "peer", "peerProtocol": 1,
                "messagingSocketPath": socket,
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            sessions.join(format!("{pid}.k.key")),
            serde_json::json!({"peerToken": "t"}).to_string(),
        )
        .unwrap();
        let transcript = dir.join("transcript.jsonl");
        std::fs::write(&transcript, "").unwrap();
        let mut peer = Self {
            socket,
            transcript,
            stop: None,
        };
        peer.close();
        peer
    }

    /// A socket file nobody listens on: the write is refused.
    fn close(&mut self) {
        if let Some(stop) = self.stop.take() {
            stop.store(true, Ordering::SeqCst);
            // Wake the blocked accept so the listener thread sees the flag and exits.
            let _ = std::os::unix::net::UnixStream::connect(&self.socket);
        }
        let _ = std::fs::remove_file(&self.socket);
        drop(UnixListener::bind(&self.socket).unwrap());
    }

    /// A listener that takes each note and records its receipt in the transcript.
    fn listen(&mut self) {
        if self.stop.is_some() {
            return;
        }
        let _ = std::fs::remove_file(&self.socket);
        let listener = UnixListener::bind(&self.socket).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        self.stop = Some(stop.clone());
        let transcript = self.transcript.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let Ok((stream, _)) = listener.accept() else {
                    continue;
                };
                for line in std::io::BufReader::new(stream)
                    .lines()
                    .map_while(Result::ok)
                {
                    let Ok(note) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if let Some(id) = note["msg_id"].as_str() {
                        let receipt = json!({"origin":{"kind":"peer","msg_id":id}});
                        let mut file = std::fs::OpenOptions::new()
                            .append(true)
                            .open(&transcript)
                            .unwrap();
                        writeln!(file, "{receipt}").unwrap();
                    }
                }
            }
        });
    }
}

async fn walk(steps: Vec<Step>) -> Told {
    let run = Run::start().await;
    let kids = [run.spawn("one").await, run.spawn("two").await];
    let ids = [run.door.clone(), kids[0].clone(), kids[1].clone()];
    let mut peer = Peer::open(&run, &kids[0]).await;
    run.signal_with(
        &kids[0],
        json!({"hook_event_name":"UserPromptSubmit","transcript_path":peer.transcript}),
    )
    .await;
    let mut events = run.daemon.bus.subscribe();
    settle().await;
    tells(&mut events);
    let mut last = fresh(&run).await;
    assert_eq!(told(&run), last);
    // An Agent whose session ended cannot receive a Message.
    let mut ended = false;
    for step in steps {
        match step {
            Step::Hook(who, hook) => {
                ended |= who == 1 && hook == "SessionEnd";
                run.signal(&ids[who], hook).await
            }
            Step::Background(start) => {
                let hook = if start {
                    "SubagentStart"
                } else {
                    "SubagentStop"
                };
                run.signal_with(&ids[2], json!({"hook_event_name":hook,"agent_id":"bg"}))
                    .await;
            }
            Step::Enqueue => {
                let todo = call(&run.daemon, "todo.create", json!({"title":"queued"})).await;
                call(
                    &run.daemon,
                    "todo.startWorkstream",
                    json!({"id":todo["id"],"name":"Later","start":{"kind":"queued"}}),
                )
                .await;
            }
            Step::Dequeue => {
                let queue = call(&run.daemon, "workstream.queue", Value::Null).await;
                if let Some(entry) = queue["entries"].get(0) {
                    call(
                        &run.daemon,
                        "workstream.dequeue",
                        json!({"workstream":entry["workstream"]}),
                    )
                    .await;
                }
            }
            Step::DeliveryFails | Step::DeliveryLands if ended => {}
            Step::DeliveryFails | Step::DeliveryLands => {
                if matches!(step, Step::DeliveryFails) {
                    peer.close();
                } else {
                    peer.listen();
                }
                call(
                    &run.daemon,
                    "message.send",
                    json!({"to":ids[1],"kind":"note","body":"note"}),
                )
                .await;
                settle().await;
                if matches!(step, Step::DeliveryLands) {
                    // The transcript changed: the Agent's next hook is when the receipt is read.
                    run.signal(&ids[1], "Stop").await;
                }
            }
            Step::Clock => {
                run.now.fetch_add(STALL_MS + 1, Ordering::SeqCst);
                tokio::time::advance(TELL_PERIOD).await;
            }
        }
        settle().await;
        let now = fresh(&run).await;
        let count = tells(&mut events);
        // A step may move two values in turn (a status, then the push it queues): each is told
        // once, and nothing is told when nothing moved.
        assert_eq!(count > 0, now != last, "{step:?}");
        assert_eq!(told(&run), now, "{step:?}");
        last = now;
    }
    run.daemon.stop_terminals().await.unwrap();
    last
}

fn on_paused_clock(steps: Vec<Step>) -> Told {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .unwrap()
        .block_on(walk(steps))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, ..ProptestConfig::default() })]
    #[test]
    fn u6243a_derived_rail_values_tell_exactly_on_change(steps in prop::collection::vec(step(), 1..10)) {
        on_paused_clock(steps);
    }
}

/// The seed: the last working child ends, and the Workstream reads idle by the next read.
#[test]
fn u6243a_the_last_working_child_ending_is_told_once() {
    on_paused_clock(vec![
        Step::Hook(1, "UserPromptSubmit"),
        Step::Hook(1, "SessionEnd"),
    ]);
}

/// Each input U6243a names moves a derived value the walk then sees told.
#[test]
fn u6243a_a_refused_note_is_told_and_a_received_one_is_told_again() {
    let unreachable = |told: &Told| told.values().any(|v| v.2.is_some());
    let idle = Step::Hook(1, "Stop");
    assert!(unreachable(&on_paused_clock(vec![
        idle.clone(),
        Step::DeliveryFails,
    ])));
    assert!(!unreachable(&on_paused_clock(vec![
        idle,
        Step::DeliveryFails,
        Step::DeliveryLands,
    ])));
}
