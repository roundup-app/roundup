use provenance::now_ms;
use std::path::Path;
use std::sync::Mutex;

use contracts::pad::{
    AppendParams, AppendSectionParams, CreateParams, ExportParams, MoveParams, Pad, PadName,
    ReorderParams, SetStorageParams, WriteParams,
};
use contracts::{ActorKind, EventData, Verb};
use rpc::{Bus, Ctx, OpenError, RpcError, reply};
use serde_json::Value;

use crate::store::Store;
use crate::{Pads, files, name, reference, section};

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

    pub(super) fn create(&self, ctx: &Ctx, p: CreateParams) -> Result<Value, RpcError> {
        name::validate(&p.name)?;
        let pad = Pad {
            incarnation: String::new(), // Assigned by the existing source-creation trigger.
            name: p.name,
            text: p.text.unwrap_or_default(),
            updated_at: now_ms().max(0),
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

    pub(super) fn read(&self, ctx: &Ctx, p: PadName) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        ctx.touch(Verb::Read, &item(&pad.name))?;
        reply(&pad)
    }

    pub(super) fn list(&self) -> Result<Value, RpcError> {
        reply(&self.store()?.list().map_err(RpcError::internal)?)
    }

    pub(super) fn write(&self, ctx: &Ctx, p: WriteParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = store.atomically(|| {
            let pad = get(&store, &p.name)?;
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
            found(
                store.set_text(&pad.name, &p.text, now_ms().max(0)),
                &pad.name,
            )?;
            self.mirror(&store, &pad.name, &p.text)?;
            get(&store, &pad.name)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&pad)
    }

    pub(super) fn append(&self, ctx: &Ctx, p: AppendParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let pad = get(&store, &p.name)?;
        let text = pad.text + &p.text;
        store.atomically(|| {
            found(store.set_text(&pad.name, &text, now_ms().max(0)), &pad.name)?;
            self.mirror(&store, &pad.name, &text)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&get(&store, &pad.name)?)
    }

    /// P15: the revision check, the insertion and the write happen in one transaction, so of two callers with one expected revision only one succeeds.
    pub(super) fn append_section(
        &self,
        ctx: &Ctx,
        p: AppendSectionParams,
    ) -> Result<Value, RpcError> {
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
            found(store.set_text(&pad.name, &text, now_ms().max(0)), &pad.name)?;
            self.mirror(&store, &pad.name, &text)?;
            get(&store, &pad.name)
        })?;
        wrote(ctx, &pad.name)?;
        reply(&pad)
    }

    pub(super) fn reorder(&self, ctx: &Ctx, p: ReorderParams) -> Result<Value, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user may reorder pads"));
        }
        let store = self.store()?;
        let (pad, changed) = store.atomically(|| {
            let pad = get(&store, &p.name)?;
            if pad.incarnation != p.expected_incarnation || pad.name != p.name {
                return Err(RpcError::conflict("the original pad creation changed"));
            }
            let mut order = store.list().map_err(RpcError::internal)?;
            let original: Vec<_> = order.iter().map(|pad| pad.incarnation.clone()).collect();
            order.retain(|entry| entry.incarnation != pad.incarnation);
            let at = if let Some(before) = &p.before {
                let target = get(&store, before)?;
                if target.home != pad.home || target.incarnation == pad.incarnation {
                    return Err(RpcError::conflict(
                        "reorder needs another pad of the same Home",
                    ));
                }
                order
                    .iter()
                    .position(|entry| entry.incarnation == target.incarnation)
                    .ok_or_else(|| RpcError::conflict("pad target changed"))?
            } else {
                order.len()
            };
            order.insert(at, pad.clone());
            let changed = original
                != order
                    .iter()
                    .map(|pad| pad.incarnation.clone())
                    .collect::<Vec<_>>();
            if changed {
                store.set_order(&order).map_err(RpcError::internal)?;
            }
            Ok((pad, changed))
        })?;
        if changed {
            ctx.emit(EventData::PadChanged(PadName {
                name: pad.name.clone(),
            }));
        }
        reply(&pad)
    }

    /// The Daemon has checked `home` against the Rail (P12). A move to the Home it has changes nothing.
    pub(super) fn move_to(&self, ctx: &Ctx, p: MoveParams) -> Result<Value, RpcError> {
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

    pub(super) fn export(&self, ctx: &Ctx, p: ExportParams) -> Result<Value, RpcError> {
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

    pub(super) fn set_storage(&self, ctx: &Ctx, p: SetStorageParams) -> Result<Value, RpcError> {
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
                    found(store.set_text(&pad.name, &text, now_ms().max(0)), &pad.name)?;
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

    pub(super) fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>, RpcError> {
        self.store
            .lock()
            .map_err(|_| RpcError::internal("pad store poisoned"))
    }
}

/// Validates the name, then looks the Pad up.
pub(super) fn get(store: &Store, name: &str) -> Result<Pad, RpcError> {
    name::validate(name)?;
    store
        .get(name)
        .map_err(RpcError::internal)?
        .ok_or_else(|| RpcError::not_found(format!("pad {name}")))
}

/// An update that touched no row means another Daemon deleted the Pad since we looked.
pub(super) fn found(updated: rusqlite::Result<bool>, name: &str) -> Result<(), RpcError> {
    match updated.map_err(RpcError::internal)? {
        true => Ok(()),
        false => Err(RpcError::not_found(format!("pad {name}"))),
    }
}

pub(super) fn wrote(ctx: &Ctx, name: &str) -> Result<(), RpcError> {
    ctx.touch(Verb::Wrote, &item(name))?;
    ctx.emit(EventData::PadChanged(PadName { name: name.into() }));
    Ok(())
}

fn item(name: &str) -> String {
    format!("pad:{name}")
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
