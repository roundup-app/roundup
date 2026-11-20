//! C7707a, C7707b: `search.find` reads the FTS5 tables the Project database keeps beside its rows.

use contracts::search::{FindParams, Found, SearchHit, SearchKind, Span};
use rpc::RpcError;
use rusqlite::{Connection, OpenFlags, params};

use crate::{Conn, Daemon};

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 50;
const WIDTH: usize = 80;
const LEAD: usize = 20;
/// `highlight()` wraps each matched word in these, which no Message, Pad or Todo holds.
const OPEN: &str = "\u{1}";
const CLOSE: &str = "\u{2}";

/// Each word as a quoted prefix, so no character of the query is FTS5 syntax; `None` holds no word.
fn match_query(query: &str) -> Option<String> {
    let words: Vec<String> = query
        .split_whitespace()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

/// The text around the first marked word, at most `WIDTH` characters, and the marked ranges in it.
fn snippet(marked: &str) -> (String, Vec<Span>) {
    let (mut chars, mut found, mut from) = (Vec::<char>::new(), Vec::<(usize, usize)>::new(), 0);
    for c in marked.chars() {
        match c {
            '\u{1}' => from = chars.len(),
            '\u{2}' => found.push((from, chars.len())),
            '\n' | '\r' | '\t' => chars.push(' '),
            c => chars.push(c),
        }
    }
    let first = found.first().map_or(0, |&(start, _)| start);
    let end = (first.saturating_sub(LEAD) + WIDTH).min(chars.len());
    let start = end.saturating_sub(WIDTH).min(first);
    let units = |upto: usize| -> u32 {
        chars
            .get(start..upto)
            .unwrap_or_default()
            .iter()
            .map(|c| c.len_utf16() as u32)
            .sum()
    };
    let ranges = found
        .iter()
        .filter(|&&(a, b)| b > start && a < end)
        .map(|&(a, b)| Span {
            start: units(a.max(start)),
            end: units(b.min(end)),
        })
        .collect();
    (
        chars.get(start..end).unwrap_or_default().iter().collect(),
        ranges,
    )
}

/// The snippet of the first text that holds a match, else of the first text.
fn snippet_of(texts: &[&str]) -> (String, Vec<Span>) {
    let text = texts
        .iter()
        .find(|text| text.contains(OPEN))
        .or(texts.first())
        .copied()
        .unwrap_or("");
    snippet(text)
}

struct Candidate {
    rank: f64,
    at: i64,
    hit: SearchHit,
}

fn todos(db: &Connection, query: &str, take: u32) -> rusqlite::Result<Vec<Candidate>> {
    db.prepare(
        "SELECT t.id, t.title, highlight(todos_fts, 1, ?2, ?3), highlight(todos_fts, 0, ?2, ?3),
                bm25(todos_fts, 10.0, 1.0), max(t.updated_at, t.created_at)
         FROM todos_fts JOIN todos t ON t.id = todos_fts.rowid
         WHERE todos_fts MATCH ?1 ORDER BY 5, 6 DESC LIMIT ?4",
    )?
    .query_map(params![query, OPEN, CLOSE, take], |row| {
        let (body, title): (String, String) = (row.get(2)?, row.get(3)?);
        let (snippet, ranges) = snippet_of(&[&body, &title]);
        Ok(Candidate {
            rank: row.get(4)?,
            at: row.get(5)?,
            hit: SearchHit {
                kind: SearchKind::Todo,
                id: row.get::<_, i64>(0)?.to_string(),
                title: row.get(1)?,
                snippet,
                ranges,
                opens: None,
            },
        })
    })?
    .collect()
}

fn pads(db: &Connection, query: &str, take: u32) -> rusqlite::Result<Vec<Candidate>> {
    db.prepare(
        "SELECT f.name, highlight(pads_fts, 1, ?2, ?3), highlight(pads_fts, 0, ?2, ?3),
                bm25(pads_fts, 10.0, 1.0, 0.0), p.updated_at
         FROM pads_fts f JOIN pads p ON p.key = f.key
         WHERE pads_fts MATCH ?1 ORDER BY 4, 5 DESC LIMIT ?4",
    )?
    .query_map(params![query, OPEN, CLOSE, take], |row| {
        let (body, title): (String, String) = (row.get(1)?, row.get(2)?);
        let (snippet, ranges) = snippet_of(&[&body, &title]);
        let name: String = row.get(0)?;
        Ok(Candidate {
            rank: row.get(3)?,
            at: row.get(4)?,
            hit: SearchHit {
                kind: SearchKind::Pad,
                id: name.clone(),
                title: name,
                snippet,
                ranges,
                opens: None,
            },
        })
    })?
    .collect()
}

fn messages(db: &Connection, query: &str, take: u32) -> rusqlite::Result<Vec<Candidate>> {
    db.prepare(
        "SELECT m.id, json_extract(m.from_actor, '$.id'), json_extract(m.from_actor, '$.kind'), m.to_id,
                highlight(messages_fts, 0, ?2, ?3), bm25(messages_fts), m.at
         FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
         WHERE messages_fts MATCH ?1 ORDER BY 6, 7 DESC LIMIT ?4",
    )?
    .query_map(params![query, OPEN, CLOSE, take], |row| {
        let (from, kind, to): (String, String, String) = (row.get(1)?, row.get(2)?, row.get(3)?);
        let body: String = row.get(4)?;
        let (snippet, ranges) = snippet(&body);
        // The receiver when it is an Agent, else the sender (U7707b).
        let opens = if to == "you" { (kind == "agent").then(|| from.clone()) } else { Some(to.clone()) };
        Ok(Candidate {
            rank: row.get(5)?,
            at: row.get(6)?,
            hit: SearchHit {
                kind: SearchKind::Message,
                id: row.get::<_, i64>(0)?.to_string(),
                title: format!("{from} to {to}"),
                snippet,
                ranges,
                opens,
            },
        })
    })?
    .collect()
}

/// The ranked hits of `query`: `bm25` first (a title before a body), then newest first.
pub(crate) fn find(db: &Connection, params: &FindParams) -> rusqlite::Result<Found> {
    let none = Found {
        hits: Vec::new(),
        more: false,
    };
    let Some(query) = match_query(&params.query) else {
        return Ok(none);
    };
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let take = limit + 1;
    let mut all = todos(db, &query, take)?;
    all.extend(pads(db, &query, take)?);
    all.extend(messages(db, &query, take)?);
    all.sort_by(|a, b| a.rank.total_cmp(&b.rank).then(b.at.cmp(&a.at)));
    let more = all.len() > limit as usize;
    all.truncate(limit as usize);
    Ok(Found {
        hits: all.into_iter().map(|c| c.hit).collect(),
        more,
    })
}

impl Daemon {
    /// `search.find`: the user's call; it logs no Touch (C7707a).
    pub(crate) async fn search_find(
        &self,
        _conn: &mut Conn,
        params: FindParams,
    ) -> Result<Found, RpcError> {
        let path = self.data_dir.join("project.db");
        tokio::task::spawn_blocking(move || {
            let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            find(&db, &params)
        })
        .await
        .map_err(RpcError::internal)?
        .map_err(RpcError::internal)
    }
}
