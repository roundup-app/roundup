//! Git worktrees for Agents (G1/G2, `scenarios/worktrees.md`). The `git` command, run with
//! `std::process::Command` and no shell: `git worktree add` and `git branch` are the same
//! operations a user runs, and the user's own hooks and config apply (`docs/worktrees.md`).
//! `git2` is rejected there: a native dependency whose rebase reports conflicts differently.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, TryLockError};
use std::time::{Duration, Instant};

use contracts::agent::{ChangedFile, ChangedFiles, ChangedStatus, WorktreeState};
use rpc::{RpcError, code};

/// What provisioning makes. `RailNode.worktree` (`contracts::agent::Worktree`) stores the same
/// three values as strings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub base: String,
}

#[derive(Clone, Debug)]
pub struct Provision {
    pub worktree: Worktree,
    pub commit: String,
    pub owner: String,
}

impl From<&contracts::agent::Worktree> for Worktree {
    fn from(record: &contracts::agent::Worktree) -> Self {
        Self {
            path: PathBuf::from(&record.path),
            branch: record.branch.clone(),
            base: record.base.clone(),
        }
    }
}

/// Runs one Project's `git`, one command at a time: `git worktree add` and the rest take the
/// repository's locks, and two Agents provisioned at once would otherwise fail on `index.lock`.
#[derive(Clone)]
pub struct Git {
    /// Resolves the `git` binary. A test prepends a wrapper's directory, with the real `PATH`
    /// after it, so every command the wrapper does not fake still reaches the real `git`.
    path: OsString,
    lock: Arc<Mutex<()>>,
    /// G2542: canonical paths of enrolled directories; removal and recovery retain them.
    enrolled: Arc<RwLock<Vec<PathBuf>>>,
    /// G2542c: directories a preparation is running in.
    busy: Arc<Mutex<Vec<PathBuf>>>,
    deadline: Option<Instant>,
}

impl Git {
    pub fn from_env() -> Self {
        Self::with_path(std::env::var_os("PATH").unwrap_or_default())
    }

    pub fn with_path(path: impl Into<OsString>) -> Self {
        Self {
            path: path.into(),
            lock: Arc::new(Mutex::new(())),
            enrolled: Arc::new(RwLock::new(Vec::new())),
            busy: Arc::new(Mutex::new(Vec::new())),
            deadline: None,
        }
    }

    /// One budget covers lock acquisition and every command in an App-facing operation.
    pub(crate) fn bounded(&self) -> Self {
        Self {
            deadline: Some(Instant::now() + Duration::from_secs(3)),
            ..self.clone()
        }
    }

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

    fn check_deadline(&self) -> Result<(), String> {
        if self.deadline.is_some_and(|end| Instant::now() >= end) {
            Err("Git deadline exceeded".into())
        } else {
            Ok(())
        }
    }

