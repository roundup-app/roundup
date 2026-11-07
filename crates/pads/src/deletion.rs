//! Transactional retention and restoration through the existing SQLite owner.
use super::*;
use crate::Error;
use contracts::agent::OperationKey;
use contracts::pad::{DeleteParams, Deletion, DeletionId, GetDeletionParams, RedoDeleteParams};
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::path::Path;
use storage::ledger::{self, Ledger, Refusal, Retained};

pub(super) fn cause(actor: &Actor) -> PadDeletion {
    if *actor == Actor::daemon() {
        PadDeletion::Cleanup
    } else {
        PadDeletion::User
    }
}

fn project(db: &Connection) -> Result<String, Error> {
    db.query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))
        .map_err(Error::internal)
}

/// The Daemon's own retention (cleanup, Rail removal) names its key here; the client contract never does.
fn fresh_key(db: &Connection) -> Result<OperationKey, Error> {
    let key: String = db
        .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(Error::internal)?;
    OperationKey::new(key).map_err(Error::internal)
}

fn operation(
    db: &Connection,
    id: &str,
    actor: &Actor,
) -> Result<Option<(Deletion, String)>, Error> {
    let row: Option<(String, String, String, bool)> = db
        .query_row(
            "SELECT actor, request, record, restored FROM pad_deletions WHERE operation=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(Error::internal)?;
    let Some((owner, request, record, restored)) = row else {
        return Ok(None);
    };
    let owner: Actor = serde_json::from_str(&owner).map_err(Error::internal)?;
    if owner != *actor {
        return Err(Error::forbidden("deletion belongs to another Actor"));
    }
    let mut deletion: Deletion = serde_json::from_str(&record).map_err(Error::internal)?;
    deletion.restored = restored;
    Ok(Some((deletion, request)))
}

/// Capture the authoritative chosen creation and check authority in the caller's
/// existing Project write transaction. No event or file effect is started here.
/// Rail coordination must retain before removing the row and commit its file guard last.
pub fn retain(db: &Transaction, actor: &Actor, p: &DeleteParams) -> Result<Deletion, Error> {
    name::validate(&p.name)?;
    let pad = source(db, &p.name)
        .map_err(Error::internal)?
        .ok_or_else(|| Error::not_found(format!("pad {}", p.name)))?
        .pad;
    if p.expected_incarnation
        .as_ref()
        .is_some_and(|id| id != &pad.incarnation)
    {
        return Err(Error::conflict("Pad creation changed"));
    }
    let operation = p.operation.as_str().to_owned();
    let receipt = Deletion {
        project: project(db)?,
        operation,
        pad: pad.clone(),
        restored: false,
    };
    let mut record = serde_json::to_value(&receipt).map_err(Error::internal)?;
    let names: String = db
        .query_row(
            "SELECT json_group_object(CAST(id AS TEXT),name) FROM nodes WHERE CAST(id AS TEXT) IN (?1)",
            rusqlite::params![pad.home],
            |r| r.get(0),
        )
        .map_err(Error::internal)?;
    record
        .as_object_mut()
        .ok_or_else(|| Error::internal("deletion record is not an object"))?
        .insert(
            "targetNames".into(),
            serde_json::from_str(&names).map_err(Error::internal)?,
        );
    db.execute("INSERT INTO pad_deletions(operation,actor,request,record,incarnation,pad_key) VALUES(?1,?2,?3,?4,?5,(SELECT key FROM pads WHERE key=?6))",
        rusqlite::params![receipt.operation, serde_json::to_string(actor).map_err(Error::internal)?,
            serde_json::to_string(p).map_err(Error::internal)?, serde_json::to_string(&record).map_err(Error::internal)?,
            pad.incarnation.parse::<i64>().map_err(Error::internal)?, store::key(&pad.name)]).map_err(Error::internal)?;
    Ok(receipt)
}

fn validate_targets(db: &Connection, home: Option<&str>, names: &str) -> Result<(), Error> {
    let names: serde_json::Value = serde_json::from_str(names).map_err(Error::internal)?;
    for (identity, is_home) in home.map(|id| (id, true)).into_iter() {
        let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=? AND (?=0 OR kind='workstream'))",rusqlite::params![identity,is_home],|r|r.get(0)).map_err(Error::internal)?;
        if !exists {
            return Err(Error::undo_parent(
                identity,
                names
                    .get(identity)
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Original Home"),
            ));
        }
    }
    Ok(())
}

