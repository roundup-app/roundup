//! Git command serialization, bounded output and process-group cleanup.

use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

use super::Git;

impl Git {
    fn hold(&self) -> Result<Guard<'_>, String> {
        self.check_deadline()?;
        let (lock, released) = &*self.lock;
        let busy = lock.lock().unwrap_or_else(|err| {
            lock.clear_poison();
            err.into_inner()
        });
        let mut busy = match self.deadline {
            Some(deadline) => {
                let (busy, _) = released
                    .wait_timeout_while(
                        busy,
                        deadline.saturating_duration_since(Instant::now()),
                        |busy| *busy,
                    )
                    .unwrap_or_else(|err| err.into_inner());
                self.check_deadline()?;
                busy
            }
            None => released
                .wait_while(busy, |busy| *busy)
                .unwrap_or_else(|err| err.into_inner()),
        };
        *busy = true;
        Ok(Guard(self))
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
        let Some(deadline) = self.deadline else {
            return command.output().map_err(|err| err.to_string());
        };
        // Files avoid pipe backpressure and inherited hook pipes keeping collection alive.
        let mut stdout = tempfile::tempfile().map_err(|err| err.to_string())?;
        let mut stderr = tempfile::tempfile().map_err(|err| err.to_string())?;
        command
            .stdout(stdout.try_clone().map_err(|err| err.to_string())?)
            .stderr(stderr.try_clone().map_err(|err| err.to_string())?)
            .process_group(0);
        self.check_deadline()?;
        let mut child = command.spawn().map_err(|err| err.to_string())?;
        let status = loop {
            // Retain output-limit checks without waiting past the operation's shared budget.
            let pause =
                Duration::from_millis(5).min(deadline.saturating_duration_since(Instant::now()));
            match child.wait_timeout(pause) {
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

// Keep IO outside the state mutex so bounded contenders can reach their own timeout.
struct Guard<'a>(&'a Git);

impl Drop for Guard<'_> {
    fn drop(&mut self) {
        let (lock, released) = &*self.0.lock;
        *lock.lock().unwrap_or_else(|err| {
            lock.clear_poison();
            err.into_inner()
        }) = false;
        // A waiter waking after its deadline must not strand the other contenders.
        released.notify_all();
    }
}
