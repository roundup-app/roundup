//! MC20, MC21: an Agent's sequence number on this machine, durable across `rup` runs and reboots.
//! `<dir>/seq/<agent>` holds the last `seq` handed out; it is written and fsynced before the
//! number is used, so a crash after it skips a number and never repeats one.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

use rustix::fs::{FlockOperation, flock};

/// `$RUPQ_DIR`, else `~/.rupq`.
fn root() -> io::Result<PathBuf> {
    if let Some(dir) = std::env::var_os("RUPQ_DIR") {
        return Ok(dir.into());
    }
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".rupq"))
        .ok_or_else(|| io::Error::other("neither RUPQ_DIR nor HOME is set"))
}

/// The next `seq` of `agent`, from 1, increasing by 1, and the report id `<agent>:<seq>`.
pub fn next(agent: &str) -> io::Result<String> {
    next_in(&root()?, agent)
}

fn next_in(root: &std::path::Path, agent: &str) -> io::Result<String> {
    if agent.is_empty() || agent.contains(['/', ':', '\0']) || agent.starts_with('.') {
        return Err(io::Error::other("the agent id cannot name a sequence file"));
    }
    let dir = root.join("seq");
    fs::create_dir_all(&dir)?;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join(agent))?;
    // Two hooks of one Agent never read the same number.
    flock(&file, FlockOperation::LockExclusive)?;
    let seq = last(&mut file)? + 1;
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(seq.to_string().as_bytes())?;
    file.sync_all()?;
    File::open(&dir)?.sync_all()?;
    Ok(format!("{agent}:{seq}"))
}

fn last(file: &mut File) -> io::Result<u64> {
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    match text.trim() {
        "" => Ok(0),
        n => n
            .parse()
            .map_err(|_| io::Error::other("the sequence file is not a number")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mc21_seq_never_repeats_across_a_rup_restart() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(next_in(dir.path(), "a1").unwrap(), "a1:1");
        assert_eq!(next_in(dir.path(), "a1").unwrap(), "a1:2");
        assert_eq!(next_in(dir.path(), "b2").unwrap(), "b2:1");
        assert!(next_in(dir.path(), "../x").is_err());
    }
}