/// Restore rows and consume the operation in an existing Project write transaction.
/// The coordinator validates retained Home existence and stages file mirrors
/// before committing. Refusal rolls back with the coordinator's other item changes.
pub fn restore(
    db: &Transaction,
    actor: &Actor,
    id: &DeletionId,
) -> Result<(Deletion, bool), Error> {
    let mut receipt = read(db, actor, id)?;
    if receipt.restored {
        return Ok((receipt, false));
    }
    let pad = &receipt.pad;
    let names: String = db.query_row("SELECT COALESCE(json_extract(record,'$.targetNames'),'{}') FROM pad_deletions WHERE operation=?",[&id.operation],|r|r.get(0)).map_err(Error::internal)?;
    validate_targets(db, pad.home.as_deref(), &names)?;
    let incarnation = pad.incarnation.parse::<i64>().map_err(Error::internal)?;
    let state = source_state(db, incarnation).map_err(Error::internal)?;
    if source(db, &pad.name).map_err(Error::internal)?.is_some() {
        return Err(Error::undo_pad_name(&pad.name));
    }
    if !matches!(state, PadSourceState::Deleted(_)) {
        return Err(Error::conflict(format!(
            "Can't undo: the original Pad \"{}\" is unavailable. This Undo cannot currently be completed; the deletion is retained.",
            pad.name
        )));
    }
    let original_key: String = db
        .query_row(
            "SELECT pad_key FROM pad_deletions WHERE operation=?1",
            [&id.operation],
            |r| r.get(0),
        )
        .map_err(Error::internal)?;
    // Reconnect before insertion, so the creation trigger keeps this incarnation.
    db.execute(
        "UPDATE pad_sources SET pad_key=?1, deletion=NULL WHERE incarnation=?2",
        rusqlite::params![original_key, incarnation],
    )
    .map_err(Error::internal)?;
    db.execute(
        "INSERT INTO pads(key,name,text,updated_at,home,revision) VALUES(?1,?2,?3,?4,?5,?6)",
        rusqlite::params![
            original_key,
            pad.name,
            pad.text,
            pad.updated_at,
            pad.home,
            i64::try_from(pad.revision).map_err(Error::internal)?
        ],
    )
    .map_err(Error::internal)?;
    db.execute(
        "UPDATE pad_deletions SET restored=1 WHERE operation=?1",
        [&id.operation],
    )
    .map_err(Error::internal)?;
    receipt.restored = true;
    Ok((receipt, true))
}

impl Pads {
    /// Delete within the Pad transaction, retaining the trusted deletion cause.
    pub(super) async fn delete(&self, ctx: &Ctx, p: DeleteParams) -> Result<Deletion, Error> {
        let cause = cause(&ctx.actor);
        let store = self.store()?;
        let mut files = RemovalFiles::default();
        let (receipt, changed) = store.atomically(|tx| {
            let actor = serde_json::to_string(&ctx.actor).map_err(Error::internal)?;
            let request = serde_json::to_string(&p).map_err(Error::internal)?;
            match ledger::retain(tx, Ledger::Pads, &actor, &p.operation, &request) {
                Ok(Retained::Replay(_)) => {
                    let (receipt, _) = operation(tx, &p.operation, &ctx.actor)?
                        .ok_or_else(|| Error::internal("deletion receipt vanished"))?;
                    return Ok((receipt, false));
                }
                Ok(Retained::Fresh) => {}
                Err(Refusal::Forbidden) => {
                    return Err(Error::forbidden("deletion belongs to another Actor"));
                }
                Err(Refusal::Conflict) => {
                    return Err(Error::conflict(
                        "deletion operation already used with different targets",
                    ));
                }
                Err(Refusal::Sql(error)) => return Err(Error::internal(error)),
            }
            let receipt = retain(tx, &ctx.actor, &p)?;
            let pad = &receipt.pad;
            store
                .record_deletion(&pad.name, cause)
                .map_err(Error::internal)?;
            found(store.delete(&pad.name), &pad.name)?;
            if store.files().map_err(Error::internal)? {
                files.stage(&self.files_dir, &pad.name)?;
            }
            Ok((receipt, true))
        })?;
        files.commit();
        if changed {
            wrote(ctx, &receipt.pad.name)?;
        }
        Ok(receipt)
    }

