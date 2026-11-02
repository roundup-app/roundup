//! RO1, RO2: each saved conversation's overview, read once and then only from what was
//! appended. A caller of `rail.tree` reads the cache; a task of its own fills it.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use contracts::agent::{ContextPart, ConversationCard, ConversationOverview};
use serde_json::Value;
use std::sync::Arc;

use super::Launcher;
use super::conversation::{context_limit, context_parts, measured_parts, merge_cards};

/// How often the background path looks at the transcripts it was asked to keep current.
const POLL: Duration = Duration::from_millis(500);
/// How long a transcript stays kept current after a `rail.tree` last asked for it.
const KEEP: Duration = Duration::from_secs(60);
/// Bytes at the start of a transcript that tell a replaced file from a grown one.
const HEAD: usize = 64;

#[derive(Default)]
struct Fold {
    name: Option<String>,
    custom_name: Option<String>,
    used: Option<u64>,
    limit: Option<u64>,
    measured: Option<Vec<ContextPart>>,
    card: ConversationCard,
}

impl Fold {
    fn push(&mut self, record: &Value) {
        if record["type"] == "assistant" {
            let content = &record["message"]["content"];
            let text = if let Some(text) = content.as_str() {
                text.to_owned()
            } else {
                content
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|block| block["type"] == "text")
                    .filter_map(|block| block["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            merge_cards(&mut self.card, &text);
            self.limit = record["message"]["model"].as_str().and_then(context_limit);
            let usage = &record["message"]["usage"];
            self.used = usage["input_tokens"].as_u64().and_then(|input| {
                input
                    .checked_add(usage["cache_read_input_tokens"].as_u64().unwrap_or(0))?
                    .checked_add(usage["cache_creation_input_tokens"].as_u64().unwrap_or(0))
            });
        }
        if record["type"] == "system"
            && record["subtype"] == "local_command"
            && (record["commandRun"]["command"] == "context"
                || record["contextUsage"]["categories"].is_array())
        {
            self.measured = Some(measured_parts(&record["contextUsage"]["categories"]));
        }
        if record["type"] == "custom-title"
            && let Some(title) = record["customTitle"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
        {
            self.custom_name = Some(title.to_owned());
        }
        if record["type"] == "ai-title"
            && let Some(title) = record["aiTitle"].as_str().filter(|s| !s.trim().is_empty())
        {
            self.name = Some(title.to_owned());
        }
    }

    fn overview(&self, id: &str) -> ConversationOverview {
        let mut card = self.card.clone();
        if card.facts.as_ref().is_some_and(Vec::is_empty) {
            card.facts = None;
        }
        ConversationOverview {
            program: "Claude Code".into(),
            id: id.into(),
            name: self.custom_name.clone().or_else(|| self.name.clone()),
            used: self.used,
            limit: self.limit,
            context_parts: self
                .used
                .zip(self.measured.clone())
                .and_then(|(used, parts)| context_parts(used, parts)),
            card: (card != ConversationCard::default()).then_some(card),
        }
    }
}

/// One transcript as last read: where, at what size and time, and what its complete lines say.
struct Entry {
    path: Option<PathBuf>,
    len: u64,
    modified: Option<SystemTime>,
    head: Vec<u8>,
    /// Bytes up to the end of the last complete line read.
    offset: u64,
    fold: Fold,
    overview: Option<ConversationOverview>,
}

impl Entry {
    fn new() -> Self {
        Self {
            path: None,
            len: 0,
            modified: None,
            head: Vec::new(),
            offset: 0,
            fold: Fold::default(),
            overview: None,
        }
    }

    fn reset(&mut self) {
        let path = self.path.take();
        *self = Self::new();
        self.path = path;
    }
}

#[derive(Default)]
pub(super) struct OverviewCache {
    entries: Mutex<HashMap<String, Arc<Mutex<Entry>>>>,
    /// The transcripts a `rail.tree` asked to keep current: id to its folder and last ask.
    wanted: Mutex<HashMap<String, (PathBuf, Instant)>>,
    working: AtomicBool,
    parsed: AtomicU64,
    /// An isolated observer's hold, run before each background read (RO3).
    hold: OnceLock<Box<dyn Fn() + Send + Sync>>,
}

impl OverviewCache {
    fn entry(&self, id: &str) -> Arc<Mutex<Entry>> {
        Arc::clone(
            self.entries
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(Entry::new()))),
        )
    }
}

fn read_new(path: &Path, entry: &mut Entry) -> std::io::Result<u64> {
    let meta = std::fs::metadata(path)?;
    let (len, modified) = (meta.len(), meta.modified().ok());
    if len == entry.len && modified == entry.modified {
        return Ok(0);
    }
    let mut file = std::fs::File::open(path)?;
    let mut head = vec![0; HEAD.min(entry.offset as usize)];
    let replaced = len < entry.offset
        || modified < entry.modified
        || file.read_exact(&mut head).is_err()
        || head != entry.head[..head.len()];
    if replaced {
        entry.reset();
    }
    file.seek(SeekFrom::Start(entry.offset))?;
    let mut bytes = Vec::new();
    file.take(len.saturating_sub(entry.offset))
        .read_to_end(&mut bytes)?;
    let complete = bytes
        .iter()
        .rposition(|b| *b == b'\n')
        .map_or(0, |at| at + 1);
    for line in bytes[..complete].split(|b| *b == b'\n') {
        if let Ok(record) = serde_json::from_slice::<Value>(line) {
            entry.fold.push(&record);
        }
    }
    if entry.head.len() < HEAD {
        entry
            .head
            .extend_from_slice(&bytes[..complete.min(HEAD.saturating_sub(entry.head.len()))]);
    }
    entry.offset += complete as u64;
    entry.len = len;
    entry.modified = modified;
    Ok(complete as u64)
}

impl Launcher {
    /// RO2: the overview as last read, with no file read and no parse.
    pub fn cached_overview(&self, id: &str) -> Option<ConversationOverview> {
        let entry = self
            .overviews
            .entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()?;
        let entry = entry.lock().unwrap_or_else(|e| e.into_inner());
        entry.overview.clone()
    }

