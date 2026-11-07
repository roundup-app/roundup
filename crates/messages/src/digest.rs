//! B19, B20: what a Door is told about its children, composed from the Rail, the Todos, the
//! Pads and the Messages, which only the Daemon holds together. Nothing here reads a Terminal.

use crate::Error;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use contracts::agent::{Digest, DigestEntry, DigestItem, NodeKind, RailNode};
use contracts::message::Message;
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, Kind};

mod projection;
use projection::Projection;

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
#[derive(Default)]
pub struct Sources<'a> {
    pub nodes: &'a [RailNode],
    pub todos: &'a [Todo],
    pub pads: &'a [Pad],
    pub touches: Vec<contracts::Touch>,
    /// A5482c: Agent id to (Attempt/turn identity, turn start/end in Unix milliseconds, final text), from the Adapter.
    pub completed: HashMap<String, (String, i64, i64, String)>,
    pub messages: &'a [Message],
    /// AL1: the Project's key, which an Agent's link names; empty before the Daemon has one.
    pub project_key: &'a str,
}

/// What a Door was last told about a child, to see whether a change alters the entry (B21).
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Told {
    binding: crate::store::Binding,
    completed: Option<String>,
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
    told: TellMap,
    /// For each (parent, child), the Kind of the last note of `done`, `error` or `needs-you` made
    /// about it (B47(c)); a push of any other Kind (B21, B35) or a `[wake]` note is none of these.
    noted: HashMap<(String, String), Kind>,
    /// `named` written through, so a restart keeps it (B23); `None` for a `Seen` kept in memory.
    db: Option<rusqlite::Connection>,
}

/// What each Door was told about each child, written through to `door_told` so that a restart
/// keeps it: no told fact is queued again and no untold fact is marked told (DCL8).
#[derive(Default)]
struct TellMap {
    map: HashMap<(String, String), Told>,
    db: Option<rusqlite::Connection>,
}

impl TellMap {
    fn get(&self, key: &(String, String)) -> Option<&Told> {
        self.map.get(key)
    }

    fn contains_key(&self, key: &(String, String)) -> bool {
        self.map.contains_key(key)
    }

    fn keys(&self) -> impl Iterator<Item = &(String, String)> {
        self.map.keys()
    }

    /// DCL10a: a refused write is returned and leaves the map as it was, so the fact stays
    /// untold in memory as in storage.
    fn insert(&mut self, key: (String, String), told: Told) -> rusqlite::Result<Option<Told>> {
        if let Some(db) = &self.db {
            let json = serde_json::to_string(&told)
                .map_err(|err| rusqlite::Error::ToSqlConversionFailure(Box::new(err)))?;
            db.execute(
                "INSERT OR REPLACE INTO door_told (door, child, told) VALUES (?1, ?2, ?3)",
                rusqlite::params![key.0, key.1, json],
            )?;
        }
        Ok(self.map.insert(key, told))
    }

    fn insert_absent(&mut self, key: (String, String), told: Told) -> rusqlite::Result<()> {
        if !self.map.contains_key(&key) {
            self.insert(key, told)?;
        }
        Ok(())
    }

    fn remove(&mut self, key: &(String, String)) -> rusqlite::Result<Option<Told>> {
        if let Some(db) = &self.db {
            db.execute(
                "DELETE FROM door_told WHERE door = ?1 AND child = ?2",
                rusqlite::params![key.0, key.1],
            )?;
        }
        Ok(self.map.remove(key))
    }

    /// `insert`, with the change the Door is to be told kept in `push_intents` in the same
    /// transaction (DCL4): a kill before the push reaches the ledger leaves it to be queued.
    fn insert_queued(
        &mut self,
        key: (String, String),
        told: Told,
        entry: &DigestEntry,
    ) -> rusqlite::Result<Option<Told>> {
        if let Some(db) = &self.db {
            let to_sql = |err| rusqlite::Error::ToSqlConversionFailure(Box::new(err));
            let json = serde_json::to_string(&told).map_err(to_sql)?;
            let entry = serde_json::to_string(entry).map_err(to_sql)?;
            let tx = db.unchecked_transaction()?;
            tx.execute(
                "INSERT OR REPLACE INTO door_told (door, child, told) VALUES (?1, ?2, ?3)",
                rusqlite::params![key.0, key.1, json],
            )?;
            tx.execute(
                "INSERT INTO push_intents (door, child, entry, weight) VALUES (?1, ?2, ?3, 1) \
                 ON CONFLICT (door, child) DO UPDATE SET entry = ?3, weight = weight + 1",
                rusqlite::params![key.0, key.1, entry],
            )?;
            tx.commit()?;
        }
        Ok(self.map.insert(key, told))
    }

