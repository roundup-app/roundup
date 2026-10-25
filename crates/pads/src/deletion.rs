//! Transactional retention and restoration through the existing SQLite owner.
use super::*;
use contracts::pad::{DeleteParams, Deletion, DeletionId, GetDeletionParams};
use rusqlite::{Connection, OptionalExtension};

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
    db.execute("INSERT INTO pad_deletions(operation,actor,request,record,incarnation,pad_key) VALUES(?1,?2,?3,?4,?5,(SELECT key FROM pads WHERE key=?6))",
        rusqlite::params![receipt.operation, serde_json::to_string(actor).map_err(RpcError::internal)?,
            serde_json::to_string(p).map_err(RpcError::internal)?, serde_json::to_string(&receipt).map_err(RpcError::internal)?,
            pad.incarnation.parse::<i64>().map_err(RpcError::internal)?, store::key(&pad.name)]).map_err(RpcError::internal)?;
    Ok(receipt)
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
    let incarnation = pad.incarnation.parse::<i64>().map_err(RpcError::internal)?;
    let state = source_state(db, incarnation).map_err(RpcError::internal)?;
    if !matches!(state, PadSourceState::Deleted(_))
        || source(db, &pad.name).map_err(RpcError::internal)?.is_some()
    {
        return Err(RpcError::conflict(
            "original Pad is unavailable or its name is in use; retry after resolving the conflict",
        ));
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
            for (identity, kind) in home
                .as_deref()
                .map(|id| (id, "workstream"))
                .into_iter()
                .chain(
                    (original_owner.kind == ActorKind::Agent)
                        .then_some((original_owner.id.as_str(), "agent")),
                )
            {
                let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=? AND (kind=? OR ?='agent'))",rusqlite::params![identity,kind,kind],|r|r.get(0)).map_err(RpcError::internal)?;
                if !exists {
                    return Err(RpcError::conflict(
                        "original Pad Home or owner is unavailable",
                    ));
                }
            }
            if kind == "pad-home" {
                let current = source(db, &name)
                    .map_err(RpcError::internal)?
                    .ok_or_else(|| RpcError::conflict("kept Pad no longer exists"))?
                    .pad;
                if current.incarnation != incarnation
                    || current.home.is_some()
                    || serde_json::to_string(&current.owner).map_err(RpcError::internal)? != owner
                {
                    return Err(RpcError::conflict("kept Pad changed Home or owner"));
                }
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
}
