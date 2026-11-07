//! AMG2–AMG4: starts the memory guard's sampler and tells the Agent and its Door of each end.

use std::collections::HashSet;

use agents::guard::{self, End, Live};
use contracts::Actor;
use contracts::agent::NodeKind;
use serde_json::json;

use crate::Daemon;
use crate::digest::Reader;

impl Daemon {
    /// Start the sampler on its own thread, and a task that sends each end's note. The thread
    /// lives as long as the Daemon process.
    pub fn start_memory_guard(&self) {
        let (ends, mut ended) = tokio::sync::mpsc::unbounded_channel::<End>();
        let agents = std::sync::Arc::clone(&self.agents);
        let source = Live::new(move || {
            agents
                .running_programs()
                .into_iter()
                .map(|(_, pid)| pid)
                .collect::<HashSet<u32>>()
        });
        guard::spawn(
            source,
            self.observers.memory_budget,
            true,
            guard::every_second(),
            move |end| {
                let _ = ends.send(end);
            },
        );
        let reader = self.reader();
        tokio::spawn(async move {
            while let Some(end) = ended.recv().await {
                tell(&reader, &end).await;
            }
        });
    }
}

/// The note to the Agent whose process ended, and to the Door it belongs to: one each.
async fn tell(reader: &Reader, end: &End) {
    let body = end.note();
    let mut targets = vec![(end.agent.clone(), body.clone())];
    if let Ok(nodes) = reader.rail().await {
        let mut at = nodes.iter().find(|n| n.id == end.agent);
        while let Some(node) = at {
            if node.kind == NodeKind::Workstream {
                targets.push((node.id.clone(), format!("Agent {}: {body}", end.agent)));
                break;
            }
            at = node
                .parent
                .as_ref()
                .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
        }
    }
    for (to, body) in targets {
        let sent = reader
            .call::<contracts::message::Message>(
                "message",
                "message.send",
                json!({"to": to, "kind": "note", "body": body}),
                Actor::daemon(),
            )
            .await;
        if let Err(err) = sent {
            eprintln!("memory guard: note to {to} not sent: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agents::guard::{Sample, Source};
    use async_trait::async_trait;
    use parking_lot::Mutex;
    use rpc::{Bus, Ctx, Module, RpcError};
    use serde_json::Value;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct Stub {
        sent: Mutex<Vec<Value>>,
    }

    #[async_trait]
    impl Module for Stub {
        fn namespaces(&self) -> &'static [&'static str] {
            &["rail", "todo", "pad", "message"]
        }

        async fn call(&self, _: &Ctx, method: &str, params: Value) -> Result<Value, RpcError> {
            match method {
                "rail.tree" => Ok(json!([
                    node("d", "workstream", None),
                    node("a", "agent", Some("d"))
                ])),
                "message.send" => {
                    self.sent.lock().push(params.clone());
                    Ok(
                        json!({"id":1,"from":Actor::daemon(),"to":params["to"],"kind":"note","body":params["body"],"replyTo":null,"status":"pending","reason":null,"at":0}),
                    )
                }
                other => panic!("unexpected {other}"),
            }
        }
    }

    fn node(id: &str, kind: &str, parent: Option<&str>) -> Value {
        json!({
            "id": id, "kind": kind, "name": id, "parent": parent, "order": 0,
            "status": null, "attempt": null, "status_revision": null,
            "terminal_id": null, "worktree": null, "can_resume": false,
            "yolo": false, "channel": null, "work": null, "stray": [], "model": null,
            "effort": null,
        })
    }

    /// The real reader, narrowed to one fake Agent's process, so a test never ends another.
    struct Only(Live, u32);

    impl Source for Only {
        fn sample(&mut self) -> Sample {
            let mut sample = self.0.sample();
            sample.readings.retain(|r| r.pid == self.1);
            sample
        }
        fn end(&mut self, pid: u32) {
            self.0.end(pid);
        }
    }

    #[tokio::test]
    async fn amg3_an_end_notes_the_agent_and_its_door() {
        let mut sleep = std::process::Command::new("sleep")
            .arg("30")
            .env("ROUNDUP_AGENT", "a")
            .spawn()
            .unwrap();
        let (told, ended) = std::sync::mpsc::channel();
        let done = Arc::new(AtomicBool::new(false));
        let ticked = Arc::clone(&done);
        let mut ticks = 0;
        guard::spawn(
            Only(Live::new(HashSet::new), sleep.id()),
            Some(1),
            false,
            move || {
                // The reader may miss a process only just started, so it reads again until one ends.
                std::thread::sleep(std::time::Duration::from_millis(50));
                ticks += 1;
                ticks <= 40 && !ticked.load(Ordering::SeqCst)
            },
            move |end| {
                done.store(true, Ordering::SeqCst);
                told.send(end).unwrap();
            },
        )
        .join()
        .unwrap();
        let status = sleep.wait().unwrap();
        assert!(!status.success(), "the ended command fails");
        let ends: Vec<End> = ended.try_iter().collect();
        assert_eq!(ends.len(), 1);

        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(&dir.path().join("data")).unwrap();
        let stub = Arc::new(Stub {
            sent: Mutex::new(Vec::new()),
        });
        let mut modules = daemon.modules.clone();
        for name in ["rail", "todo", "pad", "message"] {
            modules.insert(name, stub.clone());
        }
        let reader = Reader::new(
            &modules,
            Bus::new(),
            daemon.touches.clone(),
            None,
            String::new(),
        );
        tell(&reader, &ends[0]).await;
        let sent = stub.sent.lock().clone();
        assert_eq!(sent.len(), 2, "one note to the Agent, one to its Door");
        assert_eq!(sent[0]["to"], "a");
        assert_eq!(sent[1]["to"], "d");
        for note in &sent {
            let body = note["body"].as_str().unwrap();
            assert!(body.contains("roundup ended sleep ("), "{body}");
            assert!(body.contains(" MB)"), "{body}");
            assert!(
                body.contains("Agents held over half of this Mac's memory"),
                "{body}"
            );
            assert!(body.contains("run fewer at once"), "{body}");
        }
    }
}