    pub(super) async fn redo_delete(
        &self,
        ctx: &Ctx,
        p: RedoDeleteParams,
    ) -> Result<Deletion, Error> {
        let store = self.store()?;
        let mut files = RemovalFiles::default();
        let (receipt, changed) = store.atomically(|tx| {
            if project(&store.db)? != p.project {
                return Err(Error::forbidden("deletion belongs to another Project"));
            }
            let request = serde_json::to_string(&p).map_err(Error::internal)?;
            if let Some((receipt, previous)) = operation(&store.db, &p.operation, &ctx.actor)? {
                if previous != request {
                    return Err(Error::conflict(
                        "deletion operation already used with different targets",
                    ));
                }
                return Ok((receipt, false));
            }
            let prior = read(
                &store.db,
                &ctx.actor,
                &DeletionId {
                    project: p.project.clone(),
                    operation: p.restored_operation.clone(),
                },
            )?;
            if !prior.restored || prior.pad.incarnation != p.expected_incarnation {
                return Err(Error::conflict("Redo requires the restored Pad creation"));
            }
            let incarnation = prior
                .pad
                .incarnation
                .parse::<i64>()
                .map_err(Error::internal)?;
            let PadSourceState::Live(source) =
                source_state(&store.db, incarnation).map_err(Error::internal)?
            else {
                return Err(Error::conflict("The restored Pad creation is unavailable"));
            };
            let current = source.pad;
            if current.incarnation != prior.pad.incarnation
                || current.name != prior.pad.name
                || current.revision != p.expected_revision
                || current.home != p.expected_home
            {
                return Err(Error::conflict(
                    "Pad changed since readback; read it before retrying Redo",
                ));
            }
            if store.files().map_err(Error::internal)?
                && super::files::read(&self.files_dir, &current.name)?
                    .is_some_and(|text| text != current.text)
            {
                return Err(Error::conflict(
                    "Pad mirror has external edits; import them before retrying Redo",
                ));
            }
            let receipt = retain(
                tx,
                &ctx.actor,
                &DeleteParams {
                    name: current.name.clone(),
                    operation: OperationKey::new(p.operation.as_str()).map_err(Error::internal)?,
                    expected_incarnation: Some(current.incarnation),
                },
            )?;
            store
                .db
                .execute(
                    "UPDATE pad_deletions SET request=?1 WHERE operation=?2",
                    rusqlite::params![request, p.operation],
                )
                .map_err(Error::internal)?;
            store
                .record_deletion(&current.name, cause(&ctx.actor))
                .map_err(Error::internal)?;
            found(store.delete(&current.name), &current.name)?;
            if store.files().map_err(Error::internal)? {
                files.stage(&self.files_dir, &current.name)?;
            }
            Ok((receipt, true))
        })?;
        files.commit();
        if changed {
            wrote(ctx, &receipt.pad.name)?;
        }
        Ok(receipt)
    }

    pub(super) async fn get_deletion(
        &self,
        ctx: &Ctx,
        id: GetDeletionParams,
    ) -> Result<Deletion, Error> {
        let store = self.store()?;
        let receipt = operation(&store.db, &id.operation, &ctx.actor)?
            .map(|(receipt, _)| receipt)
            .ok_or_else(|| Error::not_found("Pad deletion operation"))?;
        Ok(receipt)
    }

    /// The Daemon validates the retained Home before calling this method.
    pub(super) async fn restore(&self, ctx: &Ctx, id: DeletionId) -> Result<Deletion, Error> {
        let store = self.store()?;
        let mut mirror = None;
        let (receipt, changed) = store.atomically(|tx| {
            let (receipt, changed) = restore(tx, &ctx.actor, &id)?;
            if changed && store.files().map_err(Error::internal)? {
                mirror = Some(super::files::restore(
                    &self.files_dir,
                    &receipt.pad.name,
                    &receipt.pad.text,
                )?);
            }
            Ok((receipt, changed))
        })?;
        if let Some(file) = mirror {
            file.keep().map_err(Error::internal)?;
        }
        if changed {
            wrote(ctx, &receipt.pad.name)?;
        }
        Ok(receipt)
    }
}

fn read(db: &Connection, actor: &Actor, id: &DeletionId) -> Result<Deletion, Error> {
    if project(db)? != id.project {
        return Err(Error::forbidden("deletion belongs to another Project"));
    }
    operation(db, &id.operation, actor)?
        .map(|(receipt, _)| receipt)
        .ok_or_else(|| Error::not_found("Pad deletion operation"))
}

