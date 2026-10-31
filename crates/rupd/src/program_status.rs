//! PS7, PS8: a Terminal's program status records folded into one Status, and published.
//!
//! `fold` rolls the records up; `Statuses` keeps each Terminal's Status for `rail.tree` and
//! decides, on an injected clock, when a change leaves as a `terminal.status` event. Nothing a
//! record holds is logged or written anywhere else.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use contracts::terminal::TerminalStatusEvent;
use contracts::{EventData, Kind, Status};
use terminal::{ProgramState, Record};

/// PS8.3: the least time between two `terminal.status` events of one Terminal.
const WINDOW_MS: i64 = 250;
/// PS7.3: the longest label, `…` included.
const LABEL_MAX: usize = 200;

fn kind_of(state: ProgramState) -> Kind {
    match state {
        ProgramState::Idle => Kind::Idle,
        ProgramState::Working => Kind::Working,
        ProgramState::Done => Kind::Done,
        ProgramState::Blocked => Kind::NeedsYou,
        ProgramState::Error => Kind::Error,
    }
}

/// PS7.2: lower is more urgent.
fn urgency(kind: Kind) -> u8 {
    match kind {
        Kind::Error => 0,
        Kind::NeedsYou => 1,
        Kind::Working => 2,
        Kind::Idle => 3,
        _ => 4,
    }
}

fn label(record: &Record) -> String {
    let text = record
        .msg
        .as_deref()
        .or(record.title.as_deref())
        .unwrap_or("");
    let line = text.lines().next().unwrap_or("");
    if line.chars().count() <= LABEL_MAX {
        return line.to_owned();
    }
    let mut cut: String = line.chars().take(LABEL_MAX - 1).collect();
    cut.push('…');
    cut
}

/// PS7: the Terminal's Status, or `None` for a Terminal with no record. `previous` keeps `since`
/// while the rolled-up Kind stays as it was.
pub(crate) fn fold(records: &[Arc<Record>], previous: Option<&Status>, now: i64) -> Option<Status> {
    let winner = records.iter().min_by(|a, b| {
        urgency(kind_of(a.state))
            .cmp(&urgency(kind_of(b.state)))
            .then(b.applied.total_cmp(&a.applied))
    })?;
    let kind = kind_of(winner.state);
    let since = previous
        .filter(|status| status.kind == kind)
        .map_or(now, |status| status.since);
    Some(Status {
        kind,
        label: label(winner),
        since,
        finished: "0".to_owned(),
    })
}

#[derive(Default)]
struct Slot {
    status: Option<Status>,
    /// When the last event for this Terminal left; `None` before the first.
    sent_at: Option<i64>,
    /// What the last event said, so a change back to it sends nothing.
    sent: Option<Status>,
}

/// Each Terminal's current program status and what of it has been announced.
#[derive(Default)]
pub(crate) struct Statuses {
    slots: Mutex<BTreeMap<String, Slot>>,
}

impl Statuses {
    fn slots(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, Slot>> {
        self.slots.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// A Terminal's records are now `records` (empty once it is removed). Returns the events to
    /// send at `now` (ms): the first at once, a later one only after the window.
    pub(crate) fn changed(
        &self,
        terminal: &str,
        records: &[Arc<Record>],
        now: i64,
    ) -> Vec<EventData> {
        let mut slots = self.slots();
        let slot = slots.entry(terminal.to_owned()).or_default();
        slot.status = fold(records, slot.status.as_ref(), now);
        Self::release(terminal, slot, now).into_iter().collect()
    }

    /// PS8.1: the Terminal's Status now, whether or not its event has left yet.
    pub(crate) fn current(&self, terminal: &str) -> Option<Status> {
        self.slots()
            .get(terminal)
            .and_then(|slot| slot.status.clone())
    }

    /// PS8.3: the events whose window ended by `now`.
    pub(crate) fn due(&self, now: i64) -> Vec<EventData> {
        let mut slots = self.slots();
        let out = slots
            .iter_mut()
            .filter_map(|(terminal, slot)| Self::release(terminal, slot, now))
            .collect();
        slots.retain(|_, slot| {
            slot.status.is_some()
                || slot.sent.is_some()
                || slot.sent_at.is_some_and(|at| now - at < WINDOW_MS)
        });
        out
    }

    /// When the next deferred event may leave, if one is deferred.
    pub(crate) fn next_due(&self) -> Option<i64> {
        self.slots()
            .values()
            .filter(|slot| slot.status != slot.sent)
            .filter_map(|slot| slot.sent_at.map(|at| at + WINDOW_MS))
            .min()
    }

    fn release(terminal: &str, slot: &mut Slot, now: i64) -> Option<EventData> {
        if slot.status == slot.sent {
            return None;
        }
        if slot.sent_at.is_some_and(|at| now - at < WINDOW_MS) {
            return None;
        }
        slot.sent = slot.status.clone();
        slot.sent_at = Some(now);
        Some(EventData::TerminalStatus(TerminalStatusEvent {
            id: terminal.to_owned(),
            status: slot.status.clone(),
        }))
    }
}

fn wall_ms() -> i64 {
    let millis = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    i64::try_from(millis.max(0)).unwrap_or(i64::MAX)
}

impl Statuses {
    /// Publish every Terminal's changes to the Bus until the stream closes.
    pub(crate) async fn run(
        self: Arc<Self>,
        mut changes: tokio::sync::broadcast::Receiver<Arc<terminal::Change>>,
        bus: rpc::Bus,
        terminals: Arc<terminal::Terminals>,
        agents: Arc<agents::Agents>,
    ) {
        use tokio::sync::broadcast::error::RecvError;
        let send = |events: Vec<EventData>| {
            for event in events {
                bus.emit(contracts::Actor::daemon(), event);
            }
        };
        loop {
            let wait = self.next_due().map(|at| {
                std::time::Duration::from_millis(u64::try_from(at - wall_ms()).unwrap_or(0))
            });
            tokio::select! {
                change = changes.recv() => match change {
                    Ok(change) => {
                        let events = self.changed(&change.terminal, &change.records, wall_ms());
                        let status = self.current(&change.terminal);
                        terminals.set_program_status(&change.terminal, status.clone());
                        if let Some(status) = status {
                            agents.observe_program_status(&change.terminal, status);
                        }
                        send(events);
                    }
                    Err(RecvError::Lagged(_)) => {}
                    Err(RecvError::Closed) => return,
                },
                () = async { tokio::time::sleep(wait.unwrap_or_default()).await }, if wait.is_some() => {
                    send(self.due(wall_ms()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
