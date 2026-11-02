//! B19, B20: what a Door is told about its children, composed from the Rail, the Todos, the
//! Pads and the Messages, which only the Daemon holds together. Nothing here reads a Terminal.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use contracts::agent::{Digest, DigestEntry, DigestItem, NodeKind, RailNode};
use contracts::message::Message;
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, Kind};
use rpc::RpcError;

const LAST_BYTES: usize = 120;
const PAD_NAME_BYTES: usize = 32;
const PADS: usize = 4;
const ENTRY_BYTES: usize = 512;
const END_LAST_BYTES: usize = 600;
const END_ENTRY_BYTES: usize = 1024;
const NO_FINDING: &str = "ended with no finding";
const CHILDREN: usize = 20;
const CUT: &str = "[cut]";

/// What the Daemon read to compose a digest.
pub struct Sources<'a> {
    pub nodes: &'a [RailNode],
    pub todos: &'a [Todo],
    pub pads: &'a [Pad],
    pub touches: Vec<contracts::Touch>,
    /// A5482c: Agent id to (Attempt/turn identity, turn start in Unix milliseconds, final text), from the Adapter.
    pub completed: HashMap<String, (String, i64, String)>,
    pub messages: &'a [Message],
}

/// What a Door was last told about a child, to see whether a change alters the entry (B21).
#[derive(Clone, PartialEq, Eq)]
struct Told {
    completed: Option<String>,
    kind: Kind,
    todos: u32,
    /// The newest Pad write seen then, named or not.
    pads: i64,
    /// The entry as it was then, for the last push when the child leaves the Rail (B23).
    entry: DigestEntry,
}

#[derive(Default)]
struct Book {
    /// For each (Door, child), the newest `updated_at` among the child's Pads that an
    /// envelope already named, so the next envelope names only Pads written after it (B19).
    named: HashMap<(String, String), i64>,
    told: HashMap<(String, String), Told>,
    /// For each (parent, child), the Kind of the last note of `done`, `error` or `needs-you` made
    /// about it (B47(c)); a push of any other Kind (B21, B35) or a `[wake]` note is none of these.
    noted: HashMap<(String, String), Kind>,
    /// `named` written through, so a restart keeps it (B23); `None` for a `Seen` kept in memory.
    db: Option<rusqlite::Connection>,
}

impl Book {
    fn name(&mut self, key: &(String, String), newest: i64) {
        self.named.insert(key.clone(), newest);
        if let Some(db) = &self.db {
            let _ = db.execute(
                "INSERT OR REPLACE INTO pad_cursors (door, child, newest) VALUES (?1, ?2, ?3)",
                rusqlite::params![key.0, key.1, newest],
            );
        }
    }

    fn forget(&mut self, key: &(String, String)) {
        self.named.remove(key);
        if let Some(db) = &self.db {
            let _ = db.execute(
                "DELETE FROM pad_cursors WHERE door = ?1 AND child = ?2",
                rusqlite::params![key.0, key.1],
            );
        }
    }
}

/// An entry B21 decided to push. `changed` already recorded it as told, so a digest asked while
/// the Message is in flight does not repeat it; `release` takes that back if the send failed.
pub struct Push {
    key: (String, String),
    pub meta: String,
    pub entry: DigestEntry,
    told: Told,
    before: (Option<i64>, Option<Told>),
    /// The child left the Rail (B23): `told` is what `changed` took out of the book.
    gone: bool,
}

impl Push {
    /// Stable Rail identity, including for a Subagent that has just left the Rail.
    pub fn subagent(&self) -> &str {
        &self.key.1
    }
}

#[derive(Default)]
pub struct Seen(Mutex<Book>);

