//! B55: the new session after a Clear holds no text of the old ask.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use daemon::aimock;

use contracts::Kind;
use daemon::rail_tree;
use serde_json::{Value, json};
use std::time::Duration;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/launch_gate.rs"]
#[allow(dead_code)]
mod launch_gate;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::{requests_holding, started_door, user_texts};
use launch_gate::Gate;
use waiting::{until, until_async};

impl Fresh {
    async fn start() -> Self {
        let gate = Gate::new();
        let project = daemon::start_real(
            "b55_clear_starts_fresh",
            &[
                ("ROUNDUP_CLAUDE_BIN", &gate.wrapper()),
                ("ROUNDUP_HANDOFF_BOUND_MS", "60000"),
            ],
        );
        let client = project.subscribed().await;
        let door = started_door(&client).await;
        let fresh = Self {
            project,
            client,
            gate,
            door,
        };
        fresh.settled().await;
        fresh
    }

    fn model(&self) -> &aimock::Model {
        self.project.model.as_ref().unwrap()
    }

    /// The Door is idle and no model request has arrived for 300 ms.
    async fn settled(&self) {
        let seen = std::cell::Cell::new((usize::MAX, std::time::Instant::now()));
        until_async("the Door stays idle", || async {
            let count = self.model().journal().len();
            let door_idle = rail_tree(&self.client).await.iter().any(|n| {
                n.id == self.door && n.status.as_ref().is_some_and(|s| s.kind == Kind::Idle)
            });
            if !door_idle || count != seen.get().0 {
                seen.set((count, std::time::Instant::now()));
                return None;
            }
            (seen.get().1.elapsed() > Duration::from_millis(300)).then_some(())
        })
        .await;
    }

    /// The old Iteration's ask: the word in a Message, a Todo and a Pad.
    async fn ask(&self, delivered: bool) {
        self.client
            .request(
                "message.send",
                json!({"to": self.door, "kind": "note", "body": format!("{QUOKKA} plan")}),
            )
            .await
            .unwrap();
        self.client
            .request("todo.create", json!({"title": format!("{QUOKKA} todo")}))
            .await
            .unwrap();
        self.client
            .request(
                "pad.create",
                json!({"name": "plan", "text": format!("{QUOKKA} pad")}),
            )
            .await
            .unwrap();
        if delivered {
            until_async("the note reaches the Door", || async {
                (requests_holding(self.model(), &format!("{QUOKKA} plan")) > 0).then_some(())
            })
            .await;
        }
        self.settled().await;
    }

    /// Clear, answer the Handoff as the Door, and return once the next session has its first prompt.
    async fn clear(&mut self, summary: &str) {
        self.client
            .request(
                "workstream.clear",
                json!({"id": self.door, "reason": "start over"}),
            )
            .await
            .unwrap();
        until_async("the Door is asked for the Handoff", || async {
            (requests_holding(self.model(), "Write the Handoff") > 0).then_some(())
        })
        .await;
        self.settled().await;
        let actor = self.project.client().await;
        actor
            .request(
                "daemon.identify",
                contracts::IdentifyParams {
                    actor: contracts::Actor {
                        kind: contracts::ActorKind::Agent,
                        id: self.door.clone(),
                        parent: None,
                    },
                },
            )
            .await
            .unwrap();
        actor
            .request(
                "workstream.handoff",
                json!({"id": self.door, "summary": summary, "keep_todos": [], "keep_pads": []}),
            )
            .await
            .unwrap();
        until_async("the next session has its first prompt", || async {
            (requests_holding(self.model(), B55_FIRST_PROMPT) > 0).then_some(())
        })
        .await;
        self.settled().await;
    }

    fn launches(&self) -> Vec<Value> {
        self.gate.rows()
    }

