//! Identity-preserving name changes and rollback of their optional file mirror.

use std::path::PathBuf;

use contracts::{EventData, pad::RenameParams};
use rpc::{Ctx, RpcError, reply};
use serde_json::Value;

use crate::{Pads, RemovalFiles, files, get, name, require_owner_or_user, store, wrote};

impl Pads {
    pub(super) fn rename(&self, ctx: &Ctx, p: RenameParams) -> Result<Value, RpcError> {
        name::validate(&p.new_name)?;
        let store = self.store()?;
        let mut mirror = MirrorRename::default();
        let pad = store.atomically(|| {
            let pad = get(&store, &p.name)?;
            require_owner_or_user(&ctx.actor, &pad, "rename")?;
            if pad.incarnation != p.expected_incarnation || pad.name != p.name {
                return Err(RpcError::conflict(
                    "the original pad name or creation changed",
                ));
            }
            if store::key(&pad.name) != store::key(&p.new_name)
                && store
                    .get(&p.new_name)
                    .map_err(RpcError::internal)?
                    .is_some()
            {
                return Err(RpcError::conflict(format!("pad exists: {}", p.new_name)));
            }
            if pad.name == p.new_name {
                return Ok(pad);
            }
            store
                .rename(&pad.name, &p.new_name)
                .map_err(RpcError::internal)?;
            if store.files().map_err(RpcError::internal)? {
                mirror.original.stage(&self.files_dir, &pad.name)?;
                let destination = self.files_dir.join(format!("{}.md", p.new_name));
                if let Some((_, backup)) = mirror.original.files.last() {
                    // hard_link refuses an occupied path and preserves external edits and metadata.
                    std::fs::hard_link(backup, &destination).map_err(RpcError::internal)?;
                } else {
                    files::write_new(&self.files_dir, &p.new_name, &pad.text)?;
                }
                mirror.destination = Some(destination);
            }
            get(&store, &p.new_name)
        })?;
        mirror.commit();
        if p.name != pad.name {
            wrote(ctx, &pad.name)?;
            ctx.emit(EventData::PadRenamed {
                incarnation: pad.incarnation.clone(),
                name: pad.name.clone(),
                previous_name: p.name,
            });
        }
        reply(&pad)
    }
}

#[derive(Default)]
struct MirrorRename {
    original: RemovalFiles,
    destination: Option<PathBuf>,
}

impl MirrorRename {
    fn commit(mut self) {
        self.destination = None;
        self.original.committed = true;
    }
}

impl Drop for MirrorRename {
    fn drop(&mut self) {
        if let Some(path) = &self.destination {
            // RemovalFiles restores the old path after this destination is removed, including
            // on a case-insensitive filesystem. Its backup remains recoverable if removal fails.
            if let Err(error) = std::fs::remove_file(path) {
                eprintln!(
                    "cannot remove rejected Pad mirror {}: {error}",
                    path.display()
                );
            }
        }
    }
}
