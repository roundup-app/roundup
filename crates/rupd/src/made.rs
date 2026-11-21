//! LH19, LH20: what an Agent made for the user to read: its shown Pads, its open Todos and the files
//! it published, read from the records the Pads, Todos and publications already keep (no model
//! call), and one `agent.made` event whenever an Agent's list changes.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use contracts::links::{MAX_MADE, MadeItem, MadeKind};
use contracts::{Actor, ActorKind, Event, EventData};
use rpc::{Bus, RpcError};
use tokio::sync::broadcast::{Receiver, error::RecvError};

use crate::deliverables::Publications;

pub(crate) struct Made {
    todos: Arc<todos::Todos>,
    pads: Arc<pads::Pads>,
    publications: Arc<Publications>,
    /// The list last read or told for each Agent; an Agent with none is absent.
    seen: parking_lot::Mutex<HashMap<String, Vec<MadeItem>>>,
}

impl Made {
    pub(crate) fn new(
        todos: Arc<todos::Todos>,
        pads: Arc<pads::Pads>,
        publications: Arc<Publications>,
    ) -> Self {
        Self {
            todos,
            pads,
            publications,
            seen: Default::default(),
        }
    }

    /// Every Agent's list: its shown Pads, then its open Todos, then its published files, each
    /// in creation order, the oldest dropped past `MAX_MADE`.
    fn lists(&self) -> Result<BTreeMap<String, Vec<MadeItem>>, RpcError> {
        let mine = |actor: &Actor| (actor.kind == ActorKind::Agent).then(|| actor.id.clone());
        let mut lists: BTreeMap<String, Vec<MadeItem>> = BTreeMap::new();
        let mut pads = self.pads.list_all()?;
        pads.sort_by_key(|pad| pad.incarnation.parse::<i64>().unwrap_or(i64::MAX));
        for pad in pads {
            if pad.visibility != contracts::agent::RailVisibility::Shown {
                continue;
            }
            if let Some(agent) = mine(&pad.creator) {
                lists.entry(agent).or_default().push(MadeItem {
                    kind: MadeKind::Pad,
                    id: pad.name.clone(),
                    title: pad.name,
                });
            }
        }
        let mut todos = self.todos.list_all()?;
        todos.sort_by_key(|todo| todo.id);
        for todo in todos.into_iter().filter(|todo| !todo.done) {
            if let Some(agent) = mine(&todo.creator) {
                lists.entry(agent).or_default().push(MadeItem {
                    kind: MadeKind::Todo,
                    id: todo.id.to_string(),
                    title: todo.title,
                });
            }
        }
        for (maker, id, title) in self.publications.made_files()? {
            lists.entry(maker).or_default().push(MadeItem {
                kind: MadeKind::File,
                id,
                title,
            });
        }
        for list in lists.values_mut() {
            let extra = list.len().saturating_sub(MAX_MADE);
            list.drain(..extra);
        }
        Ok(lists)
    }

    /// LH19: what `agent` made now. It is also what the Agent's next change is compared with.
    pub(crate) fn read(&self, agent: &str) -> Result<Vec<MadeItem>, RpcError> {
        let list = self.lists()?.remove(agent).unwrap_or_default();
        let mut seen = self.seen.lock();
        if list.is_empty() {
            seen.remove(agent);
        } else {
            seen.insert(agent.to_owned(), list.clone());
        }
        Ok(list)
    }

    /// LH20: the Agents whose list differs from the one last read or told, each told once.
    fn changed(&self) -> Result<Vec<String>, RpcError> {
        let now = self.lists()?;
        let mut seen = self.seen.lock();
        let mut changed: Vec<String> = seen
            .keys()
            .filter(|agent| !now.contains_key(*agent))
            .cloned()
            .collect();
        changed.extend(
            now.iter()
                .filter(|(agent, list)| seen.get(*agent) != Some(*list))
                .map(|(agent, _)| agent.clone()),
        );
        *seen = now.into_iter().collect();
        Ok(changed)
    }

    /// LH20: whether an event is a change to a Pad, a Todo or a publication.
    fn moves(event: &Event) -> bool {
        matches!(
            event.data,
            EventData::PadChanged(_)
                | EventData::PadRenamed { .. }
                | EventData::PadDeleted(_)
                | EventData::TodoCreated(_)
                | EventData::TodoUpdated(_)
                | EventData::TodoRestored(_)
                | EventData::TodoDeleted(_)
                | EventData::DeliverablePublished { .. }
                | EventData::DeliverableChanged
        )
    }

    /// Runs for as long as the Bus lives: each change to a Pad, a Todo or a publication tells the
    /// Agents whose list it changed.
    pub(crate) async fn watch(self: Arc<Self>, mut events: Receiver<Event>, bus: Bus) {
        loop {
            match events.recv().await {
                Ok(event) if !Self::moves(&event) => continue,
                Ok(_) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => return,
            }
            match self.changed() {
                Ok(agents) => {
                    for id in agents {
                        bus.emit(
                            Actor::daemon(),
                            EventData::AgentMade(contracts::agent::NodeId { id }),
                        );
                    }
                }
                Err(err) => eprintln!("agent.made: the lists could not be read: {err:?}"),
            }
        }
    }
}

impl crate::Daemon {
    pub(crate) async fn agent_made(
        &self,
        conn: &mut crate::Conn,
        p: contracts::agent::NodeId,
    ) -> Result<Vec<MadeItem>, RpcError> {
        self.agents.guard_reach(&conn.actor, &p.id, true)?;
        self.made.read(&p.id)
    }
}
