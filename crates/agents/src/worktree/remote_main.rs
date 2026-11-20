//! U7693: whether the remote's main has moved, and fetching it. Both calls talk to the network, so
//! neither holds the runner's lock (`Git::hold`) while it waits: a read of the same Project's
//! files answers meanwhile.

use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use wait_timeout::ChildExt;

use contracts::agent::{FetchedMain, RemoteMain};
use rpc::RpcError;

use super::Git;
use super::error::WorktreeError;
use super::remote::argv;

const READ_LIMIT: Duration = Duration::from_secs(5);
const FETCH_LIMIT: Duration = Duration::from_secs(60);

/// Never a prompt: git asks nothing on a terminal and ssh runs in batch mode, on top of the
/// owner's own ssh command (`GIT_SSH_COMMAND`, else `core.sshCommand`, else `ssh`).
const NEVER_PROMPT: &str = r#"GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-$(git config --get core.sshCommand || echo ssh)} -o BatchMode=yes" exec git "$@""#;

/// The remote's default branch as the repository last fetched it: its name and the commit id
/// `refs/remotes/origin/<name>` holds. `None` with no `origin` or no `origin/HEAD`.
struct Fetched {
    name: String,
    id: String,
}

fn unreachable(cause: impl Into<String>) -> RpcError {
    WorktreeError::RemoteUnreachable(cause.into()).into()
}

impl Git {
    fn fetched_main(&self, repo: &Path) -> Option<Fetched> {
        let full = self
            .run(
                repo,
                &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
            )
            .ok()?;
        let name = full.strip_prefix("origin/")?.to_owned();
        let id = self
            .run(
                repo,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("refs/remotes/origin/{name}^{{commit}}"),
                ],
            )
            .ok()?;
        Some(Fetched { name, id })
    }

    /// One `ls-remote` of the default branch against the ref the repository holds; nothing is
    /// fetched, written or counted.
    pub fn remote_main(&self, repo: &Path) -> Result<RemoteMain, RpcError> {
        let Some(local) = self.fetched_main(repo) else {
            return Ok(RemoteMain::None);
        };
        let reference = format!("refs/heads/{}", local.name);
        let out = self.network(repo, &["ls-remote", "origin", &reference], READ_LIMIT)?;
        let remote = out
            .lines()
            .find_map(|line| line.split_once('\t').filter(|(_, name)| *name == reference))
            .map(|(id, _)| id)
            .ok_or_else(|| unreachable(format!("the remote has no branch {}", local.name)))?;
        Ok(if remote == local.id {
            RemoteMain::Current
        } else {
            RemoteMain::Moved
        })
    }

    /// Fetch the default branch into `refs/remotes/origin/<it>` alone, and count the commits
    /// that brought onto it. No pull, merge or rebase: the folder is untouched.
    pub fn fetch_remote_main(&self, repo: &Path) -> Result<FetchedMain, RpcError> {
        let Some(before) = self.fetched_main(repo) else {
            return Err(unreachable("the repository has no remote main to fetch"));
        };
        let refspec = format!("+refs/heads/{0}:refs/remotes/origin/{0}", before.name);
        self.network(
            repo,
            &[
                "-c",
                "gc.auto=0",
                "-c",
                "maintenance.auto=false",
                "fetch",
                "--no-tags",
                "--no-write-fetch-head",
                "--no-recurse-submodules",
                "origin",
                &refspec,
            ],
            FETCH_LIMIT,
        )?;
        let after = self
            .fetched_main(repo)
            .ok_or_else(|| unreachable("the fetch left no remote main"))?;
        let commits = self
            .run(
                repo,
                &["rev-list", "--count", &after.id, &format!("^{}", before.id)],
            )
            .map_err(unreachable)?
            .parse()
            .unwrap_or(0);
        Ok(FetchedMain { commits })
    }

    /// `git <args>` in `repo`, here or on the Project's Machine, never prompting and ended after
    /// `limit`. Stdout on success; git's stderr in full on failure.
    fn network(&self, repo: &Path, args: &[&str], limit: Duration) -> Result<String, RpcError> {
        let limit = self.network_limit.unwrap_or(limit);
        let mut command = argv(["sh", "-c", NEVER_PROMPT, "sh"]);
        command.extend(args.iter().map(|arg| (*arg).to_owned()));
        let (status, stdout, stderr) = match self.remote().map_err(unreachable)? {
            Some(machine) => {
                let out = self
                    .exec_on(&machine, repo, &command, limit)
                    .map_err(unreachable)?;
                (out.status, out.stdout, out.stderr)
            }
            None => self.spawn_bounded(repo, &command, limit)?,
        };
        if status.success() {
            return Ok(String::from_utf8_lossy(&stdout).trim_end().to_owned());
        }
        let cause = String::from_utf8_lossy(&stderr).trim().to_owned();
        Err(unreachable(if cause.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            cause
        }))
    }

    fn spawn_bounded(
        &self,
        repo: &Path,
        command: &[String],
        limit: Duration,
    ) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), RpcError> {
        let io = |err: std::io::Error| unreachable(err.to_string());
        let mut stdout = tempfile::tempfile().map_err(io)?;
        let mut stderr = tempfile::tempfile().map_err(io)?;
        let mut child = Command::new(&command[0])
            .args(&command[1..])
            .current_dir(repo)
            .env("PATH", &self.path)
            .stdin(Stdio::null())
            .stdout(stdout.try_clone().map_err(io)?)
            .stderr(stderr.try_clone().map_err(io)?)
            .process_group(0)
            .spawn()
            .map_err(io)?;
        let waited = child.wait_timeout(limit).map_err(io);
        // The group ends whether git finished or not: a hook or ssh must not outlive the call.
        if let Some(pid) = i32::try_from(child.id())
            .ok()
            .and_then(rustix::process::Pid::from_raw)
        {
            let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
        }
        let Some(status) = waited? else {
            let _ = child.wait();
            return Err(unreachable(format!(
                "the remote did not answer within {} ms",
                limit.as_millis()
            )));
        };
        let read = |file: &mut std::fs::File| {
            let mut bytes = Vec::new();
            std::io::Seek::rewind(file)
                .and_then(|()| file.read_to_end(&mut bytes))
                .map_err(io)?;
            Ok::<_, RpcError>(bytes)
        };
        Ok((status, read(&mut stdout)?, read(&mut stderr)?))
    }
}
