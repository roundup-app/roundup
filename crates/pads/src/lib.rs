//! Pads: markdown notes, app-stored or as files. Owner: pads Builder.

mod files;
mod name;
pub mod reference;
#[doc(hidden)]
pub mod schema;
pub mod section;
mod store;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use contracts::pad::{
    AppendParams, AppendSectionParams, CreateParams, ExportParams, MoveParams, Pad, PadName,
    SetOwnerParams, SetStorageParams, WriteParams,
};
use contracts::{Actor, ActorKind, EventData, Verb};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, params, reply};
use serde_json::Value;

use store::Store;
pub use store::{PadDeletion, PadSource, PadSourceState, source, source_state};

pub struct Pads {
    store: Mutex<Store>,
    files_dir: PathBuf,
}

impl Pads {
    /// `dir` is the Project's data folder (N1). `bus` is for events no call caused.
    pub fn open(dir: &Path, _bus: Bus) -> Result<Self, OpenError> {
        Ok(Self {
            store: Mutex::new(Store::open(&dir.join(
                if dir.join("project.db").exists() {
                    "project.db"
                } else {
                    "pads.db"
                },
            ))?),
            files_dir: dir.join("pads"),
        })
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

    fn create(&self, ctx: &Ctx, p: CreateParams) -> Result<Value, RpcError> {
        name::validate(&p.name)?;
        let pad = Pad {
            incarnation: String::new(), // Assigned by the existing source-creation trigger.
            name: p.name,
            owner: ctx.actor.clone(),
            text: p.text.unwrap_or_default(),
            updated_at: now_ms(),
            revision: 1,
            home: None,
        };
        let store = self.store()?;
        let pad = store.atomically(|| {
            if !store.insert(&pad).map_err(RpcError::internal)? {
                return Err(RpcError::conflict(format!("pad exists: {}", pad.name)));
            }
            self.mirror(&store, &pad.name, &pad.text)?;
            get(&store, &pad.name)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&pad)
    }

    /// T27: whether the Pad `link` names, and its section, exist now. It logs no Touch.
    pub fn holds(&self, link: &reference::PadRef) -> Result<bool, RpcError> {
        let store = self.store()?;
        let pad = match get(&store, &link.name) {
            Ok(pad) => pad,
            Err(err) if err.code == rpc::code::NOT_FOUND => return Ok(false),
            Err(err) => return Err(err),
        };
        Ok(link
            .heading
            .as_deref()
            .is_none_or(|heading| section::find(&pad.text, &section::wanted(heading)).is_some()))
    }

    fn read(&self, ctx: &Ctx, p: PadName) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        ctx.touch(Verb::Read, &item(&pad.name))?;
        reply(&pad)
    }

    fn list(&self) -> Result<Value, RpcError> {
        reply(&self.store()?.list().map_err(RpcError::internal)?)
    }

    fn write(&self, ctx: &Ctx, p: WriteParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = store.atomically(|| {
            let pad = get(&store, &p.name)?;
            if pad.owner != ctx.actor {
                return Err(RpcError::forbidden(format!(
                    "only {} may rewrite pad {}",
                    pad.owner.id, pad.name
                )));
            }
            if let Some(expected) = &p.expected_incarnation
                && expected != &pad.incarnation
            {
                return Err(RpcError::conflict(format!(
                    "pad {} is a different creation",
                    pad.name
                )));
            }
            if let Some(expected) = p.expected_revision
                && expected != pad.revision
            {
                return Err(RpcError::conflict(format!(
                    "pad {} is at revision {}, not {expected}",
                    pad.name, pad.revision
                )));
            }
            found(store.set_text(&pad.name, &p.text, now_ms()), &pad.name)?;
            self.mirror(&store, &pad.name, &p.text)?;
            get(&store, &pad.name)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&pad)
    }

    fn append(&self, ctx: &Ctx, p: AppendParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        let text = pad.text + &p.text;
        store.atomically(|| {
            found(store.set_text(&pad.name, &text, now_ms()), &pad.name)?;
            self.mirror(&store, &pad.name, &text)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&get(&store, &pad.name)?)
    }

    /// P15: the revision check, the insertion and the write happen in one transaction, so of two callers with one expected revision only one succeeds.
    fn append_section(&self, ctx: &Ctx, p: AppendSectionParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        get(&store, &p.name)?;
        let wanted = section::wanted(&p.heading);
        if wanted.is_empty() || p.text.is_empty() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "heading and text must not be empty",
            ));
        }
        let pad = store.atomically(|| {
            let pad = get(&store, &p.name)?;
            if let Some(expected) = p.expected_revision
                && expected != pad.revision
            {
                return Err(RpcError::conflict(format!(
                    "pad {} is at revision {}, not {expected}",
                    pad.name, pad.revision
                )));
            }
            let text = section::insert(&pad.text, &wanted, &p.text).map_err(|headings| {
                let listed = if headings.is_empty() {
                    "the pad has no headings".to_string()
                } else {
                    format!("headings: \"{}\"", headings.join("\", \""))
                };
                RpcError::new(
                    rpc::code::INVALID_PARAMS,
                    format!("no heading \"{}\" in pad {}; {listed}", p.heading, pad.name),
                )
            })?;
            found(store.set_text(&pad.name, &text, now_ms()), &pad.name)?;
            self.mirror(&store, &pad.name, &text)?;
            get(&store, &pad.name)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&pad)
    }

    fn set_owner(&self, ctx: &Ctx, p: SetOwnerParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        require_owner_or_user(ctx, &pad, "hand over")?;
        found(store.set_owner(&pad.name, &p.owner, now_ms()), &pad.name)?;
        wrote(ctx, &pad.name)?;
        reply(&Pad {
            owner: p.owner,
            ..pad
        })
    }

    /// The Daemon has checked `home` against the Rail (P12). A move to the Home it has changes nothing.
    fn move_to(&self, ctx: &Ctx, p: MoveParams) -> Result<Value, RpcError> {
        if ctx.actor.kind == ActorKind::Agent {
            return Err(RpcError::forbidden("an Agent may not move a pad"));
        }
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        if pad.home == p.home {
            return reply(&pad);
        }
        found(store.set_home(&pad.name, p.home.as_deref()), &pad.name)?;
        wrote(ctx, &pad.name)?;
        reply(&Pad {
            home: p.home,
            ..pad
        })
    }

    /// Delete within the Pad transaction, retaining the cause supplied by the trusted owner.
    /// RPC authoring uses its authenticated Actor; internal archival supplies Cleanup while
    /// keeping the user's existing Touch and event attribution.
    pub fn delete(&self, ctx: &Ctx, p: PadName, cause: PadDeletion) -> Result<Value, RpcError> {
        let store = self.store()?;
        let mut files = RemovalFiles::default();
        let pad = store.atomically(|| {
            let pad = get(&store, &p.name)?;
            require_owner_or_user(ctx, &pad, "delete")?;
            store
                .record_deletion(&pad.name, cause)
                .map_err(RpcError::internal)?;
            found(store.delete(&pad.name), &pad.name)?;
            if store.files().map_err(RpcError::internal)? {
                files.stage(&self.files_dir, &pad.name)?;
            }
            Ok(pad)
        })?;
        files.commit();
        wrote(ctx, &pad.name)?;
        Ok(Value::Null)
    }

    fn export(&self, ctx: &Ctx, p: ExportParams) -> Result<Value, RpcError> {
        if !Path::new(&p.path).is_absolute() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                format!("export path must be absolute: {}", p.path),
            ));
        }
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        std::fs::write(&p.path, &pad.text).map_err(|err| {
            let code = match err.kind() {
                std::io::ErrorKind::NotFound => rpc::code::INVALID_PARAMS,
                _ => rpc::code::INTERNAL,
            };
            RpcError::new(code, format!("cannot export to {}: {err}", p.path))
        })?;
        ctx.touch(Verb::Read, &item(&pad.name))?;
        Ok(Value::Null)
    }

    fn set_storage(&self, ctx: &Ctx, p: SetStorageParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        if store.files().map_err(RpcError::internal)? == p.files {
            return Ok(Value::Null);
        }
        let imported = store.atomically(|| {
            let pads = store.list().map_err(RpcError::internal)?;
            for pad in &pads {
                name::validate(&pad.name)?;
            }
            let mut imported = Vec::new();
            for pad in &pads {
                if p.files {
                    files::write(&self.files_dir, &pad.name, &pad.text)?;
                } else if let Some(text) = files::read(&self.files_dir, &pad.name)?
                    && text != pad.text
                {
                    found(store.set_text(&pad.name, &text, now_ms()), &pad.name)?;
                    imported.push(pad.name.clone());
                }
            }
            store.set_files(p.files).map_err(RpcError::internal)?;
            Ok(imported)
        })?;
        for name in &imported {
            wrote(ctx, name)?;
        }
        Ok(Value::Null)
    }

    /// Writes the file while file storage is on. Callers do this inside `Store::atomically`, so a failure rolls the database change back.
    fn mirror(&self, store: &Store, name: &str, text: &str) -> Result<(), RpcError> {
        if store.files().map_err(RpcError::internal)? {
            files::write(&self.files_dir, name, text)?;
        }
        Ok(())
    }

    fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>, RpcError> {
        self.store
            .lock()
            .map_err(|_| RpcError::internal("pad store poisoned"))
    }
}