impl Seen {
    /// A `Seen` whose Pad cursors live in `path` (`project.db` in production), as they were when the
    /// Daemon last ran (B23).
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut db = rusqlite::Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        crate::digest_schema::open(&mut db, path)?;
        let named = db
            .prepare("SELECT door, child, newest FROM pad_cursors")?
            .query_map([], |row| Ok(((row.get(0)?, row.get(1)?), row.get(2)?)))?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        Ok(Self(Mutex::new(Book {
            named,
            told: HashMap::new(),
            noted: HashMap::new(),
            db: Some(db),
        })))
    }

    /// B47(c): whether the note of `kind` about `child` to `parent` repeats the last one of its
    /// run; when it does not, it is recorded as that last one.
    pub fn repeats_last_note(&self, parent: &str, child: &str, kind: Kind) -> bool {
        self.book()
            .noted
            .insert((parent.to_owned(), child.to_owned()), kind)
            == Some(kind)
    }

    fn book(&self) -> std::sync::MutexGuard<'_, Book> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// B20: the digest of Door `id`, asked for by `caller`.
    pub fn ask(&self, caller: &Actor, id: &str, from: &Sources) -> Result<Digest, RpcError> {
        let allowed = match caller.kind {
            ActorKind::User => true,
            ActorKind::Agent => caller.id == id,
            ActorKind::Ext => false,
        };
        let name = |id: &str| {
            from.nodes
                .iter()
                .find(|node| node.id == id && is_agent(node))
                .map_or("an Agent that is gone", |node| node.name.as_str())
        };
        if !allowed {
            let caller_name = if caller.kind == ActorKind::Agent {
                name(&caller.id)
            } else {
                &caller.id
            };
            return Err(RpcError::forbidden(format!(
                "{caller_name} may not read the digest of {}",
                name(id)
            )));
        }
        let node = from
            .nodes
            .iter()
            .find(|node| node.id == id && is_agent(node))
            .ok_or_else(|| RpcError::not_found(name(id)))?;
        if node.kind != NodeKind::Workstream {
            return Err(RpcError::conflict(format!("{} is no Door", node.name)));
        }
        let children = children_of(id, from);
        let mut book = self.book();
        let mut items: Vec<DigestItem> = Vec::new();
        for child in children.iter().take(CHILDREN) {
            let key = (id.to_owned(), child.id.clone());
            let after = book.named.get(&key).copied();
            let (entry, newest) = entry(child, id, from, after, false);
            if caller.kind == ActorKind::Agent {
                if let Some(newest) = newest {
                    book.name(&key, newest);
                }
                book.told.insert(key, told(&entry, child, from));
            }
            items.push(DigestItem::Child(entry));
        }
        if children.len() > CHILDREN {
            let more = u32::try_from(children.len() - CHILDREN).unwrap_or(u32::MAX);
            items.push(DigestItem::More { more });
        }
        Ok(Digest { children: items })
    }

    /// B41, B43: `child`'s entry as its parent is told it, `None` when it has no Status. `tell`
    /// records it as told and its Pads as named, as a digest read by the parent would, so no push
    /// repeats it.
    pub fn entry_of(&self, child: &str, from: &Sources, tell: bool) -> Option<DigestEntry> {
        let node = from
            .nodes
            .iter()
            .find(|node| node.id == child && is_agent(node) && node.status.is_some())?;
        let parent = node.parent.clone().unwrap_or_default();
        let mut book = self.book();
        let key = (parent.clone(), child.to_owned());
        let after = book.named.get(&key).copied();
        let (entry, newest) = entry(node, &parent, from, after, tell);
        if tell && node.parent.is_some() {
            if let Some(newest) = newest {
                book.name(&key, newest);
            }
            book.told.insert(key, told(&entry, node, from));
        }
        Some(entry)
    }

    /// B21: what the Daemon records as told without sending it, so that only a change after now
    /// is pushed. Children that already have an entry keep it.
    pub fn baseline(&self, from: &Sources) {
        let mut book = self.book();
        for (meta, child) in pairs(from) {
            let key = (meta.id.clone(), child.id.clone());
            if !book.told.contains_key(&key) {
                let after = book.named.get(&key).copied();
                let (entry, _) = entry(child, &meta.id, from, after, false);
                let seen = told(&entry, child, from);
                book.told.insert(key, seen);
            }
        }
    }

    /// B21: the entries whose child's Kind, open Todo count or Pads changed since its Door
    /// was last told, oldest child first in Rail order. A change that leaves the entry as it was
    /// is none. Each one is recorded as told and its Pads as named before it is returned, under one
    /// lock, so no digest can name them again while the Message is sent.
    pub fn changed(&self, from: &Sources) -> Vec<Push> {
        let mut book = self.book();
        let mut pushes = Vec::new();
        for (meta, child) in pairs(from) {
            let key = (meta.id.clone(), child.id.clone());
            let after = book.named.get(&key).copied();
            let (entry, newest) = entry(child, &meta.id, from, after, false);
            let now = told(&entry, child, from);
            let new_final = now.completed.is_some()
                && book
                    .told
                    .get(&key)
                    .is_none_or(|was| was.completed != now.completed);
            if meta.kind != NodeKind::Workstream && !new_final {
                continue;
            }
            // B43: the change into `error` or `needs-you` is the parent's note, not a push.
            let attention = matches!(now.kind, Kind::Error | Kind::NeedsYou);
            let question_turn = from
                .completed
                .get(&child.id)
                .is_some_and(|(_, started, _)| question_since(child, from, *started));
            let moved = book.told.get(&key).is_none_or(|was| {
                (was.kind != now.kind
                    && !is_flip(was, &now)
                    && !attention
                    && !(question_turn && matches!(now.kind, Kind::Idle | Kind::Working)))
                    || (now.completed.is_some() && was.completed != now.completed)
                    || was.todos != now.todos
                    || (!entry.pads.is_empty() && now.pads > was.pads)
            });
            if !moved && attention && book.told.get(&key).is_some_and(|was| was.kind != now.kind) {
                book.told.insert(key.clone(), now.clone());
            }
            if moved {
                // B47(c): the end note of a Kind the last note already told is not made again.
                let repeated = now.kind == Kind::Done
                    && book.told.get(&key).is_none_or(|was| was.kind != Kind::Done)
                    && book.noted.insert(key.clone(), Kind::Done) == Some(Kind::Done);
                // B49: the change into an end carries the child's own summary.
                let ends = book.told.get(&key).is_none_or(|was| was.kind != now.kind);
                let pushed = if ends {
                    self::entry(child, &meta.id, from, after, true).0
                } else {
                    entry
                };
                let before = (after, book.told.get(&key).cloned());
                if let Some(newest) = newest {
                    book.name(&key, newest);
                }
                book.told.insert(key.clone(), now.clone());
                if repeated {
                    continue;
                }
                pushes.push(Push {
                    key,
                    meta: meta.id.clone(),
                    entry: pushed,
                    told: now,
                    before,
                    gone: false,
                });
            }
        }
        pushes.extend(farewells(&mut book, from));
        pushes
    }

    /// B21: the Message for `push` was not sent, so its entry is as untold as it was, unless a
    /// digest asked since has told the Door something newer.
    pub fn release(&self, push: Push) {
        let mut book = self.book();
        if push.gone {
            book.told.entry(push.key).or_insert(push.told);
            return;
        }
        if book.told.get(&push.key) != Some(&push.told) {
            return;
        }
        match push.before.0 {
            Some(named) => book.name(&push.key, named),
            None => book.forget(&push.key),
        }
        match push.before.1 {
            Some(told) => book.told.insert(push.key, told),
            None => book.told.remove(&push.key),
        };
    }
}

