//! Git command serialization, bounded output and process-group cleanup.

use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::{MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use super::Git;

impl Git {
    fn hold(&self) -> Result<MutexGuard<'_, ()>, String> {
        if self.deadline.is_none() {
            return Ok(self.lock.lock().unwrap_or_else(|err| err.into_inner()));
        }
        loop {
            self.check_deadline()?;
            match self.lock.try_lock() {
                Ok(hold) => return Ok(hold),
                Err(TryLockError::Poisoned(err)) => return Ok(err.into_inner()),
                Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(5)),
            }
        }
    }

    pub(super) fn check_deadline(&self) -> Result<(), String> {
        if self.deadline.is_some_and(|end| Instant::now() >= end) {
            Err("Git deadline exceeded".into())
        } else {
            Ok(())
        }
    }

    pub(super) fn output(
        &self,
        project: &Path,
        args: &[&str],
        input: Option<&str>,
    ) -> Result<Output, String> {
        let _hold = self.hold()?;
        let stdin = match input {
            Some(input) => {
                let mut file = tempfile::tempfile().map_err(|err| err.to_string())?;
                file.write_all(input.as_bytes())
                    .map_err(|err| err.to_string())?;
                std::io::Seek::rewind(&mut file).map_err(|err| err.to_string())?;
                Stdio::from(file)
            }
            None => Stdio::null(),
        };
        let mut command = Command::new("git");
        command
            .current_dir(project)
            .env("PATH", &self.path)
            .args(args)
            .stdin(stdin);
        // Landing retains its configured check and Git/hook lifetime, including rollback.
        if self.deadline.is_none() {
            return command.output().map_err(|err| err.to_string());
        }
        // Files avoid pipe backpressure and inherited hook pipes keeping collection alive.
        let mut stdout = tempfile::tempfile().map_err(|err| err.to_string())?;
        let mut stderr = tempfile::tempfile().map_err(|err| err.to_string())?;
        let mut child = command
            .stdout(stdout.try_clone().map_err(|err| err.to_string())?)
            .stderr(stderr.try_clone().map_err(|err| err.to_string())?)
            .process_group(0)
            .spawn()
            .map_err(|err| err.to_string())?;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {}
                Err(err) => break Err(err.to_string()),
            }
            if let Err(err) = check_output_size(&stdout, &stderr) {
                break Err(err);
            }
            if let Err(err) = self.check_deadline() {
                break Err(err);
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        // A hook can spawn descendants even when Git has exited. End the entire owned group.
        if let Some(pid) = i32::try_from(child.id())
            .ok()
            .and_then(rustix::process::Pid::from_raw)
        {
            let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        }
        if status.is_err() {
            let _ = child.wait();
        }
        let status = status?;
        check_output_size(&stdout, &stderr)?;
        std::io::Seek::rewind(&mut stdout).map_err(|err| err.to_string())?;
        std::io::Seek::rewind(&mut stderr).map_err(|err| err.to_string())?;
        let mut output = Output {
            status,
            stdout: Vec::new(),
            stderr: Vec::new(),
        };
        stdout
            .read_to_end(&mut output.stdout)
            .map_err(|err| err.to_string())?;
        stderr
            .read_to_end(&mut output.stderr)
            .map_err(|err| err.to_string())?;
        Ok(output)
    }
}

fn check_output_size(stdout: &std::fs::File, stderr: &std::fs::File) -> Result<(), String> {
    if stdout.metadata().map_err(|err| err.to_string())?.len() > 16 * 1024 * 1024
        || stderr.metadata().map_err(|err| err.to_string())?.len() > 1024 * 1024
    {
        Err("Git output exceeds comparison budget".into())
    } else {
        Ok(())
    }
}
