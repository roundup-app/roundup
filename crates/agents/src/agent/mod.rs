//! The Agent's entry in `Shared::runs`: its Slot and every fact that lives only while it is known.

pub(crate) mod fold;
mod run;
use std::collections::HashMap;

use contracts::agent::Stray;
pub(crate) use run::{Run, Slot};

use crate::claude_code::toolcall::Tracked;
use crate::id::AgentId;
use crate::{Channel, resume_wait::Resume};

/// What `runs` holds for one id. A remove forgets all of it.
pub(crate) struct Agent {
    pub(crate) slot: Slot,
    pub(crate) facts: Facts,
}

/// The facts the Rail reads next to the Slot; each moves under the `runs` lock.
#[derive(Default)]
pub(crate) struct Facts {
    /// E6: the Channel of the Attempt that has left `pending`, as `(attempt, channel)`; an entry of
    /// an earlier Attempt reads as `pending`.
    pub(crate) channel: Option<(String, Channel)>,
    /// A33: the lowest open blocker of the Todos the Agent created that wait; an idle Agent in it
    /// reads `blocked`.
    pub(crate) wait: Option<u32>,
    /// U6248b: the turn Claude Code gave up on and whose resume waits.
    pub(crate) resume: Option<Resume>,
    /// F5: the Door's strays as last announced.
    pub(crate) strays: Vec<Stray>,
    /// U3780a: the current or last tool call.
    pub(crate) tool_call: Option<Tracked>,
}

/// `runs` read and written by Slot; a write keeps the entry's facts. The id is parsed here, once
/// per call: a string that is no `AgentId` names no Agent.
pub(crate) trait Runs {
    fn slot(&self, id: &str) -> Option<&Slot>;
    fn slot_mut(&mut self, id: &str) -> Option<&mut Slot>;
    /// Replace the Slot of `id`, or add an Agent with no facts.
    fn put(&mut self, id: &str, slot: Slot);
    /// Take the Slot of `id` out, leaving the facts and no Slot; the caller usually `put`s the
    /// next Slot back under the same lock. Only a remove forgets the facts.
    fn take(&mut self, id: &str) -> Option<Slot>;
    /// The entry of `id`, with its facts.
    fn agent(&self, id: &str) -> Option<&Agent>;
    fn agent_mut(&mut self, id: &str) -> Option<&mut Agent>;
    /// Forget the Agent: its Slot and every fact.
    fn forget(&mut self, id: &str) -> Option<Agent>;
}

impl Runs for HashMap<AgentId, Agent> {
    fn slot(&self, id: &str) -> Option<&Slot> {
        self.agent(id)
            .map(|agent| &agent.slot)
            .filter(|slot| !matches!(slot, Slot::Gone))
    }

    fn slot_mut(&mut self, id: &str) -> Option<&mut Slot> {
        self.agent_mut(id)
            .map(|agent| &mut agent.slot)
            .filter(|slot| !matches!(slot, Slot::Gone))
    }

    fn take(&mut self, id: &str) -> Option<Slot> {
        self.slot_mut(id)
            .map(|slot| std::mem::replace(slot, Slot::Gone))
    }

    fn put(&mut self, id: &str, slot: Slot) {
        let Some(id) = AgentId::parse(id) else {
            return;
        };
        match self.get_mut(&id) {
            Some(agent) => agent.slot = slot,
            None => {
                self.insert(
                    id,
                    Agent {
                        slot,
                        facts: Facts::default(),
                    },
                );
            }
        }
    }

    fn agent(&self, id: &str) -> Option<&Agent> {
        self.get(&AgentId::parse(id)?)
    }

    fn agent_mut(&mut self, id: &str) -> Option<&mut Agent> {
        self.get_mut(&AgentId::parse(id)?)
    }

    fn forget(&mut self, id: &str) -> Option<Agent> {
        self.remove(&AgentId::parse(id)?)
    }
}
