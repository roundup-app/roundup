//! A5717: production owner recovery composed with production Message admission and receipts.
use super::*;

impl Run {
    async fn owned(input: &str) -> Self {
        let mut run = Self::open(1, false).await;
        let helper = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("terminal-owner");
        assert!(
            helper.is_file(),
            "cargo build -p terminal --bin terminal-owner"
        );
        std::fs::write(
            run.dir.path().join("owner-helper"),
            helper.to_str().unwrap(),
        )
        .unwrap();
        run.reopen_owner().await;
        run.spawn_with_input(
            (input == "creation").then_some("creation request"),
            input == "terminal",
        )
        .await;
        if input == "message" {
            let user = run
                .user
                .request(
                    "message.send",
                    json!({"to":run.child,"kind":"note","body":"user request"}),
                )
                .await
                .unwrap();
            let id = user["id"].as_u64().unwrap() as u32;
            until("explicit user entry", async || {
                (run.entries() == [format!("rup-{id}")]).then_some(())
            })
            .await;
            run.record(&[id]).await;
            until("explicit input receipt", async || {
                (run.status(id).await.0 == "delivered").then_some(())
            })
            .await;
            run.signal(json!({"hook_event_name":"Stop"})).await;
        }
        run
    }

    async fn reopen_owner(&mut self) {
        self.daemon.child.kill().unwrap();
        self.daemon.child.wait().unwrap();
        let _ = std::fs::remove_file(&self.daemon.socket);
        self.daemon = launch(self.dir.path(), self.data.path());
        self.user = Client::connect(&self.daemon.socket).await.unwrap();
        self.watcher = Client::connect(&self.daemon.socket).await.unwrap();
        self.watcher
            .request("events.subscribe", Value::Null)
            .await
            .unwrap();
        self.sender = Client::connect(&self.daemon.socket).await.unwrap();
        self.identify_sender("daemon").await;
        if !self.child.is_empty() {
            let node = self.rail_node().await;
            assert_eq!(node["attempt"], self.attempt);
            self.terminal = node["terminal_id"].clone();
            assert!(!self.terminal.is_null());
        }
    }

    async fn automatic(&mut self, round: usize) -> Vec<u32> {
        let mut ids = Vec::new();
        for (sender, body) in [
            ("agent", "peer"),
            ("daemon", "[digest] summary"),
            ("daemon", "accepted reaction"),
        ] {
            self.identify_sender(sender).await;
            ids.push(self.note(&format!("{body} {round}")).await);
        }
        ids
    }

    async fn pending_identity(&self, before: &[Value]) {
        for original in before {
            let id = original["id"].as_u64().unwrap() as u32;
            assert_eq!(self.message(id).await, *original);
            assert_eq!(original["status"], "pending");
        }
    }

    async fn owner_identity(&self, before: &Value) {
        let node = self.rail_node().await;
        assert_eq!(node["id"], before["id"]);
        assert_eq!(node["attempt"], before["attempt"]);
        let terminals = self
            .user
            .request("terminal.list", Value::Null)
            .await
            .unwrap();
        let live: Vec<_> = terminals
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["running"] == true)
            .collect();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0]["id"], self.terminal);
        assert_eq!(
            std::fs::read_to_string(self.dir.path().join("launches.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(self.typed().await, 0);
    }
}

#[tokio::test]
async fn a5717a_surviving_attempt_retains_automatic_message_admission() {
    for input in ["terminal", "message", "creation"] {
        let mut run = Run::owned(input).await;
        let identity = run.rail_node().await;
        let mut received = run.entries();
        for round in 0..2 {
            run.signal(json!({"hook_event_name":"PreToolUse","tool_name":"Bash"}))
                .await;
            let mut ids = run.automatic(round * 2).await;
            let mut before = Vec::new();
            for id in &ids {
                before.push(run.message(*id).await);
            }
            run.reopen_owner().await;
            run.pending_identity(&before).await;
            // No new SessionStart or input: the retained program only reports its next idle.
            run.signal(json!({"hook_event_name":"Stop"})).await;
            ids.extend(run.automatic(round * 2 + 1).await);
            received.extend(ids.iter().map(|id| format!("rup-{id}")));
            until("recovered automatic batch", async || {
                (run.entries() == received).then_some(())
            })
            .await;
            run.pending_identity(&before).await;
            run.owner_identity(&identity).await;
            run.record(&ids).await;
            until("all transcript receipts", async || {
                for id in &ids {
                    if run.status(*id).await.0 != "delivered" {
                        return None;
                    }
                }
                Some(())
            })
            .await;
            assert_eq!(run.seen().await, ids);
            run.record(&ids).await;
            run.idle_edge().await;
            assert_eq!(run.entries(), received);
            assert!(run.seen().await.is_empty());
        }
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn a5717b_surviving_attempt_without_input_keeps_waiting() {
    let mut run = Run::owned("none").await;
    let identity = run.rail_node().await;
    let mut ids = run.automatic(0).await;
    let mut before = Vec::new();
    for id in &ids {
        before.push(run.message(*id).await);
    }
    for round in 1..=2 {
        run.reopen_owner().await;
        run.idle_edge().await;
        // message.send awaits production deliver_pending; absence is checked after that pass.
        ids.extend(run.automatic(round).await);
        run.pending_identity(&before).await;
        assert!(run.entries().is_empty());
        run.owner_identity(&identity).await;
    }
    let sent = run
        .user
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"first explicit request"}),
        )
        .await
        .unwrap();
    let user = sent["id"].as_u64().unwrap() as u32;
    until("user before automatic input", async || {
        (!run.entries().is_empty()).then_some(())
    })
    .await;
    assert_eq!(run.entries()[0], format!("rup-{user}"));
    run.idle_edge().await;
    let mut expected = vec![format!("rup-{user}")];
    expected.extend(ids.iter().map(|id| format!("rup-{id}")));
    until("automatic input after user", async || {
        (run.entries() == expected).then_some(())
    })
    .await;
    ids.push(user);
    run.record(&ids).await;
    until("all receipts", async || {
        for id in &ids {
            if run.status(*id).await.0 != "delivered" {
                return None;
            }
        }
        Some(())
    })
    .await;
    run.owner_identity(&identity).await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
}