#[async_trait]
impl Module for Pads {
    fn namespaces(&self) -> &'static [&'static str] {
        &["pad"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        match method {
            "pad.create" => self.create(ctx, params(value)?),
            "pad.read" => self.read(ctx, params(value)?),
            "pad.list" => self.list(),
            "pad.write" => self.write(ctx, params(value)?),
            "pad.append" => self.append(ctx, params(value)?),
            "pad.appendSection" => self.append_section(ctx, params(value)?),
            "pad.setOwner" => self.set_owner(ctx, params(value)?),
            "pad.move" => self.move_to(ctx, params(value)?),
            "pad.delete" => self.delete(
                ctx,
                params(value)?,
                if ctx.actor.kind == ActorKind::User {
                    PadDeletion::User
                } else if ctx.actor == Actor::daemon() {
                    PadDeletion::Cleanup
                } else {
                    PadDeletion::Owner
                },
            ),
            "pad.setStorage" => self.set_storage(ctx, params(value)?),
            "pad.export" => self.export(ctx, params(value)?),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

/// Files temporarily renamed beside their originals, so rollback does not reconstruct text
/// from SQLite or lose external edits, permissions or symlinks.
#[derive(Default)]
pub struct RemovalFiles {
    files: Vec<(PathBuf, tempfile::TempPath)>,
    committed: bool,
}

impl RemovalFiles {
    fn stage(&mut self, dir: &Path, name: &str) -> Result<(), RpcError> {
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

fn require_owner_or_user(ctx: &Ctx, pad: &Pad, action: &str) -> Result<(), RpcError> {
    if ctx.actor.kind == ActorKind::User || ctx.actor == Actor::daemon() || ctx.actor == pad.owner {
        return Ok(());
    }
    Err(RpcError::forbidden(format!(
        "only the user or {} may {action} pad {}",
        pad.owner.id, pad.name
    )))
}

/// Validates the name, then looks the Pad up.
fn get(store: &Store, name: &str) -> Result<Pad, RpcError> {
    name::validate(name)?;
    store
        .get(name)
        .map_err(RpcError::internal)?
        .ok_or_else(|| RpcError::not_found(format!("pad {name}")))
}

/// An update that touched no row means another Daemon deleted the Pad since we looked.
fn found(updated: rusqlite::Result<bool>, name: &str) -> Result<(), RpcError> {
    match updated.map_err(RpcError::internal)? {
        true => Ok(()),
        false => Err(RpcError::not_found(format!("pad {name}"))),
    }
}

fn wrote(ctx: &Ctx, name: &str) -> Result<(), RpcError> {
    ctx.touch(Verb::Wrote, &item(name))?;
    ctx.emit(EventData::PadChanged(PadName { name: name.into() }));
    Ok(())
}

fn item(name: &str) -> String {
    format!("pad:{name}")
}

fn now_ms() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_update_that_changed_no_row_is_not_found() {
        assert!(found(Ok(true), "notes").is_ok());
        let err = found(Ok(false), "notes").unwrap_err();
        assert_eq!(err.code, rpc::code::NOT_FOUND);
    }
}