impl Pads {
    /// Retain a coordinator's already-authorized cascade, then use the existing A34
    /// removal and file rollback guard. Kept Pads retain their original incarnation/Home.
    pub fn retain_workstream(
        &self,
        db: &Transaction,
        actor: &Actor,
        operation: &str,
        home: &str,
        _removal: &contracts::agent::Removal,
    ) -> Result<(), Error> {
        let mut query = db
            .prepare("SELECT name FROM pads WHERE home=? ORDER BY key")
            .map_err(Error::internal)?;
        let names = query
            .query_map([home], |r| r.get::<_, String>(0))
            .map_err(Error::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Error::internal)?;
        for name in names {
            let pad = source(db, &name)
                .map_err(Error::internal)?
                .ok_or_else(|| Error::not_found("Pad"))?
                .pad;
            let participant = retain(
                db,
                actor,
                &DeleteParams {
                    name: pad.name.clone(),
                    operation: fresh_key(db)?,
                    expected_incarnation: Some(pad.incarnation.clone()),
                },
            )?
            .operation;
            db.execute("INSERT INTO rail_removal_items(operation,kind,id,home,incarnation,participant) VALUES(?,'pad',?,?,?,?)",rusqlite::params![operation,pad.name,pad.home,pad.incarnation,participant]).map_err(Error::internal)?;
        }
        Ok(())
    }

    /// Restore the same Pad creations and stage mirrors in the coordinator's transaction.
    /// Keep the returned paths only after commit; dropping them undoes every staged creation.
    pub fn restore_workstream_in(
        &self,
        db: &Transaction,
        actor: &Actor,
        operation: &str,
    ) -> Result<(Vec<tempfile::TempPath>, Vec<EventData>), Error> {
        let project = project(db)?;
        let mut query = db.prepare("SELECT id,participant FROM rail_removal_items WHERE operation=? AND kind='pad' ORDER BY id").map_err(Error::internal)?;
        let rows = query
            .query_map([operation], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(Error::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Error::internal)?;
        let mut files = Vec::new();
        let mut events = Vec::new();
        for (name, participant) in rows {
            let (receipt, changed) = restore(
                db,
                actor,
                &DeletionId {
                    project: project.clone(),
                    operation: participant,
                },
            )?;
            let enabled: bool = db
                .query_row(
                    "SELECT COALESCE((SELECT value='true' FROM pad_settings WHERE key='files'),0)",
                    [],
                    |r| r.get(0),
                )
                .map_err(Error::internal)?;
            if changed && enabled {
                files.push(super::files::restore(
                    &self.files_dir,
                    &receipt.pad.name,
                    &receipt.pad.text,
                )?);
            }
            events.push(EventData::PadChanged(PadName { name }));
        }
        let mut q=db.prepare("SELECT id,home,incarnation FROM rail_removal_items WHERE operation=? AND kind='pad-home'").map_err(Error::internal)?;
        let kept = q
            .query_map([operation], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(Error::internal)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Error::internal)?;
        for (name, home, incarnation) in kept {
            let changed=db.execute("UPDATE pads SET home=?2 WHERE name=?1 AND home IS NULL AND key=(SELECT pad_key FROM pad_sources WHERE CAST(incarnation AS TEXT)=?3)",rusqlite::params![name,home,incarnation]).map_err(Error::internal)?;
            if changed != 0 {
                events.push(EventData::PadChanged(PadName { name }));
            }
        }
        Ok((files, events))
    }

    /// A34: stage file deletions and change Pad rows in the coordinator's Project transaction.
    /// Dropping the returned guard restores the files; commit it only after the Rail commits.
    pub fn remove_workstream(
        &self,
        db: &rusqlite::Connection,
        home: &str,
        removal: &mut contracts::agent::Removal,
    ) -> Result<(RemovalFiles, Vec<EventData>), Error> {
        use contracts::agent::{RemovalKind, RemovedItem};
        let store = self.store()?;
        let pads = store.list().map_err(Error::internal)?;
        let files = store.files().map_err(Error::internal)?;
        let mut undo = RemovalFiles::default();
        let mut events = Vec::new();
        for pad in pads.into_iter().filter(|p| p.home.as_deref() == Some(home)) {
            if files {
                undo.stage(&self.files_dir, &pad.name)?;
            }
            db.execute("DELETE FROM pads WHERE key = ?", [store::key(&pad.name)])
                .map_err(Error::internal)?;
            removal.removed.push(RemovedItem {
                id: pad.name.clone(),
                kind: RemovalKind::Pad,
                name: pad.name.clone(),
            });
            events.push(EventData::PadDeleted(PadName { name: pad.name }));
        }
        Ok((undo, events))
    }
}

impl RemovalFiles {
    pub(super) fn stage(&mut self, dir: &Path, name: &str) -> Result<(), Error> {
        let path = dir.join(format!("{name}.md"));
        match std::fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(Error::internal(e)),
            Ok(meta) if meta.is_dir() => {
                return Err(Error::internal(format!(
                    "pad file {name}.md is a directory"
                )));
            }
            Ok(_) => {}
        }
        let backup = tempfile::NamedTempFile::new_in(dir)
            .map_err(Error::internal)?
            .into_temp_path();
        std::fs::rename(&path, &backup).map_err(Error::internal)?;
        self.files.push((path, backup));
        Ok(())
    }

