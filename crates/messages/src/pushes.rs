//! B22: what keeps pushed digests (B21) from flooding a Door. At most 8 go out in any
//! 60 000 ms; the rest wait and leave as one rollup; at most 20 stay `pending`, the
//! oldest two merging into one when a twenty-first arrives. No cap loses a count: each digest has
//! a weight, kept in its payload, and a rollup or a merge weighs what it holds.

use crate::Error;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use contracts::Actor;
use contracts::agent::DigestEntry;
use contracts::message::{Message, MessageKind, SendParams};
use rpc::Ctx;

use crate::digest::{self, cut, entry_text, push_body};
use crate::{Inner, Messages, lock, pushes};

pub(crate) const PREFIX: &str = "[digest]";
const WINDOW_MS: i64 = 60_000;
const PUSHES: usize = 8;
const OPEN_DIGESTS: usize = 20;
const ROLLUP_CHILDREN: usize = 8;
const ROLLUP_BYTES: usize = 4096;
const MORE_BYTES: usize = 512;

/// What was sent to each Door lately, and the changes still waiting for the window.
#[derive(Default)]
pub(crate) struct Ledger {
    metas: HashMap<String, Slot>,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Slot {
    /// When the pushes of the last window went out, oldest first; B23: a restart starts the
    /// window again, so it is not stored.
    #[serde(skip)]
    sent: VecDeque<i64>,
    /// The entries of the changes kept back, oldest first.
    waiting: Vec<(String, DigestEntry, u32)>,
    /// DTC2: every waiting entry is quiet, so no clock sends it; the Door's next turn does.
    #[serde(default)]
    all_quiet: bool,
}

impl Ledger {
    /// The slots stored in `push_slots`, as they were when the Daemon last ran (DCL8): a change
    /// `Seen` recorded as told and kept back here is sent after a restart, not lost.
    pub(crate) fn load(db: &rusqlite::Connection) -> Self {
        let metas = db
            .prepare("SELECT door, slot FROM push_slots")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(meta, json)| Some((meta, serde_json::from_str(&json).ok()?)))
            .collect();
        Self { metas }
    }

    /// Writes each slot through, and drops the rows of those that are gone. A refused write
    /// is returned and leaves the stored rows as they were (DCL10a).
    /// `queued` names the Door and child whose `push_intents` row this write replaces (DCL4).
    fn save(&self, inner: &Inner, queued: Option<(&str, &str)>) -> rusqlite::Result<()> {
        let store = lock(&inner.store);
        let tx = store.db.unchecked_transaction()?;
        if let Some((door, child)) = queued {
            tx.execute(
                "DELETE FROM push_intents WHERE door = ?1 AND child = ?2",
                rusqlite::params![door, child],
            )?;
        }
        tx.execute("DELETE FROM push_slots", [])?;
        for (meta, slot) in &self.metas {
            let json = serde_json::to_string(slot)
                .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)))?;
            tx.execute(
                "INSERT INTO push_slots (door, slot) VALUES (?1, ?2)",
                rusqlite::params![meta, json],
            )?;
        }
        tx.commit()
    }

    /// `save`, logging a refused write; the entries stay waiting in memory.
    fn persist(&self, inner: &Inner, queued: Option<(&str, &str)>) {
        if let Err(err) = self.save(inner, queued) {
            crate::log_failure("push ledger", &err.to_string());
        }
    }
}

#[cfg(test)]
impl Ledger {
    pub(super) fn waiting_count(&self, meta: &str) -> usize {
        self.metas.get(meta).map_or(0, |slot| slot.waiting.len())
    }
}

impl Slot {
    fn expire(&mut self, now: i64) {
        while self.sent.front().is_some_and(|at| *at <= now - WINDOW_MS) {
            self.sent.pop_front();
        }
    }
}

/// B6506: what a stored Message is, typed once where it enters and kept in `messages.payload`.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) enum Payload {
    #[default]
    Note,
    /// A pushed digest: the entries its body lists, and the changes it stands for (B22(c)).
    Digest {
        entries: Vec<DigestEntry>,
        stands_for: u32,
    },
    /// A firing (B42): the Agents it names, in the order named.
    Wake { ids: Vec<String> },
}

impl Payload {
    /// Whether the Message is a pushed digest (B22).
    pub(crate) fn is_digest(&self) -> bool {
        matches!(self, Payload::Digest { .. })
    }

