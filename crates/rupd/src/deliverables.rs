//! DV1–DV4: publication in the existing Project database. No authoring or discovery UI.
use crate::{Conn, Daemon};
use contracts::{ActorKind, deliverable::*};
use rpc::{RpcError, code};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::path::{Path, PathBuf};

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

    fn invalidate(&self, id: &str) -> Result<(), RpcError> {
        match std::fs::remove_dir_all(self.cache.join(id)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(RpcError::internal(e)),
        }
    }
    pub(crate) fn invalidate_revoked(&self) -> Result<(), RpcError> {
        let db = self.db.lock().expect("publication database poisoned");
        let mut stmt = db
            .prepare("SELECT record FROM deliverables WHERE removed=0")
            .map_err(RpcError::internal)?;
        for record in stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(RpcError::internal)?
        {
            let record: Deliverable = serde_json::from_str(&record.map_err(RpcError::internal)?)
                .map_err(RpcError::internal)?;
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
                let live: bool = db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM deliverable_files WHERE id=?1)",
                    [id],
                    |r| r.get(0),
                )?;
                if !live {
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
        let mut stmt = db.prepare("SELECT id FROM deliverables WHERE removed=1 AND id IN (SELECT id FROM deliverable_files)")?;
        let ids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for id in ids {
            allocation_id(&id)?;
            let file: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM deliverable_files WHERE id=?1)",
                [&id],
                |r| r.get(0),
            )?;
            if file && let Some(dir) = &dir {
                fault("unlink")?;
                match unlinkat(dir, &id, AtFlags::empty()) {
                    Ok(()) | Err(rustix::io::Errno::NOENT) => {}
                    Err(e) => return Err(e.into()),
                }
                fault("removal_sync")?;
                rustix::fs::fsync(dir)?;
            }
            db.execute("DELETE FROM deliverable_files WHERE id=?1", [&id])?;
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
fn fault(operation: &str) -> std::io::Result<()> {
    if std::env::var("RUPD_PUBLICATION_FAIL").ok().as_deref() == Some(operation) {
        Err(std::io::Error::other(format!(
            "publication {operation} failed"
        )))
    } else {
        Ok(())
    }
}

