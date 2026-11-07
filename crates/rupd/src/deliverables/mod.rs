//! DV1–DV4: publication in the existing Project database. No authoring or discovery UI.
#![cfg_attr(not(test), deny(clippy::too_many_lines))]
use crate::{Conn, Daemon};
use capture::{Root, hash};
use contracts::{ActorKind, deliverable::*};
use rpc::RpcError;
use rusqlite::{Connection, Transaction};
use serde_json::Value;
use std::path::{Path, PathBuf};

mod capture;
mod store;
pub(crate) use store::{clear_home_in, clear_retained_homes_in};

/// A publication call refused or failed; it keeps its kind until the RPC edge.
#[derive(Debug, thiserror::Error)]
pub(crate) enum DeliverableError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    Conflict(String),
    #[error("maker is gone")]
    MakerGone,
    #[error("publication was removed; use a fresh key")]
    Removed,
    #[error("Pad is gone")]
    PadGone,
    #[error("Home is not a Workstream")]
    NotAHome,
    #[error("publication is gone")]
    Gone,
    #[error("publication of another Project")]
    OtherProject,
    #[error("{0}")]
    Internal(String),
    #[error("{}", .0.message)]
    Rpc(RpcError),
}

impl DeliverableError {
    fn internal(error: impl std::fmt::Display) -> Self {
        Self::Internal(error.to_string())
    }
}

impl From<RpcError> for DeliverableError {
    fn from(error: RpcError) -> Self {
        Self::Rpc(error)
    }
}
macro_rules! internal_from {
    ($($error:ty),*) => {$(
        impl From<$error> for DeliverableError {
            fn from(error: $error) -> Self {
                Self::internal(error)
            }
        }
    )*};
}
internal_from!(rusqlite::Error, serde_json::Error, std::io::Error);

impl From<DeliverableError> for RpcError {
    fn from(error: DeliverableError) -> Self {
        use DeliverableError::*;
        let message = error.to_string();
        match error {
            Invalid(_) => Self::new(rpc::code::INVALID_PARAMS, message),
            Forbidden(_) | MakerGone => Self::forbidden(message),
            Conflict(_) => Self::conflict(message),
            Removed | PadGone | NotAHome | Gone => Self::not_found(message),
            OtherProject => Self::other_project(message),
            Internal(_) => Self::internal(message),
            Rpc(error) => error,
        }
    }
}

type Ret<T> = std::result::Result<T, DeliverableError>;

pub(crate) struct Publications {
    db: std::sync::Mutex<Connection>,
    cache: PathBuf,
    quota: i64,
}

impl Publications {
    #[cfg(test)]
    pub(crate) fn in_memory(cache: PathBuf) -> Self {
        Self {
            db: std::sync::Mutex::new(
                Connection::open_in_memory().expect("test publication database"),
            ),
            cache,
            quota: QUOTA,
        }
    }

