//! B22: what keeps pushed digests (B21) from flooding a Door. At most 8 go out in any
//! 60 000 ms; the rest wait and leave as one rollup; at most 20 stay `pending`, the
//! oldest two merging into one when a twenty-first arrives. No cap loses a count: each digest has
//! a weight, read from its body, and a rollup or a merge weighs what it holds.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use contracts::Actor;
use contracts::agent::DigestEntry;
use contracts::message::{Message, MessageKind, SendParams};
use rpc::{Ctx, RpcError};

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
    fn save(&self, inner: &Inner) -> rusqlite::Result<()> {
        let store = lock(&inner.store);
        let tx = store.db.unchecked_transaction()?;
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
    fn persist(&self, inner: &Inner) {
        if let Err(err) = self.save(inner) {
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

/// Whether a Message from `from` with `body` is a pushed digest.
pub(crate) fn is_digest(from: &Actor, body: &str) -> bool {
    *from == Actor::daemon() && body.starts_with(PREFIX)
}

/// B22(c): the changes a pushed digest stands for: 1 for a plain push, K for a rollup, N for a
/// merge, W for a plain push that folded older ones (B34).
pub(crate) fn weight(body: &str) -> u32 {
    let head = body.lines().next().unwrap_or_default();
    let Some(counted) = head.strip_prefix("[digest] [") else {
        return folded_weight(body);
    };
    let digits = counted.bytes().take_while(u8::is_ascii_digit).count();
    let rest = &counted[digits..];
    if rest.starts_with(" updates kept back]") || rest.starts_with(" earlier updates: ") {
        counted[..digits].parse().unwrap_or(1)
    } else {
        1
    }
}

/// B34: the `(<w> changes)` line that ends a plain push, or 1.
fn folded_weight(body: &str) -> u32 {
    body.lines()
        .last()
        .and_then(|line| line.strip_prefix("  ("))
        .and_then(|rest| rest.strip_suffix(" changes)"))
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(1)
}

/// One part of a pushed digest's body: a line that is no entry, or an entry's lines.
enum Piece<'a> {
    Line(&'a str),
    Block(DigestEntry, Vec<&'a str>),
}

/// B33: `body` split into its entries and the lines between them.
fn pieces(body: &str) -> Vec<Piece<'_>> {
    let mut out = Vec::new();
    let mut lines = body.lines().peekable();
    while let Some(line) = lines.next() {
        let head = line.strip_prefix("[digest] ").unwrap_or(line);
        if digest::parse_head(head).is_none() {
            out.push(Piece::Line(line));
            continue;
        }
        let mut block = vec![line];
        while lines.peek().is_some_and(|next| next.starts_with("  ")) {
            block.extend(lines.next());
        }
        match digest::parse_entry(head, &block[1..]) {
            Some(entry) => out.push(Piece::Block(entry, block)),
            None => out.extend(block.into_iter().map(Piece::Line)),
        }
    }
    out
}

/// The entries a pushed digest holds, in the order it lists them.
pub(crate) fn entries_of(body: &str) -> Vec<DigestEntry> {
    pieces(body)
        .into_iter()
        .filter_map(|piece| match piece {
            Piece::Block(entry, _) => Some(entry),
            Piece::Line(_) => None,
        })
        .collect()
}

/// B34: whether `body` is one child's push, not a rollup or a merge.
pub(crate) fn is_plain_push(body: &str) -> bool {
    body.strip_prefix("[digest] ")
        .is_some_and(|rest| digest::parse_head(rest.lines().next().unwrap_or_default()).is_some())
}

/// B34: the names of the children a pushed digest holds an entry of.
pub(crate) fn names_in(body: &str) -> Vec<String> {
    entries_of(body).into_iter().map(|e| e.name).collect()
}

/// B34: `body` without the entries of the children in `gone`, and with nothing at all when that
/// leaves no entry of a plain push.
pub(crate) fn without(body: &str, gone: &std::collections::HashSet<String>) -> String {
    let kept: Vec<&str> = pieces(body)
        .into_iter()
        .flat_map(|piece| match piece {
            Piece::Line(line) => vec![line],
            Piece::Block(entry, lines) if !gone.contains(&entry.name) => lines,
            Piece::Block(..) => Vec::new(),
        })
        .collect();
    if kept
        .iter()
        .any(|line| digest::parse_head(line.strip_prefix("[digest] ").unwrap_or(line)).is_some())
        || kept
            .first()
            .is_some_and(|head| head.starts_with("[digest] ["))
    {
        kept.join("\n")
    } else {
        String::new()
    }
}

/// B34: the text of each of `found` (oldest first) for one prompt: a pushed digest loses the
/// entries of the children that a newer one in `found` holds, so the prompt names each child once.
pub(crate) fn bodies_of(found: &[Message]) -> Vec<String> {
    let mut later = std::collections::HashSet::new();
    let mut bodies: Vec<String> = found
        .iter()
        .enumerate()
        .rev()
        .map(|(index, message)| {
            if message.kind != MessageKind::Note || !is_digest(&message.from, &message.body) {
                return message.body.clone();
            }
            let body = without(&message.body, &later);
            // Equal adjacent digests reach the shared rendered comparison together (B5763b).
            // Different updates still replace the older child's content under B34.
            if index == 0
                || found[index - 1].kind != MessageKind::Note
                || found[index - 1].from != message.from
                || found[index - 1].body != message.body
            {
                later.extend(names_in(&message.body));
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
fn compose(header: &str, entries: &[DigestEntry]) -> String {
    // B49: inside a Rollup or a merge an end note keeps B19's bounds.
    let lines: Vec<String> = entries
        .iter()
        .map(|entry| entry_text(&digest::rolled(entry)))
        .collect();
    let fit = |reserve: usize| {
        let mut used = header.len();
        let mut taken = 0;
        for line in &lines {
            if taken == ROLLUP_CHILDREN || used + 1 + line.len() + reserve > ROLLUP_BYTES {
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
    for line in &lines[..taken] {
        body.push('\n');
        body.push_str(line);
    }
    if taken < lines.len() {
        let names: Vec<&str> = entries[taken..]
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        let more = format!("[+{} more: {}]", names.len(), names.join(", "));
        body.push('\n');
        body.push_str(&cut(&more, MORE_BYTES));
    }
    body
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
pub(crate) fn merged_body(older: &Message, newer: &Message) -> String {
    let count = weight(&older.body) + weight(&newer.body);
    let header = format!(
        "{PREFIX} [{count} earlier updates: #{} #{}]",
        older.id, newer.id
    );
    let entries = newest_per_child(
        entries_of(&newer.body)
            .into_iter()
            .chain(entries_of(&older.body)),
    );
    compose(&header, &entries)
}

/// B22(a): the Message that stands for the `waiting` changes, oldest first.
fn rollup_body(waiting: &[(String, DigestEntry, u32)]) -> String {
    let count: u32 = waiting.iter().map(|(_, _, weight)| weight).sum();
    let header = format!("{PREFIX} [{count} updates kept back]");
    compose(
        &header,
        &waiting
            .iter()
            .rev()
            .map(|(_, entry, _)| entry.clone())
            .collect::<Vec<_>>(),
    )
}

/// B21, B22: accepts one changed entry, retaining it until its Door can receive it.
pub(crate) async fn push(inner: &Arc<Inner>, meta: &str, subagent: &str, entry: &DigestEntry) {
    let mut ledger = inner.pushes.lock().await;
    let now = (inner.clock)();
    let slot = ledger.metas.entry(meta.to_owned()).or_default();
    slot.expire(now);
    let plain = slot.waiting.is_empty() && slot.sent.len() < PUSHES;
    let weight = slot
        .waiting
        .iter()
        .position(|(id, _, _)| id == subagent)
        .map_or(1, |at| slot.waiting.remove(at).2 + 1);
    slot.waiting
        .push((subagent.to_owned(), entry.clone(), weight));
    ledger.persist(inner);
    let slot = ledger.metas.entry(meta.to_owned()).or_default();
    match crate::load_rail_nodes(inner).await {
        Ok(nodes) => roll_up(inner, meta, slot, now, plain, &nodes).await,
        Err(err) => crate::log_failure("push", &format!("{meta}: {}", err.message)),
    }
    ledger.persist(inner);
}

/// B22(a): at the window's end, the changes kept back go out as one Message.
pub(crate) async fn flush(inner: &Arc<Inner>) {
    let mut ledger = inner.pushes.lock().await;
    let now = (inner.clock)();
    for slot in ledger.metas.values_mut() {
        slot.expire(now);
    }
    if ledger.metas.values().any(|slot| !slot.waiting.is_empty()) {
        match crate::load_rail_nodes(inner).await {
            Ok(nodes) => {
                for (meta, slot) in &mut ledger.metas {
                    if !slot.waiting.is_empty() {
                        roll_up(inner, meta, slot, now, false, &nodes).await;
                    }
                }
            }
            Err(err) => crate::log_failure("push", &err.message),
        }
    }
    ledger
        .metas
        .retain(|_, slot| !slot.sent.is_empty() || !slot.waiting.is_empty());
    ledger.persist(inner);
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
    let body = if plain && slot.waiting.len() == 1 && slot.waiting[0].2 == 1 {
        push_body(&slot.waiting[0].1)
    } else {
        rollup_body(&slot.waiting)
    };
    match send_digest(inner, meta, body).await {
        Ok(()) => {
            slot.sent.push_back(now);
            slot.waiting.clear();
        }
        Err(err) => crate::log_failure("push", &format!("{meta}: {}", err.message)),
    }
}

/// Sends one pushed digest, then merges the oldest two while more than 20 are open.
async fn send_digest(inner: &Arc<Inner>, meta: &str, body: String) -> Result<(), RpcError> {
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
    crate::trip(inner, "push").map_err(RpcError::internal)?;
    messages.send_message(&ctx, params(body), false).await?;
    while lock(&inner.store).open_digests(meta)?.len() > OPEN_DIGESTS {
        if let Err(err) = messages
            .send_message(&ctx, params(PREFIX.to_owned()), true)
            .await
        {
            crate::log_failure("push", &err.message);
            break;
        }
    }
    Ok(())
}

/// DCL10: per Door, the changes it has not received, read from storage: pending Messages
/// (a pushed digest standing for its weight) plus the ledger's waiting entries, a change counted
/// once when a pending digest already holds its entry.
pub(crate) async fn waiting_counts(inner: &Arc<Inner>) -> Result<HashMap<String, u32>, RpcError> {
    let ledger = inner.pushes.lock().await;
    let pending = lock(&inner.store).pending_all()?;
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut held: HashMap<&str, Vec<DigestEntry>> = HashMap::new();
    for message in &pending {
        let digest = is_digest(&message.from, &message.body);
        *counts.entry(message.to.clone()).or_default() +=
            if digest { weight(&message.body) } else { 1 };
        if digest {
            held.entry(&message.to)
                .or_default()
                .extend(entries_of(&message.body));
        }
    }
    for (door, slot) in &ledger.metas {
        let held = held.get(door.as_str());
        for (_, entry, weight) in &slot.waiting {
            if !held.is_some_and(|held| held.contains(entry)) {
                *counts.entry(door.clone()).or_default() += weight;
            }
        }
    }
    Ok(counts)
}

impl Messages {
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
    ) {
        pushes::push(&self.inner, meta, subagent, entry).await
    }

    /// DCL10: per Door, how many changes it has not received, read from the stored backlog.
    pub async fn waiting_counts(&self) -> Result<HashMap<String, u32>, RpcError> {
        waiting_counts(&self.inner).await
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
        push(&messages.inner, "stopped", "child-id", &entry()).await;
        push(&messages.inner, "stopped", "child-id", &entry()).await;
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
        assert_eq!(weight(&delivered[0].body), 7);
    }
}