impl Daemon {
    pub(crate) async fn deliverable_call(
        &self,
        conn: &Conn,
        method: &str,
        args: Value,
    ) -> Result<Value, RpcError> {
        let mut db = self
            .publications
            .db
            .lock()
            .expect("publication database poisoned");
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(RpcError::internal)?;
        if matches!(method, "deliverable.publish" | "deliverable.remove") {
            self.publications.recover(&tx).map_err(RpcError::internal)?;
        }
        let maker: Option<(String, Option<String>)> = if conn.actor.kind == ActorKind::Agent {
            Some(
                tx.query_row(
                    "SELECT name,worktree_path FROM nodes WHERE CAST(id AS TEXT)=?1",
                    [&conn.actor.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(RpcError::internal)?
                .ok_or_else(|| RpcError::forbidden("maker is gone"))?,
            )
        } else {
            None
        };
        let project: String = tx
            .query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))
            .map_err(RpcError::internal)?;
        let result = match method {
            "deliverable.publish" => {
                let p: PublishParams = rpc::params(args)?;
                if conn.actor.kind == ActorKind::Ext {
                    return Err(RpcError::forbidden(
                        "only the user or an authenticated maker can publish",
                    ));
                }
                if p.key.is_empty()
                    || p.key.len() > 256
                    || p.title.trim().is_empty()
                    || p.title.len() > 4096
                {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "publication key/title is empty or too long",
                    ));
                }
                let request = serde_json::to_string(&p).map_err(RpcError::internal)?;
                let actor_key = format!("{:?}:{}", conn.actor.kind, conn.actor.id);
                let previous: Option<(String, String, bool)> = tx.query_row("SELECT request, record, removed FROM deliverables WHERE maker=?1 AND publication_key=?2",params![actor_key,p.key], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(RpcError::internal)?;
                if let Some((old, record, removed)) = previous {
                    if removed {
                        return Err(RpcError::not_found(
                            "publication was removed; use a fresh key",
                        ));
                    }
                    if old != request {
                        return Err(RpcError::conflict(
                            "publication key already names another request",
                        ));
                    }
                    return serde_json::from_str(&record).map_err(RpcError::internal);
                }
                let mut bytes = None;
                let mut file_source = None;
                observe("capture_start")?;
                let target = match p.target {
                    PublicationTarget::External { url } => {
                        external(&url)?;
                        PublishedTarget::External {
                            url,
                            availability: ExternalAvailability::NotChecked,
                        }
                    }
                    PublicationTarget::Pad {
                        name,
                        incarnation,
                        revision,
                    } => {
                        let source = pads::source(&tx, &name)
                            .map_err(RpcError::internal)?
                            .ok_or_else(|| RpcError::not_found("Pad is gone"))?;
                        if source.pad.incarnation != incarnation || source.pad.revision != revision
                        {
                            return Err(RpcError::conflict("Pad source or Revision changed"));
                        }
                        let content = source.pad.text.into_bytes();
                        bounded(&tx, &content, self.publications.quota)?;
                        let target = PublishedTarget::Pad {
                            name: source.pad.name,
                            incarnation: source.pad.incarnation,
                            revision,
                            length: content.len() as u64,
                            sha256: hash(&content),
                        };
                        bytes = Some(content);
                        target
                    }
                    PublicationTarget::File { path } => {
                        let root = maker
                            .as_ref()
                            .and_then(|(_, root)| root.as_ref())
                            .map_or(self.project.as_path(), |root| Path::new(root));
                        let (content, source) = capture(
                            root,
                            &path,
                            maker.as_ref().is_some_and(|(_, root)| root.is_some()),
                        )?;
                        file_source =
                            Some(serde_json::to_string(&source).map_err(RpcError::internal)?);
                        bounded(&tx, &content, self.publications.quota)?;
                        let target = PublishedTarget::File {
                            path,
                            length: content.len() as u64,
                            sha256: hash(&content),
                        };
                        bytes = Some(content);
                        target
                    }
                };
                observe("hashed")?;
                let id: String = tx
                    .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
                    .map_err(RpcError::internal)?;
                let record = Deliverable {
                    project,
                    id,
                    maker: conn.actor.clone(),
                    maker_name: maker
                        .as_ref()
                        .map_or_else(|| "You".to_owned(), |(name, _)| name.clone()),
                    home: if maker.is_some() {
                        tx.query_row("WITH RECURSIVE ancestry(id,kind,parent) AS (SELECT id,kind,parent FROM nodes WHERE CAST(id AS TEXT)=?1 UNION ALL SELECT n.id,n.kind,n.parent FROM nodes n JOIN ancestry a ON n.id=a.parent) SELECT CAST(id AS TEXT) FROM ancestry WHERE kind IN ('workstream','group') LIMIT 1",[&conn.actor.id],|r|r.get(0)).optional().map_err(RpcError::internal)?
                    } else {
                        None
                    },
                    title: p.title,
                    published_at: (u128::try_from(
                        time::OffsetDateTime::now_utc().unix_timestamp_nanos(),
                    )
                    .map_err(RpcError::internal)?
                        / 1_000_000)
                        .try_into()
                        .map_err(RpcError::internal)?,
                    target,
                };
                tx.execute("INSERT INTO deliverables(id,maker,publication_key,request,record,home,file_source) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![record.id,actor_key,p.key,request,serde_json::to_string(&record).map_err(RpcError::internal)?,record.home,file_source]).map_err(RpcError::internal)?;
                observe("metadata_inserted")?;
                if let Some(bytes) = bytes {
                    self.publications
                        .persist(&record.id, &bytes)
                        .map_err(RpcError::internal)?;
                    tx.execute(
                        "INSERT INTO deliverable_files VALUES (?1,?2)",
                        params![record.id, bytes.len() as i64],
                    )
                    .map_err(RpcError::internal)?;
                }
                rpc::reply(&record)?
            }
            "deliverable.list" => {
                let p: ListParams = rpc::params(args)?;
                let mut stmt = tx.prepare("SELECT record FROM deliverables WHERE removed=0 AND (?1 IS NULL OR home=?1) ORDER BY rowid").map_err(RpcError::internal)?;
                let records = stmt
                    .query_map([p.home], |r| r.get::<_, String>(0))
                    .map_err(RpcError::internal)?
                    .map(|r| {
                        r.map_err(RpcError::internal).and_then(|r| {
                            serde_json::from_str::<Deliverable>(&r).map_err(RpcError::internal)
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                rpc::reply(
                    &records
                        .into_iter()
                        .filter(|r| p.maker.as_ref().is_none_or(|m| m == &r.maker.id))
                        .collect::<Vec<_>>(),
                )?
            }
            "deliverable.move" => {
                let p: MoveParams = rpc::params(args)?;
                let mut record = get(
                    &tx,
                    &project,
                    &DeliverableId {
                        project: p.project,
                        id: p.id,
                    },
                )?;
                if let Some(home) = &p.home
                    && !tx
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=?1 AND kind IN ('workstream','group'))",
                            [home],
                            |r| r.get::<_, bool>(0),
                        )
                        .map_err(RpcError::internal)?
                {
                    return Err(RpcError::not_found("Home is not a Workstream"));
                }
                let placed: bool = tx
                    .query_row(
                        "SELECT user_placed FROM deliverables WHERE id=?1",
                        [&record.id],
                        |r| r.get(0),
                    )
                    .map_err(RpcError::internal)?;
                if conn.actor.kind != ActorKind::User && (conn.actor != record.maker || placed) {
                    return Err(RpcError::forbidden(
                        "only the user can change this placement",
                    ));
                }
                record.home = p.home;
                tx.execute(
                    "UPDATE deliverables SET record=?1,home=?2,user_placed=?3 WHERE id=?4",
                    params![
                        serde_json::to_string(&record).map_err(RpcError::internal)?,
                        record.home,
                        placed || conn.actor.kind == ActorKind::User,
                        record.id
                    ],
                )
                .map_err(RpcError::internal)?;
                let kind = serde_json::to_value(conn.actor.kind).map_err(RpcError::internal)?;
                tx.execute("INSERT INTO touches(actor_kind,actor_id,actor_parent,verb,item,at) VALUES (?1,?2,?3,'wrote',?4,CAST(unixepoch('subsec')*1000 AS INTEGER))",params![kind.as_str(),conn.actor.id,conn.actor.parent,format!("deliverable:{}",record.id)]).map_err(RpcError::internal)?;
                rpc::reply(&record)?
            }
            "deliverable.remove" => {
                let p: DeliverableId = rpc::params(args)?;
                if conn.actor.kind != ActorKind::User {
                    return Err(RpcError::forbidden(
                        "only the user can remove a publication",
                    ));
                }
                let record = get(&tx, &project, &p)?;
                self.publications.invalidate(&record.id)?;
                tx.execute(
                    "UPDATE deliverables SET removed=1 WHERE id=?1",
                    [&record.id],
                )
                .map_err(RpcError::internal)?;
                Value::Null
            }
            "deliverable.get" => {
                let p: DeliverableId = rpc::params(args)?;
                rpc::reply(&get(&tx, &project, &p)?)?
            }
            "deliverable.resolve" => {
                let p: DeliverableId = rpc::params(args)?;
                let record = get(&tx, &project, &p)?;
                self.publications.invalidate(&record.id)?;
                rpc::reply(&resolve(&tx, &self.publications, &record)?)?
            }
            _ => return Err(RpcError::method_not_found(method)),
        };
        if method == "deliverable.publish" {
            observe("before_commit")?;
        }
        tx.commit().map_err(RpcError::internal)?;
        if method == "deliverable.publish" {
            observe("after_commit")?;
        }
        if matches!(method, "deliverable.publish" | "deliverable.remove") {
            observe("before_cleanup")?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(RpcError::internal)?;
            self.publications.recover(&tx).map_err(RpcError::internal)?;
            tx.commit().map_err(RpcError::internal)?;
            observe("before_reply")?;
        }
        Ok(result)
    }
}

fn get(db: &Connection, project: &str, p: &DeliverableId) -> Result<Deliverable, RpcError> {
    if p.project != project {
        return Err(RpcError::other_project("publication of another Project"));
    }
    let record: Option<String> = db
        .query_row(
            "SELECT record FROM deliverables WHERE id=?1 AND removed=0",
            [&p.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(RpcError::internal)?;
    serde_json::from_str(&record.ok_or_else(|| RpcError::not_found("publication is gone"))?)
        .map_err(RpcError::internal)
}

fn external(url: &str) -> Result<(), RpcError> {
    let parsed =
        url::Url::parse(url).map_err(|e| RpcError::new(code::INVALID_PARAMS, e.to_string()))?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "publication requires an http/https URL without credentials",
        ));
    }
    Ok(())
}

const MAX_BYTES: usize = 32 * 1024 * 1024;
const QUOTA: i64 = 1024 * 1024 * 1024;
fn bounded(db: &Connection, bytes: &[u8], quota: i64) -> Result<(), RpcError> {
    let used: i64 = db
        .query_row(
            "SELECT coalesce(sum(length),0) FROM deliverable_files",
            [],
            |r| r.get(0),
        )
        .map_err(RpcError::internal)?;
    if bytes.len() > MAX_BYTES || used + bytes.len() as i64 > quota {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "publication exceeds 32 MiB or Project's 1 GiB retained quota",
        ));
    }
    Ok(())
}
fn hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
fn resolve(
    db: &Connection,
    publications: &Publications,
    record: &Deliverable,
) -> Result<Resolution, RpcError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let unavailable = |cause| Ok(Resolution::Unavailable { cause });
    let (length, sha256) = match &record.target {
        PublishedTarget::External { url, availability } => {
            external(url)?;
            return Ok(Resolution::External {
                url: url.clone(),
                availability: availability.clone(),
            });
        }
        PublishedTarget::Pad {
            incarnation,
            length,
            sha256,
            ..
        } => {
            match pad_state(db, incarnation, &record.id).map_err(RpcError::internal)? {
                pads::PadSourceState::Deleted(pads::PadDeletion::User) => {
                    return unavailable(UnavailableCause::AccessRevoked);
                }
                pads::PadSourceState::Unknown => {
                    return unavailable(UnavailableCause::SourceUnknown);
                }
                _ => {}
            }
            (*length, sha256)
        }
        PublishedTarget::File { length, sha256, .. } => {
            let (source, revoked): (String, bool) = db
                .query_row(
                    "SELECT file_source,access_revoked FROM deliverables WHERE id=?1",
                    [&record.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(RpcError::internal)?;
            let source: FileSource = serde_json::from_str(&source).map_err(RpcError::internal)?;
            if revoked || !source.allowed(db, &record.maker.id)? {
                db.execute(
                    "UPDATE deliverables SET access_revoked=1 WHERE id=?1",
                    [&record.id],
                )
                .map_err(RpcError::internal)?;
                return unavailable(UnavailableCause::AccessRevoked);
            }
            (*length, sha256)
        }
    };
    let selected: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM deliverable_files WHERE id=?1)",
            [&record.id],
            |r| r.get(0),
        )
        .map_err(RpcError::internal)?;
    if !selected {
        return unavailable(UnavailableCause::MissingRevision);
    }
    let bytes = match publications.read(&record.id) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return unavailable(UnavailableCause::IntegrityFailure),
    };
    let Some(bytes) = bytes else {
        return unavailable(UnavailableCause::MissingRevision);
    };
    if bytes.len() as u64 != length || hash(&bytes) != *sha256 {
        return unavailable(UnavailableCause::IntegrityFailure);
    }
    let directory = publications.cache.join(&record.id);
    let filename = match &record.target {
        PublishedTarget::File { path, .. } => Path::new(path)
            .file_name()
            .ok_or_else(|| RpcError::internal("retained filename missing"))?,
        _ => std::ffi::OsStr::new("result.md"),
    };
    let path = directory.join(filename);
    std::fs::create_dir_all(&directory).map_err(RpcError::internal)?;
    // The caller invalidated this identity's previous cache before checking authority.
    let materialize = || -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o400)
            .open(&path)?;
        // A cache copy is never authoritative and is dropped on restart; only the retained file syncs.
        file.write_all(&bytes)
    };
    if materialize().is_err() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(RpcError::internal)?;
        }
        return unavailable(UnavailableCause::MaterializationFailed);
    }
    Ok(Resolution::Retained {
        path: path.to_string_lossy().into_owned(),
        sha256: sha256.clone(),
    })
}

