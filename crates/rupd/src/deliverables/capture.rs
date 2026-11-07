//! Reading a publication's source: the Pad text, the External URL or a file inside its root.
use super::{DeliverableError, MAX_BYTES, observe, open_directory, store};
use contracts::deliverable::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, DeliverableError>;

pub(super) fn external(url: &str) -> Result<()> {
    let parsed = url::Url::parse(url).map_err(|e| DeliverableError::Invalid(e.to_string()))?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(DeliverableError::Invalid(
            "publication requires an http/https URL without credentials".into(),
        ));
    }
    Ok(())
}

pub(super) fn bounded(db: &Connection, bytes: &[u8], quota: i64) -> Result<()> {
    let used = store::retained_bytes_in(db)?;
    if bytes.len() > MAX_BYTES || used + bytes.len() as i64 > quota {
        return Err(DeliverableError::Invalid(
            "publication exceeds 32 MiB or Project's 1 GiB retained quota".into(),
        ));
    }
    Ok(())
}

pub(super) fn hash(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

/// What a publish call captured: its target, the bytes to retain and the file's identity.
pub(super) struct Captured {
    pub target: PublishedTarget,
    pub bytes: Option<Vec<u8>>,
    pub file_source: Option<String>,
}

/// Where a maker's File targets resolve: its Worktree, or the Project root.
pub(super) struct Root<'a> {
    pub path: &'a Path,
    pub worktree: bool,
}

pub(super) fn capture_target(
    db: &Connection,
    quota: i64,
    root: &Root,
    target: PublicationTarget,
) -> Result<Captured> {
    match target {
        PublicationTarget::External { url } => {
            external(&url)?;
            Ok(Captured {
                target: PublishedTarget::External {
                    url,
                    availability: ExternalAvailability::NotChecked,
                },
                bytes: None,
                file_source: None,
            })
        }
        PublicationTarget::Pad {
            name,
            incarnation,
            revision,
        } => {
            let source = pads::source(db, &name)?.ok_or(DeliverableError::PadGone)?;
            if source.pad.incarnation != incarnation || source.pad.revision != revision {
                return Err(DeliverableError::Conflict(
                    "Pad source or Revision changed".into(),
                ));
            }
            let content = source.pad.text.into_bytes();
            bounded(db, &content, quota)?;
            Ok(Captured {
                target: PublishedTarget::Pad {
                    name: source.pad.name,
                    incarnation: source.pad.incarnation,
                    revision,
                    length: content.len() as u64,
                    sha256: hash(&content),
                },
                bytes: Some(content),
                file_source: None,
            })
        }
        PublicationTarget::File { path } => {
            let (content, source) = capture(root.path, &path, root.worktree)?;
            let file_source = Some(serde_json::to_string(&source)?);
            bounded(db, &content, quota)?;
            Ok(Captured {
                target: PublishedTarget::File {
                    path,
                    length: content.len() as u64,
                    sha256: hash(&content),
                },
                bytes: Some(content),
                file_source,
            })
        }
    }
}

fn open_source(root: &Path, path: &str) -> Result<std::fs::File> {
    use cap_std::fs::{Dir, OpenOptions, OpenOptionsExt};
    let invalid = |message: &str| DeliverableError::Invalid(message.into());
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
    let dir = Dir::open_ambient_dir(root, cap_std::ambient_authority())?;
    let mut options = OpenOptions::new();
    options.read(true).custom_flags(
        rustix::fs::OFlags::NONBLOCK
            .bits()
            .try_into()
            .map_err(DeliverableError::internal)?,
    );
    // Resolve components through directory handles with NOFOLLOW. This also prevents an
    // in-root symlink from entering another maker's .roundup Worktree via an innocent alias.
    let parent = Path::new(path).parent().unwrap_or_else(|| Path::new(""));
    let mut directory = dir.into_std_file();
    for part in parent.components() {
        directory = open_directory(&directory, part.as_os_str()).map_err(|e| {
            DeliverableError::Forbidden(format!("cannot read publication directory: {e}"))
        })?;
    }
    let dir = Dir::from_std_file(directory);
    options.custom_flags(
        (rustix::fs::OFlags::NONBLOCK | rustix::fs::OFlags::NOFOLLOW)
            .bits()
            .try_into()
            .map_err(DeliverableError::internal)?,
    );
    let filename = Path::new(path)
        .file_name()
        .ok_or_else(|| invalid("publication filename is absent"))?;
    let file = dir
        .open_with(filename, &options)
        .map_err(|e| DeliverableError::Forbidden(format!("cannot read publication source: {e}")))?
        .into_std();
    Ok(file)
}

fn capture(root: &Path, path: &str, worktree: bool) -> Result<(Vec<u8>, FileSource)> {
    use std::io::Read;
    use std::os::unix::fs::MetadataExt;
    let mut file = open_source(root, path)?;
    let before = file.metadata()?;
    if !before.is_file() || before.len() > MAX_BYTES as u64 || before.mode() & 0o444 == 0 {
        return Err(DeliverableError::Invalid(
            "source is not a readable regular file within 32 MiB".into(),
        ));
    }
    // One allocation: read_to_end from an empty Vec regrows by copying up to 32 MiB.
    let mut bytes = Vec::with_capacity(before.len() as usize + 1);
    file.by_ref()
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    observe("captured")?;
    let after = file.metadata()?;
    if bytes.len() > MAX_BYTES
        || before.len() != bytes.len() as u64
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(DeliverableError::Conflict(
            "publication source changed during capture".into(),
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

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct FileSource {
    root: PathBuf,
    path: String,
    worktree: bool,
    device: u64,
    inode: u64,
    created: String,
}

fn birth(meta: &std::fs::Metadata) -> Result<String> {
    Ok(meta
        .created()
        .map_err(|e| {
            DeliverableError::Forbidden(format!("source creation identity unavailable: {e}"))
        })?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(DeliverableError::internal)?
        .as_nanos()
        .to_string())
}

impl FileSource {
    pub(super) fn allowed(&self, db: &Connection, maker: &str) -> Result<bool> {
        if !self.root.exists() && self.worktree {
            // A removed maker's unregistered Worktree is cleanup, not a source denial.
            return Ok(!agents::registered_in(
                db,
                maker,
                &self.root.to_string_lossy(),
            )?);
        }
        // Opening the source, without reading its contents, also enforces ACLs. Mode bits
        // alone would incorrectly keep retained access after an ACL denied this reader.
        let Ok(file) = open_source(&self.root, &self.path) else {
            return Ok(false);
        };
        let metadata = file.metadata()?;
        use std::os::unix::fs::MetadataExt;
        if !metadata.is_file()
            || metadata.mode() & 0o444 == 0
            || metadata.dev() != self.device
            || metadata.ino() != self.inode
        {
            return Ok(false);
        }
        Ok(birth(&metadata)? == self.created)
    }
}
