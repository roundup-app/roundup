//! MC30, MC31: a Project folder on a Machine is reached through herdr-core's exec there, never
//! through this Mac's disk. `Git` runs each command, and each file check a Worktree needs, through
//! [`Machines`] when its Project has a Machine; with none it runs them here as before.

use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{Git, canonical_path};

/// A Machine's name and the program that runs commands on it.
pub(super) type Remote = (String, Arc<dyn Machines>);

/// Where a Machine's programs run: herdr-core's exec on it, answered once the program ends.
pub trait Machines: Send + Sync {
    fn exec(
        &self,
        machine: &str,
        cwd: &Path,
        argv: &[String],
        limit: Duration,
    ) -> Result<Output, String>;

    /// MC32: the file at `path` on `machine`, read by the core's file method. Never an exec of `cat`.
    fn read_file(&self, machine: &str, path: &Path) -> std::io::Result<String>;

    /// MC32: `bytes` as the file at `path` on `machine`, missing folders made, by the core's file
    /// method. Never an exec of `tee` or a shell redirect.
    fn write_file(&self, machine: &str, path: &Path, bytes: &[u8]) -> std::io::Result<()>;
}

/// The longest one `git` command of an unbounded operation may take on a Machine.
const GIT_LIMIT: Duration = Duration::from_secs(120);
/// The longest the Project's `check` may take on a Machine.
pub(super) const CHECK_LIMIT: Duration = Duration::from_secs(30 * 60);

pub(crate) fn argv<const N: usize>(parts: [&str; N]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

impl Git {
    /// Where this Project's folder lives; `None` is this Mac.
    pub fn set_machine(&self, machine: Option<String>) {
        *self.machine.write().unwrap_or_else(|e| e.into_inner()) = machine;
    }

    /// The program that runs commands on a Machine.
    pub fn set_host(&self, host: Arc<dyn Machines>) {
        *self.host.write().unwrap_or_else(|e| e.into_inner()) = Some(host);
    }

    pub(super) fn remote(&self) -> Result<Option<Remote>, String> {
        let machine = self
            .machine
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let Some(machine) = machine else {
            return Ok(None);
        };
        let host = self.host.read().unwrap_or_else(|e| e.into_inner()).clone();
        host.map(|host| Some((machine.clone(), host)))
            .ok_or_else(|| format!("no way to reach Machine {machine}"))
    }

    /// `argv` run in `cwd` where the Project's folder is: here, or on its Machine.
    pub(super) fn exec_on(
        &self,
        machine: &(String, Arc<dyn Machines>),
        cwd: &Path,
        argv: &[String],
        limit: Duration,
    ) -> Result<Output, String> {
        self.check_deadline()?;
        let limit = self.deadline.map_or(limit, |end| {
            end.saturating_duration_since(Instant::now()).min(limit)
        });
        machine.1.exec(&machine.0, cwd, argv, limit)
    }

    pub(super) fn output_remote(
        &self,
        machine: &(String, Arc<dyn Machines>),
        project: &Path,
        args: &[&str],
        input: Option<&str>,
    ) -> Result<Output, String> {
        let mut command = match input {
            Some(input) => argv([
                "sh",
                "-c",
                "i=$1; shift; printf %s \"$i\" | \"$@\"",
                "sh",
                input,
            ]),
            None => Vec::new(),
        };
        command.push("git".to_owned());
        command.extend(args.iter().map(|arg| (*arg).to_owned()));
        self.exec_on(machine, project, &command, GIT_LIMIT)
    }

    /// Whether `path` is a directory where the Project's folder is.
    pub(crate) fn is_dir(&self, path: &Path) -> bool {
        match self.remote() {
            Ok(Some(machine)) => self.test_on(&machine, "-d", path),
            _ => path.is_dir(),
        }
    }

    /// Whether `path` exists where the Project's folder is.
    pub(super) fn exists(&self, path: &Path) -> bool {
        match self.remote() {
            Ok(Some(machine)) => self.test_on(&machine, "-e", path),
            _ => path.exists(),
        }
    }

    fn test_on(&self, machine: &(String, Arc<dyn Machines>), flag: &str, path: &Path) -> bool {
        let command = argv(["test", flag, &path.to_string_lossy()]);
        self.exec_on(machine, Path::new("/"), &command, GIT_LIMIT)
            .is_ok_and(|out| out.status.success())
    }

    /// `path` as git lists it: resolved here, kept as written on a Machine, where a listing
    /// already names real paths.
    pub(super) fn listed_path(&self, path: &Path) -> PathBuf {
        match self.remote() {
            Ok(Some(_)) => path.to_owned(),
            _ => canonical_path(path),
        }
    }

    /// `path` with symlinks and `..` resolved where the Project's folder is.
    pub fn real_path(&self, path: &Path) -> std::io::Result<PathBuf> {
        let other = |message: String| std::io::Error::other(message);
        match self.remote().map_err(other)? {
            None => path.canonicalize(),
            Some(machine) => {
                let command = argv([
                    "sh",
                    "-c",
                    "cd \"$1\" && pwd -P",
                    "sh",
                    &path.to_string_lossy(),
                ]);
                let out = self
                    .exec_on(&machine, Path::new("/"), &command, GIT_LIMIT)
                    .map_err(other)?;
                if !out.status.success() {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        String::from_utf8_lossy(&out.stdout).trim().to_owned(),
                    ));
                }
                Ok(PathBuf::from(String::from_utf8_lossy(&out.stdout).trim()))
            }
        }
    }

    /// MC32: the text of `path` where the Project's folder is: this Mac's disk, or its Machine's
    /// file method. A missing file is `NotFound` in both.
    pub(super) fn read_file(&self, path: &Path) -> std::io::Result<String> {
        match self.remote().map_err(std::io::Error::other)? {
            None => std::fs::read_to_string(path),
            Some((machine, host)) => host.read_file(&machine, path),
        }
    }

    /// MC32: `bytes` as the file at `path` where the Project's folder is, missing folders made.
    pub(super) fn write_file(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        match self.remote().map_err(std::io::Error::other)? {
            None => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(path, bytes)
            }
            Some((machine, host)) => host.write_file(&machine, path, bytes),
        }
    }
}