    /// RO1: bring `id`'s overview up to its transcript, parsing only what was appended. Holds
    /// no lock another call waits on. Whether the overview changed.
    pub fn refresh_overview(&self, cwd: &Path, id: &str) -> bool {
        if let Some(hold) = self.overviews.hold.get() {
            hold();
        }
        let entry = self.overviews.entry(id);
        let mut entry = entry.lock().unwrap_or_else(|e| e.into_inner());
        let before = entry.overview.clone();
        if entry.path.is_none() {
            entry.path = self.conversation_path(cwd, id).ok();
        }
        match entry.path.clone().map(|path| read_new(&path, &mut entry)) {
            Some(Ok(parsed)) => {
                self.overviews.parsed.fetch_add(parsed, Ordering::Relaxed);
                entry.overview = Some(entry.fold.overview(id));
            }
            _ => {
                entry.reset();
            }
        }
        entry.overview != before
    }

    /// RO2: keep `id`'s overview current from a task of its own, calling `changed` whenever it
    /// moves. A caller only asks; it never waits on a read.
    pub fn keep_overview(&self, cwd: &Path, id: &str, changed: impl Fn() + Send + Sync + 'static) {
        self.overviews
            .wanted
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_owned(), (cwd.to_path_buf(), Instant::now()));
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        if self.overviews.working.swap(true, Ordering::AcqRel) {
            return;
        }
        let launcher = self.clone();
        runtime.spawn(async move {
            let mut tick = tokio::time::interval(POLL);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                let batch: Vec<(String, PathBuf)> = {
                    let mut wanted = launcher
                        .overviews
                        .wanted
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    wanted.retain(|_, (_, asked)| asked.elapsed() < KEEP);
                    wanted
                        .iter()
                        .map(|(id, (cwd, _))| (id.clone(), cwd.clone()))
                        .collect()
                };
                if batch.is_empty() {
                    launcher.overviews.working.store(false, Ordering::Release);
                    if launcher.overviews.wanted.lock().unwrap().is_empty()
                        || launcher.overviews.working.swap(true, Ordering::AcqRel)
                    {
                        return;
                    }
                    continue;
                }
                let reader = launcher.clone();
                let moved = tokio::task::spawn_blocking(move || {
                    batch.iter().fold(false, |moved, (id, cwd)| {
                        reader.refresh_overview(cwd, id) | moved
                    })
                })
                .await
                .unwrap_or(false);
                if moved {
                    changed();
                }
                tick.tick().await;
            }
        });
    }

    /// RO3: run `hold` before each read, for an isolated observer that keeps the reader pending.
    #[must_use]
    pub fn with_overview_hold(self, hold: impl Fn() + Send + Sync + 'static) -> Self {
        let _ = self.overviews.hold.set(Box::new(hold));
        self
    }

    /// RO1's call count: transcript bytes parsed so far, by every read of this Launcher.
    #[cfg(any(test, feature = "test-support"))]
    pub fn overview_bytes_parsed(&self) -> u64 {
        self.overviews.parsed.load(Ordering::Relaxed)
    }
}