    /// B22(c): the changes a Message stands for: 1 for a plain push or a note, K for a rollup,
    /// N for a merge, W for a plain push that folded older ones (B34).
    pub(crate) fn weight(&self) -> u32 {
        match self {
            Payload::Digest { stands_for, .. } => *stands_for,
            _ => 1,
        }
    }

    /// The entries a pushed digest holds, in the order its body lists them.
    pub(crate) fn entries(&self) -> &[DigestEntry] {
        match self {
            Payload::Digest { entries, .. } => entries,
            _ => &[],
        }
    }

    /// B34: the names of the children a pushed digest holds an entry of.
    pub(crate) fn names(&self) -> Vec<String> {
        self.entries().iter().map(|e| e.name.clone()).collect()
    }

    /// B34: whether a Message with this `body` is one child's push, not a rollup or a merge.
    pub(crate) fn is_plain_push(&self, body: &str) -> bool {
        match self {
            Payload::Digest {
                entries,
                stands_for,
            } => matches!(entries.as_slice(), [entry]
                if body == counted(&digest::push_body(entry), *stands_for)),
            _ => false,
        }
    }
}

/// The payloads of some stored Messages, by id; a Message not in it is a `Note`.
#[derive(Default)]
pub(crate) struct Payloads(pub(crate) HashMap<u32, Payload>);

impl Payloads {
    pub(crate) fn of(&self, message: &Message) -> &Payload {
        static NOTE: Payload = Payload::Note;
        self.0.get(&message.id).unwrap_or(&NOTE)
    }
}

/// B34: `body`, a pushed digest of `payload`, without the entries of the children in `gone`, and
/// with nothing at all when that leaves no entry of a plain push.
pub(crate) fn without(
    body: &str,
    payload: &Payload,
    gone: &std::collections::HashSet<String>,
) -> String {
    let entries = payload.entries();
    if payload.is_plain_push(body) {
        return if entries.iter().any(|e| gone.contains(&e.name)) {
            String::new()
        } else {
            body.to_owned()
        };
    }
    let mut out = String::new();
    let mut at = 0;
    for entry in entries {
        let line = format!("\n{}", digest::entry_text(entry));
        let Some(found) = body[at..].find(&line) else {
            continue;
        };
        let (start, end) = (at + found, at + found + line.len());
        if gone.contains(&entry.name) {
            out.push_str(&body[at..start]);
            at = end;
        } else {
            out.push_str(&body[at..end]);
            at = end;
        }
    }
    out.push_str(&body[at..]);
    out
}

/// B34: the text of each of `found` (oldest first) for one prompt: a pushed digest loses the
/// entries of the children that a newer one in `found` holds, so the prompt names each child once.
pub(crate) fn bodies_of(found: &[Message], payloads: &Payloads) -> Vec<String> {
    let mut later = std::collections::HashSet::new();
    let mut bodies: Vec<String> = found
        .iter()
        .enumerate()
        .rev()
        .map(|(index, message)| {
            let payload = payloads.of(message);
            if message.kind != MessageKind::Note || !payload.is_digest() {
                return message.body.clone();
            }
            let body = without(&message.body, payload, &later);
            // Equal adjacent digests reach the shared rendered comparison together (B5763b).
            // Different updates still replace the older child's content under B34.
            if index
                .checked_sub(1)
                .and_then(|previous| found.get(previous))
                .is_none_or(|previous| {
                    previous.kind != MessageKind::Note
                        || previous.from != message.from
                        || previous.body != message.body
                })
            {
                later.extend(payload.names());
            }
            body
        })
        .collect();
    bodies.reverse();
    bodies
}

/// B34: `body`, a plain push, ending with the line that says it stands for `weight` changes.
pub(crate) fn counted(body: &str, weight: u32) -> String {
    if weight > 1 {
        format!("{body}\n  ({weight} changes)")
    } else {
        body.to_owned()
    }
}

