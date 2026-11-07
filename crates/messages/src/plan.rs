//! B50, B5763c, DCL8: what a loaded batch of pending Messages does. `plan` reads only the `Batch`
//! it is given, so no store, lock, clock or inbox can reach it; `inbox::send` loads the batch and
//! carries the plan out.

use std::collections::{HashMap, HashSet};

use agents::claude_code::inbox::Entry;

use super::*;

/// Everything `plan` decides from: the facts `inbox::send` loaded for one idle receiver.
pub(crate) struct Batch<'a> {
    pub agent: &'a str,
    pub at: store::Binding,
    pub pick: Pick,
    /// The Messages still `pending` after the waiting check, in id order.
    pub notes: Vec<Message>,
    /// What each of `notes` is (B6506).
    pub payloads: pushes::Payloads,
    /// The Attempt each of `notes` is bound to, in the same order.
    pub bounds: Vec<store::Binding>,
    /// Whether `at` still names the receiver's open Attempt and revision.
    pub generation_ok: bool,
    /// Display name of each Agent sender.
    pub names: HashMap<String, String>,
    /// The last content the receiver's session was given, when known.
    pub previous: Option<String>,
    /// U6248a: Messages written again after a missed receipt, which skip the repeat check.
    pub rewrite: HashSet<u32>,
    /// Every Message is a digest with no news over what the receiver was already given.
    pub quiet: bool,
    /// DCL8: the open-Job snapshot due with this batch.
    pub snapshot: Option<String>,
    /// The exact content the Adapter renders for an entry.
    pub render: Box<dyn Fn(&Entry) -> String + 'a>,
}

/// What `inbox::send` does with a batch.
pub(crate) enum Plan {
    /// The revision, the Attempt or a Message's binding moved on: nothing is written.
    Stale,
    /// Nothing is written now; `ids` stay `pending` for `why`, or for the next eligible event.
    Hold {
        ids: Vec<u32>,
        why: Option<&'static str>,
    },
    /// Write `said`, close `repeats` as delivered and confirm `empty`; `snapshot` says the
    /// open-Job snapshot rides in `said`.
    Write {
        said: Vec<Entry>,
        repeats: Vec<u32>,
        empty: Vec<Entry>,
        snapshot: bool,
    },
}

/// Whether a write for Messages bound to `bounds` must not go on.
pub(crate) fn is_stale(
    at: store::Binding,
    pick: Pick,
    generation_ok: bool,
    bounds: &[store::Binding],
) -> bool {
    !generation_ok
        || bounds
            .iter()
            .any(|b| b.0 != at.0 || (pick == Pick::Next && b.1 >= at.1))
}

#[cfg(test)]
impl Plan {
    /// Whether the batch went on, as `Stale` says it did not.
    pub(crate) fn went(&self) -> bool {
        !matches!(self, Plan::Stale)
    }
}