    fn invalidate(&self, id: &str) -> Ret<()> {
        match std::fs::remove_dir_all(self.cache.join(id)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
    pub(crate) fn invalidate_revoked(&self) -> std::result::Result<(), RpcError> {
        let db = self.db.lock().expect("publication database poisoned");
        for record in store::live_in(&db)? {
            if let PublishedTarget::Pad { incarnation, .. } = record.target
                && matches!(
                    pad_state(&db, &incarnation, &record.id).map_err(RpcError::internal)?,
                    pads::PadSourceState::Deleted(pads::PadDeletion::User)
                        | pads::PadSourceState::Unknown
                )
            {
                self.invalidate(&record.id)?;
            }
        }
        Ok(())
    }

    pub(crate) fn open(data: &Path) -> Result<Self, rpc::OpenError> {
        // Cached files are never authoritative and are not retained across a restart.
        let cache = data.join("deliverables");
        if cache.exists() {
            std::fs::remove_dir_all(&cache)?;
        }
        let db = Connection::open(data.join("project.db"))?;
        db.pragma_update(None, "synchronous", "FULL")?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        // SQLite uses the stronger device flush on platforms that support it.
        db.pragma_update(None, "fullfsync", true)?;
        // R5457: only test-support builds accept a Project-local fixture limit. Keeping it
        // beside this Project's database preserves it across restart without ambient state.
        #[cfg(feature = "test-support")]
        let quota = match std::fs::read_to_string(data.join("test-publication-quota")) {
            Ok(value) => value.trim().parse::<i64>().map_err(std::io::Error::other)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => QUOTA,
            Err(error) => return Err(error.into()),
        };
        #[cfg(not(feature = "test-support"))]
        let quota = QUOTA;
        Ok(Self {
            db: std::sync::Mutex::new(db),
            cache,
            quota,
        })
    }
}

fn open_directory(
    at: impl std::os::fd::AsFd,
    name: impl rustix::path::Arg,
) -> std::io::Result<std::fs::File> {
    use rustix::fs::{Mode, OFlags};
    Ok(rustix::fs::openat(
        at,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )?
    .into())
}

// This is part of the existing publication owner: SQLite alone selects live identities.
impl Publications {
    fn directory(&self, create: bool) -> std::io::Result<std::fs::File> {
        use rustix::fs::{CWD, Mode};
        let parent = open_directory(CWD, self.cache.parent().expect("Project data"))?;
        if create {
            match rustix::fs::mkdirat(&parent, "publication-files", Mode::from_raw_mode(0o700)) {
                Ok(()) | Err(rustix::io::Errno::EXIST) => {}
                Err(e) => return Err(e.into()),
            }
            // Also retry a prior failed parent flush; existence alone proves no durability.
            fault("parent_sync")?;
            rustix::fs::fsync(&parent)?;
            observe("parent_synced").map_err(std::io::Error::other)?;
        }
        open_directory(&parent, "publication-files")
    }
    fn pending(dir: &std::fs::File) -> std::io::Result<cap_std::fs::Dir> {
        use rustix::fs::Mode;
        match rustix::fs::mkdirat(dir, "pending", Mode::from_raw_mode(0o700)) {
            Ok(()) | Err(rustix::io::Errno::EXIST) => {}
            Err(e) => return Err(e.into()),
        }
        fault("pending_parent_sync")?;
        rustix::fs::fsync(dir)?;
        observe("pending_directory_synced").map_err(std::io::Error::other)?;
        Ok(cap_std::fs::Dir::from_std_file(open_directory(
            dir, "pending",
        )?))
    }
    fn persist(&self, id: &str, bytes: &[u8]) -> std::io::Result<()> {
        use rustix::fs::OFlags;
        use std::io::Write;
        let dir = self.directory(true)?;
        let pending = Self::pending(&dir)?;
        use cap_std::fs::OpenOptionsExt;
        let mut options = cap_std::fs::OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .mode(0o400)
            .custom_flags(
                OFlags::NOFOLLOW
                    .bits()
                    .try_into()
                    .map_err(std::io::Error::other)?,
            );
        let mut file = pending.open_with(id, &options)?.into_std();
        fault("write")?;
        file.write_all(bytes)?;
        observe("before_file_sync").map_err(std::io::Error::other)?;
        fault("file_sync")?;
        // Rust uses F_FULLFSYNC on macOS here; directory fsync persists namespace entries.
        file.sync_all()?;
        observe("after_file_sync").map_err(std::io::Error::other)?;
        rustix::fs::fsync(&pending)?;
        fault("link")?;
        rustix::fs::linkat(&pending, id, &dir, id, rustix::fs::AtFlags::empty())?;
        fault("directory_sync")?;
        rustix::fs::fsync(&dir)?;
        observe("after_directory_sync").map_err(std::io::Error::other)?;
        Ok(())
    }
    fn read(&self, id: &str) -> std::io::Result<Vec<u8>> {
        use rustix::fs::{Mode, OFlags};
        use std::io::Read;
        allocation_id(id)?;
        fault("read")?;
        let dir = self.directory(false)?;
        let fd = rustix::fs::openat(
            &dir,
            id,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )?;
        let mut file = std::fs::File::from(fd);
        if !file.metadata()?.is_file() {
            return Err(std::io::Error::other("payload is not a regular file"));
        }
        let mut bytes = Vec::with_capacity(
            usize::try_from(file.metadata()?.len().min(MAX_BYTES as u64)).unwrap_or(0) + 1,
        );
        file.by_ref()
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        Ok(bytes)
    }
    fn recover(&self, db: &Connection) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use rustix::fs::{AtFlags, statat, unlinkat};
        let dir = match self.directory(false) {
            Ok(dir) => Some(dir),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        if let Some(dir) = &dir {
            let pending = Self::pending(dir)?;
            let mut entries = pending.entries()?;
            if let Some(entry) = entries.next() {
                let name = entry?.file_name();
                let id = name.to_str().ok_or("invalid pending identity")?;
                allocation_id(id)?;
                if entries.next().is_some() {
                    return Err("more than one pending allocation".into());
                }
                if !store::file_retained_in(db, id)? {
                    // A link collision never authorizes deleting the other inode.
                    match statat(dir, id, AtFlags::SYMLINK_NOFOLLOW) {
                        Ok(final_stat) => {
                            let staged = statat(&pending, id, AtFlags::SYMLINK_NOFOLLOW)?;
                            if (staged.st_dev, staged.st_ino)
                                != (final_stat.st_dev, final_stat.st_ino)
                            {
                                return Err("pending allocation collides with another file".into());
                            }
                            unlinkat(dir, id, AtFlags::empty())?;
                        }
                        Err(rustix::io::Errno::NOENT) => {}
                        Err(e) => return Err(e.into()),
                    }
                    rustix::fs::fsync(dir)?;
                }
                fault("staging_cleanup")?;
                unlinkat(&pending, id, AtFlags::empty())?;
                fault("cleanup_sync")?;
                rustix::fs::fsync(&pending)?;
            } else {
                // A failed unlink flush must be retried even if its entry is already absent.
                rustix::fs::fsync(&pending)?;
            }
        }
        for id in store::removed_with_files_in(db)? {
            allocation_id(&id)?;
            if let Some(dir) = &dir {
                fault("unlink")?;
                match unlinkat(dir, &id, AtFlags::empty()) {
                    Ok(()) | Err(rustix::io::Errno::NOENT) => {}
                    Err(e) => return Err(e.into()),
                }
                fault("removal_sync")?;
                rustix::fs::fsync(dir)?;
            }
            store::drop_file_in(db, &id)?;
        }
        Ok(())
    }
}
fn allocation_id(id: &str) -> std::io::Result<()> {
    if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(std::io::Error::other(
            "invalid publication allocation identity",
        ))
    }
}
// Faults are opt-in, isolated-process observers like the capture/commit cuts below.
#[expect(
    clippy::disallowed_methods,
    reason = "an isolated-process fault probe, absent in normal operation"
)]
fn fault(operation: &str) -> std::io::Result<()> {
    if std::env::var("RUPD_PUBLICATION_FAIL").ok().as_deref() == Some(operation) {
        Err(std::io::Error::other(format!(
            "publication {operation} failed"
        )))
    } else {
        Ok(())
    }
}

