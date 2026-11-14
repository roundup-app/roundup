//! MC30, MC31: a Project folder on a Machine is reached through herdr-core's exec there, never
//! through this Mac's disk. `Git` runs each command, and each file check a Worktree needs, through
//! [`Machines`] when its Project has a Machine; with none it runs them here as before.

use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{Git, canonical_path};

/// Where a Machine's programs run: herdr-core's exec on it, answered once the program ends.
pub trait Machines: Send + Sync {
    fn exec(
        &self,
        machine: &str,
        cwd: &Path,
        argv: &[String],
        limit: Duration,
    ) -> Result<Output, String>;
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

    pub(super) fn remote(&self) -> Result<Option<(String, Arc<dyn Machines>)>, String> {
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

    /// G2: `.roundup/` in the repository's `info/exclude`, once, where the Project's folder is.
    pub(super) fn exclude_on(
        &self,
        machine: &(String, Arc<dyn Machines>),
        exclude: &Path,
    ) -> Result<(), String> {
        let script = "mkdir -p \"$(dirname \"$1\")\" && touch \"$1\" && \
            { grep -qx '[[:space:]]*\\.roundup/[[:space:]]*' \"$1\" || \
            { [ -z \"$(tail -c1 \"$1\")\" ] || echo >>\"$1\"; echo .roundup/ >>\"$1\"; }; }";
        let command = argv(["sh", "-c", script, "sh", &exclude.to_string_lossy()]);
        let out = self.exec_on(machine, Path::new("/"), &command, GIT_LIMIT)?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
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
}

#[cfg(test)]
#[path = "remote_tests.rs"]
mod tests;
