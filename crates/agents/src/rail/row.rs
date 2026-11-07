//! The one typed mapping of a `nodes` row: `NodeRow` reads it, `NewAgent` writes an Agent.
use super::*;
use contracts::agent::{Ordinal, RailVisibility, SpawnRole};
use rusqlite::{
    Row,
    types::{FromSql, FromSqlError, FromSqlResult, ValueRef},
};
use serde::de::{DeserializeOwned, IntoDeserializer, value::StrDeserializer};

/// A column holding one serde word of `T`; a stored text `T` does not name fails the read.
pub(super) struct Word<T>(pub T);

impl<T: DeserializeOwned> FromSql for Word<T> {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text: StrDeserializer<'_, serde::de::value::Error> =
            value.as_str()?.into_deserializer();
        T::deserialize(text)
            .map(Word)
            .map_err(|error| FromSqlError::Other(Box::new(error)))
    }
}

/// A column holding one JSON document; a document `T` does not read fails the read.
struct Json<T>(T);

impl<T: DeserializeOwned> FromSql for Json<T> {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        serde_json::from_slice(value.as_bytes()?)
            .map(Json)
            .map_err(|error| FromSqlError::Other(Box::new(error)))
    }
}

/// The stored spelling of a unit enum: its serde word.
fn word(value: &impl serde::Serialize) -> Result<String, StoreError> {
    match serde_json::to_value(value)? {
        serde_json::Value::String(word) => Ok(word),
        other => Err(StoreError::internal(format!("{other} is not a word"))),
    }
}

/// The columns `load_with` selects, in `NodeRow::read`'s order.
pub(super) const COLUMNS: &str = "SELECT id, kind, name, parent, ord, attempt, terminal_id,
                worktree_path, worktree_branch, worktree_base, work, model, effort,
                conversation_id, conversation_cwd, auto, finished, opening_prompt, alert_level, start_attribution, visibility FROM nodes";

/// One stored node, before live Agent facts are applied.
pub(super) struct NodeRow {
    id: i64,
    kind: NodeKind,
    name: String,
    parent: Option<i64>,
    order: u32,
    attempt: i64,
    terminal_id: Option<String>,
    worktree: Option<Worktree>,
    work: Option<Order>,
    model: Option<String>,
    effort: Option<String>,
    can_resume: bool,
    auto: bool,
    pub finished: u64,
    opening_prompt: Option<String>,
    alert_level: contracts::agent::AlertLevel,
    start_attribution: Option<StartAttribution>,
    visibility: RailVisibility,
}

impl NodeRow {
    pub(super) fn read(row: &Row<'_>) -> rusqlite::Result<Self> {
        let worktree = match (
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
        ) {
            (Some(path), Some(branch), Some(base)) => Some(Worktree { path, branch, base }),
            _ => None,
        };
        Ok(Self {
            id: row.get(0)?,
            kind: row.get::<_, Word<NodeKind>>(1)?.0,
            name: row.get(2)?,
            parent: row.get(3)?,
            order: row.get(4)?,
            attempt: row.get(5)?,
            terminal_id: row.get(6)?,
            worktree,
            // An unreadable stored Order reads as none, as before.
            work: row
                .get_ref(10)?
                .as_str_or_null()?
                .and_then(|json| serde_json::from_str(json).ok()),
            model: row.get(11)?,
            effort: row.get(12)?,
            // R3696c: SQL null predicates cost 280 extra VM steps per forty nodes.
            // Borrow the fields without copying conversation text; presentation gates
            // availability on the live Attempt (R16).
            can_resume: !matches!(row.get_ref(13)?, ValueRef::Null)
                && !matches!(row.get_ref(14)?, ValueRef::Null),
            auto: row.get(15)?,
            finished: row.get::<_, i64>(16)?.cast_unsigned(),
            opening_prompt: row.get(17)?,
            alert_level: row.get::<_, Json<_>>(18)?.0,
            start_attribution: row
                .get_ref(19)?
                .as_str_or_null()?
                .map(|_| row.get::<_, Json<_>>(19).map(|json| json.0))
                .transpose()?,
            visibility: row.get::<_, Word<RailVisibility>>(20)?.0,
        })
    }

    pub(super) fn into_node(self) -> RailNode {
        let kind = self.kind;
        let work = match kind {
            NodeKind::Workstream => Some(self.work.unwrap_or_else(workstream_order)),
            NodeKind::Agent => self.work,
            NodeKind::Group => None,
        };
        let workstream = kind == NodeKind::Workstream;
        RailNode {
            workstream_state: None,
            waiting: None,
            unreachable: None,
            resume: None,
            start_attribution: self.start_attribution,
            visibility: self.visibility,
            alert_level: self.alert_level,
            opening_prompt: self.opening_prompt.filter(|_| workstream),
            auto: workstream.then_some(self.auto),
            id: self.id.to_string(),
            kind,
            name: self.name,
            parent: self.parent.map(|id| id.to_string()),
            order: self.order,
            status: None,
            status_revision: None,
            final_text: None,
            attempt: Ordinal::new(self.attempt),
            terminal_id: self.terminal_id,
            worktree: self.worktree,
            can_resume: self.can_resume,
            can_make_workstream: false,
            can_save_as_mode: false,
            yolo: false,
            channel: None,
            stray: Vec::new(),
            work,
            model: self.model,
            effort: self.effort,
            inbox: None,
            tool_call: None,
            overview: None,
        }
    }
}

/// A new Agent, every column it starts with.
pub struct NewAgent<'a> {
    pub name: &'a str,
    pub parent: Option<&'a str>,
    pub work: Option<&'a Order>,
    pub start_attribution: Option<&'a StartAttribution>,
    pub visibility: RailVisibility,
    pub spawn_prompt: Option<&'a str>,
    /// O13: the Agent that started it.
    pub spawner: Option<&'a str>,
    pub role: Option<SpawnRole>,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

impl Rail {
    /// Append an Agent with all its columns in one statement and one transaction; a failed write
    /// leaves no node.
    pub fn insert_agent(&mut self, new: NewAgent<'_>) -> Result<RailNode, StoreError> {
        let work = new.work.map(serde_json::to_string).transpose()?;
        let start_attribution = new
            .start_attribution
            .map(serde_json::to_string)
            .transpose()?;
        let role = new.role.map(|role| role.as_str());
        let visibility = word(&new.visibility)?;
        let tx = self.db.transaction()?;
        let nodes = load(&tx)?;
        check_parent(&nodes, NodeKind::Agent, new.parent)?;
        let order = siblings(&nodes, new.parent).len() as i64;
        tx.execute(
            "INSERT INTO nodes (kind, name, parent, ord, work, start_attribution, visibility,
                    spawn_prompt, spawner, role, model, effort)
                VALUES ('agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                new.name,
                new.parent,
                order,
                work,
                start_attribution,
                visibility,
                new.spawn_prompt,
                new.spawner,
                role,
                new.model,
                new.effort,
            ],
        )?;
        let id = tx.last_insert_rowid().to_string();
        tx.commit()?;
        self.node(&id)
    }
}
