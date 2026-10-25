//! File-backed storage: each Pad is `<dir>/<name>.md`. Callers validate names first; a name the file system still refuses is reported as invalid params.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use rpc::RpcError;
use tempfile::NamedTempFile;

/// Atomic: a temp file in the same directory, then a rename.
pub fn write(dir: &Path, name: &str, text: &str) -> Result<(), RpcError> {
    let write = || -> io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let mut temp = NamedTempFile::new_in(dir)?;
        temp.write_all(text.as_bytes())?;
        temp.persist(path(dir, name)).map_err(|err| err.error)?;
        Ok(())
    };
    write().map_err(|err| refused(err, name))
}

/// `None` when the file does not exist.
pub fn read(dir: &Path, name: &str) -> Result<Option<String>, RpcError> {
    match std::fs::read_to_string(path(dir, name)) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(refused(err, name)),
    }
}

fn path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.md"))
}

/// The file system refusing a name (too long, or code points it cannot store) is the caller's mistake; anything else is ours.
fn refused(err: io::Error, name: &str) -> RpcError {
    let invalid =
        err.kind() == io::ErrorKind::InvalidFilename || err.raw_os_error() == Some(libc::EILSEQ);
    let code = if invalid {
        rpc::code::INVALID_PARAMS
    } else {
        rpc::code::INTERNAL
    };
    RpcError::new(code, format!("pad file {name}.md: {err}"))
}

/// Create a mirror without replacing any existing file. Dropping the path rolls it back;
/// keep it only after SQLite commits, so a refused restore leaves both holders unchanged.
pub fn restore(dir: &Path, name: &str, text: &str) -> Result<tempfile::TempPath, RpcError> {
    std::fs::create_dir_all(dir).map_err(|e| refused(e, name))?;
    let mut temp = NamedTempFile::new_in(dir).map_err(|e| refused(e, name))?;
    temp.write_all(text.as_bytes())
        .map_err(|e| refused(e, name))?;
    let target = path(dir, name);
    temp.persist_noclobber(&target)
        .map_err(|e| refused(e.error, name))?;
    tempfile::TempPath::try_from_path(target).map_err(|e| refused(e, name))
}