/// The finished call: what to reply and what to announce after the commit.
enum Done {
    /// A replayed publish answers from the stored record and commits nothing.
    Replayed(Value),
    Applied {
        reply: Value,
        changed: bool,
        publication: Option<contracts::EventData>,
    },
}

impl Done {
    fn reply(reply: Value) -> Self {
        Self::Applied {
            reply,
            changed: false,
            publication: None,
        }
    }
}

/// What every handler reads: the caller, the one open transaction and the resolved maker.
struct Call<'a> {
    daemon: &'a Daemon,
    conn: &'a Conn,
    tx: &'a Transaction<'a>,
    project: String,
    maker: Option<(String, Option<String>)>,
}

impl Daemon {
    pub(crate) async fn deliverable_call(
        &self,
        conn: &Conn,
        method: &str,
        args: Value,
    ) -> std::result::Result<Value, RpcError> {
        Ok(self.deliver(conn, method, args)?)
    }

    fn deliver(&self, conn: &Conn, method: &str, args: Value) -> Ret<Value> {
        // Read the run before taking SQLite's writer lock: completion folds may save the Rail.
        let completion = if method == "deliverable.publish" && conn.actor.kind == ActorKind::Agent {
            self.agents.turn_identity(&conn.actor.id)
        } else {
            None
        };
        let mut db = self
            .publications
            .db
            .lock()
            .expect("publication database poisoned");
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let settles = matches!(method, "deliverable.publish" | "deliverable.remove");
        if settles {
            self.publications
                .recover(&tx)
                .map_err(DeliverableError::internal)?;
        }
        let maker = if conn.actor.kind == ActorKind::Agent {
            Some(agents::maker_in(&tx, &conn.actor.id)?.ok_or(DeliverableError::MakerGone)?)
        } else {
            None
        };
        let call = Call {
            daemon: self,
            conn,
            tx: &tx,
            project: store::project_in(&tx)?,
            maker,
        };
        let done = match method {
            "deliverable.publish" => publish(&call, args, completion)?,
            "deliverable.list" => list(&call, args)?,
            "deliverable.move" => move_to(&call, args)?,
            "deliverable.remove" => remove(&call, args)?,
            "deliverable.get" => get(&call, args)?,
            "deliverable.resolve" => resolve_call(&call, args)?,
            _ => return Err(RpcError::method_not_found(method).into()),
        };
        let (reply, changed, publication) = match done {
            Done::Replayed(reply) => return Ok(reply),
            Done::Applied {
                reply,
                changed,
                publication,
            } => (reply, changed, publication),
        };
        if method == "deliverable.publish" {
            observe("before_commit")?;
        }
        tx.commit()?;
        if let Some(publication) = publication {
            self.bus.emit(conn.actor.clone(), publication);
        }
        if changed {
            self.bus
                .emit(conn.actor.clone(), contracts::EventData::DeliverableChanged);
        }
        if method == "deliverable.publish" {
            observe("after_commit")?;
        }
        if settles {
            observe("before_cleanup")?;
            let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            self.publications
                .recover(&tx)
                .map_err(DeliverableError::internal)?;
            tx.commit()?;
            observe("before_reply")?;
        }
        Ok(reply)
    }
}