/// B33: `entry` as the lines a person reads: `<name> is <kind>`, then its last line, its open
/// Todo count and, when it names Pads, the Pads. No line is indented but the first.
#[must_use]
pub fn entry_text(entry: &DigestEntry) -> String {
    let line = |text: &str| text.replace(['\n', '\r'], " ");
    let mut text = format!(
        "{} is {}\n  last: {}\n  open todos: {}",
        line(&entry.name),
        kind_word(entry.kind),
        line(&entry.last),
        entry.todos
    );
    if !entry.pads.is_empty() {
        text.push_str("\n  pads: ");
        text.push_str(&line(&entry.pads.join(", ")));
    }
    text
}

pub(crate) fn kind_word(kind: Kind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// B33: the entry whose first line is `head` (`<name> is <kind>`), with the indented `rest` lines.
pub(crate) fn parse_head(head: &str) -> Option<(String, Kind)> {
    if head.starts_with([' ', '[']) {
        return None;
    }
    let (name, kind) = head.rsplit_once(" is ")?;
    let kind = serde_json::from_value(serde_json::Value::String(kind.to_owned())).ok()?;
    Some((name.to_owned(), kind))
}

/// B33: the entry that `head` and its indented `rest` lines spell, the inverse of `entry_text`.
pub(crate) fn parse_entry(head: &str, rest: &[&str]) -> Option<DigestEntry> {
    let (name, kind) = parse_head(head)?;
    let mut entry = DigestEntry {
        name,
        kind,
        last: String::new(),
        todos: 0,
        pads: Vec::new(),
    };
    for line in rest {
        if let Some(last) = line.strip_prefix("  last: ") {
            last.clone_into(&mut entry.last);
        } else if let Some(todos) = line.strip_prefix("  open todos: ") {
            entry.todos = todos.parse().ok()?;
        } else if let Some(pads) = line.strip_prefix("  pads: ") {
            entry.pads = pads.split(", ").map(str::to_owned).collect();
        }
    }
    Some(entry)
}

/// B35: whether `now` differs from `was` only by an `idle` and `working` flip, its last line
/// the same.
fn is_flip(was: &Told, now: &Told) -> bool {
    let flips = |kind| matches!(kind, Kind::Idle | Kind::Working);
    flips(was.kind) && flips(now.kind) && was.entry.last == now.entry.last
}

/// B21, B33: the body of a pushed digest.
#[must_use]
pub fn push_body(entry: &DigestEntry) -> String {
    format!("[digest] {}", entry_text(entry))
}

fn told(entry: &DigestEntry, child: &RailNode, from: &Sources) -> Told {
    Told {
        completed: final_text(child, from).map(|(turn, _, _)| turn.clone()),
        kind: entry.kind,
        todos: entry.todos,
        pads: newest_pad(child, from),
        entry: entry.clone(),
    }
}

/// B23: one last push for each child told of that no longer has a node, to its Door if that
/// is still a Door, with the entry as it was last told; none when that already said the child
/// ended (`done`, `error`). A child that only moved to another Door has nothing to say.
fn farewells(book: &mut Book, from: &Sources) -> Vec<Push> {
    let child_of = |key: &(String, String)| {
        from.nodes
            .iter()
            .find(|node| node.id == key.1 && is_agent(node))
    };
    let stale: Vec<(String, String)> = book
        .told
        .keys()
        .filter(|key| child_of(key).is_none_or(|node| node.parent.as_deref() != Some(&key.0)))
        .cloned()
        .collect();
    let mut pushes = Vec::new();
    for key in stale {
        let Some(told) = book.told.remove(&key) else {
            continue;
        };
        book.forget(&key);
        if child_of(&key).is_some() {
            continue;
        }
        let door = from
            .nodes
            .iter()
            .any(|node| node.id == key.0 && node.kind == NodeKind::Workstream && is_agent(node));
        if door && !matches!(told.kind, Kind::Done | Kind::Error) {
            pushes.push(Push {
                meta: key.0.clone(),
                entry: told.entry.clone(),
                before: (None, Some(told.clone())),
                told,
                key,
                gone: true,
            });
        }
    }
    pushes
}

fn newest_pad(child: &RailNode, from: &Sources) -> i64 {
    from.pads
        .iter()
        .filter(|pad| {
            from.touches.iter().any(|touch| {
                touch.verb == contracts::Verb::Wrote
                    && touch.actor.id == child.id
                    && touch.item == format!("pad:{}", pad.name)
            })
        })
        .map(|pad| pad.updated_at)
        .max()
        .unwrap_or(i64::MIN)
}

/// The direct children of Door `id` that have a Status, in Rail order.
fn children_of<'a>(id: &str, from: &'a Sources) -> Vec<&'a RailNode> {
    from.nodes
        .iter()
        .filter(|child| child.parent.as_deref() == Some(id) && is_agent(child))
        .filter(|child| child.status.is_some())
        .collect()
}