/// `header`, then `entries` (newest first, one per child) one to a line, at most 8 and 4096 bytes
/// in all; the children left out are named on one last line, cut at 512 bytes.
/// The entries the body lists are the payload's, as the body renders them.
fn compose(header: &str, entries: &[DigestEntry], children: usize) -> (String, Vec<DigestEntry>) {
    // B49: inside a Rollup or a merge an end note keeps B19's bounds.
    let mut rolled: Vec<DigestEntry> = entries.iter().map(digest::rolled).collect();
    let lines: Vec<String> = rolled.iter().map(entry_text).collect();
    let fit = |reserve: usize| {
        let mut used = header.len();
        let mut taken = 0;
        for line in &lines {
            if taken == children || used + 1 + line.len() + reserve > ROLLUP_BYTES {
                break;
            }
            used += 1 + line.len();
            taken += 1;
        }
        taken
    };
    let mut taken = fit(0);
    if taken < lines.len() {
        taken = fit(1 + MORE_BYTES);
    }
    let mut body = header.to_owned();
    for line in lines.iter().take(taken) {
        body.push('\n');
        body.push_str(line);
    }
    if taken < lines.len() {
        let names: Vec<&str> = entries
            .iter()
            .skip(taken)
            .map(|entry| entry.name.as_str())
            .collect();
        let more = format!("[+{} more: {}]", names.len(), names.join(", "));
        body.push('\n');
        body.push_str(&cut(&more, MORE_BYTES));
    }
    rolled.truncate(taken);
    (body, rolled)
}

/// The newest entry of each child, from `entries` newest first.
fn newest_per_child(entries: impl IntoIterator<Item = DigestEntry>) -> Vec<DigestEntry> {
    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter(|entry| seen.insert(entry.name.clone()))
        .collect()
}

/// B22(b): the Message that stands for `older` and `newer`.
pub(crate) fn merged(
    (older, older_payload): (&Message, &Payload),
    (newer, newer_payload): (&Message, &Payload),
) -> (String, Payload) {
    let count = older_payload.weight() + newer_payload.weight();
    let header = format!(
        "{PREFIX} [{count} earlier updates: #{} #{}]",
        older.id, newer.id
    );
    let entries = newest_per_child(
        newer_payload
            .entries()
            .iter()
            .chain(older_payload.entries())
            .cloned(),
    );
    // DTC4: a merge names every child its entries hold, within the byte bound.
    let (body, entries) = compose(&header, &entries, usize::MAX);
    (
        body,
        Payload::Digest {
            entries,
            stands_for: count,
        },
    )
}

/// B22(a): the Message that stands for the `waiting` changes, oldest first.
pub(crate) fn rollup_body(waiting: &[(String, DigestEntry, u32)]) -> (String, Payload) {
    let count: u32 = waiting.iter().map(|(_, _, weight)| weight).sum();
    let header = format!("{PREFIX} [{count} updates kept back]");
    let (body, entries) = compose(
        &header,
        &waiting
            .iter()
            .rev()
            .map(|(_, entry, _)| entry.clone())
            .collect::<Vec<_>>(),
        ROLLUP_CHILDREN,
    );
    (
        body,
        Payload::Digest {
            entries,
            stands_for: count,
        },
    )
}

tokio::task_local! {
    /// Set while this task holds the ledger, so a nested `release` does not wait on its holder.
    static IN_LEDGER: ();
}

/// B21, B22: accepts one changed entry, retaining it until its Door can receive it.
///
/// DTC2: a quiet entry (`waking` false) is stored and starts no turn; a waking one, the report or
/// end note of a child, is never made quiet, whatever Wake request the Door holds; `release_quiet` writes it with the next Message the Door takes.
pub(crate) async fn push(
    inner: &Arc<Inner>,
    meta: &str,
    subagent: &str,
    entry: &DigestEntry,
    waking: bool,
) {
    IN_LEDGER
        .scope((), push_locked(inner, meta, subagent, entry, waking))
        .await;
}

async fn push_locked(
    inner: &Arc<Inner>,
    meta: &str,
    subagent: &str,
    entry: &DigestEntry,
    waking: bool,
) {
    let quiet = !waking;
    // DCL4's observer ends the Daemon here, after the change was recorded as told and before it is
    // queued; the hook refuses nothing.
    let _ = crate::trip(inner, "push.queue");
    let mut ledger = inner.pushes.lock().await;
    let now = (inner.clock)();
    let slot = ledger.metas.entry(meta.to_owned()).or_default();
    slot.expire(now);
    let plain = slot.waiting.is_empty() && slot.sent.len() < PUSHES;
    if slot.waiting.is_empty() {
        slot.all_quiet = quiet;
    } else if !quiet {
        slot.all_quiet = false;
    }
    let weight = slot
        .waiting
        .iter()
        .position(|(id, _, _)| id == subagent)
        .map_or(1, |at| slot.waiting.remove(at).2 + 1);
    slot.waiting
        .push((subagent.to_owned(), entry.clone(), weight));
    ledger.persist(inner, Some((meta, subagent)));
    if quiet {
        return;
    }
    let slot = ledger.metas.entry(meta.to_owned()).or_default();
    match crate::load_rail_nodes(inner).await {
        Ok(nodes) => roll_up(inner, meta, slot, now, plain, &nodes).await,
        Err(err) => crate::log_failure("push", &format!("{meta}: {}", err)),
    }
    ledger.persist(inner, Some((meta, subagent)));
}