impl Machines for terminal::Terminals {
    fn exec(
        &self,
        machine: &str,
        cwd: &Path,
        argv: &[String],
        limit: Duration,
    ) -> Result<Output, String> {
        use std::os::unix::process::ExitStatusExt;
        let handle = tokio::runtime::Handle::try_current()
            .map_err(|_| "no runtime to reach a Machine".to_owned())?;
        // Callers are blocking threads or runtime workers; either may wait on the core.
        let ran = tokio::task::block_in_place(|| {
            handle.block_on(self.exec(machine, argv, &cwd.to_string_lossy(), limit))
        })
        .map_err(|err| err.message)?;
        Ok(Output {
            status: std::process::ExitStatus::from_raw(ran.code.unwrap_or(1) << 8),
            stdout: ran.stdout,
            stderr: ran.stderr,
        })
    }

    fn read_file(&self, machine: &str, path: &Path) -> std::io::Result<String> {
        let handle = file_runtime()?;
        tokio::task::block_in_place(|| {
            handle.block_on(self.file_read(machine, &path.to_string_lossy()))
        })
        .map_err(io_error)
    }

    fn write_file(&self, machine: &str, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let handle = file_runtime()?;
        tokio::task::block_in_place(|| {
            handle.block_on(self.file_write(machine, &path.to_string_lossy(), bytes))
        })
        .map_err(io_error)
    }
}

fn file_runtime() -> std::io::Result<tokio::runtime::Handle> {
    tokio::runtime::Handle::try_current()
        .map_err(|_| std::io::Error::other("no runtime to reach a Machine"))
}

/// A core's `not_found` stays `NotFound`; every other failure keeps its code in the message.
fn io_error(err: terminal::FileError) -> std::io::Error {
    let kind = match err.code.as_str() {
        "not_found" => std::io::ErrorKind::NotFound,
        _ => std::io::ErrorKind::Other,
    };
    std::io::Error::new(kind, err.to_string())
}

#[cfg(test)]
#[path = "remote_tests.rs"]
mod tests;