/// Every coordinating Agent and direct child on the Rail, including non-Door parents (A5482c).
fn pairs<'a>(from: &'a Sources) -> impl Iterator<Item = (&'a RailNode, &'a RailNode)> {
    from.nodes
        .iter()
        .filter(|node| is_agent(node))
        .flat_map(|meta| {
            children_of(&meta.id, from)
                .into_iter()
                .map(move |child| (meta, child))
        })
}

/// An Agent, or a Workstream whose Door has run.
fn is_agent(node: &RailNode) -> bool {
    match node.kind {
        NodeKind::Agent => true,
        NodeKind::Workstream => node.attempt.is_some(),
    }
}

/// B19: the entry for `child` as told to `meta`, and the newest Pad write it names. `after` is the
/// newest Pad write an earlier envelope named.
fn entry(
    child: &RailNode,
    meta: &str,
    from: &Sources,
    after: Option<i64>,
    end: bool,
) -> (DigestEntry, Option<i64>) {
    let Some(status) = child.status.as_ref() else {
        unreachable!("the caller keeps only children that have a Status");
    };
    let told = from
        .messages
        .iter()
        .filter(|message| {
            message.from.kind == ActorKind::Agent
                && message.from.id == child.id
                && message.to == meta
        })
        .max_by_key(|message| message.id);
    // B49: an end note carries the child's own summary, whole, or says there was none.
    let end = end && is_end(child);
    let final_reply = (!end)
        .then(|| final_text(child, from))
        .flatten()
        .filter(|(_, started, _)| {
            // B5519a: a Message in the newer Status belongs ahead of the older turn's text.
            told.is_none_or(|message| status.since <= *started || message.at < status.since)
        });
    let last = match (told, end) {
        (Some(message), true) => message.body.as_str(),
        (None, true) => NO_FINDING,
        (Some(message), false) => message.body.lines().next().unwrap_or_default(),
        (None, false) => status.label.as_str(),
    };
    let last = final_reply.map_or(last, |(_, _, text)| text.as_str());
    let last = if final_reply.is_some() && last.lines().count() > 1 {
        format!("{}[cut]", last.lines().next().unwrap_or_default())
    } else {
        last.to_owned()
    };
    let todos = from
        .todos
        .iter()
        .filter(|todo| {
            !todo.done && todo.creator.kind == ActorKind::Agent && todo.creator.id == child.id
        })
        .count();
    let mut written: Vec<&Pad> = from
        .pads
        .iter()
        .filter(|pad| {
            from.touches.iter().any(|touch| {
                touch.verb == contracts::Verb::Wrote
                    && touch.actor.id == child.id
                    && touch.item == format!("pad:{}", pad.name)
            })
        })
        .filter(|pad| after.is_none_or(|after| pad.updated_at > after))
        .collect();
    written.sort_by_key(|pad| pad.updated_at);
    let newest = written.last().map(|pad| pad.updated_at);
    let mut pads: Vec<String> = Vec::new();
    if written.len() > PADS {
        pads.extend(
            written[written.len() - PADS..]
                .iter()
                .map(|pad| cut(&pad.name, PAD_NAME_BYTES)),
        );
        pads.push(CUT.to_owned());
    } else {
        pads.extend(written.iter().map(|pad| cut(&pad.name, PAD_NAME_BYTES)));
    }
    let entry = DigestEntry {
        name: child.name.clone(),
        kind: status.kind,
        last: cut(&last, if end { END_LAST_BYTES } else { LAST_BYTES }),
        todos: u32::try_from(todos).unwrap_or(u32::MAX),
        pads,
    };
    (
        fit(entry, if end { END_ENTRY_BYTES } else { ENTRY_BYTES }),
        newest,
    )
}

