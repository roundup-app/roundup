use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use contracts::{Actor, Kind};
use serde_json::{Value, json};
use tokio::sync::Notify;

use crate::tests::*;
use crate::{Observation, Shared, StopModel, stop_asks};

/// A model that answers `answer` once `gate` opens (at once when there is none), counting its calls.
struct Model {
    answer: Result<Option<String>, String>,
    gate: Option<Arc<Notify>>,
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl StopModel for Model {
    async fn question(&self, _text: &str) -> Result<Option<String>, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = &self.gate {
            gate.notified().await;
        }
        self.answer.clone()
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    shared: Arc<Shared>,
    id: String,
    calls: Arc<AtomicUsize>,
}

fn fixture(answer: Result<Option<&str>, &str>, gate: Option<&Arc<Notify>>) -> Fixture {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let calls = Arc::new(AtomicUsize::new(0));
    let shared = with_stop_model(
        shared,
        Model {
            answer: answer.map(|q| q.map(str::to_owned)).map_err(str::to_owned),
            gate: gate.map(Arc::clone),
            calls: Arc::clone(&calls),
        },
    );
    let id = running_agent(&shared, None);
    shared
        .rail()
        .allocate_attempt(crate::rail::agent_id(&id).unwrap())
        .unwrap();
    Fixture {
        _dir: dir,
        shared,
        id,
        calls,
    }
}

impl Fixture {
    fn signal(&self, payload: Value) {
        self.shared
            .observe(Actor::daemon(), &self.id, "1", Observation::Signal(payload))
            .unwrap();
    }

    /// A turn that ends with `text`.
    fn turn(&self, text: &str) {
        self.signal(json!({"hook_event_name":"UserPromptSubmit"}));
        self.signal(json!({"hook_event_name":"Stop","last_assistant_message":text}));
    }

    fn status(&self) -> Value {
        serde_json::to_value(self.shared.node(&self.id).unwrap()).unwrap()["status"].clone()
    }

    /// Let spawned work run until the model was called `n` times, then until it has finished.
    async fn settle(&self, n: usize) {
        while self.calls.load(Ordering::SeqCst) < n {
            tokio::task::yield_now().await;
        }
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
    }

    async fn until(&self, kind: &str) {
        for _ in 0..400 {
            if self.status()["kind"] == kind {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("never {kind}: {}", self.status());
    }
}

#[tokio::test]
async fn a7180a_a_stop_that_asks_shows_needs_you_with_its_question() {
    let fixture = fixture(Err("not asked"), None);
    fixture.turn("Updated three files.\n\nShould I publish three pages or five?");
    let status = fixture.status();
    assert_eq!(status["kind"], "needs-you");
    assert_eq!(
        status["label"],
        "asks: Should I publish three pages or five?"
    );
    assert_eq!(status["finished"], "1");
    assert!(stop_asks(Kind::NeedsYou, status["label"].as_str().unwrap()));
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a7180a_a_stop_that_reports_stays_idle_and_calls_no_model() {
    for text in [
        "All done. The PR is merged.",
        "Fixed the lint; `just check` passes.",
    ] {
        let fixture = fixture(Err("not asked"), None);
        fixture.turn(text);
        fixture.settle(0).await;
        assert_eq!(fixture.status()["kind"], "idle", "{text}");
        assert_eq!(fixture.calls.load(Ordering::SeqCst), 0, "{text}");
    }
}

#[tokio::test]
async fn a7180b_an_unclear_stop_shows_idle_then_the_models_question() {
    let gate = Arc::new(Notify::new());
    let fixture = fixture(Ok(Some("Which format do you want?")), Some(&gate));
    fixture.turn("Here is what you asked for.");
    assert_eq!(fixture.status()["kind"], "idle");
    fixture.settle(1).await;
    assert_eq!(
        fixture.status()["kind"],
        "idle",
        "the model is still reading"
    );
    gate.notify_one();
    fixture.until("needs-you").await;
    assert_eq!(fixture.status()["label"], "asks: Which format do you want?");
    assert_eq!(fixture.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a7180b_a_model_that_fails_or_finds_no_ask_leaves_the_agent_idle() {
    for answer in [Err("no network"), Ok(None)] {
        let fixture = fixture(answer, None);
        fixture.turn("Here is what you asked for.");
        fixture.settle(1).await;
        assert_eq!(fixture.status()["kind"], "idle");
    }
}

#[tokio::test(start_paused = true)]
async fn a7180b_a_late_answer_leaves_the_agent_idle() {
    let gate = Arc::new(Notify::new());
    let fixture = fixture(Ok(Some("Which format do you want?")), Some(&gate));
    fixture.turn("Here is what you asked for.");
    fixture.settle(1).await;
    tokio::time::advance(Duration::from_secs(4)).await;
    fixture.settle(1).await;
    gate.notify_one();
    fixture.settle(1).await;
    assert_eq!(fixture.status()["kind"], "idle");
}

#[tokio::test]
async fn a7180b_an_answer_for_a_turn_the_agent_left_is_dropped() {
    let gate = Arc::new(Notify::new());
    let fixture = fixture(Ok(Some("Which format do you want?")), Some(&gate));
    fixture.turn("Here is what you asked for.");
    fixture.settle(1).await;
    fixture.signal(json!({"hook_event_name":"UserPromptSubmit"}));
    let answered = fixture.shared.events.observed.notified();
    tokio::pin!(answered);
    answered.as_mut().enable();
    gate.notify_one();
    tokio::time::timeout(Duration::from_secs(5), answered)
        .await
        .expect("the answer arrives");
    fixture.settle(1).await;
    assert_eq!(fixture.status()["kind"], "working");
}

#[tokio::test]
async fn a7180c_the_next_turn_clears_needs_you() {
    let fixture = fixture(Err("not asked"), None);
    fixture.turn("Should I publish three pages or five?");
    assert_eq!(fixture.status()["kind"], "needs-you");
    fixture.turn("Published five pages.");
    assert_eq!(fixture.status()["kind"], "idle");
}