pub(crate) fn plan(batch: &Batch) -> Plan {
    let mut entries: Vec<Entry> = batch
        .notes
        .iter()
        .zip(pushes::bodies_of(&batch.notes, &batch.payloads))
        .map(|(note, text)| Entry {
            id: note.id,
            kind: note.kind,
            from: if note.from.kind == ActorKind::Agent {
                batch
                    .names
                    .get(&note.from.id)
                    .cloned()
                    .unwrap_or_else(|| note.from.id.clone())
            } else {
                note.from.id.clone()
            },
            one_line: note.kind == MessageKind::Note
                && !matches!(batch.payloads.of(note), pushes::Payload::Note),
            text,
        })
        .collect();
    let attached = batch.snapshot.is_some();
    let carrier = entries
        .iter()
        .rposition(|entry| !entry.one_line)
        .or(entries.len().checked_sub(1));
    if let (Some(snapshot), Some(last)) =
        (&batch.snapshot, carrier.and_then(|i| entries.get_mut(i)))
    {
        last.one_line = false;
        last.text = if last.text.is_empty() {
            snapshot.clone()
        } else {
            format!("{}\n\n{snapshot}", last.text)
        };
    }
    let mut previous = batch.previous.clone();
    let mut repeats = Vec::new();
    let mut said = Vec::new();
    let mut empty = Vec::new();
    for entry in entries {
        let content = (batch.render)(&entry);
        if entry.text.is_empty() {
            empty.push(entry);
        // Questions preserve same-id receipt recovery; distinct reply ids already prevent
        // equality between different Questions. B5763c closes recovered notes only.
        } else if entry.kind == MessageKind::Note
            && previous.as_deref() == Some(&content)
            && !batch.rewrite.contains(&entry.id)
        {
            repeats.push(entry.id);
        } else if !batch.quiet {
            previous = Some(content);
            said.push(entry);
        }
    }
    let kept = |id: u32| {
        repeats.contains(&id) || said.iter().any(|e| e.id == id) || empty.iter().any(|e| e.id == id)
    };
    let bounds: Vec<store::Binding> = batch
        .notes
        .iter()
        .zip(&batch.bounds)
        .filter(|(m, _)| kept(m.id))
        .map(|(_, bound)| *bound)
        .collect();
    if bounds.is_empty() {
        return Plan::Hold {
            ids: batch.notes.iter().map(|m| m.id).collect(),
            why: None,
        };
    }
    if is_stale(batch.at, batch.pick, batch.generation_ok, &bounds) {
        return Plan::Stale;
    }
    Plan::Write {
        said,
        repeats,
        empty,
        snapshot: attached,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: u32, body: &str) -> Message {
        Message {
            id,
            from: Actor::daemon(),
            to: "m".into(),
            kind: MessageKind::Note,
            body: body.into(),
            reply_to: None,
            status: MessageStatus::Pending,
            reason: None,
            waiting: None,
            at: 0,
        }
    }

    fn render(entry: &Entry) -> String {
        entry.text.clone()
    }

    fn batch(notes: Vec<Message>) -> Batch<'static> {
        Batch {
            agent: "m",
            at: (1, 2),
            pick: Pick::Next,
            bounds: notes.iter().map(|_| (1, 1)).collect(),
            payloads: pushes::Payloads::default(),
            notes,
            generation_ok: true,
            names: HashMap::new(),
            previous: None,
            rewrite: HashSet::new(),
            quiet: false,
            snapshot: None,
            render: Box::new(render),
        }
    }

    #[test]
    fn b39_a_batch_bound_to_a_later_revision_is_stale() {
        let mut stale = batch(vec![note(1, "a")]);
        stale.bounds = vec![(1, 2)];
        assert!(matches!(plan(&stale), Plan::Stale));
        let mut stopped = batch(vec![note(1, "a")]);
        stopped.generation_ok = false;
        assert!(matches!(plan(&stopped), Plan::Stale));
    }

    #[test]
    fn dcl1_a_quiet_batch_holds_every_id_and_writes_nothing() {
        let mut quiet = batch(vec![note(1, "a"), note(2, "b")]);
        quiet.quiet = true;
        let Plan::Hold { ids, why } = plan(&quiet) else {
            panic!("a quiet batch is deferred");
        };
        assert_eq!((ids, why), (vec![1, 2], None));
    }

    #[test]
    fn b5763c_write_splits_said_repeat_and_empty_and_snapshot_rides_the_last_note() {
        let mut b = batch(vec![note(1, "again"), note(2, "new"), note(3, "[wake]")]);
        b.payloads
            .0
            .insert(3, pushes::Payload::Wake { ids: vec![] });
        b.previous = Some("again".into());
        b.snapshot = Some("[open jobs]\n- j".into());
        let Plan::Write {
            said,
            repeats,
            empty,
            snapshot,
        } = plan(&b)
        else {
            panic!("a fresh batch is written");
        };
        assert_eq!(repeats, vec![1]);
        assert!(empty.is_empty());
        assert_eq!(said.iter().map(|e| e.id).collect::<Vec<_>>(), vec![2, 3]);
        assert!(snapshot);
        // The carrier is the last entry that is not one line: the `[wake]` note stays as it was.
        assert_eq!(said[0].text, "new\n\n[open jobs]\n- j");
        assert_eq!(said[1].text, "[wake]");
        b.rewrite.insert(1);
        let Plan::Write { repeats, .. } = plan(&b) else {
            panic!("a rewrite is written");
        };
        assert!(repeats.is_empty());
        let Plan::Write { empty, said, .. } = plan(&batch(vec![note(4, "")])) else {
            panic!("an empty note is confirmed");
        };
        assert_eq!(empty.iter().map(|e| e.id).collect::<Vec<_>>(), vec![4]);
        assert!(said.is_empty());
    }
}