    fn output(&self, project: &Path, args: &[&str], input: Option<&str>) -> Result<Output, String> {
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

    fn run(&self, project: &Path, args: &[&str]) -> Result<String, String> {
        let output = self.output(project, args, None)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if stderr.is_empty() {
                format!("git {} failed", args.join(" "))
            } else {
                stderr
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    pub fn plan(&self, project: &Path, id: &str, attempt: &str) -> Result<Provision, RpcError> {
        let commit = self.run(project, &["rev-parse", "HEAD"]).map_err(|err| {
            if self.check_deadline().is_err() {
                failed(err)
            } else {
                invalid("not_a_git_project", project.display())
            }
        })?;
        let base = self
            .run(project, &["symbolic-ref", "--short", "HEAD"])
            .map_err(|err| {
                if self.check_deadline().is_err() {
                    failed(err)
                } else {
                    invalid("no_base", "HEAD is detached")
                }
            })?;
        let worktree = Worktree {
            path: worktree_path(project, id),
            branch: format!("roundup/agent-{id}"),
            base,
        };
        if worktree.path.exists()
            || self
                .reference(project, &format!("refs/heads/{}", worktree.branch))?
                .is_some()
        {
            return Err(failed("provisioning destination already exists"));
        }
        Ok(Provision {
            worktree,
            commit,
            owner: format!("refs/roundup/provisioning/{id}/{attempt}"),
        })
    }

    pub fn provision(&self, project: &Path, plan: &Provision) -> Result<Worktree, RpcError> {
        let input = format!(
            "start\ncreate refs/heads/{} {}\ncreate {} {}\nprepare\ncommit\n",
            plan.worktree.branch, plan.commit, plan.owner, plan.commit
        );
        self.update_refs(project, &input)?;
        let result = (|| {
            self.run(
                project,
                &[
                    "worktree",
                    "add",
                    &plan.worktree.path.to_string_lossy(),
                    &plan.worktree.branch,
                ],
            )
            .map_err(failed)?;
            let exclude = self
                .run(project, &["rev-parse", "--git-path", "info/exclude"])
                .map_err(failed)?;
            exclude_worktrees(&project.join(exclude)).map_err(failed)?;
            Ok(plan.worktree.clone())
        })();
        if result.is_err() {
            if self.deadline.is_some() {
                self.bounded().recover(project, plan)?;
            } else {
                self.recover(project, plan)?;
            }
        }
        result
    }

    fn reference(&self, project: &Path, reference: &str) -> Result<Option<String>, RpcError> {
        let output = self
            .output(
                project,
                &["show-ref", "--verify", "--hash", reference],
                None,
            )
            .map_err(failed)?;
        if output.status.success() {
            return Ok(Some(String::from_utf8_lossy(&output.stdout).trim().into()));
        }
        if output.status.code() == Some(1) {
            return Ok(None);
        }
        // show-ref reports an absent exact ref as 128 on older Git versions.
        if !self
            .run(project, &["for-each-ref", "--format=%(refname)", reference])
            .map_err(failed)?
            .lines()
            .any(|line| line == reference)
        {
            return Ok(None);
        }
        Err(failed(String::from_utf8_lossy(&output.stderr)))
    }

    fn update_refs(&self, project: &Path, input: &str) -> Result<(), RpcError> {
        let output = self
            .output(project, &["update-ref", "--stdin"], Some(input))
            .map_err(failed)?;
        if !output.status.success() {
            return Err(failed(String::from_utf8_lossy(&output.stderr)));
        }
        Ok(())
    }

    pub fn finish(&self, project: &Path, plan: &Provision) -> Result<(), RpcError> {
        if let Some(owner) = self.reference(project, &plan.owner)? {
            if owner != plan.commit {
                return Err(failed("provisioning ownership changed"));
            }
            self.run(project, &["update-ref", "-d", &plan.owner, &plan.commit])
                .map_err(failed)?;
        }
        Ok(())
    }

    pub fn recover(&self, project: &Path, plan: &Provision) -> Result<(), RpcError> {
        if self.is_enrolled(&plan.worktree.path) {
            return self.recover_prepared(project, plan);
        }
        let branch_ref = format!("refs/heads/{}", plan.worktree.branch);
        let branch = self.reference(project, &branch_ref)?;
        let owner = self.reference(project, &plan.owner)?;
        if owner.is_none() {
            if branch.is_some() || plan.worktree.path.exists() {
                return Err(failed("unowned provisioning destination; preserving it"));
            }
            return Ok(());
        }
        if owner.as_deref() != Some(&plan.commit)
            || branch.as_ref().is_some_and(|head| head != &plan.commit)
        {
            return Err(failed(
                "provisioning ownership or branch changed; preserving it",
            ));
        }
        let expected_path = canonical_path(&plan.worktree.path);
        let mut registered = false;
        for (path, reference) in self.registered_worktrees(project)? {
            if path == expected_path {
                if reference.as_deref() != Some(&branch_ref) {
                    return Err(failed("provisioning path belongs to another branch"));
                }
                registered = true;
            } else if reference.as_deref() == Some(&branch_ref) {
                return Err(failed("provisioning branch belongs to another path"));
            }
        }
        if plan.worktree.path.exists() {
            if !registered {
                return Err(failed("provisioning path is not its registered Worktree"));
            }
            if !self
                .run(&plan.worktree.path, &["status", "--porcelain"])
                .map_err(failed)?
                .is_empty()
            {
                return Err(failed("unfinished Worktree has edits; preserving it"));
            }
        }
        if registered {
            self.run(
                project,
                &["worktree", "remove", &plan.worktree.path.to_string_lossy()],
            )
            .map_err(failed)?;
        }
        if branch.is_some() {
            self.run(project, &["update-ref", "-d", &branch_ref, &plan.commit])
                .map_err(failed)?;
        }
        self.finish(project, plan)
    }

    /// A22: the saved Worktree still names a real directory on its saved branch, checked against
    /// Git itself rather than trusted from the record. The directory's cleanliness is not this
    /// check's concern (resume never cares whether it is landed).
    pub fn verify_resumable(&self, project: &Path, worktree: &Worktree) -> Result<(), RpcError> {
        if !worktree.path.is_dir() {
            return Err(RpcError::conflict(format!(
                "worktree_missing: {}",
                worktree.path.display()
            )));
        }
        let branch_ref = format!("refs/heads/{}", worktree.branch);
        if self.reference(project, &branch_ref)?.is_none() {
            return Err(RpcError::conflict(format!(
                "worktree_branch_missing: {}",
                worktree.branch
            )));
        }
        let expected_path = canonical_path(&worktree.path);
        match self
            .registered_worktrees(project)?
            .into_iter()
            .find(|(path, _)| *path == expected_path)
        {
            Some((_, Some(reference))) if reference == branch_ref => Ok(()),
            Some((_, Some(_))) => Err(RpcError::conflict(
                "worktree_mismatched: registered to another branch",
            )),
            Some((_, None)) => Err(RpcError::conflict(
                "worktree_detached: no branch checked out",
            )),
            None => Err(RpcError::conflict("worktree_unregistered")),
        }
    }

    /// G3: `ahead` and `behind` between the branch and its Base, and whether the Worktree has
    /// changes outside `.roundup/`. Runs no command that writes.
    pub fn state(&self, project: &Path, worktree: &Worktree) -> Result<WorktreeState, RpcError> {
        if !worktree.path.is_dir() {
            return Err(RpcError::new(
                code::NOT_FOUND,
                format!("worktree_missing: {}", worktree.path.display()),
            ));
        }
        let range = format!("{}...refs/heads/{}", worktree.base, worktree.branch);
        let counts = self
            .run(project, &["rev-list", "--left-right", "--count", &range])
            .map_err(failed)?;
        let mut counts = counts.split_whitespace().map(|n| n.parse::<u32>());
        let (Some(Ok(behind)), Some(Ok(ahead))) = (counts.next(), counts.next()) else {
            return Err(failed("unreadable commit counts"));
        };
        Ok(WorktreeState {
            ahead,
            behind,
            dirty: self.dirty(worktree)?,
        })
    }

    /// U2539a: the files the Worktree's working tree differs in from the merge base of its branch
    /// and its Base, outside `.roundup/`, sorted by path. Runs no command that writes.
    pub fn changed_files(&self, worktree: &Worktree) -> Result<ChangedFiles, RpcError> {
        if !worktree.path.is_dir() {
            return Err(RpcError::new(
                code::NOT_FOUND,
                format!("worktree_missing: {}", worktree.path.display()),
            ));
        }
        let dir = &worktree.path;
        let base = self
            .run(dir, &["merge-base", &worktree.base, "HEAD"])
            .map_err(failed)?;
        let diff = [
            "--no-optional-locks",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "-M",
        ];
        let names = self
            .run(dir, &[&diff[..], &["-z", "--name-status", &base]].concat())
            .map_err(failed)?;
        let patch = self
            .run(dir, &[&diff[..], &["-U0", &base]].concat())
            .map_err(failed)?;
        // Both outputs list the files in the same order, one patch section per name-status entry.
        let mut sections = patch.split("\ndiff --git ").map(first_changed_line);
        let mut fields = names.split('\0').filter(|field| !field.is_empty());
        let mut files = Vec::new();
        while let Some(letter) = fields.next() {
            let renamed = letter.starts_with('R') || letter.starts_with('C');
            let from = if renamed { fields.next() } else { None };
            let Some(path) = fields.next() else { break };
            let line = sections.next().flatten();
            let status = match letter.as_bytes()[0] {
                b'A' => ChangedStatus::Added,
                b'D' => ChangedStatus::Deleted,
                b'R' | b'C' => ChangedStatus::Renamed,
                _ => ChangedStatus::Modified,
            };
            let line = if status == ChangedStatus::Deleted {
                None
            } else {
                line
            };
            files.push(ChangedFile {
                path: path.to_owned(),
                status,
                line,
                from: from.map(str::to_owned),
            });
        }
        let untracked = self
            .run(
                dir,
                &[
                    "--no-optional-locks",
                    "ls-files",
                    "-z",
                    "--others",
                    "--exclude-standard",
                ],
            )
            .map_err(failed)?;
        for path in untracked.split('\0').filter(|path| !path.is_empty()) {
            files.push(ChangedFile {
                path: path.to_owned(),
                status: ChangedStatus::Untracked,
                line: untracked_line(&dir.join(path)),
                from: None,
            });
        }
        files.retain(|file| !file.path.starts_with(".roundup/"));
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(ChangedFiles { files })
    }

    /// Whether the Worktree has a staged, unstaged or untracked change outside `.roundup/`.
    fn dirty(&self, worktree: &Worktree) -> Result<bool, RpcError> {
        let status = self
            .run(
                &worktree.path,
                &[
                    "--no-optional-locks",
                    "status",
                    "--porcelain",
                    "-z",
                    "--untracked-files=all",
                ],
            )
            .map_err(failed)?;
        Ok(status
            .split('\0')
            .filter(|entry| !entry.is_empty())
            .any(|entry| !entry.get(3..).is_some_and(|p| p.starts_with(".roundup/"))))
    }

    /// The entries the Worktree's directory changed, and the commits its branch holds that the
    /// Base lacks. A directory or branch already gone counts for none.
    pub fn unlanded(&self, project: &Path, worktree: &Worktree) -> Result<(usize, u64), RpcError> {
        let dirty = if worktree.path.exists() {
            self.run(
                &worktree.path,
                &["status", "--porcelain", "-z", "--untracked-files=all"],
            )
            .map_err(failed)?
            .split('\0')
            .filter(|entry| !entry.is_empty())
            .count()
        } else {
            0
        };
        let ahead = match self.reference(project, &format!("refs/heads/{}", worktree.branch))? {
            Some(head) => self
                .run(
                    project,
                    &["rev-list", "--count", &format!("{}..{head}", worktree.base)],
                )
                .map_err(failed)?,
            None if !worktree.path.exists() => "0".into(),
            None => return Err(failed("recorded Worktree branch is missing")),
        };
        let ahead = ahead.trim().parse().map_err(failed)?;
        Ok((dirty, ahead))
    }

    pub fn require_landed(&self, project: &Path, worktree: &Worktree) -> Result<(), RpcError> {
        let (dirty, ahead) = self.unlanded(project, worktree)?;
        if dirty != 0 || ahead != 0 {
            return Err(RpcError::conflict(format!(
                "worktree_unlanded: dirty {dirty}, ahead {ahead}"
            )));
        }
        Ok(())
    }

    /// G4: rebase the branch onto the Base, run `check` in the Worktree, fast-forward the Base.
    /// Every failure leaves the branch, the Worktree and the Base as they were. The checks run in
    /// the order the scenario lists, so one code wins when several hold.
    pub fn land(
        &self,
        project: &Path,
        worktree: &Worktree,
        check: Option<&str>,
    ) -> Result<String, RpcError> {
        if !worktree.path.is_dir() {
            return Err(RpcError::new(
                code::NOT_FOUND,
                format!("worktree_missing: {}", worktree.path.display()),
            ));
        }
        let Some(check) = check else {
            return Err(RpcError::conflict(
                "check_missing: the Project has no check; set one with project.setWorktrees",
            ));
        };
        if self.dirty(worktree)? {
            return Err(RpcError::conflict(
                "worktree_dirty: the Worktree has changes",
            ));
        }
        let base_ref = format!("refs/heads/{}", worktree.base);
        let moved =
            || RpcError::conflict(format!("base_moved: {} is not checked out", worktree.base));
        let checked_out = self.run(project, &["symbolic-ref", "HEAD"]).ok();
        if checked_out.as_deref() != Some(&base_ref)
            || self.reference(project, &base_ref)?.is_none()
        {
            return Err(moved());
        }
        let before = self
            .run(&worktree.path, &["rev-parse", "HEAD"])
            .map_err(failed)?;
        let undo =
            |err: RpcError| match self.run(&worktree.path, &["reset", "--hard", "-q", &before]) {
                Ok(_) => {
                    let _ = self.run(&worktree.path, &["clean", "-fdq"]);
                    err
                }
                Err(reset) => failed(format!("{err}; could not restore the branch: {reset}")),
            };

        if let Err(err) = self.run(&worktree.path, &["rebase", &base_ref]) {
            let paths = self
                .run(&worktree.path, &["diff", "--name-only", "--diff-filter=U"])
                .unwrap_or_default();
            self.run(&worktree.path, &["rebase", "--abort"])
                .map_err(|abort| failed(format!("could not abort the rebase: {abort}")))?;
            return Err(if paths.is_empty() {
                failed(err)
            } else {
                RpcError::conflict(format!(
                    "landing_conflict: {}",
                    paths.lines().collect::<Vec<_>>().join(", ")
                ))
            });
        }

        let output = Command::new("sh")
            .current_dir(&worktree.path)
            .args(["-c", "exec 2>&1; eval \"$1\"", "sh", check])
            .stdin(Stdio::null())
            .output()
            .map_err(|err| undo(failed(err)))?;
        if !output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = text.lines().collect();
            let tail = lines[lines.len().saturating_sub(20)..].join("\n");
            return Err(undo(RpcError::conflict(format!("check_failed: {tail}"))));
        }
        if self.dirty(worktree).map_err(undo)? {
            return Err(undo(RpcError::conflict("check_failed: check left changes")));
        }

        let touched = self
            .run(
                project,
                &["diff", "--name-only", "-z", &base_ref, &worktree.branch],
            )
            .map_err(|err| undo(failed(err)))?;
        let touched: Vec<&str> = touched.split('\0').filter(|p| !p.is_empty()).collect();
        let status = self
            .run(
                project,
                &[
                    "--no-optional-locks",
                    "status",
                    "--porcelain",
                    "-z",
                    "--untracked-files=all",
                ],
            )
            .map_err(|err| undo(failed(err)))?;
        let mut entries = status.split('\0').filter(|e| !e.is_empty());
        while let Some(entry) = entries.next() {
            let path = entry.get(3..).unwrap_or_default();
            if matches!(entry.get(..1), Some("R" | "C")) {
                entries.next();
            }
            if touched.contains(&path) {
                return Err(undo(RpcError::conflict(format!(
                    "base_dirty: {path} has changes in the Project folder"
                ))));
            }
        }
        if self
            .run(project, &["merge", "--ff-only", "-q", &worktree.branch])
            .is_err()
        {
            return Err(undo(moved()));
        }
        self.run(project, &["rev-parse", &base_ref]).map_err(failed)
    }

    /// G5: delete the Worktree's directory and branch whatever their state; a directory already
    /// gone is not an error, and only git's record of it is removed.
    pub fn discard(&self, project: &Path, worktree: &Worktree) -> Result<(), RpcError> {
        if self.is_enrolled(&worktree.path) {
            return self.discard_prepared(project, worktree);
        }
        let reference = format!("refs/heads/{}", worktree.branch);
        let path = canonical_path(&worktree.path);
        let registered = self
            .registered_worktrees(project)?
            .into_iter()
            .find(|(entry, _)| *entry == path);
        match registered {
            Some((_, branch)) if branch.is_none() || branch.as_deref() == Some(&reference) => {
                self.run(
                    project,
                    &[
                        "worktree",
                        "remove",
                        "--force",
                        &worktree.path.to_string_lossy(),
                    ],
                )
                .map_err(failed)?;
            }
            Some(_) => return Err(failed("recorded Worktree path belongs to another branch")),
            None if worktree.path.exists() => {
                return Err(failed("recorded Worktree path is unregistered"));
            }
            None => {}
        }
        if let Some(head) = self.reference(project, &reference)? {
            self.run(project, &["update-ref", "-d", &reference, &head])
                .map_err(failed)?;
        }
        Ok(())
    }

    fn registered_worktrees(
        &self,
        project: &Path,
    ) -> Result<Vec<(PathBuf, Option<String>)>, RpcError> {
        let listing = self
            .run(project, &["worktree", "list", "--porcelain", "-z"])
            .map_err(failed)?;
        Ok(listing
            .split("\0\0")
            .filter_map(|record| {
                let path = record
                    .split('\0')
                    .find_map(|value| value.strip_prefix("worktree "))?;
                let branch = record
                    .split('\0')
                    .find_map(|value| value.strip_prefix("branch "))
                    .map(str::to_owned);
                Some((canonical_path(Path::new(path)), branch))
            })
            .collect())
    }

    /// A34: retain complete clean Worktrees (including ignored files) and branch tips until
    /// the coordinated SQLite commit succeeds. A failed git command can then be retried.
    pub(crate) fn prepare_removal(
        &self,
        project: &Path,
        worktrees: &[Worktree],
    ) -> Result<Removal, RpcError> {
        let mut removal = Removal {
            git: self.clone(),
            project: project.to_owned(),
            entries: Vec::new(),
            removed: false,
        };
        let result = (|| {
            for worktree in worktrees {
                self.require_landed(project, worktree)?;
                let tip = self.reference(project, &format!("refs/heads/{}", worktree.branch))?;
                // G2542d: an enrolled directory is never moved aside; only its branch goes.
                if self.is_enrolled(&worktree.path) {
                    removal.entries.push((worktree.clone(), tip, None));
                    continue;
                }
                let backup = if worktree.path.try_exists().map_err(failed)? {
                    let reference = format!("refs/heads/{}", worktree.branch);
                    let path = canonical_path(&worktree.path);
                    let registered = self.registered_worktrees(project)?;
                    if !registered.iter().any(|(entry, branch)| {
                        *entry == path && branch.as_deref() == Some(&reference)
                    }) {
                        return Err(failed(
                            "recorded Worktree path is unregistered or belongs to another branch",
                        ));
                    }
                    // G9's one-second budget excludes copying ignored build output. A sibling
                    // backup stays on the Worktree's filesystem, including external Worktrees.
                    validate_directory(&worktree.path)?;
                    let backup = tempfile::Builder::new()
                        .prefix(".roundup-removal-")
                        .tempdir_in(
                            worktree
                                .path
                                .parent()
                                .ok_or_else(|| failed("Worktree has no parent"))?,
                        )
                        .map_err(failed)?;
                    let saved = backup.path().join("worktree");
                    // Record ownership before moving: even a partial source deletion after a
                    // completed cross-device copy must retain the complete backup.
                    removal.entries.push((worktree.clone(), tip, Some(backup)));
                    retain_directory(&worktree.path, &saved, rename_directory)?;
                    continue;
                } else {
                    None
                };
                removal.entries.push((worktree.clone(), tip, backup));
            }
            Ok(())
        })();
        if let Err(err) = result {
            removal.restore(self, project)?;
            return Err(err);
        }
        Ok(removal)
    }

    pub fn remove_landed(&self, project: &Path, worktree: &Worktree) -> Result<(), RpcError> {
        let reference = format!("refs/heads/{}", worktree.branch);
        let expected = self.reference(project, &reference)?;
        self.remove_at_tip(project, worktree, expected.as_deref())
    }

    fn remove_at_tip(
        &self,
        project: &Path,
        worktree: &Worktree,
        expected: Option<&str>,
    ) -> Result<(), RpcError> {
        let reference = format!("refs/heads/{}", worktree.branch);
        self.require_landed(project, worktree)?;
        if self.reference(project, &reference)?.as_deref() != expected {
            return Err(failed("Worktree branch changed during removal"));
        }
        if self.is_enrolled(&worktree.path) {
            return self.release_prepared(project, worktree, expected);
        }
        let path = canonical_path(&worktree.path);
        let registered = self
            .registered_worktrees(project)?
            .into_iter()
            .find(|(entry, _)| *entry == path);
        match registered {
            Some((_, branch)) if expected.is_some() && branch.as_deref() == Some(&reference) => {
                self.run(
                    project,
                    &["worktree", "remove", &worktree.path.to_string_lossy()],
                )
                .map_err(failed)?;
            }
            Some(_) => return Err(failed("recorded Worktree path belongs to another branch")),
            None if worktree.path.exists() => {
                return Err(failed("recorded Worktree path is unregistered"));
            }
            None => {}
        }
        if let Some(expected) = expected {
            self.run(project, &["update-ref", "-d", &reference, expected])
                .map_err(failed)?;
        }
        Ok(())
    }
}

pub(crate) struct Removal {
    git: Git,
    project: PathBuf,
    entries: Vec<(Worktree, Option<String>, Option<tempfile::TempDir>)>,
    removed: bool,
}

impl Removal {
    pub(crate) fn remove(&mut self, git: &Git, project: &Path) -> Result<(), RpcError> {
        for (worktree, tip, _) in &self.entries {
            git.remove_at_tip(project, worktree, tip.as_deref())?;
        }
        // The caller explicitly restores on storage failure. Otherwise Drop cleans backups
        // only after the coordinated commit has returned successfully.
        self.removed = true;
        Ok(())
    }

    pub(crate) fn restore(mut self, git: &Git, project: &Path) -> Result<(), RpcError> {
        self.restore_all(git, project)
    }

    fn restore_all(&mut self, git: &Git, project: &Path) -> Result<(), RpcError> {
        // Preparation can exhaust its budget after moving earlier Worktrees. Rollback
        // needs its own bounded budget to restore them instead of retaining every backup.
        let git = if git.deadline.is_some() {
            git.bounded()
        } else {
            git.clone()
        };
        self.removed = true;
        let mut errors = Vec::new();
        for (worktree, tip, backup) in self.entries.iter_mut().rev() {
            let mut moved_back = false;
            let result = (|| {
                let reference = format!("refs/heads/{}", worktree.branch);
                if let Some(tip) = tip {
                    // A surviving ref may belong to an external writer; only recreate absent refs.
                    if git.reference(project, &reference)?.is_none() {
                        git.run(project, &["update-ref", &reference, tip, ""])
                            .map_err(failed)?;
                    }
                }
                let Some(backup) = backup.as_ref() else {
                    if let Some(tip) = tip
                        && git.is_enrolled(&worktree.path)
                    {
                        git.reattach_prepared(worktree, tip)?;
                    }
                    return Ok(());
                };
                let saved = backup.path().join("worktree");
                if !saved.try_exists().map_err(failed)? {
                    return Ok(());
                }
                if std::fs::symlink_metadata(&worktree.path).is_ok() {
                    return Err(failed("original Worktree path contains external files"));
                }
                let registered = git
                    .registered_worktrees(project)?
                    .iter()
                    .any(|(path, branch)| {
                        *path == canonical_path(&worktree.path)
                            && branch.as_deref() == Some(&reference)
                    });
                if registered {
                    retain_directory(&saved, &worktree.path, rename_directory)?;
                    moved_back = true;
                } else {
                    // Rebuild git's administrative files away from the original path. No git
                    // command runs inside the retained directory, and Base never changes.
                    let staging = tempfile::tempdir().map_err(failed)?;
                    let checkout = staging.path().join("restore");
                    git.run(
                        project,
                        &[
                            "worktree",
                            "add",
                            "--force",
                            &checkout.to_string_lossy(),
                            &worktree.branch,
                        ],
                    )
                    .map_err(failed)?;
                    let registration = std::fs::read(checkout.join(".git")).map_err(failed)?;
                    // Replace the retained pointer before exposing the restored path. Removing
                    // a symlink here never writes through it to an external registration file.
                    let pointer = saved.join(".git");
                    std::fs::remove_file(&pointer).map_err(failed)?;
                    std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(pointer)
                        .map_err(failed)?
                        .write_all(&registration)
                        .map_err(failed)?;
                    retain_directory(&saved, &worktree.path, rename_directory)?;
                    moved_back = true;
                    git.run(
                        project,
                        &["worktree", "repair", &worktree.path.to_string_lossy()],
                    )
                    .map_err(failed)?;
                }
                Ok(())
            })();
            if let Err(err) = result {
                if moved_back {
                    // A git-registration repair can fail after the files moved back. Retain
                    // those files again so the reported backup remains directly recoverable.
                    let saved = backup.as_ref().unwrap().path().join("worktree");
                    if let Err(retain) = retain_directory(&worktree.path, &saved, rename_directory)
                    {
                        errors.push(format!(
                            "{retain}; Worktree files remain at {}",
                            worktree.path.display()
                        ));
                    }
                }
                if let Some(backup) = backup.take() {
                    let path = backup.keep();
                    errors.push(format!("{err}; Worktree backup kept at {}", path.display()));
                } else {
                    errors.push(err.to_string());
                }
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(failed(errors.join("; ")))
        }
    }
}

impl Drop for Removal {
    fn drop(&mut self) {
        if !self.removed {
            // Judgement can fail before remove is called. Restore those prepared moves too;
            // restore_all keeps and reports every backup it cannot safely restore.
            let git = self.git.clone();
            let project = self.project.clone();
            if let Err(err) = self.restore_all(&git, &project) {
                eprintln!("{err}");
            }
        }
    }
}

fn validate_directory(path: &Path) -> Result<(), RpcError> {
    use fs_more::directory::{DirectoryScanOptions, DirectoryScanner};
    for entry in DirectoryScanner::new(path, DirectoryScanOptions::default()) {
        let entry = entry.map_err(failed)?;
        let kind = entry.metadata().file_type();
        if !(kind.is_file() || kind.is_dir() || kind.is_symlink()) {
            return Err(failed(format!(
                "cannot retain special Worktree file {}",
                entry.path().display()
            )));
        }
    }
    Ok(())
}

fn rename_directory(from: &Path, to: &Path) -> std::io::Result<()> {
    // NOREPLACE closes the check/rename race with external writers, even an empty directory.
    rustix::fs::renameat_with(
        rustix::fs::CWD,
        from,
        rustix::fs::CWD,
        to,
        rustix::fs::RenameFlags::NOREPLACE,
    )
    .map_err(Into::into)
}

fn retain_directory(
    from: &Path,
    to: &Path,
    rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), RpcError> {
    match rename(from, to) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::CrossesDevices => {
            use fs_more::directory::{
                DestinationDirectoryRule, DirectoryCopyOptions, DirectoryScanOptions,
                DirectoryScanner,
            };
            validate_directory(from)?;
            fs_more::directory::copy_directory(
                from,
                to,
                DirectoryCopyOptions {
                    destination_directory_rule: DestinationDirectoryRule::DisallowExisting,
                    ..DirectoryCopyOptions::default()
                },
            )
            .map_err(failed)?;
            // fs-more preserves regular-file modes and links, but creates directories with
            // default modes. Set directory modes after copying their contents, deepest first.
            let directories = DirectoryScanner::new(from, DirectoryScanOptions::default())
                .into_iter()
                .collect::<Result<Vec<_>, _>>()
                .map_err(failed)?;
            for entry in directories.iter().rev().filter(|e| e.metadata().is_dir()) {
                let relative = entry.path().strip_prefix(from).map_err(failed)?;
                std::fs::set_permissions(to.join(relative), entry.metadata().permissions())
                    .map_err(failed)?;
            }
            std::fs::remove_dir_all(from).map_err(failed)
        }
        Err(err) => Err(failed(err)),
    }
}

/// `path` as git lists it, even when the directory is gone: the nearest existing ancestor is
/// resolved (a symlinked temp directory) and the missing rest is appended.
fn canonical_path(path: &Path) -> PathBuf {
    if let Ok(resolved) = path.canonicalize() {
        return resolved;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => canonical_path(parent).join(name),
        _ => path.to_owned(),
    }
}

fn worktree_path(project: &Path, id: &str) -> PathBuf {
    project
        .join(".roundup")
        .join("worktrees")
        .join(format!("agent-{id}"))
}

fn invalid(name: &str, detail: impl std::fmt::Display) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, format!("{name}: {detail}"))
}

