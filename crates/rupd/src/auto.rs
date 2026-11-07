//! A3308: ordinary Messages ask the Door to assign unassigned Todos. The retained Message
//! and Todo owner history together identify a firing, including after a Daemon restart.
use super::*;
use crate::field::Field;
use crate::rail_index::RailIndex;
use crate::route::policy::{Serial, policy};
use contracts::agent::{NodeKind, RailNode};
use contracts::message::Message;
use contracts::todo::{History, Todo};

#[derive(Default)]
pub(crate) struct Auto {
    gate: Arc<tokio::sync::Mutex<()>>,
}

impl Auto {
    /// Tell the Door of each change that may leave a Todo unassigned, until the Bus closes.
    pub(crate) fn watch(
        &self,
        mut events: tokio::sync::broadcast::Receiver<contracts::Event>,
        reader: digest::Reader,
    ) -> impl std::future::Future<Output = ()> + use<> {
        let gate = Arc::clone(&self.gate);
        async move {
            use tokio::sync::broadcast::error::RecvError;
            loop {
                match events.recv().await {
                    Ok(event) => match event.data {
                        contracts::EventData::TodoCreated(_)
                        | contracts::EventData::TodoUpdated(_)
                        | contracts::EventData::RailChanged
                        | contracts::EventData::AgentStatus(_)
                        | contracts::EventData::WorkstreamUpdated(_) => {}
                        _ => continue,
                    },
                    Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => return,
                }
                let _guard = gate.lock().await;
                if let Err(err) = tell(&reader).await {
                    eprintln!("rupd: Auto notices for the Door were not retained: {err}");
                }
            }
        }
    }
}

impl Daemon {
    /// Serialize Todo edits and the Auto switch with notice admission. The Bus watcher also
    /// covers internal Home/owner repairs and queued Door starts, which bypass the router.
    pub(crate) async fn route(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let params = self
            .resolve_agent_inputs(&conn.actor, method, params)
            .await?;
        let row = policy(method).ok_or_else(|| RpcError::method_not_found(method))?;
        let serializes = match row.serial {
            Serial::No => false,
            Serial::Yes => true,
            Serial::Operation => params.field("operation").is_string(),
        };
        let _guard = if serializes {
            Some(self.auto.gate.lock().await)
        } else {
            None
        };
        let _cap = if row.capped && conn.actor.kind == ActorKind::Agent {
            let guard = self.queue.pass.lock().await;
            self.require_auto_slot(&conn.actor).await?;
            Some(guard)
        } else {
            None
        };
        let result = self.route_inner(conn, method, params).await;
        if row.observes && result.is_ok() {
            // Terminal starts and stops may await an external program. They must leave
            // unrelated Todo edits free; only their subsequent notice pass needs this lock.
            let _notice = if _guard.is_none() {
                Some(self.auto.gate.lock().await)
            } else {
                None
            };
            tell(&self.reader()).await?;
        }
        result
    }

    async fn require_auto_slot(&self, actor: &Actor) -> Result<(), RpcError> {
        let nodes = self.rail().await?;
        let Some(door) = RailIndex::new(&nodes).workstream_of(&actor.id) else {
            return Ok(());
        };
        if door.auto == Some(true) {
            let running = queue::running(&nodes, &self.queue.launching.lock());
            if !running.contains(&door.id)
                && self
                    .agents
                    .workstream_cap()?
                    .is_some_and(|cap| running.len() >= cap as usize)
            {
                return Err(RpcError::conflict(
                    "Workstream cap reached; wait for a running Workstream to finish",
                ));
            }
        }
        Ok(())
    }
}

