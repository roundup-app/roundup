use super::*;
use rusqlite::{Connection, OptionalExtension, params};

pub(super) struct Store(pub(super) Connection);

impl Store {
    pub(super) fn open(dir: &Path) -> Result<Self, OpenError> {
        let path = dir.join(if dir.join("project.db").exists() {
            "project.db"
        } else {
            "agents.db"
        });
        let db = Connection::open(&path)?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS ask_intake (
            ask TEXT PRIMARY KEY REFERENCES asks(id),
            submission TEXT UNIQUE,
            workstream TEXT
        )",
        )?;
        // A killed placement is never called again. A pre-write typed claim also remains final.
        let placement = serde_json::to_string(&Place::Unclear {
            question: "roundup restarted before placing this".into(),
            candidates: vec![],
        })
        .expect("serializable placement");
        db.execute(
            "UPDATE ask_parts SET state='waiting', placement=? WHERE state='placing'",
            [placement],
        )?;
        Ok(Self(db))
    }

    pub(super) fn list(&self) -> Result<Vec<Ask>, RpcError> {
        let mut stmt = self
            .0
            .prepare("SELECT asks.id, text, at, submission, workstream FROM asks LEFT JOIN ask_intake ON ask_intake.ask=asks.id ORDER BY seq DESC")
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Ask {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    at: row.get(2)?,
                    submission: row.get(3)?,
                    workstream: row.get(4)?,
                    parts: vec![],
                })
            })
            .map_err(sql)?;
        let mut asks = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(sql)?;
        for ask in &mut asks {
            ask.parts = self.parts(&ask.id)?;
        }
        Ok(asks)
    }

    fn parts(&self, id: &str) -> Result<Vec<Part>, RpcError> {
        let mut stmt = self
            .0
            .prepare(
                "SELECT text, placement, state, reason FROM ask_parts WHERE ask=? ORDER BY ord",
            )
            .map_err(sql)?;
        let rows = stmt
            .query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(sql)?;
        rows.map(|row| {
            let (text, placement, state, reason) = row.map_err(sql)?;
            Ok(Part {
                text,
                placement: serde_json::from_str(&placement).map_err(RpcError::internal)?,
                state: serde_json::from_value(Value::String(state)).map_err(RpcError::internal)?,
                reason,
            })
        })
        .collect()
    }

    pub(super) fn next_placing(&self) -> Result<Option<Ask>, RpcError> {
        let id: Option<String> = self.0.query_row("SELECT asks.id FROM asks JOIN ask_parts ON ask_parts.ask=asks.id WHERE state='placing' AND json_extract(placement,'$.kind')='unclear' ORDER BY asks.seq LIMIT 1", [], |row|row.get(0)).optional().map_err(sql)?;
        id.map(|id| self.get(&id)).transpose()
    }

    pub(super) fn get(&self, id: &str) -> Result<Ask, RpcError> {
        let mut ask = self
            .0
            .query_row("SELECT asks.id,text,at,submission,workstream FROM asks LEFT JOIN ask_intake ON ask_intake.ask=asks.id WHERE asks.id=?", [id], |row| {
                Ok(Ask {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    at: row.get(2)?,
                    submission: row.get(3)?,
                    workstream: row.get(4)?,
                    parts: vec![],
                })
            })
            .optional()
            .map_err(sql)?
            .ok_or_else(|| RpcError::not_found(format!("Ask {id}")))?;
        ask.parts = self.parts(id)?;
        Ok(ask)
    }

    pub(super) fn replay(
        &self,
        submission: &str,
        text: &str,
        workstream: &Option<String>,
    ) -> Result<Option<Ask>, RpcError> {
        let id: Option<String> = self
            .0
            .query_row(
                "SELECT ask FROM ask_intake WHERE submission=?",
                [submission],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?;
        let Some(id) = id else { return Ok(None) };
        let ask = self.get(&id)?;
        if ask.text != text || &ask.workstream != workstream {
            return Err(RpcError::conflict(
                "submission already names different Ask content or destination",
            ));
        }
        Ok(Some(ask))
    }

    pub(super) fn insert(
        &mut self,
        text: String,
        at: i64,
        submission: Option<String>,
        workstream: Option<String>,
    ) -> Result<Ask, RpcError> {
        let tx = self.0.transaction().map_err(sql)?;
        let id: String = tx
            .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
            .map_err(sql)?;
        tx.execute(
            "INSERT INTO asks (id,text,at) VALUES (?,?,?)",
            params![id, text, at],
        )
        .map_err(sql)?;
        tx.execute(
            "INSERT INTO ask_intake (ask,submission,workstream) VALUES (?,?,?)",
            params![id, submission, workstream],
        )
        .map_err(sql)?;
        let part = Part {
            text: text.clone(),
            placement: Place::Unclear {
                question: String::new(),
                candidates: vec![],
            },
            state: State::Placing,
            reason: None,
        };
        write_part(&tx, &id, 0, &part)?;
        tx.commit().map_err(sql)?;
        Ok(Ask {
            id,
            text,
            at,
            submission,
            workstream,
            parts: vec![part],
        })
    }

    pub(super) fn replace(&mut self, id: &str, parts: &[Part]) -> Result<(), RpcError> {
        let tx = self.0.transaction().map_err(sql)?;
        tx.execute("DELETE FROM ask_parts WHERE ask=?", [id])
            .map_err(sql)?;
        for (ord, part) in parts.iter().enumerate() {
            write_part(&tx, id, ord, part)?;
        }
        tx.commit().map_err(sql)
    }

    pub(super) fn update(
        &mut self,
        id: &str,
        ord: usize,
        part: &Part,
        from: State,
    ) -> Result<bool, RpcError> {
        let changed = self.0.execute("UPDATE ask_parts SET placement=?,state=?,reason=? WHERE ask=? AND ord=? AND state=?",
            params![serde_json::to_string(&part.placement).map_err(RpcError::internal)?, state(part.state), part.reason, id, i64::try_from(ord).map_err(RpcError::internal)?, state(from)]).map_err(sql)?;
        Ok(changed == 1)
    }
}

fn state(state: State) -> String {
    serde_json::to_value(state)
        .expect("serializable state")
        .as_str()
        .expect("string state")
        .into()
}
fn write_part(db: &Connection, id: &str, ord: usize, part: &Part) -> Result<(), RpcError> {
    db.execute(
        "INSERT INTO ask_parts (ask,ord,text,placement,state,reason) VALUES (?,?,?,?,?,?)",
        params![
            id,
            i64::try_from(ord).map_err(RpcError::internal)?,
            part.text,
            serde_json::to_string(&part.placement).map_err(RpcError::internal)?,
            state(part.state),
            part.reason
        ],
    )
    .map_err(sql)?;
    Ok(())
}
fn sql(error: rusqlite::Error) -> RpcError {
    RpcError::internal(error)
}