fn open_source(root: &Path, path: &str) -> Result<std::fs::File, RpcError> {
    use cap_std::fs::{Dir, OpenOptions, OpenOptionsExt};
    let invalid = |message| RpcError::new(code::INVALID_PARAMS, message);
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
        || Path::new(path)
            .components()
            .any(|c| c.as_os_str() == ".roundup" || c.as_os_str() == ".git")
    {
        return Err(invalid(
            "publication needs a relative file inside its authorized root",
        ));
    }
    let dir =
        Dir::open_ambient_dir(root, cap_std::ambient_authority()).map_err(RpcError::internal)?;
    let mut options = OpenOptions::new();
    options.read(true).custom_flags(
        rustix::fs::OFlags::NONBLOCK
            .bits()
            .try_into()
            .map_err(RpcError::internal)?,
    );
    // Resolve components through directory handles with NOFOLLOW. This also prevents an
    // in-root symlink from entering another maker's .roundup Worktree via an innocent alias.
    let parent = Path::new(path).parent().unwrap_or_else(|| Path::new(""));
    let mut directory = dir.into_std_file();
    for part in parent.components() {
        directory = open_directory(&directory, part.as_os_str())
            .map_err(|e| RpcError::forbidden(format!("cannot read publication directory: {e}")))?;
    }
    let dir = Dir::from_std_file(directory);
    options.custom_flags(
        (rustix::fs::OFlags::NONBLOCK | rustix::fs::OFlags::NOFOLLOW)
            .bits()
            .try_into()
            .map_err(RpcError::internal)?,
    );
    let filename = Path::new(path)
        .file_name()
        .ok_or_else(|| invalid("publication filename is absent"))?;
    let file = dir
        .open_with(filename, &options)
        .map_err(|e| RpcError::forbidden(format!("cannot read publication source: {e}")))?
        .into_std();
    Ok(file)
}