pub(super) async fn tell(reader: &digest::Reader) -> Result<(), RpcError> {
    let nodes: Vec<RailNode> = reader
        .call("rail", "rail.tree", Value::Null, Actor::daemon())
        .await?;
    let doors: Vec<_> = nodes
        .iter()
        .filter(|node| {
            node.kind == NodeKind::Workstream
                && node.auto == Some(true)
                && node.terminal_id.is_some()
                && node
                    .status
                    .as_ref()
                    .is_some_and(|s| s.kind != contracts::Kind::Done)
        })
        .collect();
    if doors.is_empty() {
        return Ok(());
    }
    let todos: Vec<Todo> = reader
        .call("todo", "todo.list", Value::Null, Actor::daemon())
        .await?;
    // Read retained sends as the Daemon: only its own Messages are visible. This includes
    // Dropped Messages; neither state authorizes sending the same firing twice.
    let sent: Vec<Message> = reader
        .call("message", "message.list", json!({}), Actor::daemon())
        .await?;
    let candidates: Vec<_> = todos
        .iter()
        .filter(|todo| !todo.done && todo.owner.is_none())
        .filter_map(|todo| {
            doors
                .iter()
                .find(|door| Some(&door.id) == todo.home.as_ref())
                .map(|door| (todo, door))
        })
        .collect();
    // EC5637d bounds history extraction to once per row for a multi-candidate pass.
    // split_once preserves the exact newline protocol (including rejecting bare keys / CRLF).
    let daemon = Actor::daemon();
    fn first_line(message: &Message) -> Option<&str> {
        #[cfg(test)]
        counts::first_line();
        message.body.split_once('\n').map(|(line, _)| line)
    }
    let mut index = Vec::new();
    if candidates.len() > 1 {
        #[cfg(test)]
        counts::index();
        index.extend(
            sent.iter()
                .filter(|message| message.from == daemon)
                .filter_map(first_line),
        );
        index.sort_unstable();
    }
    for (todo, door) in candidates.iter() {
        let history: History = reader
            .call(
                "todo",
                "todo.getHistory",
                json!({"id":todo.id}),
                Actor::daemon(),
            )
            .await?;
        let unassigned = history
            .changes
            .iter()
            .rev()
            .find(|change| {
                change.after.owner.is_none()
                    && change
                        .before
                        .as_ref()
                        .is_none_or(|before| before.owner.is_some())
            })
            .map_or(0, |change| change.seq);
        #[cfg(test)]
        counts::identity();
        let key = format!("[auto todo:{} unassigned:{unassigned}]", todo.id);
        let already_sent = if candidates.len() > 1 {
            index.binary_search(&key.as_str()).is_ok()
        } else {
            sent.iter()
                .filter(|message| message.from == daemon)
                .any(|message| first_line(message) == Some(key.as_str()))
        };
        if already_sent {
            continue;
        }
        let body = format!(
            "{key}\nTodo #{}: {}\nTake this Todo with todo_assign {{\"id\": {}, \"owner\": \"me\"}}. Delegate using a peer's Rail name as owner, or start a Subagent and assign it. Subagent starts obey the Workstream cap.",
            todo.id, todo.title, todo.id
        );
        reader
            .call::<Message>(
                "message",
                "message.send",
                json!({"to":door.id,"kind":"note","body":body}),
                Actor::daemon(),
            )
            .await?;
    }
    Ok(())
}

#[cfg(test)]
pub(super) mod counts {
    use std::cell::Cell;
    thread_local! { static COUNTS: Cell<(usize, usize, usize)> = const { Cell::new((0,0,0)) }; }
    pub(super) fn identity() {
        COUNTS.update(|(a, b, c)| (a + 1, b, c));
    }
    pub(super) fn first_line() {
        COUNTS.update(|(a, b, c)| (a, b + 1, c));
    }
    pub(super) fn index() {
        COUNTS.update(|(a, b, c)| (a, b, c + 1));
    }
    pub(crate) async fn measure<F, R>(run: F) -> (usize, usize, usize)
    where
        F: FnOnce() -> R,
        R: std::future::Future<Output = ()>,
    {
        COUNTS.set((0, 0, 0));
        run().await;
        COUNTS.get()
    }
}