    /// The coordinated database commit succeeded; dropping the backups now completes deletion.
    pub fn commit(mut self) {
        self.committed = true;
    }
}

impl Drop for RemovalFiles {
    fn drop(&mut self) {
        if !self.committed {
            for (path, backup) in self.files.iter().rev() {
                if let Err(err) = std::fs::rename(backup, path) {
                    eprintln!("cannot restore staged Pad file {}: {err}", path.display());
                }
            }
        }
    }
}

impl Pads {
    /// Stage only the retained Pad incarnations in the coordinator's transaction.
    pub fn redo_workstream_in(
        &self,
        db: &Transaction,
        actor: &Actor,
        prior: &str,
        operation: &str,
        removed: &[String],
    ) -> Result<(RemovalFiles, Vec<EventData>), Error> {
        let mut q=db.prepare("SELECT id,incarnation FROM rail_removal_items WHERE operation=? AND kind='pad' ORDER BY id").map_err(Error::internal)?;
        let rows = q
            .query_map([prior], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(Error::internal)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Error::internal)?;
        let mut files = RemovalFiles::default();
        let mut events = Vec::new();
        let store = self.store()?;
        let enabled = store.files().map_err(Error::internal)?;
        for (name, incarnation) in rows {
            let pad = source(db, &name)
                .map_err(Error::internal)?
                .ok_or_else(|| Error::conflict("Restored Pad is unavailable"))?
                .pad;
            if enabled
                && super::files::read(&self.files_dir, &name)?.is_some_and(|text| text != pad.text)
            {
                return Err(Error::conflict(
                    "Pad mirror has external edits; import them before retrying Redo",
                ));
            }
            let participant = retain(
                db,
                actor,
                &DeleteParams {
                    name: name.clone(),
                    operation: fresh_key(db)?,
                    expected_incarnation: Some(incarnation.clone()),
                },
            )?
            .operation;
            db.execute("INSERT INTO rail_removal_items(operation,kind,id,home,incarnation,participant) VALUES(?,'pad',?,?,?,?)",rusqlite::params![operation,name,pad.home,incarnation,participant]).map_err(Error::internal)?;
            if enabled {
                files.stage(&self.files_dir, &name)?;
            }
            db.execute("DELETE FROM pads WHERE name=?", [&name])
                .map_err(Error::internal)?;
            events.push(EventData::PadDeleted(PadName { name }));
        }
        db.execute("INSERT INTO rail_removal_items(operation,kind,id,home,incarnation) SELECT ?2,'pad-home',p.name,p.home,CAST(s.incarnation AS TEXT) FROM pads p JOIN pad_sources s ON s.pad_key=p.key WHERE p.home IN (SELECT value FROM json_each(?1))",rusqlite::params![serde_json::to_string(removed).map_err(Error::internal)?,operation]).map_err(Error::internal)?;
        let mut q = db
            .prepare("SELECT id FROM rail_removal_items WHERE operation=? AND kind='pad-home'")
            .map_err(Error::internal)?;
        let kept = q
            .query_map([operation], |r| r.get::<_, String>(0))
            .map_err(Error::internal)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Error::internal)?;
        for name in kept {
            events.push(EventData::PadChanged(PadName { name }));
        }
        db.execute("UPDATE pads SET home=NULL WHERE name IN (SELECT id FROM rail_removal_items WHERE operation=? AND kind='pad-home')",[operation]).map_err(Error::internal)?;
        Ok((files, events))
    }
}