/// DTC2: a Door is about to take Messages, so the quiet entries waiting for it go out with them, as
/// one rollup (B22) in the same inbox write. A busy ledger is a push in progress that sends its own.
pub(crate) fn release_quiet<'a>(
    inner: &'a Arc<Inner>,
    door: &'a str,
    turn_start: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    // Boxed: the rollup it sends is delivered through `on_idle`, which calls this again.
    Box::pin(release(inner, door, turn_start))
}

async fn release(inner: &Arc<Inner>, door: &str, turn_start: bool) {
    // A call beneath a ledger holder in this task is that holder's own rollup being delivered: it
    // sends its own. Any other call waits for a concurrent push, whose entries it then carries out.
    let mut ledger = if IN_LEDGER.try_with(|()| ()).is_ok() {
        let Ok(ledger) = inner.pushes.try_lock() else {
            return;
        };
        ledger
    } else {
        inner.pushes.lock().await
    };
    IN_LEDGER
        .scope((), release_locked(inner, door, turn_start, &mut ledger))
        .await;
}

async fn release_locked(inner: &Arc<Inner>, door: &str, turn_start: bool, ledger: &mut Ledger) {
    let Some(slot) = ledger.metas.get_mut(door) else {
        return;
    };
    if slot.waiting.is_empty() || (turn_start && !slot.all_quiet) {
        return;
    }
    // DTC4: at a Stop the entries the window cap kept back are pending for the Door too, so they
    // ride the one catch-up note.
    let held = !turn_start && !slot.all_quiet;
    // A Door turn the user's prompt starts takes the quiet notes though nothing else waits; a Door at
    // rest takes them only with a Message, so quiet notes alone start no turn. A turn that starts
    // with a Message pending is that Message's turn, already written: a quiet note arriving after
    // the write stays stored, since a second Message would cost the Door a second turn.
    let pending = lock(&inner.store)
        .list_pending_to(door)
        .is_ok_and(|pending| !pending.is_empty());
    if !held && turn_start == pending {
        return;
    }
    slot.all_quiet = false;
    let now = (inner.clock)();
    slot.expire(now);
    if held {
        slot.sent.clear();
    }
    match crate::load_rail_nodes(inner).await {
        Ok(nodes) => roll_up(inner, door, slot, now, false, &nodes).await,
        Err(err) => crate::log_failure("push", &format!("{door}: {err}")),
    }
    ledger.persist(inner, None);
}

/// DTC4: a Door at its Stop is written one note for what `rupd` has pending for it: its pending
/// digests fold into one Message with one entry per child, the newest, as B22(b) merges two.
pub(crate) fn catch_up<'a>(
    inner: &'a Arc<Inner>,
    door: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    // Boxed: the merged Message it sends is delivered through `on_idle`, which calls this again.
    Box::pin(fold_pending(inner, door))
}

async fn fold_pending(inner: &Arc<Inner>, door: &str) {
    let is_door = crate::load_rail_nodes(inner).await.is_ok_and(|nodes| {
        nodes
            .iter()
            .any(|node| node.id == door && node.kind == contracts::agent::NodeKind::Workstream)
    });
    if !is_door {
        return;
    }
    let messages = Messages {
        inner: Arc::clone(inner),
    };
    let ctx = Ctx {
        actor: Actor::daemon(),
        bus: inner.bus.clone(),
        touches: Arc::clone(&inner.touches),
    };
    let params = SendParams {
        to: door.to_owned(),
        kind: MessageKind::Note,
        body: PREFIX.to_owned(),
        reply_to: None,
    };
    loop {
        let foldable = {
            let store = lock(&inner.store);
            store.open_digests(door).map(|open| {
                // A digest in flight is being written: it is not folded under its writer.
                open.len() > 1
                    && !open
                        .iter()
                        .any(|(m, _)| store.in_flight(m.id).unwrap_or(true))
            })
        };
        match foldable {
            Ok(true) => {}
            Ok(false) => return,
            Err(err) => return crate::log_failure("catch-up", &err.to_string()),
        }
        let empty = Payload::Digest {
            entries: Vec::new(),
            stands_for: 1,
        };
        if let Err(err) = messages
            .send_message(&ctx, params.clone(), true, empty)
            .await
        {
            return crate::log_failure("catch-up", &err.to_string());
        }
    }
}

