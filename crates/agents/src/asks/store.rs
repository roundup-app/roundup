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
        // A killed placement is never called again. A pre-write typed claim also remains final.
        let placement = serde_json::to_string(&Place::Unclear {
            question: "roundup restarted before placing this".into(),
            candidates: vec![],
        })
        .expect("serializable placement");
        db.execute(
            "UPDATE ask_parts SET state='waiting', placement=? WHERE state='placing' AND json_extract(placement,'$.kind') != 'routed'",
            [placement],
        )?;
        db.execute("UPDATE ask_parts SET state='failed',reason='roundup restarted before delivering this' WHERE state='placing' AND json_extract(placement,'$.kind')='routed'", [])?;
        Ok(Self(db))
    }

    pub(super) fn list(&self) -> Result<Vec<Ask>, RpcError> {
        let mut stmt = self
            .0
            .prepare("SELECT asks.id, text, at, submission FROM asks LEFT JOIN ask_submissions ON ask=asks.id ORDER BY seq DESC")
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Ask {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    at: row.get(2)?,
                    submission: row.get(3)?,
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
        let id: Option<String> = self.0.query_row("SELECT asks.id FROM asks JOIN ask_parts ON ask_parts.ask=asks.id WHERE state='placing' AND json_extract(placement,'$.kind') IN ('unclear','routed') ORDER BY asks.seq LIMIT 1", [], |row|row.get(0)).optional().map_err(sql)?;
        id.map(|id| self.get(&id)).transpose()
    }

    pub(super) fn get(&self, id: &str) -> Result<Ask, RpcError> {
        let mut ask = self
            .0
            .query_row("SELECT asks.id,text,at,submission FROM asks LEFT JOIN ask_submissions ON ask=asks.id WHERE asks.id=?", [id], |row| {
                Ok(Ask {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    at: row.get(2)?,
                    submission: row.get(3)?,
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
        workstream: Option<&str>,
    ) -> Result<Option<Ask>, RpcError> {
        let stored: Option<(String, Option<String>)> = self
            .0
            .query_row(
                "SELECT ask,workstream FROM ask_submissions WHERE submission=?",
                [submission],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(sql)?;
        let Some((id, target)) = stored else {
            return Ok(None);
        };
        let ask = self.get(&id)?;
        if ask.text != text || target.as_deref() != workstream {
            return Err(RpcError::conflict(
                "Ask submission identity already holds different work",
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
        if let Some(submission) = &submission {
            tx.execute(
                "INSERT INTO ask_submissions (submission,ask,workstream) VALUES (?,?,?)",
                params![submission, id, workstream],
            )
            .map_err(sql)?;
        }
        let part = Part {
            text: text.clone(),
            placement: workstream.map_or_else(
                || Place::Unclear {
                    question: String::new(),
                    candidates: vec![],
                },
                |workstream| Place::Routed { workstream },
            ),
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
