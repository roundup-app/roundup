//! FK5977: copy the live data folder into a Fork, keeping what the caller picks. Every database is
//! copied with `VACUUM INTO`, which reads one snapshot, so a copy taken while a Daemon writes is
//! consistent; the live folder is only read.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use contracts::data::{
    ForkAgents, ForkAgentsAll, ForkParams, ForkProject, ForkRecord, ForkResult, Forked,
};
use rpc::{RpcError, code};
use rusqlite::{Connection, params};

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

fn failed(path: &Path, err: impl std::fmt::Display) -> RpcError {
    RpcError::internal(format!("{}: {err}", path.display()))
}

/// The canonical form of `path`, which may not exist yet: its deepest existing ancestor, resolved,
/// with the missing names appended.
fn resolved(path: &Path) -> Result<PathBuf, RpcError> {
    let mut missing = Vec::new();
    let mut at = path;
    let base = loop {
        match at.canonicalize() {
            Ok(base) => break base,
            Err(_) => {
                let (Some(parent), Some(name)) = (at.parent(), at.file_name()) else {
                    return Err(invalid(format!("{} cannot be resolved", path.display())));
                };
                missing.push(name);
                at = parent;
            }
        }
    };
    Ok(missing.iter().rev().fold(base, |acc, name| acc.join(name)))
}

/// U6044a: the colour of the Fork whose Project data folder is `project_dir`
/// (`<fork>/projects/<key>`); `None` when `<fork>/fork.json` is absent or unreadable.
pub(crate) fn colour_of(project_dir: &Path) -> Option<contracts::data::ForkColour> {
    let root = project_dir.parent()?.parent()?;
    let text = fs::read_to_string(root.join("fork.json")).ok()?;
    serde_json::from_str::<ForkRecord>(&text)
        .ok()
        .map(|r| r.colour)
}

/// `ForkParams` whose name was checked while parsing: 1 to 40 characters, no control character.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(try_from = "ForkParams")]
pub(crate) struct ForkRequest(ForkParams);

impl TryFrom<ForkParams> for ForkRequest {
    type Error = &'static str;

    fn try_from(params: ForkParams) -> Result<Self, Self::Error> {
        let name = params.name.as_str();
        if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
            return Err("A Fork name is 1 to 40 characters with no control character.");
        }
        Ok(Self(params))
    }
}

/// Copy the live `root` into `params.path`; on failure remove what this call wrote.
pub(crate) fn fork(root: &Path, params: &ForkRequest) -> Result<ForkResult, RpcError> {
    let params = &params.0;
    let folder = Path::new(&params.path);
    if !folder.is_absolute() {
        return Err(invalid(format!("{} is not an absolute path", params.path)));
    }
    let source = root.canonicalize().map_err(|e| failed(root, e))?;
    let target = resolved(folder)?;
    if target.starts_with(&source) || source.starts_with(&target) {
        return Err(invalid(
            "The Fork folder must not lie inside the live data folder or contain it.",
        ));
    }
    let existed = target.exists();
    if existed && !fs::read_dir(&target).is_ok_and(|mut entries| entries.next().is_none()) {
        return Err(invalid(format!(
            "{} is not an empty folder",
            target.display()
        )));
    }
    let plan = plan(&source, params.projects.as_deref())?;
    fs::create_dir_all(&target).map_err(|e| failed(&target, e))?;
    let done = copy_all(&source, &target, params, &plan);
    if done.is_err() {
        let _ = if existed {
            fs::read_dir(&target).map(|entries| {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let _ = if path.is_dir() {
                        fs::remove_dir_all(path)
                    } else {
                        fs::remove_file(path)
                    };
                }
            })
        } else {
            first_created(folder, &target)
        };
    }
    done
}

/// Remove the topmost folder `create_dir_all` made for `target`.
fn first_created(given: &Path, target: &Path) -> std::io::Result<()> {
    let mut top = target;
    while let Some(parent) = top.parent() {
        if parent.exists() {
            break;
        }
        top = parent;
    }
    let _ = given;
    fs::remove_dir_all(top)
}