    /// Everything the second session was given: argv, the files argv names, and every model
    /// request from its first prompt on.
    fn second_session(&self) -> String {
        let mut record = String::new();
        for launch in self.launches().iter().skip(1) {
            record.push_str(&launch.to_string());
            for arg in launch["argv"].as_array().unwrap() {
                if let Ok(text) = std::fs::read_to_string(arg.as_str().unwrap()) {
                    record.push_str(&text);
                }
            }
        }
        let journal = self.model().journal();
        let start = journal
            .iter()
            .position(|entry| {
                user_texts(entry)
                    .iter()
                    .any(|text| text.contains(B55_FIRST_PROMPT))
            })
            .expect("the next session sent a request");
        for entry in &journal[start..] {
            record.push_str(&entry["body"].to_string());
        }
        record
    }

    fn word_free(&self) {
        let record = self.second_session();
        assert!(!record.contains(QUOKKA), "{record}");
    }

    fn assert_fresh_launch(&self) {
        assert!(
            !self.launches()[1]["argv"].to_string().contains("--resume"),
            "{:?}",
            self.launches()
        );
    }
}

struct Fresh {
    project: daemon::Project,
    client: rpc::Client,
    gate: Gate,
    door: String,
}

/// B55: the unique word of an old ask, and the Door whose Iteration was given it.
const QUOKKA: &str = "QUOKKA";
const B55_FIRST_PROMPT: &str = "Follow this instruction: Build the";

#[tokio::test]
async fn b55_the_word_appears_only_inside_the_handoff_when_the_summary_has_it() {
    let mut w = Fresh::start().await;
    w.ask(true).await;
    w.clear(&format!("Build the {QUOKKA} page.")).await;
    w.assert_fresh_launch();
    let handoff = format!("Build the {QUOKKA} page.");
    let record = w.second_session();
    assert!(record.contains(&handoff), "{record}");
    assert!(
        !record.replace(&handoff, "").contains(QUOKKA),
        "the word is in the Handoff and nowhere else: {record}"
    );
    w.model().assert_matched();
}

#[tokio::test]
async fn b55_a_restart_and_start_door_still_holds_no_word() {
    let mut w = Fresh::start().await;
    w.ask(true).await;
    w.clear("Build the login page.").await;
    let claude = w.gate.wrapper();
    let home = w.project.dir.path().join("home");
    w.project.restart(&[
        ("ROUNDUP_CLAUDE_BIN", &claude),
        ("HOME", home.to_str().unwrap()),
        ("CLAUDE_CODE_OAUTH_TOKEN", ""),
    ]);
    w.client = w.project.subscribed().await;
    w.client
        .request("rail.startDoor", json!({"id": w.door}))
        .await
        .unwrap();
    until("the Door starts a third time", || {
        (w.launches().len() >= 3).then_some(())
    })
    .await;
    w.settled().await;
    w.word_free();
    w.model().assert_matched();
}

#[tokio::test]
async fn b55_pending_held_and_waiting_messages_of_the_old_iteration_are_not_replayed() {
    let mut w = Fresh::start().await;
    w.client
        .request(
            "route.set",
            json!({"from": "you", "to": w.door, "delivery": "ask-first"}),
        )
        .await
        .unwrap();
    w.ask(false).await;
    w.clear("Build the login page.").await;
    w.word_free();
    w.model().assert_matched();
}

#[tokio::test]
async fn b55_thirty_idle_edges_of_the_new_session_type_none_of_it() {
    let mut w = Fresh::start().await;
    w.ask(true).await;
    w.clear("Build the login page.").await;
    w.assert_fresh_launch();
    for _ in 0..30 {
        let attempt = rail_tree(&w.client)
            .await
            .into_iter()
            .find(|n| n.id == w.door)
            .unwrap()
            .attempt;
        w.client
            .request(
                "agent.signal",
                json!({"id": w.door, "attempt": attempt, "payload": {"hook_event_name": "Stop"}}),
            )
            .await
            .unwrap();
    }
    w.settled().await;
    w.word_free();
    w.model().assert_matched();
}