/// B22(a): at the window's end, the changes kept back go out as one Message.
pub(crate) async fn flush(inner: &Arc<Inner>) {
    IN_LEDGER.scope((), flush_locked(inner)).await;
}

async fn flush_locked(inner: &Arc<Inner>) {
    let mut ledger = inner.pushes.lock().await;
    let now = (inner.clock)();
    for slot in ledger.metas.values_mut() {
        slot.expire(now);
    }
    if ledger
        .metas
        .values()
        .any(|slot| !slot.waiting.is_empty() && !slot.all_quiet)
    {
        match crate::load_rail_nodes(inner).await {
            Ok(nodes) => {
                for (meta, slot) in &mut ledger.metas {
                    if !slot.waiting.is_empty() && !slot.all_quiet {
                        roll_up(inner, meta, slot, now, false, &nodes).await;
                    }
                }
            }
            Err(err) => crate::log_failure("push", &err.to_string()),
        }
    }
    ledger
        .metas
        .retain(|_, slot| !slot.sent.is_empty() || !slot.waiting.is_empty());
    ledger.persist(inner, None);
}

async fn roll_up(
    inner: &Arc<Inner>,
    meta: &str,
    slot: &mut Slot,
    now: i64,
    plain: bool,
    nodes: &[contracts::agent::RailNode],
) {
    // Resolve lifecycle before the cap: removal must discard even a full window's queue.
    let Some(door) = nodes.iter().find(|node| node.id == meta) else {
        slot.waiting.clear();
        return;
    };
    if door.terminal_id.is_none()
        || crate::ended(door)
        || slot.waiting.is_empty()
        || slot.sent.len() >= PUSHES
    {
        return;
    }
    let sent = match slot.waiting.as_slice() {
        [(_, entry, 1)] if plain => (
            push_body(entry),
            Payload::Digest {
                entries: vec![entry.clone()],
                stands_for: 1,
            },
        ),
        waiting => rollup_body(waiting),
    };
    match send_digest(inner, meta, sent).await {
        Ok(()) => {
            slot.sent.push_back(now);
            slot.waiting.clear();
            slot.all_quiet = false;
        }
        Err(err) => crate::log_failure("push", &format!("{meta}: {}", err)),
    }
}

/// Sends one pushed digest, then merges the oldest two while more than 20 are open.
async fn send_digest(
    inner: &Arc<Inner>,
    meta: &str,
    (body, payload): (String, Payload),
) -> Result<(), Error> {
    let messages = Messages {
        inner: Arc::clone(inner),
    };
    let ctx = Ctx {
        actor: Actor::daemon(),
        bus: inner.bus.clone(),
        touches: Arc::clone(&inner.touches),
    };
    let params = |body: String| SendParams {
        to: meta.to_owned(),
        kind: MessageKind::Note,
        body,
        reply_to: None,
    };
    crate::trip(inner, "push").map_err(Error::internal)?;
    messages
        .send_message(&ctx, params(body), false, payload)
        .await?;
    while lock(&inner.store).open_digests(meta)?.len() > OPEN_DIGESTS {
        if let Err(err) = messages
            .send_message(
                &ctx,
                params(PREFIX.to_owned()),
                true,
                Payload::Digest {
                    entries: Vec::new(),
                    stands_for: 1,
                },
            )
            .await
        {
            crate::log_failure("push", &err.to_string());
            break;
        }
    }
    Ok(())
}