fn capture(root: &Path, path: &str, worktree: bool) -> Result<(Vec<u8>, FileSource), RpcError> {
    use std::io::Read;
    use std::os::unix::fs::MetadataExt;
    let mut file = open_source(root, path)?;
    let before = file.metadata().map_err(RpcError::internal)?;
    if !before.is_file() || before.len() > MAX_BYTES as u64 || before.mode() & 0o444 == 0 {
        return Err(RpcError::new(
            code::INVALID_PARAMS,
            "source is not a readable regular file within 32 MiB",
        ));
    }
    // One allocation: read_to_end from an empty Vec regrows by copying up to 32 MiB.
    let mut bytes = Vec::with_capacity(before.len() as usize + 1);
    file.by_ref()
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(RpcError::internal)?;
    observe("captured")?;
    let after = file.metadata().map_err(RpcError::internal)?;
    if bytes.len() > MAX_BYTES
        || before.len() != bytes.len() as u64
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(RpcError::conflict(
            "publication source changed during capture",
        ));
    }
    let source = FileSource {
        root: root.to_path_buf(),
        path: path.to_owned(),
        worktree,
        device: before.dev(),
        inode: before.ino(),
        created: birth(&before)?,
    };
    Ok((bytes, source))
}

// Isolated Daemon observer; absent in normal operation. A file acknowledgement, not a sleep,
// tells the probe exactly which side of the commit/capture it may interrupt.
fn observe(stage: &str) -> Result<(), RpcError> {
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

#[derive(serde::Serialize, serde::Deserialize)]
struct FileSource {
    root: PathBuf,
    path: String,
    worktree: bool,
    device: u64,
    inode: u64,
    created: String,
}
fn birth(meta: &std::fs::Metadata) -> Result<String, RpcError> {
    Ok(meta
        .created()
        .map_err(|e| RpcError::forbidden(format!("source creation identity unavailable: {e}")))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(RpcError::internal)?
        .as_nanos()
        .to_string())
}
impl FileSource {
    fn allowed(&self, db: &Connection, maker: &str) -> Result<bool, RpcError> {
        if !self.root.exists() && self.worktree {
            // A removed maker's unregistered Worktree is cleanup, not a source denial.
            let registered: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?1 OR worktree_path=?2)",
                    params![maker, self.root.to_string_lossy()],
                    |r| r.get(0),
                )
                .map_err(RpcError::internal)?;
            return Ok(!registered);
        }
        // Opening the source, without reading its contents, also enforces ACLs. Mode bits
        // alone would incorrectly keep retained access after an ACL denied this reader.
        let file = match open_source(&self.root, &self.path) {
            Ok(file) => file,
            Err(_) => return Ok(false),
        };
        let metadata = file.metadata().map_err(RpcError::internal)?;
        use std::os::unix::fs::MetadataExt;
        if !metadata.is_file()
            || metadata.mode() & 0o444 == 0
            || metadata.dev() != self.device
            || metadata.ino() != self.inode
        {
            return Ok(false);
        }
        let created = birth(&metadata)?;
        Ok(created == self.created)
    }
}

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
    let revoked: bool = db
        .query_row(
            "SELECT access_revoked FROM deliverables WHERE id=?1",
            [publication],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false);
    if revoked {
        return Ok(pads::PadSourceState::Deleted(pads::PadDeletion::User));
    }
    pads::source_state(db, id)
}