/// What one Project of the Fork keeps.
struct Keep {
    key: String,
    /// `None` keeps every Agent.
    agents: Option<BTreeSet<String>>,
    todos: bool,
    pads: bool,
    messages: bool,
    history: bool,
}

fn agent_ids(db: &Path) -> Result<BTreeSet<String>, RpcError> {
    let conn = open_read(db)?;
    let mut statement = conn
        .prepare("SELECT id FROM nodes WHERE kind = 'agent'")
        .map_err(|e| failed(db, e))?;
    let rows = statement
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|e| failed(db, e))?;
    rows.map(|id| id.map(|id| id.to_string()).map_err(|e| failed(db, e)))
        .collect()
}

fn plan(source: &Path, picks: Option<&[ForkProject]>) -> Result<Vec<Keep>, RpcError> {
    let projects = source.join("projects");
    let mut live = BTreeSet::new();
    if let Ok(entries) = fs::read_dir(&projects) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                live.insert(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    let Some(picks) = picks else {
        return Ok(live
            .into_iter()
            .map(|key| Keep {
                key,
                agents: None,
                todos: true,
                pads: true,
                messages: true,
                history: true,
            })
            .collect());
    };
    let mut seen = BTreeSet::new();
    let mut keeps = Vec::new();
    for pick in picks {
        if !live.contains(&pick.key) {
            return Err(invalid(format!(
                "no Project {:?} in the data folder",
                pick.key
            )));
        }
        if !seen.insert(&pick.key) {
            return Err(invalid(format!("Project {:?} is listed twice", pick.key)));
        }
        let agents = match &pick.agents {
            ForkAgents::Keyword(ForkAgentsAll::All) => None,
            ForkAgents::Keyword(ForkAgentsAll::None) => Some(BTreeSet::new()),
            ForkAgents::Ids(ids) => {
                let db = projects.join(&pick.key).join("project.db");
                let known = if db.exists() {
                    agent_ids(&db)?
                } else {
                    BTreeSet::new()
                };
                if let Some(id) = ids.iter().find(|id| !known.contains(*id)) {
                    return Err(invalid(format!(
                        "no Agent {id:?} in Project {:?}",
                        pick.key
                    )));
                }
                Some(ids.iter().cloned().collect())
            }
        };
        keeps.push(Keep {
            key: pick.key.clone(),
            agents,
            todos: pick.todos,
            pads: pick.pads,
            messages: pick.messages,
            history: pick.history,
        });
    }
    Ok(keeps)
}

fn copy_all(
    source: &Path,
    target: &Path,
    params: &ForkParams,
    plan: &[Keep],
) -> Result<ForkResult, RpcError> {
    let prefs = source.join("preferences.db");
    if prefs.exists() {
        snapshot(&prefs, &target.join("preferences.db"))?;
    }
    let mut projects = Vec::new();
    for keep in plan {
        projects.push(copy_project(
            &source.join("projects").join(&keep.key),
            &target.join("projects").join(&keep.key),
            keep,
        )?);
    }
    let record = ForkRecord {
        name: params.name.clone(),
        colour: params.colour,
        source: source.to_string_lossy().into_owned(),
        created_ms: u64::try_from(provenance::now_ms()).unwrap_or(0),
        projects: params.projects.clone(),
    };
    let text = serde_json::to_string_pretty(&record).map_err(RpcError::internal)?;
    let path = target.join("fork.json");
    fs::write(&path, text + "\n").map_err(|e| failed(&path, e))?;
    Ok(ForkResult {
        path: target.to_string_lossy().into_owned(),
        projects,
    })
}

/// Opens `db` to read. A database at rest has no `-wal`; opening it normally would create that
/// file and a `-shm` in the live folder, so it opens `immutable`, which touches nothing.
fn open_read(db: &Path) -> Result<Connection, RpcError> {
    let at_rest = ["-wal", "-shm"].iter().all(|suffix| {
        let mut side = db.as_os_str().to_owned();
        side.push(suffix);
        !Path::new(&side).exists()
    });
    let mut flags =
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let target = if at_rest {
        flags |= rusqlite::OpenFlags::SQLITE_OPEN_URI;
        let encoded: String = db
            .to_string_lossy()
            .bytes()
            .map(|b| match b {
                b'/' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                b if b.is_ascii_alphanumeric() => (b as char).to_string(),
                b => format!("%{b:02X}"),
            })
            .collect();
        PathBuf::from(format!("file:{encoded}?immutable=1"))
    } else {
        db.to_path_buf()
    };
    Connection::open_with_flags(&target, flags).map_err(|e| failed(db, e))
}

/// `VACUUM INTO`: one read snapshot of `from`, whose `-wal` is part of it, written whole to `to`.
fn snapshot(from: &Path, to: &Path) -> Result<(), RpcError> {
    let conn = open_read(from)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))
        .map_err(|e| failed(from, e))?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| failed(parent, e))?;
    }
    conn.execute("VACUUM INTO ?1", params![to.to_string_lossy()])
        .map_err(|e| failed(from, e))?;
    Ok(())
}