/// DCL10: per Door, the changes it has not received, read from storage: pending Messages
/// (a pushed digest standing for its weight) plus the ledger's waiting entries, a change counted
/// once when a pending digest already holds its entry.
pub(crate) async fn waiting_counts(
    inner: &Arc<Inner>,
    with_quiet: bool,
) -> Result<HashMap<String, u32>, Error> {
    let ledger = inner.pushes.lock().await;
    let (pending, payloads, deferred) = {
        let store = lock(&inner.store);
        let pending = store.pending_all()?;
        let payloads = store.payloads(&pending)?;
        let deferred = if with_quiet {
            HashSet::new()
        } else {
            deferred_digests_in(&store, &pending, &payloads)?
        };
        (pending, payloads, deferred)
    };
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut digested: HashMap<&str, Vec<DigestEntry>> = HashMap::new();
    for message in &pending {
        let payload = payloads.of(message);
        if !deferred.contains(&message.id) {
            *counts.entry(message.to.clone()).or_default() += payload.weight();
        }
        if payload.is_digest() {
            digested
                .entry(&message.to)
                .or_default()
                .extend(payload.entries().iter().cloned());
        }
    }
    for (door, slot) in &ledger.metas {
        if slot.all_quiet && !with_quiet {
            continue;
        }
        let digested = digested.get(door.as_str());
        for (_, entry, weight) in &slot.waiting {
            if !digested.is_some_and(|digested| digested.contains(entry)) {
                *counts.entry(door.clone()).or_default() += weight;
            }
        }
    }
    Ok(counts)
}

/// DTC2: the pending digests no inbox write carries, which a Door at rest takes only with a
/// Message that is no quiet digest (B5168f); the Message that settles a Workstream is such a one.
fn deferred_digests_in(
    store: &crate::store::Store,
    pending: &[Message],
    payloads: &Payloads,
) -> Result<HashSet<u32>, Error> {
    let mut deferred = HashSet::new();
    for message in pending {
        if payloads.of(message).is_digest() && !store.in_flight(message.id)? {
            deferred.insert(message.id);
        }
    }
    Ok(deferred)
}

impl Messages {
    /// DTC2: the pending digests that wait for a Message to ride with, so that Message may be
    /// sent without waiting for them.
    pub async fn deferred_digests(&self) -> Result<HashSet<u32>, Error> {
        let store = lock(&self.inner.store);
        let pending = store.pending_all()?;
        let payloads = store.payloads(&pending)?;
        deferred_digests_in(&store, &pending, &payloads)
    }

    /// B21, B22: accepts one change of the Subagent's entry. `subagent` is its stable Rail id,
    /// not its mutable display name. Waiting changes compact to the newest entry per id while
    /// retaining their weight. A stopped Door waits until a successful start; a removed Door's
    /// queue is discarded. Other refusals are logged with the receiver and retried by Messages,
    /// so acceptance is successful even when the entry cannot yet be sent.
    pub async fn push_digest(
        &self,
        meta: &str,
        subagent: &str,
        entry: &contracts::agent::DigestEntry,
        waking: bool,
    ) {
        pushes::push(&self.inner, meta, subagent, entry, waking).await
    }

    /// DCL10: per Door, how many changes it has not received, read from the stored backlog.
    pub async fn waiting_counts(&self) -> Result<HashMap<String, u32>, Error> {
        waiting_counts(&self.inner, true).await
    }