/// The refusal of a publish request that needs no database: who may publish.
fn check_publish(actor: ActorKind) -> Ret<()> {
    if actor == ActorKind::Ext {
        return Err(DeliverableError::Forbidden(
            "only the user or an authenticated maker can publish".into(),
        ));
    }
    Ok(())
}

fn now_ms() -> Ret<i64> {
    let nanos = u128::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos())
        .map_err(DeliverableError::internal)?;
    (nanos / 1_000_000)
        .try_into()
        .map_err(DeliverableError::internal)
}

fn publish(
    call: &Call,
    args: Value,
    completion: Option<contracts::event::Completion>,
) -> Ret<Done> {
    let (conn, tx) = (call.conn, call.tx);
    let p: PublishParams = rpc::params(args)?;
    check_publish(conn.actor.kind)?;
    let request = serde_json::to_string(&p)?;
    let actor_key = format!("{:?}:{}", conn.actor.kind, conn.actor.id);
    if let Some((old, record, removed)) = store::previous_in(tx, &actor_key, &p.key)? {
        if removed {
            return Err(DeliverableError::Removed);
        }
        if old != request {
            return Err(DeliverableError::Conflict(
                "publication key already names another request".into(),
            ));
        }
        return Ok(Done::Replayed(serde_json::from_str(&record)?));
    }
    observe("capture_start")?;
    let worktree = call.maker.as_ref().and_then(|(_, root)| root.as_deref());
    let root = Root {
        path: worktree.map_or(call.daemon.project.as_path(), Path::new),
        worktree: worktree.is_some(),
    };
    let quota = call.daemon.publications.quota;
    let captured = capture::capture_target(tx, quota, &root, p.target)?;
    observe("hashed")?;
    let record = Deliverable {
        project: call.project.clone(),
        id: store::new_id_in(tx)?,
        maker: conn.actor.clone(),
        maker_name: call
            .maker
            .as_ref()
            .map_or_else(|| "You".to_owned(), |(name, _)| name.clone()),
        home: match call.maker {
            Some(_) => agents::home_in(tx, &conn.actor.id)?,
            None => None,
        },
        title: p.title.into(),
        published_at: now_ms()?,
        target: captured.target,
    };
    let row = store::NewRow {
        maker: &actor_key,
        key: &p.key,
        request: &request,
        file_source: captured.file_source.as_deref(),
    };
    store::insert_in(tx, &record, &row)?;
    observe("metadata_inserted")?;
    if let Some(bytes) = captured.bytes {
        call.daemon.publications.persist(&record.id, &bytes)?;
        store::insert_file_in(tx, &record.id, bytes.len())?;
    }
    Ok(Done::Applied {
        reply: rpc::reply(&record)?,
        changed: true,
        publication: Some(contracts::EventData::DeliverablePublished {
            record: Box::new(record),
            completion,
        }),
    })
}

