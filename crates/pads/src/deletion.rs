//! Transactional retention and restoration through the existing SQLite owner.
use super::*;
use contracts::pad::{DeleteParams, Deletion, DeletionId, GetDeletionParams, RedoDeleteParams};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

fn project(db: &Connection) -> Result<String, RpcError> {
    db.query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))
        .map_err(RpcError::internal)
}

fn operation(
    db: &Connection,
    id: &str,
    actor: &Actor,
) -> Result<Option<(Deletion, String)>, RpcError> {
    let row: Option<(String, String, String, bool)> = db
        .query_row(
            "SELECT actor, request, record, restored FROM pad_deletions WHERE operation=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(RpcError::internal)?;
    let Some((owner, request, record, restored)) = row else {
        return Ok(None);
    };
    let owner: Actor = serde_json::from_str(&owner).map_err(RpcError::internal)?;
    if owner != *actor {
        return Err(RpcError::forbidden("deletion belongs to another Actor"));
    }
    let mut deletion: Deletion = serde_json::from_str(&record).map_err(RpcError::internal)?;
    deletion.restored = restored;
    Ok(Some((deletion, request)))
}

/// Capture the authoritative chosen creation and check authority in the caller's
/// existing Project write transaction. No event or file effect is started here.
/// Rail coordination must retain before removing the row and commit its file guard last.
pub fn retain(db: &Connection, actor: &Actor, p: &DeleteParams) -> Result<Deletion, RpcError> {
    if db.is_autocommit() {
        return Err(RpcError::internal("Pad retention requires a transaction"));
    }
    name::validate(&p.name)?;
    let pad = source(db, &p.name)
        .map_err(RpcError::internal)?
        .ok_or_else(|| RpcError::not_found(format!("pad {}", p.name)))?
        .pad;
    require_owner_or_user(actor, &pad, "delete")?;
    if p.expected_incarnation
        .as_ref()
        .is_some_and(|id| id != &pad.incarnation)
    {
        return Err(RpcError::conflict("Pad creation changed"));
    }
    let operation = match &p.operation {
        Some(id) if !id.is_empty() && id.len() <= 256 => id.clone(),
        Some(_) => {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "invalid deletion operation",
            ));
        }
        None => db
            .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
            .map_err(RpcError::internal)?,
    };
    let receipt = Deletion {
        project: project(db)?,
        operation,
        pad: pad.clone(),
        restored: false,
    };
    let mut record = serde_json::to_value(&receipt).map_err(RpcError::internal)?;
    let has_nodes: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='nodes')",
            [],
            |r| r.get(0),
        )
        .map_err(RpcError::internal)?;
    if has_nodes {
        let names: String = db
            .query_row(
                "SELECT json_group_object(CAST(id AS TEXT),name) FROM nodes WHERE CAST(id AS TEXT) IN (?1,?2)",
                rusqlite::params![pad.home, pad.owner.id],
                |r| r.get(0),
            )
            .map_err(RpcError::internal)?;
        record["targetNames"] = serde_json::from_str(&names).map_err(RpcError::internal)?;
    }
    db.execute("INSERT INTO pad_deletions(operation,actor,request,record,incarnation,pad_key) VALUES(?1,?2,?3,?4,?5,(SELECT key FROM pads WHERE key=?6))",
        rusqlite::params![receipt.operation, serde_json::to_string(actor).map_err(RpcError::internal)?,
            serde_json::to_string(p).map_err(RpcError::internal)?, serde_json::to_string(&record).map_err(RpcError::internal)?,
            pad.incarnation.parse::<i64>().map_err(RpcError::internal)?, store::key(&pad.name)]).map_err(RpcError::internal)?;
    Ok(receipt)
}