    /// DTC2: `waiting_counts` without the quiet notes, which wait for a Message the Door takes
    /// and so cannot be waited on by the Message that settles a Workstream.
    pub async fn waiting_counts_unquiet(&self) -> Result<HashMap<String, u32>, Error> {
        waiting_counts(&self.inner, false).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inbox::tests::{live, setup};
    use std::sync::atomic::Ordering;

    fn entry() -> DigestEntry {
        DigestEntry {
            name: "child".into(),
            kind: contracts::Kind::Working,
            last: "change".into(),
            todos: 2,
            link: None,
            pads: vec![],
        }
    }

    fn full(now: i64, waiting: bool) -> Slot {
        Slot {
            sent: std::iter::repeat_n(now, PUSHES).collect(),
            waiting: if waiting {
                vec![("child-id".into(), entry(), 7)]
            } else {
                vec![]
            },
            all_quiet: false,
        }
    }

    #[tokio::test(start_paused = true)]
    async fn b5640d_flush_reads_once_for_waiting_slots_and_never_for_sent_only() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, rail, _) = setup(dir.path());
        let now = (messages.inner.clock)();
        {
            let mut ledger = messages.inner.pushes.lock().await;
            for i in 0..16 {
                ledger.metas.insert(format!("m{i}"), full(now, false));
            }
        }
        flush(&messages.inner).await;
        assert_eq!(rail.reads.load(Ordering::SeqCst), 0);
        {
            let mut ledger = messages.inner.pushes.lock().await;
            assert!(ledger.metas.values().all(|s| s.sent.len() == PUSHES));
            for (id, slot) in &mut ledger.metas {
                slot.waiting.push(("child-id".into(), entry(), 7));
                lock(&rail.nodes).push(live(id));
            }
        }
        flush(&messages.inner).await;
        assert_eq!(rail.reads.load(Ordering::SeqCst), 1);
        {
            let mut ledger = messages.inner.pushes.lock().await;
            assert!(
                ledger
                    .metas
                    .values()
                    .all(|s| s.sent.len() == PUSHES && s.waiting[0].2 == 7)
            );
            for slot in ledger.metas.values_mut() {
                slot.waiting.clear();
                slot.sent = std::iter::repeat_n(now - WINDOW_MS, PUSHES).collect();
            }
        }
        flush(&messages.inner).await;
        assert_eq!(rail.reads.load(Ordering::SeqCst), 1);
        assert!(messages.inner.pushes.lock().await.metas.is_empty());
    }

    /// DCL8: changes kept back for a stopped Door and the window's sends survive a reopen.
    #[tokio::test(start_paused = true)]
    async fn dcl8_kept_back_changes_survive_a_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, rail, _) = setup(dir.path());
        let mut stopped = live("stopped");
        stopped.terminal_id = None;
        lock(&rail.nodes).push(stopped);
        push(&messages.inner, "stopped", "child-id", &entry(), true).await;
        push(&messages.inner, "stopped", "child-id", &entry(), true).await;
        drop(messages);
        let (messages, _, _) = setup(dir.path());
        let ledger = messages.inner.pushes.lock().await;
        assert_eq!(ledger.metas["stopped"].waiting.len(), 1);
        assert_eq!(ledger.metas["stopped"].waiting[0].2, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn b5640d_flush_preserves_lifecycle_and_retries() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, rail, _) = setup(dir.path());
        let now = (messages.inner.clock)();
        let mut stopped = live("stopped");
        stopped.terminal_id = None;
        lock(&rail.nodes).push(stopped);
        {
            let mut ledger = messages.inner.pushes.lock().await;
            for id in ["m", "stopped", "removed"] {
                ledger.metas.insert(id.into(), full(now, true));
            }
        }
        rail.fail.store(true, Ordering::SeqCst);
        flush(&messages.inner).await;
        {
            let ledger = messages.inner.pushes.lock().await;
            assert!(
                ledger
                    .metas
                    .values()
                    .all(|s| s.waiting[0].2 == 7 && s.sent.len() == PUSHES)
            );
        }
        rail.fail.store(false, Ordering::SeqCst);
        flush(&messages.inner).await;
        {
            let mut ledger = messages.inner.pushes.lock().await;
            assert!(ledger.metas["removed"].waiting.is_empty());
            assert_eq!(ledger.metas["stopped"].waiting[0].2, 7);
            for slot in ledger.metas.values_mut() {
                slot.sent.clear();
            }
        }
        // A receiver validation failure after the shared read must keep the work.
        lock(&messages.inner.store)
            .reserve_retirement("m", "retire")
            .unwrap();
        flush(&messages.inner).await;
        {
            let ledger = messages.inner.pushes.lock().await;
            assert_eq!(ledger.metas["m"].waiting[0].2, 7);
            assert!(ledger.metas["m"].sent.is_empty());
            assert_eq!(ledger.metas["stopped"].waiting[0].2, 7);
        }
        lock(&messages.inner.store)
            .db
            .execute("DELETE FROM message_retirements WHERE agent='m'", [])
            .unwrap();
        flush(&messages.inner).await;
        let ledger = messages.inner.pushes.lock().await;
        assert!(ledger.metas["m"].waiting.is_empty());
        assert_eq!(ledger.metas["m"].sent.len(), 1);
        assert_eq!(ledger.metas["stopped"].waiting[0].2, 7);
        let delivered = lock(&messages.inner.store).list().unwrap();
        assert_eq!(delivered.len(), 1);
        assert_eq!(
            lock(&messages.inner.store)
                .payload(delivered[0].id)
                .unwrap()
                .weight(),
            7
        );
    }
}