fn list(call: &Call, args: Value) -> Ret<Done> {
    let p: ListParams = rpc::params(args)?;
    let records = store::list_in(call.tx, p.home.as_deref())?;
    Ok(Done::reply(rpc::reply(
        &records
            .into_iter()
            .filter(|r| p.maker.as_ref().is_none_or(|m| m == &r.maker.id))
            .collect::<Vec<_>>(),
    )?))
}

fn move_to(call: &Call, args: Value) -> Ret<Done> {
    let (conn, tx) = (call.conn, call.tx);
    let p: MoveParams = rpc::params(args)?;
    let mut record = store::get_in(
        tx,
        &call.project,
        &DeliverableId {
            project: p.project,
            id: p.id,
        },
    )?;
    if let Some(home) = &p.home
        && !agents::is_home_in(tx, home)?
    {
        return Err(DeliverableError::NotAHome);
    }
    let placed = store::user_placed_in(tx, &record.id)?;
    if conn.actor.kind != ActorKind::User && (conn.actor != record.maker || placed) {
        return Err(DeliverableError::Forbidden(
            "only the user can change this placement".into(),
        ));
    }
    let changed = record.home != p.home;
    record.home = p.home;
    store::place_in(tx, &record, placed || conn.actor.kind == ActorKind::User)?;
    provenance::record_in(
        tx,
        &conn.actor,
        contracts::Verb::Wrote,
        &format!("deliverable:{}", record.id),
    )?;
    Ok(Done::Applied {
        reply: rpc::reply(&record)?,
        changed,
        publication: None,
    })
}

fn remove(call: &Call, args: Value) -> Ret<Done> {
    let p: DeliverableId = rpc::params(args)?;
    if call.conn.actor.kind != ActorKind::User {
        return Err(DeliverableError::Forbidden(
            "only the user can remove a publication".into(),
        ));
    }
    let record = store::get_in(call.tx, &call.project, &p)?;
    call.daemon.publications.invalidate(&record.id)?;
    store::remove_in(call.tx, &record.id)?;
    Ok(Done::Applied {
        reply: Value::Null,
        changed: true,
        publication: None,
    })
}

fn get(call: &Call, args: Value) -> Ret<Done> {
    let p: DeliverableId = rpc::params(args)?;
    Ok(Done::reply(rpc::reply(&store::get_in(
        call.tx,
        &call.project,
        &p,
    )?)?))
}

fn resolve_call(call: &Call, args: Value) -> Ret<Done> {
    let p: DeliverableId = rpc::params(args)?;
    let record = store::get_in(call.tx, &call.project, &p)?;
    let publications = &call.daemon.publications;
    publications.invalidate(&record.id)?;
    Ok(Done::reply(rpc::reply(&resolve(
        call.tx,
        publications,
        &record,
    )?)?))
}

const MAX_BYTES: usize = 32 * 1024 * 1024;
const QUOTA: i64 = 1024 * 1024 * 1024;

/// Why a retained publication cannot be served, decided before any file is read.
fn source_gate(
    db: &Connection,
    record: &Deliverable,
) -> Ret<std::result::Result<(u64, String), Resolution>> {
    let unavailable = |cause| Ok(Err(Resolution::Unavailable { cause }));
    match &record.target {
        PublishedTarget::External { url, availability } => {
            capture::external(url)?;
            Ok(Err(Resolution::External {
                url: url.clone(),
                availability: availability.clone(),
            }))
        }
        PublishedTarget::Pad {
            incarnation,
            length,
            sha256,
            ..
        } => match pad_state(db, incarnation, &record.id)? {
            pads::PadSourceState::Deleted(pads::PadDeletion::User) => {
                unavailable(UnavailableCause::AccessRevoked)
            }
            pads::PadSourceState::Unknown => unavailable(UnavailableCause::SourceUnknown),
            _ => Ok(Ok((*length, sha256.clone()))),
        },
        PublishedTarget::File { length, sha256, .. } => {
            let (source, revoked) = store::file_source_in(db, &record.id)?;
            let source: capture::FileSource = serde_json::from_str(&source)?;
            if revoked || !source.allowed(db, &record.maker.id)? {
                store::revoke_in(db, &record.id)?;
                return unavailable(UnavailableCause::AccessRevoked);
            }
            Ok(Ok((*length, sha256.clone())))
        }
    }
}

