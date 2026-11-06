//! A5717: production owner recovery composed with production Message admission and receipts.
use super::*;

impl Run {
    async fn owned(input: &str) -> Self {
        let mut run = Self::open(1, false).await;
        let helper = Self::owner_helper();
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
        if input == "creation" {
            let id = until("creation prompt reaches the inbox", async || {
                run.received().iter().find_map(|entry| {
                    entry["message"]["content"]
                        .as_str()
                        .unwrap()
                        .contains("creation request")
                        .then(|| {
                            u32::from_str_radix(
                                entry["msg_id"]
                                    .as_str()
                                    .unwrap()
                                    .rsplit('-')
                                    .next()
                                    .unwrap(),
                                16,
                            )
                            .unwrap()
                        })
                })
            })
            .await;
            run.record(&[id]).await;
            until("creation prompt receipt", async || {
                (run.status(id).await.0 == "delivered").then_some(())
            })
            .await;
            run.signal(json!({"hook_event_name":"Stop"})).await;
        }
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
        let digest = messages::digest::push_body(&contracts::agent::DigestEntry {
            name: format!("child-{round}"),
            kind: contracts::Kind::Done,
            last: format!("completed result {round}"),
            todos: 0,
            link: None,
            pads: vec![],
        });
        for (sender, body) in [
            ("agent", format!("peer {round}")),
            ("daemon", digest),
            ("daemon", format!("accepted Daemon Note {round}")),
        ] {
            if sender == "daemon" {
                self.sender
                    .request(
                        "daemon.identify",
                        json!({"actor":contracts::Actor::daemon()}),
                    )
                    .await
                    .unwrap();
            } else {
                self.identify_sender(sender).await;
            }
            ids.push(self.note(&body).await);
        }
        ids
    }

    async fn pending_identity(&self, before: &[Value]) {
        for original in before {
            let id = original["id"].as_u64().unwrap() as u32;
            // U6260a: `waiting` says why it stays pending; the Message's identity is the rest.
            let (mut now, mut then) = (self.message(id).await, original.clone());
            now.as_object_mut().unwrap().remove("waiting");
            then.as_object_mut().unwrap().remove("waiting");
            assert_eq!(now, then);
            assert_eq!(original["status"], "pending");
        }
    }

    fn in_flight(&self, ids: &[u32]) -> Vec<u32> {
        let data = self.project_data();
        let db = rusqlite::Connection::open(data.join("project.db")).unwrap();
        ids.iter()
            .copied()
            .filter(|id| {
                db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM message_flight WHERE message_id=?)",
                    [id],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap()
            })
            .collect()
    }

    async fn owner_identity(&self, before: &Value) {
        let node = self.rail_node().await;
        assert_eq!(node["id"], before["id"]);
        assert_eq!(node["attempt"], before["attempt"]);
        let db = rusqlite::Connection::open(self.project_data().join("project.db")).unwrap();
        let conversation: (String, String) = db
            .query_row(
                "SELECT conversation_id, conversation_cwd FROM nodes WHERE id=?",
                [&self.child],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(conversation.0, "00000000-0000-4000-8000-000000000050");
        assert_eq!(Path::new(&conversation.1), self.dir.path());
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
        assert_eq!(live[0]["incarnation"], before["terminal"]["incarnation"]);
        assert_eq!(live[0]["program_pid"], before["terminal"]["program_pid"]);
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
        let mut identity = run.rail_node().await;
        identity["terminal"] = run
            .user
            .request("terminal.list", Value::Null)
            .await
            .unwrap()[0]
            .clone();
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
            for id in &ids[before.len()..] {
                before.push(run.message(*id).await);
            }
            received.extend(ids.iter().map(|id| format!("rup-{id}")));
            until("recovered automatic batch", async || {
                (run.entries() == received).then_some(())
            })
            .await;
            run.pending_identity(&before).await;
            run.owner_identity(&identity).await;
            assert_eq!(run.in_flight(&ids), ids);
            let entries = run.received();
            for message in &before {
                let suffix = format!("{:012x}", message["id"].as_u64().unwrap());
                let entry = entries
                    .iter()
                    .find(|e| e["msg_id"].as_str().unwrap().ends_with(&suffix))
                    .unwrap();
                let content = entry["message"]["content"].as_str().unwrap();
                // Digests use B50's one-line transport; every body line must still arrive.
                for line in message["body"].as_str().unwrap().lines() {
                    assert!(content.contains(line.trim()), "{content}");
                }
                assert_eq!(message["to"], run.child);
            }
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
            assert!(run.in_flight(&ids).is_empty());
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
    let mut identity = run.rail_node().await;
    identity["terminal"] = run
        .user
        .request("terminal.list", Value::Null)
        .await
        .unwrap()[0]
        .clone();
    let mut ids = run.automatic(0).await;
    let mut before = Vec::new();
    for id in &ids {
        before.push(run.message(*id).await);
    }
    for round in 1..=2 {
        run.reopen_owner().await;
        run.idle_edge().await;
        // message.send awaits production deliver_pending; absence is checked after that pass.
        let added = run.automatic(round).await;
        for id in &added {
            before.push(run.message(*id).await);
        }
        ids.extend(added);
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

// A5717c: durable authorization belongs only to the surviving Attempt, including on restart.
#[tokio::test]
async fn a5717c_explicit_resume_and_restart_require_fresh_input() {
    for restart_live in [false, true] {
        let mut run = Run::owned("terminal").await;
        let earlier = run.attempt.clone();
        if !restart_live {
            run.user
                .request("agent.stop", json!({"id":run.child}))
                .await
                .unwrap();
        }
        let node = run
            .user
            .request("agent.resume", json!({"id":run.child,"mode":"normal"}))
            .await
            .unwrap();
        run.terminal = node["terminal_id"].clone();
        run.attempt = node["attempt"].clone();
        assert_ne!(run.attempt, earlier);
        run.ready().await;
        run.idle_edge().await;
        let ids = run.automatic(0).await;
        assert!(run.entries().is_empty());
        for id in ids {
            assert_eq!(run.status(id).await.0, "pending");
        }
        let user = run
            .user
            .request(
                "message.send",
                json!({"to":run.child,"kind":"note","body":"fresh request"}),
            )
            .await
            .unwrap();
        let id = user["id"].as_u64().unwrap() as u32;
        until("fresh explicit input", async || {
            (!run.entries().is_empty()).then_some(())
        })
        .await;
        assert_eq!(run.entries()[0], format!("rup-{id}"));
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
    }
}