    /// Records `told`, logging a refused write once, naming the Door and child (DCL10a); with
    /// `push`, the change is also queued for the Door in the same transaction (DCL4).
    fn record(&mut self, key: (String, String), told: Told, push: Option<&DigestEntry>) -> bool {
        let at = format!("{}/{}", key.0, key.1);
        let result = match push {
            Some(entry) => self.insert_queued(key, told, entry),
            None => self.insert(key, told),
        };
        let Err(err) = result else {
            return true;
        };
        crate::log_failure("told", &format!("{at}: {err}"));
        false
    }
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

/// A change `Seen` recorded as told that no push ledger holds yet (DCL4).
pub struct Intent {
    pub door: String,
    pub child: String,
    pub entry: DigestEntry,
    /// How many changes it stands for.
    pub weight: u32,
}

#[derive(Default)]
pub struct Seen(Mutex<Book>);

impl Seen {
    /// A `Seen` whose Pad cursors live in the Project database of `dir`, as they were when the
    /// Daemon last ran (B23).
    pub fn open(dir: &Path) -> rusqlite::Result<Self> {
        let db = storage::connect(dir)?;
        let named = db
            .prepare("SELECT door, child, newest FROM pad_cursors")?
            .query_map([], |row| Ok(((row.get(0)?, row.get(1)?), row.get(2)?)))?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        let stored = db
            .prepare("SELECT door, child, told FROM door_told")?
            .query_map([], |row| {
                Ok((
                    (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        // A row this build cannot read is dropped: its child is baselined as unseen.
        let told = stored
            .into_iter()
            .filter_map(|(key, json)| Some((key, serde_json::from_str(&json).ok()?)))
            .collect();
        let tell_db = storage::connect(dir)?;
        Ok(Self(Mutex::new(Book {
            named,
            told: TellMap {
                map: told,
                db: Some(tell_db),
            },
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
    pub fn ask(&self, caller: &Actor, id: &str, from: &Sources) -> Result<Digest, Error> {
        let projection = Projection::new(from);
        let from = &projection;
        let allowed = match caller.kind {
            ActorKind::User => true,
            ActorKind::Agent => caller.id == id,
            ActorKind::Ext => false,
        };
        let name = |id: &str| {
            from.node(id)
                .map_or("an Agent that is gone", |node| node.name.as_str())
        };
        if !allowed {
            let caller_name = if caller.kind == ActorKind::Agent {
                name(&caller.id)
            } else {
                &caller.id
            };
            return Err(Error::forbidden(format!(
                "{caller_name} may not read the digest of {}",
                name(id)
            )));
        }
        let node = from.node(id).ok_or_else(|| Error::not_found(name(id)))?;
        if node.kind != NodeKind::Workstream {
            return Err(Error::conflict(format!("{} is no Door", node.name)));
        }
        let children = from.children(id);
        let mut book = self.book();
        let mut items: Vec<DigestItem> = Vec::new();
        for &(_, index) in children.iter().take(CHILDREN) {
            let Some(&child) = from.nodes.get(index) else {
                continue;
            };
            let key = (id.to_owned(), child.id.clone());
            let after = book.named.get(&key).copied();
            let (entry, newest) = entry(child, id, from, after, false);
            if caller.kind == ActorKind::Agent {
                if let Some(newest) = newest {
                    book.name(&key, newest);
                }
                book.told.record(key, told(&entry, child, from), None);
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
        let projection = Projection::new(from);
        let from = &projection;
        let node = from.node(child).filter(|node| node.status.is_some())?;
        let parent = node.parent.clone().unwrap_or_default();
        let mut book = self.book();
        let key = (parent.clone(), child.to_owned());
        let after = book.named.get(&key).copied();
        let (entry, newest) = entry(node, &parent, from, after, tell);
        if tell && node.parent.is_some() {
            if let Some(newest) = newest {
                book.name(&key, newest);
            }
            book.told.record(key, told(&entry, node, from), None);
        }
        Some(entry)
    }

    /// DCL10: whether the stored told book holds any fact, so startup compares with it instead of
    /// recording every child as told.
    pub fn has_told(&self) -> bool {
        !self.book().told.map.is_empty()
    }

    /// B21: what the Daemon records as told without sending it, so that only a change after now
    /// is pushed. Children that already have an entry keep it.
    pub fn baseline(&self, from: &Sources) {
        let projection = Projection::new(from);
        let from = &projection;
        let mut book = self.book();
        for (meta, child) in from.pairs() {
            let key = (meta.id.clone(), child.id.clone());
            if !book.told.contains_key(&key) {
                let after = book.named.get(&key).copied();
                let (entry, _) = entry(child, &meta.id, from, after, false);
                let seen = told(&entry, child, from);
                book.told.record(key, seen, None);
            }
        }
    }

    /// B21: the entries whose child's Kind, open Todo count or Pads changed since its Door
    /// was last told, oldest child first in Rail order. A change that leaves the entry as it was
    /// is none. Each one is recorded as told and its Pads as named before it is returned, under one
    /// lock, so no digest can name them again while the Message is sent.
    pub fn changed(&self, from: &Sources) -> Vec<Push> {
        let projection = Projection::new(from);
        let from = &projection;
        let mut book = self.book();
        let mut pushes = Vec::new();
        for (meta, child) in from.pairs() {
            let key = (meta.id.clone(), child.id.clone());
            let after = book.named.get(&key).copied();
            let (entry, newest) = entry(child, &meta.id, from, after, false);
            let now = told(&entry, child, from);
            // A snapshot read before an attention note must not supersede that newer Status.
            if book
                .told
                .get(&key)
                .is_some_and(|was| was.binding > now.binding)
            {
                continue;
            }
            let new_final = now.completed.is_some()
                && book
                    .told
                    .get(&key)
                    .is_none_or(|was| was.completed != now.completed);
            if meta.kind != NodeKind::Workstream && !new_final {
                continue;
            }
            // B43: the change into `error` or `needs-you` is the parent's note, not a push.
            let attention = matches!(now.entry.kind, Kind::Error | Kind::NeedsYou);
            let question_turn = from
                .completed_of(child)
                .is_some_and(|(_, started, _, _)| question_since(child, from, *started));
            let moved = book.told.get(&key).is_none_or(|was| {
                (was.entry.kind != now.entry.kind
                    && !is_flip(was, &now)
                    && !attention
                    && !(question_turn && matches!(now.entry.kind, Kind::Idle | Kind::Working)))
                    || (now.completed.is_some() && was.completed != now.completed)
                    || was.entry.todos != now.entry.todos
                    || (!entry.pads.is_empty() && now.pads > was.pads)
            });
            if !moved
                && attention
                && book
                    .told
                    .get(&key)
                    .is_some_and(|was| was.entry.kind != now.entry.kind)
            {
                book.told.record(key.clone(), now.clone(), None);
            }
            if moved {
                let noted = book.noted.get(&key).copied();
                // B47(c): the end note of a Kind the last note already told is not made again.
                let repeated = now.entry.kind == Kind::Done
                    && book
                        .told
                        .get(&key)
                        .is_none_or(|was| was.entry.kind != Kind::Done)
                    && book.noted.insert(key.clone(), Kind::Done) == Some(Kind::Done);
                // B49: the change into an end carries the child's own summary.
                let ends = book
                    .told
                    .get(&key)
                    .is_none_or(|was| was.entry.kind != now.entry.kind);
                let pushed = if ends {
                    self::entry(child, &meta.id, from, after, true).0
                } else {
                    entry
                };
                let before = (after, book.told.get(&key).cloned());
                // DCL10a: a refused write leaves the change untold, to be offered again.
                let queued = (!repeated).then_some(&pushed);
                if !book.told.record(key.clone(), now.clone(), queued) {
                    match noted {
                        Some(kind) => book.noted.insert(key, kind),
                        None => book.noted.remove(&key),
                    };
                    continue;
                }
                if let Some(newest) = newest {
                    book.name(&key, newest);
                }
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

    /// DCL4: the changes recorded as told whose push never reached the push ledger, because the
    /// Daemon ended between the two; the ledger's own write removes each one.
    pub fn intents(&self) -> Vec<Intent> {
        let book = self.book();
        let Some(db) = &book.db else {
            return Vec::new();
        };
        db.prepare("SELECT door, child, entry, weight FROM push_intents ORDER BY rowid")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, u32>(3)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()
            })
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(door, child, entry, weight)| {
                Some(Intent {
                    door,
                    child,
                    entry: serde_json::from_str(&entry).ok()?,
                    weight,
                })
            })
            .collect()
    }

    /// B21: the Message for `push` was not sent, so its entry is as untold as it was, unless a
    /// digest asked since has told the Door something newer.
    pub fn release(&self, push: Push) {
        let mut book = self.book();
        if push.gone {
            let at = format!("{}/{}", push.key.0, push.key.1);
            if let Err(err) = book.told.insert_absent(push.key, push.told) {
                crate::log_failure("told", &format!("{at}: {err}"));
            }
            return;
        }
        if book.told.get(&push.key) != Some(&push.told) {
            return;
        }
        match push.before.0 {
            Some(named) => book.name(&push.key, named),
            None => book.forget(&push.key),
        }
        let at = format!("{}/{}", push.key.0, push.key.1);
        let undone = match push.before.1 {
            Some(told) => book.told.insert(push.key, told).map(drop),
            None => book.told.remove(&push.key).map(drop),
        };
        if let Err(err) = undone {
            crate::log_failure("told", &format!("{at}: {err}"));
        }
    }
}

/// B33: `entry` as the lines a person reads: `<name> is <kind>`, then its last line, its open
/// Todo count and, when it names Pads, the Pads. No line is indented but the first.
#[must_use]
pub fn entry_text(entry: &DigestEntry) -> String {
    let line = |text: &str| text.replace(['\n', '\r'], " ");
    let link = entry
        .link
        .as_ref()
        .map_or_else(String::new, |link| format!(" ({link})"));
    let mut text = format!(
        "{} is {}{link}\n  last: {}\n  open todos: {}",
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

/// B35: whether `now` differs from `was` only by an `idle` and `working` flip, its last line
/// the same.
fn is_flip(was: &Told, now: &Told) -> bool {
    let flips = |kind| matches!(kind, Kind::Idle | Kind::Working);
    flips(was.entry.kind) && flips(now.entry.kind) && was.entry.last == now.entry.last
}

/// B21, B33: the body of a pushed digest.
#[must_use]
pub fn push_body(entry: &DigestEntry) -> String {
    format!("[digest] {}", entry_text(entry))
}

fn told(entry: &DigestEntry, child: &RailNode, from: &Projection) -> Told {
    Told {
        binding: crate::binding(child),
        completed: final_text(child, from).map(|(turn, _, _, _)| turn.clone()),
        pads: newest_pad(child, from),
        entry: entry.clone(),
    }
}

/// B23: one last push for each child told of that no longer has a node, to its Door if that
/// is still a Door, with the entry as it was last told; none when that already said the child
/// ended (`done`, `error`). A child that only moved to another Door has nothing to say.
fn farewells(book: &mut Book, from: &Projection) -> Vec<Push> {
    let child_of = |key: &(String, String)| from.node(&key.1);
    let stale: Vec<(String, String)> = book
        .told
        .keys()
        .filter(|key| child_of(key).is_none_or(|node| node.parent.as_deref() != Some(&key.0)))
        .cloned()
        .collect();
    let mut pushes = Vec::new();
    for key in stale {
        let removed = book.told.remove(&key);
        let Some(told) = (match removed {
            Ok(told) => told,
            Err(err) => {
                crate::log_failure("told", &format!("{}/{}: {err}", key.0, key.1));
                continue;
            }
        }) else {
            continue;
        };
        book.forget(&key);
        if child_of(&key).is_some() {
            continue;
        }
        let door = from
            .node(&key.0)
            .is_some_and(|node| node.kind == NodeKind::Workstream);
        if door && !matches!(told.entry.kind, Kind::Done | Kind::Error) {
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

fn newest_pad(child: &RailNode, from: &Projection) -> i64 {
    from.written(child)
        .last()
        .map_or(i64::MIN, |&(_, pad)| from.pad_time(pad))
}

/// An Agent, or a Workstream whose Door has run.
fn is_agent(node: &RailNode) -> bool {
    match node.kind {
        NodeKind::Group => false,
        NodeKind::Agent => true,
        NodeKind::Workstream => node.attempt.is_some(),
    }
}

/// B19: the entry for `child` as told to `meta`, and the newest Pad write it names. `after` is the
/// newest Pad write an earlier envelope named.
fn entry(
    child: &RailNode,
    meta: &str,
    from: &Projection,
    after: Option<i64>,
    end: bool,
) -> (DigestEntry, Option<i64>) {
    let Some(status) = child.status.as_ref() else {
        unreachable!("the caller keeps only children that have a Status");
    };
    let index = from.ids.get(child.id.as_str()).copied();
    let told = index
        .and_then(|index| from.messages.get(&(index, meta)))
        .and_then(|&(_, index)| from.message_text.get(index).copied());
    // B49: an end note carries the child's own summary, whole, or says there was none.
    let end = end && is_end(child);
    let final_reply = (!end)
        .then(|| final_text(child, from))
        .flatten()
        .filter(|(_, _, ended, _)| told.is_none_or(|message| message.at <= *ended));
    let last = match (told, end) {
        (Some(message), true) => message.body.as_str(),
        (None, true) => NO_FINDING,
        (Some(message), false) => message.body.lines().next().unwrap_or_default(),
        (None, false) => status.label.as_str(),
    };
    let last = final_reply.map_or(last, |(_, _, _, text)| text.as_str());
    let last = if final_reply.is_some() && last.lines().count() > 1 {
        format!("{}[cut]", last.lines().next().unwrap_or_default())
    } else {
        last.to_owned()
    };
    let todos = index
        .and_then(|index| from.todos.get(index))
        .copied()
        .unwrap_or(0);
    let written = from.written(child);
    let first =
        written.partition_point(|&(_, pad)| after.is_some_and(|after| from.pad_time(pad) <= after));
    let written = written.get(first..).unwrap_or_default();
    let newest = written.last().map(|&(_, pad)| from.pad_time(pad));
    let mut pads: Vec<String> = Vec::new();
    if written.len() > PADS {
        pads.extend(
            written
                .iter()
                .skip(written.len().saturating_sub(PADS))
                .map(|&(_, pad)| cut(from.pad_name(pad), PAD_NAME_BYTES)),
        );
        pads.push(CUT.to_owned());
    } else {
        pads.extend(
            written
                .iter()
                .map(|&(_, pad)| cut(from.pad_name(pad), PAD_NAME_BYTES)),
        );
    }
    let entry = DigestEntry {
        name: child.name.clone(),
        kind: status.kind,
        link: (!from.project_key.is_empty())
            .then(|| contracts::link::node_link(from.project_key, child))
            .flatten(),
        last: cut(&last, if end { END_LAST_BYTES } else { LAST_BYTES }),
        todos,
        pads,
    };
    (
        fit(entry, if end { END_ENTRY_BYTES } else { ENTRY_BYTES }),
        newest,
    )
}

/// Explicit question Messages already carry this turn's choice; never duplicate them as fallback.
fn final_text<'a>(
    child: &RailNode,
    from: &'a Projection,
) -> Option<&'a (String, i64, i64, String)> {
    if is_end(child) {
        return None;
    }
    let text = from.completed_of(child)?;
    if !text
        .0
        .starts_with(&format!("{}:", child.attempt.as_deref()?))
    {
        return None;
    }
    (!question_since(child, from, text.1)).then_some(text)
}

fn question_since(child: &RailNode, from: &Projection, started: i64) -> bool {
    from.ids
        .get(child.id.as_str())
        .and_then(|&index| from.questions.get(index).copied().flatten())
        .is_some_and(|at| at >= started)
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
mod link_tests;
#[cfg(test)]
mod reopen_tests;
#[cfg(test)]
mod tests;

// B5641a counts source visits at the loops, never inferred from capacities.
#[inline]
fn cost(column: usize) {
    #[cfg(test)]
    COST.with(|counts| counts.borrow_mut()[column] += 1);
    #[cfg(not(test))]
    let _ = column;
}

#[cfg(test)]
thread_local! {
    static COST: std::cell::RefCell<[usize; 7]> = const { std::cell::RefCell::new([0; 7]) };
}