/// Explicit question Messages already carry this turn's choice; never duplicate them as fallback.
fn final_text<'a>(child: &RailNode, from: &'a Sources) -> Option<&'a (String, i64, String)> {
    if is_end(child) {
        return None;
    }
    let text = from.completed.get(&child.id)?;
    if !text
        .0
        .starts_with(&format!("{}:", child.attempt.as_deref()?))
    {
        return None;
    }
    (!question_since(child, from, text.1)).then_some(text)
}

fn question_since(child: &RailNode, from: &Sources, started: i64) -> bool {
    from.messages.iter().any(|message| {
        message.from.kind == ActorKind::Agent
            && message.from.id == child.id
            && message.kind == contracts::message::MessageKind::Question
            && message.at >= started
    })
}

/// `text` as is when it fits `max` bytes, else a prefix ending in `[cut]`, whole at most `max`.
pub(crate) fn cut(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_owned();
    }
    let mut end = max.saturating_sub(CUT.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{CUT}", &text[..end])
}

/// B49: whether `node` has ended: Kind `done`, or an Attempt that exited with no Terminal.
fn is_end(node: &RailNode) -> bool {
    node.status.as_ref().is_some_and(|status| {
        status.kind == Kind::Done || (status.kind == Kind::Error && node.terminal_id.is_none())
    })
}

/// B49: `entry` as a Rollup or a merge holds it: B19's 120-byte `last` and 512-byte bound.
pub(crate) fn rolled(entry: &DigestEntry) -> DigestEntry {
    let mut entry = entry.clone();
    entry.last = cut(entry.last.lines().next().unwrap_or_default(), LAST_BYTES);
    fit(entry, ENTRY_BYTES)
}

fn size(entry: &DigestEntry) -> usize {
    let json = serde_json::to_string(entry).map_or(usize::MAX, |json| json.len());
    json.max(entry_text(entry).len())
}

/// B19: the whole entry is at most `max` bytes, 512 but for an end note (B49). Past that, `last` gives way first, then the Pad
/// names, then the name; every cut is marked.
pub(crate) fn fit(mut entry: DigestEntry, max: usize) -> DigestEntry {
    while size(&entry) > max && entry.last.len() > CUT.len() {
        let over = size(&entry) - max;
        let max = entry.last.len().saturating_sub(over).max(CUT.len());
        entry.last = cut(&entry.last, max);
    }
    while size(&entry) > max && entry.pads.len() > 1 {
        entry.pads.pop();
        if let Some(end) = entry.pads.last_mut() {
            *end = CUT.to_owned();
        }
    }
    while size(&entry) > max && entry.name.len() > CUT.len() {
        let over = size(&entry) - max;
        let max = entry.name.len().saturating_sub(over).max(CUT.len());
        entry.name = cut(&entry.name, max);
    }
    entry
}

#[cfg(test)]
mod tests;
