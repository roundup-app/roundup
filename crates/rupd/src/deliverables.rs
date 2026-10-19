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
}

impl Publications {
    #[cfg(test)]
    pub(crate) fn in_memory(cache: PathBuf) -> Self {
        Self {
            db: std::sync::Mutex::new(
                Connection::open_in_memory().expect("test publication database"),
            ),
            cache,
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
                    pads::source_state(&db, incarnation).map_err(RpcError::internal)?,
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
        Ok(Self {
            db: std::sync::Mutex::new(Connection::open(data.join("project.db"))?),
            cache,
        })
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
                let target = match p.target {
                    PublicationTarget::External { url } => {
                        external(&url)?;
                        PublishedTarget::External {
                            url,
                            availability: ExternalAvailability::NotChecked,
                        }
                    }
                    PublicationTarget::Pad { name, revision } => {
                        let source = pads::source(&tx, &name)
                            .map_err(RpcError::internal)?
                            .ok_or_else(|| RpcError::not_found("Pad is gone"))?;
                        if source.pad.revision != revision {
                            return Err(RpcError::conflict("Pad Revision changed"));
                        }
                        let content = source.pad.text.into_bytes();
                        bounded(&tx, &content)?;
                        let target = PublishedTarget::Pad {
                            name: source.pad.name,
                            incarnation: source.incarnation,
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
                        bounded(&tx, &content)?;
                        let target = PublishedTarget::File {
                            path,
                            length: content.len() as u64,
                            sha256: hash(&content),
                        };
                        bytes = Some(content);
                        target
                    }
                };
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
                    published_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(RpcError::internal)?
                        .as_millis()
                        .try_into()
                        .map_err(RpcError::internal)?,
                    target,
                };
                tx.execute("INSERT INTO deliverables(id,maker,publication_key,request,record,home,file_source) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![record.id,actor_key,p.key,request,serde_json::to_string(&record).map_err(RpcError::internal)?,record.home,file_source]).map_err(RpcError::internal)?;
                if let Some(bytes) = bytes {
                    tx.execute(
                        "INSERT INTO deliverable_bytes VALUES (?1,?2)",
                        params![record.id, bytes],
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
                tx.execute("DELETE FROM deliverable_bytes WHERE id=?1", [&record.id])
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
                rpc::reply(&resolve(&tx, &self.publications.cache, &record)?)?
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
        Ok(result)
    }
}

fn get(db: &Connection, project: &str, p: &DeliverableId) -> Result<Deliverable, RpcError> {
    if p.project != project {
        return Err(RpcError::not_found("publication Project differs"));
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
fn bounded(db: &Connection, bytes: &[u8]) -> Result<(), RpcError> {
    let used: i64 = db
        .query_row(
            "SELECT coalesce(sum(length(bytes)),0) FROM deliverable_bytes",
            [],
            |r| r.get(0),
        )
        .map_err(RpcError::internal)?;
    if bytes.len() > MAX_BYTES || used + bytes.len() as i64 > QUOTA {
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
fn resolve(db: &Connection, cache: &Path, record: &Deliverable) -> Result<Resolution, RpcError> {
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
            match pads::source_state(db, *incarnation).map_err(RpcError::internal)? {
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
    let bytes: Option<Vec<u8>> = db
        .query_row(
            "SELECT bytes FROM deliverable_bytes WHERE id=?1",
            [&record.id],
            |r| r.get(0),
        )
        .optional()
        .map_err(RpcError::internal)?;
    let Some(bytes) = bytes else {
        return unavailable(UnavailableCause::MissingRevision);
    };
    if bytes.len() as u64 != length || hash(&bytes) != *sha256 {
        return unavailable(UnavailableCause::IntegrityFailure);
    }
    let directory = cache.join(&record.id);
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
        file.write_all(&bytes)?;
        file.sync_all()
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
        directory = rustix::fs::openat(
            &directory,
            part.as_os_str(),
            rustix::fs::OFlags::RDONLY
                | rustix::fs::OFlags::DIRECTORY
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|e| RpcError::forbidden(format!("cannot read publication directory: {e}")))?
        .into();
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
    let mut bytes = Vec::new();
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
    if std::env::var("RUPD_PUBLICATION_PAUSE").ok().as_deref() != Some(stage) {
        return Ok(());
    }
    let Some(dir) = std::env::var_os("RUPD_PUBLICATION_OBSERVER").map(PathBuf::from) else {
        return Ok(());
    };
    std::fs::create_dir_all(&dir).map_err(RpcError::internal)?;
    std::fs::write(dir.join(stage), b"reached").map_err(RpcError::internal)?;
    let start = std::time::Instant::now();
    while !dir.join("release").exists() {
        if start.elapsed() > std::time::Duration::from_secs(10) {
            return Err(RpcError::conflict(
                "publication observer interrupted before reply",
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn dv2_metadata_only() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = Conn {
            actor: contracts::Actor::user(),
            peer: None,
            events,
            output: None,
        };
        daemon
            .route(
                &mut conn,
                "pad.create",
                json!({"name":"notes","text":"retained"}),
            )
            .await
            .unwrap();
        let record=daemon.route(&mut conn,"deliverable.publish",json!({"key":"notes","title":"Result","target":{"kind":"pad","name":"notes","revision":1}})).await.unwrap();
        let denied = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = denied.clone();
        daemon
            .publications
            .db
            .lock()
            .unwrap()
            .authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
                if matches!(
                    ctx.action,
                    rusqlite::hooks::AuthAction::Read {
                        table_name: "deliverable_bytes",
                        ..
                    }
                ) {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    rusqlite::hooks::Authorization::Deny
                } else {
                    rusqlite::hooks::Authorization::Allow
                }
            }))
            .unwrap();
        assert_eq!(
            daemon
                .route(&mut conn, "deliverable.list", json!({}))
                .await
                .unwrap(),
            json!([record])
        );
        let id = json!({"project":record["project"],"id":record["id"]});
        assert_eq!(
            daemon
                .route(&mut conn, "deliverable.get", id.clone())
                .await
                .unwrap(),
            record
        );
        assert_eq!(denied.load(std::sync::atomic::Ordering::SeqCst), 0);
        // Confirm the instrument actually catches a payload read at the same public seam.
        assert!(
            daemon
                .route(&mut conn, "deliverable.resolve", id)
                .await
                .is_err()
        );
        assert!(denied.load(std::sync::atomic::Ordering::SeqCst) > 0);
    }
}

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