fn validate_targets(
    db: &Connection,
    home: Option<&str>,
    owner: &Actor,
    names: &str,
) -> Result<(), RpcError> {
    let names: serde_json::Value = serde_json::from_str(names).map_err(RpcError::internal)?;
    for (identity, is_home) in home
        .map(|id| (id, true))
        .into_iter()
        .chain((owner.kind == ActorKind::Agent).then_some((owner.id.as_str(), false)))
    {
        let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=? AND (?=0 OR kind='workstream'))",rusqlite::params![identity,is_home],|r|r.get(0)).map_err(RpcError::internal)?;
        if !exists {
            return Err(RpcError::undo_parent(
                identity,
                names[identity].as_str().unwrap_or("Original Home or owner"),
            ));
        }
    }
    Ok(())
}

/// Restore rows and consume the operation in an existing Project write transaction.
/// The coordinator validates retained Home/owner existence and stages file mirrors
/// before committing. Refusal rolls back with the coordinator's other item changes.
pub fn restore(
    db: &Connection,
    actor: &Actor,
    id: &DeletionId,
) -> Result<(Deletion, bool), RpcError> {
    if db.is_autocommit() {
        return Err(RpcError::internal("Pad restoration requires a transaction"));
    }
    let mut receipt = read(db, actor, id)?;
    if receipt.restored {
        return Ok((receipt, false));
    }
    require_owner_or_user(actor, &receipt.pad, "restore")?;
    let pad = &receipt.pad;
    let has_nodes: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='nodes')",
            [],
            |r| r.get(0),
        )
        .map_err(RpcError::internal)?;
    if has_nodes {
        let names: String = db.query_row("SELECT COALESCE(json_extract(record,'$.targetNames'),'{}') FROM pad_deletions WHERE operation=?",[&id.operation],|r|r.get(0)).map_err(RpcError::internal)?;
        validate_targets(db, pad.home.as_deref(), &pad.owner, &names)?;
    }
    let incarnation = pad.incarnation.parse::<i64>().map_err(RpcError::internal)?;
    let state = source_state(db, incarnation).map_err(RpcError::internal)?;
    if source(db, &pad.name).map_err(RpcError::internal)?.is_some() {
        return Err(RpcError::undo_pad_name(&pad.name));
    }
    if !matches!(state, PadSourceState::Deleted(_)) {
        return Err(RpcError::conflict(format!(
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
        .map_err(RpcError::internal)?;
    // Reconnect before insertion, so the creation trigger keeps this incarnation.
    db.execute(
        "UPDATE pad_sources SET pad_key=?1, deletion=NULL WHERE incarnation=?2",
        rusqlite::params![original_key, incarnation],
    )
    .map_err(RpcError::internal)?;
    db.execute("INSERT INTO pads(key,name,owner,text,updated_at,home,revision) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![original_key,pad.name,serde_json::to_string(&pad.owner).map_err(RpcError::internal)?,pad.text,pad.updated_at,pad.home,i64::try_from(pad.revision).map_err(RpcError::internal)?]).map_err(RpcError::internal)?;
    db.execute(
        "UPDATE pad_deletions SET restored=1 WHERE operation=?1",
        [&id.operation],
    )
    .map_err(RpcError::internal)?;
    receipt.restored = true;
    Ok((receipt, true))
}

impl Pads {
    /// Delete within the Pad transaction, retaining the trusted deletion cause.
    pub fn delete(
        &self,
        ctx: &Ctx,
        p: DeleteParams,
        cause: PadDeletion,
    ) -> Result<Value, RpcError> {
        let store = self.store()?;
        let mut files = RemovalFiles::default();
        let (receipt, changed) = store.atomically(|| {
            if let Some(id) = &p.operation
                && let Some((receipt, request)) = operation(&store.db, id, &ctx.actor)?
            {
                if request != serde_json::to_string(&p).map_err(RpcError::internal)? {
                    return Err(RpcError::conflict(
                        "deletion operation already used with different targets",
                    ));
                }
                return Ok((receipt, false));
            }
            let receipt = retain(&store.db, &ctx.actor, &p)?;
            let pad = &receipt.pad;
            store
                .record_deletion(&pad.name, cause)
                .map_err(RpcError::internal)?;
            found(store.delete(&pad.name), &pad.name)?;
            if store.files().map_err(RpcError::internal)? {
                files.stage(&self.files_dir, &pad.name)?;
            }
            Ok((receipt, true))
        })?;
        files.commit();
        if changed {
            wrote(ctx, &receipt.pad.name)?;
        }
        reply(&receipt)
    }

    pub(super) fn redo_delete(&self, ctx: &Ctx, p: RedoDeleteParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let mut files = RemovalFiles::default();
        let (receipt, changed) = store.atomically(|| {
            if project(&store.db)? != p.project {
                return Err(RpcError::forbidden("deletion belongs to another Project"));
            }
            let request = serde_json::to_string(&p).map_err(RpcError::internal)?;
            if let Some((receipt, previous)) = operation(&store.db, &p.operation, &ctx.actor)? {
                if previous != request {
                    return Err(RpcError::conflict(
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
                return Err(RpcError::conflict(
                    "Redo requires the restored Pad creation",
                ));
            }
            let incarnation = prior
                .pad
                .incarnation
                .parse::<i64>()
                .map_err(RpcError::internal)?;
            let PadSourceState::Live(source) =
                source_state(&store.db, incarnation).map_err(RpcError::internal)?
            else {
                return Err(RpcError::conflict(
                    "The restored Pad creation is unavailable",
                ));
            };
            let current = source.pad;
            require_owner_or_user(&ctx.actor, &current, "delete")?;
            if current.incarnation != prior.pad.incarnation
                || current.name != prior.pad.name
                || current.revision != p.expected_revision
                || current.home != p.expected_home
            {
                return Err(RpcError::conflict(
                    "Pad changed since readback; read it before retrying Redo",
                ));
            }
            if store.files().map_err(RpcError::internal)?
                && super::files::read(&self.files_dir, &current.name)?
                    .is_some_and(|text| text != current.text)
            {
                return Err(RpcError::conflict(
                    "Pad mirror has external edits; import them before retrying Redo",
                ));
            }
            let receipt = retain(
                &store.db,
                &ctx.actor,
                &DeleteParams {
                    name: current.name.clone(),
                    operation: Some(p.operation.clone()),
                    expected_incarnation: Some(current.incarnation),
                },
            )?;
            store
                .db
                .execute(
                    "UPDATE pad_deletions SET request=?1 WHERE operation=?2",
                    rusqlite::params![request, p.operation],
                )
                .map_err(RpcError::internal)?;
            let cause = if ctx.actor.kind == ActorKind::User {
                PadDeletion::User
            } else if ctx.actor == Actor::daemon() {
                PadDeletion::Cleanup
            } else {
                PadDeletion::Owner
            };
            store
                .record_deletion(&current.name, cause)
                .map_err(RpcError::internal)?;
            found(store.delete(&current.name), &current.name)?;
            if store.files().map_err(RpcError::internal)? {
                files.stage(&self.files_dir, &current.name)?;
            }
            Ok((receipt, true))
        })?;
        files.commit();
        if changed {
            wrote(ctx, &receipt.pad.name)?;
        }
        reply(&receipt)
    }

    pub(super) fn get_deletion(&self, ctx: &Ctx, id: GetDeletionParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let receipt = operation(&store.db, &id.operation, &ctx.actor)?
            .map(|(receipt, _)| receipt)
            .ok_or_else(|| RpcError::not_found("Pad deletion operation"))?;
        reply(&receipt)
    }

    /// The Daemon validates the retained Home and owner before calling this method.
    pub(super) fn restore(&self, ctx: &Ctx, id: DeletionId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let mut mirror = None;
        let (receipt, changed) = store.atomically(|| {
            let (receipt, changed) = restore(&store.db, &ctx.actor, &id)?;
            if changed && store.files().map_err(RpcError::internal)? {
                mirror = Some(super::files::restore(
                    &self.files_dir,
                    &receipt.pad.name,
                    &receipt.pad.text,
                )?);
            }
            Ok((receipt, changed))
        })?;
        if let Some(file) = mirror {
            file.keep().map_err(RpcError::internal)?;
        }
        if changed {
            wrote(ctx, &receipt.pad.name)?;
        }
        reply(&receipt)
    }
}

fn read(db: &Connection, actor: &Actor, id: &DeletionId) -> Result<Deletion, RpcError> {
    if project(db)? != id.project {
        return Err(RpcError::forbidden("deletion belongs to another Project"));
    }
    operation(db, &id.operation, actor)?
        .map(|(receipt, _)| receipt)
        .ok_or_else(|| RpcError::not_found("Pad deletion operation"))
}

impl Pads {
    /// Retain a coordinator's already-authorized cascade, then use the existing A34
    /// removal and file rollback guard. Kept Pads retain their original incarnation/Home.
    pub fn retain_workstream(
        &self,
        db: &Connection,
        actor: &Actor,
        operation: &str,
        home: &str,
        removal: &contracts::agent::Removal,
    ) -> Result<(), RpcError> {
        let mut query = db
            .prepare("SELECT name FROM pads WHERE home=? ORDER BY key")
            .map_err(RpcError::internal)?;
        let names = query
            .query_map([home], |r| r.get::<_, String>(0))
            .map_err(RpcError::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(RpcError::internal)?;
        for name in names {
            let pad = source(db, &name)
                .map_err(RpcError::internal)?
                .ok_or_else(|| RpcError::not_found("Pad"))?
                .pad;
            let kept = pad.owner.kind == ActorKind::Agent
                && removal.kept.iter().any(|i| {
                    i.kind == contracts::agent::RemovalKind::Agent && i.id == pad.owner.id
                });
            let kind = if kept { "pad-home" } else { "pad" };
            let participant = if kept {
                None
            } else {
                Some(
                    retain(
                        db,
                        actor,
                        &DeleteParams {
                            name: pad.name.clone(),
                            operation: None,
                            expected_incarnation: Some(pad.incarnation.clone()),
                        },
                    )?
                    .operation,
                )
            };
            db.execute("INSERT INTO rail_removal_items(operation,kind,id,home,owner,incarnation,participant) VALUES(?,?,?,?,?,?,?)",rusqlite::params![operation,kind,pad.name,pad.home,serde_json::to_string(&pad.owner).map_err(RpcError::internal)?,pad.incarnation,participant]).map_err(RpcError::internal)?;
        }
        Ok(())
    }

    /// Restore the same Pad creations and stage mirrors in the coordinator's transaction.
    /// Keep the returned paths only after commit; dropping them undoes every staged creation.
    pub fn restore_workstream_in(
        &self,
        db: &Connection,
        actor: &Actor,
        operation: &str,
    ) -> Result<(Vec<tempfile::TempPath>, Vec<EventData>), RpcError> {
        let project = project(db)?;
        let mut query = db.prepare("SELECT kind,id,home,owner,incarnation,participant FROM rail_removal_items WHERE operation=? AND kind IN ('pad','pad-home') ORDER BY id").map_err(RpcError::internal)?;
        let rows = query
            .query_map([operation], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(RpcError::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(RpcError::internal)?;
        let mut files = Vec::new();
        let mut events = Vec::new();
        for (kind, name, home, owner, incarnation, participant) in rows {
            let original_owner: Actor = serde_json::from_str(&owner).map_err(RpcError::internal)?;
            if kind == "pad-home" {
                let current = source(db, &name)
                    .map_err(RpcError::internal)?
                    .ok_or_else(|| {
                        RpcError::conflict(format!(
                            "Can't undo: Pad \"{name}\" was removed too. Undo that removal first."
                        ))
                    })?
                    .pad;
                if current.incarnation != incarnation {
                    return Err(RpcError::conflict(format!(
                        "Can't undo: the original Pad \"{}\" was replaced. This Undo cannot currently be completed; the deletion is retained.",
                        current.name
                    )));
                }
                if current.home.is_some()
                    || serde_json::to_string(&current.owner).map_err(RpcError::internal)? != owner
                {
                    continue;
                }
                let names: String = db.query_row("SELECT json_group_object(json_extract(value,'$.id'),json_extract(value,'$.name')) FROM rail_deletions,json_each(json_extract(boundary,'$.before')) WHERE operation=?",[operation],|r|r.get(0)).map_err(RpcError::internal)?;
                validate_targets(db, home.as_deref(), &original_owner, &names)?;
                db.execute(
                    "UPDATE pads SET home=? WHERE key=?",
                    rusqlite::params![home, store::key(&name)],
                )
                .map_err(RpcError::internal)?;
            } else {
                let (receipt, changed) = restore(
                    db,
                    actor,
                    &DeletionId {
                        project: project.clone(),
                        operation: participant
                            .ok_or_else(|| RpcError::internal("missing Pad participant"))?,
                    },
                )?;
                let enabled:bool=db.query_row("SELECT COALESCE((SELECT value='true' FROM pad_settings WHERE key='files'),0)",[],|r|r.get(0)).map_err(RpcError::internal)?;
                if changed && enabled {
                    files.push(super::files::restore(
                        &self.files_dir,
                        &receipt.pad.name,
                        &receipt.pad.text,
                    )?);
                }
            }
            events.push(EventData::PadChanged(PadName { name }));
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
    ) -> Result<(RemovalFiles, Vec<EventData>), RpcError> {
        use contracts::agent::{KeptItem, RemovalKind, RemovedItem};
        let store = self.store()?;
        let pads = store.list().map_err(RpcError::internal)?;
        let files = store.files().map_err(RpcError::internal)?;
        let mut undo = RemovalFiles::default();
        let mut events = Vec::new();
        for pad in pads.into_iter().filter(|p| p.home.as_deref() == Some(home)) {
            let kept = (pad.owner.kind == ActorKind::Agent)
                .then(|| {
                    removal
                        .kept
                        .iter()
                        .find(|i| i.kind == RemovalKind::Agent && i.id == pad.owner.id)
                })
                .flatten();
            if let Some(owner) = kept {
                db.execute(
                    "UPDATE pads SET home = NULL WHERE key = ?",
                    [store::key(&pad.name)],
                )
                .map_err(RpcError::internal)?;
                removal.kept.push(KeptItem {
                    id: pad.name.clone(),
                    kind: RemovalKind::Pad,
                    name: pad.name.clone(),
                    reason: owner.reason,
                });
                events.push(EventData::PadChanged(PadName { name: pad.name }));
            } else {
                if files {
                    undo.stage(&self.files_dir, &pad.name)?;
                }
                db.execute("DELETE FROM pads WHERE key = ?", [store::key(&pad.name)])
                    .map_err(RpcError::internal)?;
                removal.removed.push(RemovedItem {
                    id: pad.name.clone(),
                    kind: RemovalKind::Pad,
                    name: pad.name.clone(),
                });
                events.push(EventData::PadDeleted(PadName { name: pad.name }));
            }
        }
        Ok((undo, events))
    }
}

impl RemovalFiles {
    pub(super) fn stage(&mut self, dir: &Path, name: &str) -> Result<(), RpcError> {
        let path = dir.join(format!("{name}.md"));
        match std::fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(RpcError::internal(e)),
            Ok(meta) if meta.is_dir() => {
                return Err(RpcError::internal(format!(
                    "pad file {name}.md is a directory"
                )));
            }
            Ok(_) => {}
        }
        let backup = tempfile::NamedTempFile::new_in(dir)
            .map_err(RpcError::internal)?
            .into_temp_path();
        std::fs::rename(&path, &backup).map_err(RpcError::internal)?;
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
                std::fs::rename(backup, path)
                    .expect("restore staged Pad file after rejected removal");
            }
        }
    }
}
