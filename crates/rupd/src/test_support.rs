//! Process-free domain fixture for MCP reply observers. Only lifecycle and inbox I/O are replaced.
use super::*;
use async_trait::async_trait;
use contracts::agent::{Inbox, RailNode};
use contracts::{Kind, Status};
use std::sync::Mutex;

#[derive(Default)]
pub struct ReplyState {
    bus: Bus,
    pub nodes: Mutex<Vec<RailNode>>,
    pub entries: Mutex<Vec<(String, u32, String, String)>>,
    pub written: tokio::sync::Notify,
    pub terminal_writes: Mutex<usize>,
}

#[async_trait]
impl Module for ReplyState {
    fn namespaces(&self) -> &'static [&'static str] {
        &["rail", "agent", "terminal"]
    }
    async fn call(&self, _: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
        match method {
            "rail.tree" => rpc::reply(&*self.nodes.lock().unwrap()),
            "agent.channelUp" => Ok(Value::Null),
            "terminal.write" => {
                *self.terminal_writes.lock().unwrap() += 1;
                Ok(Value::Null)
            }
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}
impl messages::TerminalOwners for ReplyState {
    fn with_terminal_owner(
        &self,
        terminal: &str,
        record: &mut dyn FnMut(Option<&agents::TerminalOwner>) -> Result<(), RpcError>,
    ) -> Result<(), RpcError> {
        let nodes = self.nodes.lock().unwrap();
        let owner = nodes
            .iter()
            .find(|n| n.terminal_id.as_deref() == Some(terminal))
            .map(|n| agents::TerminalOwner {
                id: n.id.clone(),
                attempt: n.attempt.clone(),
                status_revision: n.status_revision.clone(),
                ended: false,
            });
        record(owner.as_ref())
    }
}
#[async_trait]
impl messages::NoteInbox for ReplyState {
    async fn check(&self, _: &str) -> Inbox {
        Inbox::Ok
    }
    fn write(&self, id: &str, notes: &[agents::claude_code::inbox::Entry]) -> Result<(), Inbox> {
        self.entries.lock().unwrap().extend(
            notes
                .iter()
                .map(|n| (id.into(), n.id, n.from.clone(), n.text.clone())),
        );
        self.written.notify_one();
        Ok(())
    }
}
impl ReplyState {
    pub fn status(&self, id: &str, kind: Kind) {
        let mut nodes = self.nodes.lock().unwrap();
        let node = nodes.iter_mut().find(|n| n.id == id).unwrap();
        node.status = Some(Status {
            kind,
            label: String::new(),
            since: 0,
            finished: "0".into(),
        });
        node.status_revision = Some(
            (node
                .status_revision
                .as_ref()
                .unwrap()
                .parse::<u64>()
                .unwrap()
                + 1)
            .to_string(),
        );
        let event = contracts::agent::StatusEvent {
            ended: false,
            id: id.into(),
            attempt: node.attempt.clone().unwrap(),
            status_revision: node.status_revision.clone().unwrap(),
            status: node.status.clone().unwrap(),
        };
        drop(nodes);
        self.bus.emit(
            Actor::daemon(),
            contracts::EventData::AgentStatus(Box::new(event)),
        );
    }
}

/// Open stores before entering Tokio so background readers see the configured modules.
pub fn reply_daemon(dir: &Path, door: bool) -> (Daemon, Arc<ReplyState>) {
    let dir = dir.to_path_buf();
    let mut daemon = std::thread::spawn(move || Daemon::open_in(&dir, &dir).unwrap())
        .join()
        .unwrap();
    let state = Arc::new(ReplyState {
        bus: daemon.bus.clone(),
        ..Default::default()
    });
    for id in ["1", "2"] {
        let node: RailNode = serde_json::from_value(json!({
            "id":id,"kind":if door && id == "1" {"workstream"} else {"agent"},"name":id,"parent":null,"order":0,
            "status":{"kind":"working","label":"","since":0,"finished":"0"},"attempt":"1","status_revision":"1",
            "terminal_id":format!("t-{id}"),"worktree":null,"can_resume":false,"yolo":false,
            "channel":null,"stray":[],"model":null,"effort":null,"work":null,"auto":false
        })).unwrap();
        // Publication authorization reads maker identity from the authoritative Project store.
        let db = rusqlite::Connection::open(daemon.project.join("project.db")).unwrap();
        db.execute(
            "INSERT INTO nodes(id,kind,name,ord) VALUES(?1,?2,?1,0)",
            rusqlite::params![
                id,
                if door && id == "1" {
                    "workstream"
                } else {
                    "agent"
                }
            ],
        )
        .unwrap();
        state.nodes.lock().unwrap().push(node);
    }
    let messages = Arc::new(
        messages::Messages::open_with(
            &daemon.project,
            daemon.bus.clone(),
            state.clone(),
            messages::Env {
                touches: daemon.touches.clone(),
                clock: Arc::new(|| 1000),
                fault: Arc::new(|_| Ok(())),
            },
        )
        .unwrap(),
    );
    messages.set_inbox(state.clone());
    daemon.register(messages);
    daemon.register(state.clone());
    daemon.start_pushes();
    (daemon, state)
}