fn failed(detail: impl std::fmt::Display) -> RpcError {
    RpcError::internal(format!("worktree_failed: {detail}"))
}

/// Add `.roundup/` to `exclude` (the repository's `info/exclude`), once: it is local, so the
/// user's tracked files and `git status` do not change.
fn exclude_worktrees(exclude: &Path) -> std::io::Result<()> {
    if let Some(parent) = exclude.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing = std::fs::read_to_string(exclude).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == ".roundup/") {
        return Ok(());
    }
    let mut text = existing;
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(".roundup/\n");
    std::fs::write(exclude, text)
}

/// `cwd` mapped into `worktree_path`, the same subpath it was of `project`; `None` when `cwd` is
/// not under `project` at all (left for the usual cwd validation to reject).
pub fn map_cwd(project: &Path, cwd: &Path, worktree_path: &Path) -> Option<PathBuf> {
    let relative = cwd.strip_prefix(project).ok()?;
    Some(worktree_path.join(relative))
}

#[path = "worktree_prepared.rs"]
mod prepared;

#[cfg(test)]
#[path = "../tests/scenarios/g9.rs"]
mod g9;

/// The new-side first line of the first hunk of one `git diff -U0` section; `None` for a binary
/// file, 1 for a change with no hunk (a pure rename or mode change).
fn first_changed_line(section: &str) -> Option<u32> {
    if section
        .lines()
        .any(|line| line.starts_with("Binary files "))
    {
        return None;
    }
    let Some(hunk) = section.lines().find(|line| line.starts_with("@@ ")) else {
        return Some(1);
    };
    let new_side = hunk.split_whitespace().find(|part| part.starts_with('+'))?;
    let start = new_side.trim_start_matches('+').split(',').next()?;
    Some(start.parse::<u32>().ok()?.max(1))
}

/// 1 for a text file, `None` for a binary one (a NUL in its first 8000 bytes) or one that cannot be read.
fn untracked_line(path: &Path) -> Option<u32> {
    let mut head = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(8000)
        .read_to_end(&mut head)
        .ok()?;
    (!head.contains(&0)).then_some(1)
}