/// The numeric id of the file `agents/<id>.settings.json`, `<id>.mcp.json` or `<id>.bin`.
fn agent_of(file: &str) -> &str {
    file.split('.').next().unwrap_or_default()
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), RpcError> {
    let meta = fs::symlink_metadata(from).map_err(|e| failed(from, e))?;
    if meta.is_dir() {
        fs::create_dir_all(to).map_err(|e| failed(to, e))?;
        for entry in fs::read_dir(from).map_err(|e| failed(from, e))? {
            let entry = entry.map_err(|e| failed(from, e))?;
            copy_tree(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else if meta.is_file() {
        // `clonefile` on macOS, a reflink where the filesystem has one, else a byte copy.
        reflink_copy::reflink_or_copy(from, to).map_err(|e| failed(from, e))?;
    }
    Ok(())
}

fn copy_project(from: &Path, to: &Path, keep: &Keep) -> Result<Forked, RpcError> {
    fs::create_dir_all(to).map_err(|e| failed(to, e))?;
    for entry in fs::read_dir(from).map_err(|e| failed(from, e))? {
        let entry = entry.map_err(|e| failed(from, e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        if name.ends_with("-wal") || name.ends_with("-shm") || name.ends_with("-journal") {
            continue;
        }
        match name.as_str() {
            "pads" if !keep.pads => {}
            "agents" => {
                fs::create_dir_all(to.join("agents")).map_err(|e| failed(to, e))?;
                for file in fs::read_dir(&path).map_err(|e| failed(&path, e))? {
                    let file = file.map_err(|e| failed(&path, e))?;
                    let file_name = file.file_name().to_string_lossy().into_owned();
                    let kept = keep
                        .agents
                        .as_ref()
                        .is_none_or(|ids| ids.contains(agent_of(&file_name)));
                    if kept {
                        copy_tree(&file.path(), &to.join("agents").join(&file_name))?;
                    }
                }
            }
            _ if name.ends_with(".db") => snapshot(&path, &to.join(&name))?,
            _ => copy_tree(&path, &to.join(&name))?,
        }
    }
    let db = to.join("project.db");
    if !db.exists() {
        return Ok(Forked {
            key: keep.key.clone(),
            agents: Vec::new(),
            todos: 0,
            pads: 0,
            messages: 0,
            history: 0,
        });
    }
    let conn = crate::storage::open(to).map_err(|e| failed(&db, e))?;
    let counts = prune(&conn, keep).map_err(|e| failed(&db, e))?;
    conn.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(|e| failed(&db, e))?;
    Ok(Forked {
        key: keep.key.clone(),
        agents: counts.0,
        todos: counts.1,
        pads: counts.2,
        messages: counts.3,
        history: counts.4,
    })
}

fn has_table(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

fn clear(conn: &Connection, tables: &[&str]) -> rusqlite::Result<()> {
    for table in tables {
        if has_table(conn, table)? {
            conn.execute(&format!("DELETE FROM {table}"), [])?;
        }
    }
    Ok(())
}

fn count(conn: &Connection, table: &str) -> rusqlite::Result<u32> {
    if !has_table(conn, table)? {
        return Ok(0);
    }
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get::<_, i64>(0).map(|n| n as u32)
    })
}

const TODO_TABLES: &[&str] = &[
    "blockers",
    "changes",
    "comments",
    "todo_refs",
    "todo_deletions",
    "deleted_todos",
    "deleted_blockers",
    "deleted_changes",
    "deleted_comments",
    "deleted_refs",
    "todos",
];
const PAD_TABLES: &[&str] = &["pad_sources", "pad_deletions", "pad_cursors", "pads"];
const MESSAGE_TABLES: &[&str] = &[
    "message_retirements",
    "message_restarts",
    "message_flight",
    "message_results",
    "message_result_facts",
    "message_sender_names",
    "message_inbox_last",
    "wakes",
    "routes",
    "chains",
    "iterations",
    "receiver_generations",
    "messages",
];
const HISTORY_TABLES: &[&str] = &["touches", "events"];

type Counts = (Vec<String>, u32, u32, u32, u32);

/// Remove from the copy what `keep` leaves out, in one transaction.
fn prune(conn: &Connection, keep: &Keep) -> rusqlite::Result<Counts> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    if let Some(kept) = &keep.agents {
        let all: Vec<i64> = conn
            .prepare("SELECT id FROM nodes WHERE kind = 'agent'")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        let dropped: Vec<i64> = all
            .into_iter()
            .filter(|id| !kept.contains(&id.to_string()))
            .collect();
        for id in &dropped {
            // Children of a dropped Agent move up to its parent.
            conn.execute(
                "UPDATE nodes SET parent = (SELECT parent FROM nodes p WHERE p.id = ?1) WHERE parent = ?1",
                [id],
            )?;
        }
        for id in &dropped {
            let text = id.to_string();
            conn.execute("DELETE FROM nodes WHERE id = ?1", [id])?;
            // FOP5978e: a Todo the Agent owned stays, unassigned.
            if has_table(conn, "todos")? {
                conn.execute(
                    "UPDATE todos SET owner = NULL WHERE json_valid(owner) AND json_extract(owner, '$.kind') = 'agent' AND json_extract(owner, '$.id') = ?1",
                    [&text],
                )?;
            }
            if has_table(conn, "messages")? {
                conn.execute(
                    "DELETE FROM messages WHERE to_id = ?1 OR (json_valid(from_actor) AND json_extract(from_actor, '$.kind') = 'agent' AND json_extract(from_actor, '$.id') = ?1)",
                    [&text],
                )?;
            }
            for (table, column) in [
                ("message_retirements", "agent"),
                ("message_restarts", "agent"),
                ("message_inbox_last", "receiver"),
                ("wakes", "waiter"),
            ] {
                if has_table(conn, table)? {
                    conn.execute(&format!("DELETE FROM {table} WHERE {column} = ?1"), [&text])?;
                }
            }
        }
        if has_table(conn, "message_flight")? {
            conn.execute(
                "DELETE FROM message_flight WHERE message_id NOT IN (SELECT id FROM messages)",
                [],
            )?;
        }
    }
    if !keep.todos {
        clear(conn, TODO_TABLES)?;
    }
    if !keep.pads {
        clear(conn, PAD_TABLES)?;
    }
    if !keep.messages {
        clear(conn, MESSAGE_TABLES)?;
    }
    if !keep.history {
        clear(conn, HISTORY_TABLES)?;
    }
    conn.execute_batch("COMMIT")?;
    let agents = conn
        .prepare("SELECT id FROM nodes WHERE kind = 'agent' ORDER BY id")?
        .query_map([], |row| row.get::<_, i64>(0).map(|id| id.to_string()))?
        .collect::<Result<_, _>>()?;
    Ok((
        agents,
        count(conn, "todos")?,
        count(conn, "pads")?,
        count(conn, "messages")?,
        count(conn, "touches")?,
    ))
}
