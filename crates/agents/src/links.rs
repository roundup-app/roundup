//! LH1–LH4: each Agent's link set for its header. At a turn stop an adapter reads the turn text;
//! text that may hold a link runs one model call, and an accepted answer replaces the Agent's
//! set. Vendor-neutral: the adapter owns the transcript and the call.

use async_trait::async_trait;
use contracts::links::{LinkSet, LinksEvent};
use contracts::{Actor, EventData};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use crate::{Shared, claude_code};

/// The one model call: the links the turn text holds, given the Agent's last set.
#[async_trait]
pub trait LinksModel: Send + Sync {
    /// An answer that does not parse as a `LinkSet`, or a call that fails, is an `Err`.
    async fn links(&self, text: &str, last: &LinkSet) -> Result<LinkSet, String>;
}

/// No model: every call fails. The default of a test `Shared`.
#[cfg(test)]
pub(crate) struct Absent;

#[cfg(test)]
#[async_trait]
impl LinksModel for Absent {
    async fn links(&self, _text: &str, _last: &LinkSet) -> Result<LinkSet, String> {
        Err("no model".into())
    }
}

/// LH4: the last set of each Agent, and how far each Agent's transcript has been read.
#[derive(Default)]
pub(crate) struct Links {
    sets: Mutex<HashMap<String, LinkSet>>,
    read: Mutex<HashMap<String, (PathBuf, u64)>>,
}

impl Links {
    pub(crate) fn get(&self, id: &str) -> LinkSet {
        self.sets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
            .unwrap_or_default()
    }

    /// The set lives as long as the Agent's record.
    pub(crate) fn forget(&self, id: &str) {
        self.sets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
        self.read
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }

    /// The turn text since this Agent's last stop, and the cursor moved past it.
    fn turn_text(&self, id: &str, path: PathBuf) -> String {
        let mut read = self.read.lock().unwrap_or_else(|e| e.into_inner());
        let from = read
            .get(id)
            .filter(|(known, _)| *known == path)
            .map_or(0, |(_, offset)| *offset);
        let (text, next) = claude_code::links::turn_text(&path, from);
        read.insert(id.to_owned(), (path, next));
        text
    }
}

impl Shared {
    /// LH1: at an Agent's Stop, read the turn text and, for link-like text, run the call off every
    /// lock. A turn that runs no call, a failed call or an unparsable answer keeps the set and
    /// emits nothing (LH4); the log says why a call failed.
    pub(super) fn read_links(&self, id: &str, payload: &serde_json::Value) {
        let seen = claude_code::see(payload);
        let (Some(path), "Stop") = (seen.transcript, seen.name) else {
            return;
        };
        let Some(shared) = self.me.upgrade() else {
            return;
        };
        let id = id.to_owned();
        tokio::spawn(async move {
            let reader = Arc::clone(&shared);
            let name = id.clone();
            let Ok(text) =
                tokio::task::spawn_blocking(move || reader.events.links.turn_text(&name, path))
                    .await
            else {
                return;
            };
            let last = shared.events.links.get(&id);
            match claude_code::links::answer(&*shared.events.links_model, &text, &last).await {
                Ok(None) => {}
                Ok(Some(set)) => {
                    shared
                        .events
                        .links
                        .sets
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .insert(id.clone(), set.clone());
                    shared.bus.emit(
                        Actor::daemon(),
                        EventData::AgentLinks(Box::new(LinksEvent { id, set })),
                    );
                }
                Err(err) => eprintln!("agents: {id}: its links stay as they were: {err}"),
            }
        });
    }
}