fn resolve(db: &Connection, publications: &Publications, record: &Deliverable) -> Ret<Resolution> {
    let unavailable = |cause| Ok(Resolution::Unavailable { cause });
    let (length, sha256) = match source_gate(db, record)? {
        Ok(gate) => gate,
        Err(resolution) => return Ok(resolution),
    };
    if !store::file_retained_in(db, &record.id)? {
        return unavailable(UnavailableCause::MissingRevision);
    }
    let bytes = match publications.read(&record.id) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return unavailable(UnavailableCause::MissingRevision);
        }
        Err(_) => return unavailable(UnavailableCause::IntegrityFailure),
    };
    if bytes.len() as u64 != length || hash(&bytes) != sha256 {
        return unavailable(UnavailableCause::IntegrityFailure);
    }
    publications.materialize(record, &bytes, sha256)
}

impl Publications {
    /// Write a read-only cache copy; a failed write is "unavailable", not an error.
    fn materialize(&self, record: &Deliverable, bytes: &[u8], sha256: String) -> Ret<Resolution> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let directory = self.cache.join(&record.id);
        let filename = match &record.target {
            PublishedTarget::File { path, .. } => Path::new(path)
                .file_name()
                .ok_or_else(|| DeliverableError::internal("retained filename missing"))?,
            _ => std::ffi::OsStr::new("result.md"),
        };
        let path = directory.join(filename);
        std::fs::create_dir_all(&directory)?;
        // The caller invalidated this identity's previous cache before checking authority.
        let write = || -> std::io::Result<()> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o400)
                .open(&path)?;
            // A cache copy is never authoritative and is dropped on restart; only the retained file syncs.
            file.write_all(bytes)
        };
        if write().is_err() {
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
            return Ok(Resolution::Unavailable {
                cause: UnavailableCause::MaterializationFailed,
            });
        }
        Ok(Resolution::Retained {
            path: path.to_string_lossy().into_owned(),
            sha256,
        })
    }
}

// Isolated Daemon observer; absent in normal operation. A file acknowledgement, not a sleep,
// tells the probe exactly which side of the commit/capture it may interrupt.
#[expect(
    clippy::disallowed_methods,
    reason = "an isolated-process observer, absent in normal operation"
)]
fn observe(stage: &str) -> std::result::Result<(), RpcError> {
    if let Some(path) = std::env::var_os("RUPD_PUBLICATION_TRACE") {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(RpcError::internal)?;
        writeln!(
            file,
            "{stage} {}",
            time::OffsetDateTime::now_utc().unix_timestamp_nanos()
        )
        .map_err(RpcError::internal)?;
    }
    if std::env::var("RUPD_PUBLICATION_PAUSE").ok().as_deref() != Some(stage) {
        return Ok(());
    }
    let Some(dir) = std::env::var_os("RUPD_PUBLICATION_OBSERVER").map(PathBuf::from) else {
        return Ok(());
    };
    std::fs::create_dir_all(&dir).map_err(RpcError::internal)?;
    std::fs::write(dir.join(stage), b"reached").map_err(RpcError::internal)?;
    let release = dir.join("release");
    let released =
        crate::observers::wait_for_gate(&dir, std::time::Duration::from_secs(10), || {
            release.exists()
        })
        .map_err(RpcError::internal)?;
    if !released {
        return Err(RpcError::conflict(
            "publication observer interrupted before reply",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;

fn pad_state(
    db: &Connection,
    incarnation: &str,
    publication: &str,
) -> rusqlite::Result<pads::PadSourceState> {
    let Ok(id) = incarnation.parse::<i64>() else {
        return Ok(pads::PadSourceState::Unknown);
    };
    if id.to_string() != incarnation {
        return Ok(pads::PadSourceState::Unknown);
    }
    // Restoring source data never grants access to an explicitly revoked publication.
    if store::revoked_in(db, publication)? {
        return Ok(pads::PadSourceState::Deleted(pads::PadDeletion::User));
    }
    pads::source_state(db, id)
}

#[cfg(test)]
mod observation;
