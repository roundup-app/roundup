//! Explicit resume of a fresh vendor program after Daemon loss.
use super::*;

impl Run {
    /// A Daemon kill (D6), then a new Daemon on the same Project, and the Agent resumed.
    pub(super) async fn restart(&mut self) {
        let socket = self.daemon.socket.clone();
        let _ = self.daemon.child.kill();
        let _ = self.daemon.child.wait();
        let _ = std::fs::remove_file(&socket);
        self.daemon = launch(self.dir.path(), self.data.path());
        self.user = Client::connect(&self.daemon.socket).await.unwrap();
        self.watcher = Client::connect(&self.daemon.socket).await.unwrap();
        self.watcher
            .request("events.subscribe", Value::Null)
            .await
            .unwrap();
        self.sender = Client::connect(&self.daemon.socket).await.unwrap();
        self.sender
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"ext","id":"b50"}}),
            )
            .await
            .unwrap();
        let node = self
            .user
            .request("agent.resume", json!({"id":self.child}))
            .await
            .unwrap();
        self.terminal = node["terminal_id"].clone();
        self.attempt = node["attempt"].clone();
        self.ready().await;
        self.signal(json!({"hook_event_name":"UserPromptSubmit","prompt":"Wait for notes"}))
            .await;
        self.signal(json!({"hook_event_name":"Stop"})).await;
    }
}

#[tokio::test]
async fn b52_a_restart_with_a_sent_note_delivers_it_once() {
    // B52(b): rejects losing the unacknowledged id on restart or falsely delivering its write.
    for kind in ["note", "question"] {
        let mut run = Run::start().await;
        run.kind = kind;
        let id = run.note("once").await;
        until("taken up", async || {
            (!run.entries().is_empty()).then_some(())
        })
        .await;
        assert_eq!(run.taken(), [format!("rup-{id}")]);
        run.restart().await;
        run.idle_edge().await;
        // The resumed session is a new process with its own socket; it takes the note up once.
        until("taken up again", async || {
            (run.entries() == [format!("rup-{id}")]).then_some(())
        })
        .await;
        run.record(&[id]).await;
        until("delivered", async || {
            (run.status(id).await.0 == "delivered").then_some(())
        })
        .await;
        assert_eq!(run.entries(), [format!("rup-{id}")]);
        assert_eq!(
            run.taken(),
            [format!("rup-{id}")],
            "a retry is not another peer uptake"
        );
        assert_eq!(run.typed().await, 0);
        assert_eq!(run.seen().await, [id]);
    }
}

