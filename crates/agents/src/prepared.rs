//! G2542: prepared directories. Assignment reserves an enrolled directory in the Rail before
//! its branch changes, switches it without force, then waits for the Project's readiness
//! command; a failure leaves the directory unavailable until `project.prepareDirectory` passes.

use std::process::Stdio;

use contracts::project::Prepared;

use super::*;
use crate::worktree_wiring::real_paths;

/// A cold `setup` command may take minutes; it still ends.
const SETUP_TIMEOUT: Duration = Duration::from_secs(3600);
const TAIL_LINES: usize = 20;
const TAIL_BYTES: usize = 16 * 1024;

/// Ends a command's whole process group on drop: on timeout, on cancellation, and after exit so a
/// hook's stray descendants do not outlive the phase.
struct Group(rustix::process::Pid);

impl Drop for Group {
    fn drop(&mut self) {
        let _ = rustix::process::kill_process_group(self.0, rustix::process::Signal::KILL);
    }
}

/// The last `TAIL_LINES` lines of `text`, at most `TAIL_BYTES` bytes.
fn tail(text: &[u8]) -> String {
    let text = String::from_utf8_lossy(text);
    let lines: Vec<&str> = text.lines().collect();
    let kept = lines[lines.len().saturating_sub(TAIL_LINES)..].join("\n");
    let start = kept.len().saturating_sub(TAIL_BYTES);
    let start = (start..=kept.len())
        .find(|at| kept.is_char_boundary(*at))
        .unwrap_or(kept.len());
    kept[start..].to_owned()
}

/// Run `command` with `sh -c` in `dir`. The error names the phase, path, exit status when there
/// is one, and the tail of the combined output.
async fn run_command(
    phase: &str,
    dir: &Path,
    command: &str,
    timeout: Duration,
) -> Result<(), String> {
    let failure = |status: Option<i32>, why: &str, output: &[u8]| {
        format!(
            "prepared_failed: phase={phase} path={} status={} reason={why}\n{}",
            dir.display(),
            status.map_or("none".into(), |code| code.to_string()),
            tail(output)
        )
    };
    let spawn_failed = |err: String| failure(None, &format!("could not run: {err}"), b"");
    let mut output = tempfile::tempfile().map_err(|err| spawn_failed(err.to_string()))?;
    let mut child = tokio::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            output
                .try_clone()
                .map_err(|err| spawn_failed(err.to_string()))?,
        ))
        .stderr(Stdio::from(
            output
                .try_clone()
                .map_err(|err| spawn_failed(err.to_string()))?,
        ))
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| spawn_failed(err.to_string()))?;
    let _group = child
        .id()
        .and_then(|pid| i32::try_from(pid).ok())
        .and_then(rustix::process::Pid::from_raw)
        .map(Group);
    let waited = tokio::time::timeout(timeout, child.wait()).await;
    let read = |file: &mut std::fs::File| {
        use std::io::{Read, Seek};
        let mut bytes = Vec::new();
        let _ = file.rewind();
        let _ = file.read_to_end(&mut bytes);
        bytes
    };
    match waited {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(status)) => Err(failure(status.code(), "nonzero exit", &read(&mut output))),
        Ok(Err(err)) => Err(failure(None, &err.to_string(), &read(&mut output))),
        Err(_) => {
            let _ = child.kill().await;
            let why = format!("timeout after {} ms", timeout.as_millis());
            Err(failure(None, &why, &read(&mut output)))
        }
    }
}

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

impl Agents {
    /// Whether Agents start in enrolled directories: `worktrees` on and a directory enrolled.
    pub(super) fn prepared_mode(&self) -> Result<Option<Prepared>, RpcError> {
        let rail = self.shared.rail();
        if !rail.get_worktrees()?.on {
            return Ok(None);
        }
        let prepared = rail.get_prepared()?;
        Ok((!prepared.enrolled.is_empty()).then_some(prepared))
    }

    /// `project.setPrepared`: enrolment is explicit local configuration, validated here and nowhere
    /// discovered. A directory in use stays enrolled until its Agent is gone.
    pub(super) async fn set_prepared(&self, prepared: Prepared) -> Result<(), RpcError> {
        if prepared.readiness.as_deref() == Some("") || prepared.setup.as_deref() == Some("") {
            return Err(invalid("readiness and setup must not be empty"));
        }
        if prepared.timeout_ms == Some(0) {
            return Err(invalid("timeout_ms must be positive"));
        }
        if !prepared.enrolled.is_empty() {
            if prepared.readiness.is_none() || prepared.timeout_ms.is_none() {
                return Err(invalid(
                    "prepared_readiness_missing: enrolling needs a readiness command and a positive timeout_ms",
                ));
            }
            if !self.shared.rail().get_worktrees()?.on {
                return Err(invalid(
                    "worktrees_off: turn the worktrees setting on first",
                ));
            }
        }
        let previous = self.shared.rail().get_prepared()?.enrolled;
        let (git, project, wanted, held) = (
            self.shared.git.bounded(),
            self.project_dir().to_owned(),
            prepared.enrolled.clone(),
            previous.clone(),
        );
        let mut owned = Vec::new();
        for path in &previous {
            if self.shared.rail().worktree_owner_of(path)?.is_some() {
                owned.push(path.clone());
            }
        }
        let kept = owned.clone();
        let canonical = tokio::task::spawn_blocking(move || {
            let mut canonical: Vec<PathBuf> = Vec::new();
            for path in &wanted {
                let path = Path::new(path);
                if !path.is_absolute() {
                    return Err(invalid(format!("path {} is not absolute", path.display())));
                }
                let resolved = if held.iter().any(|held| Path::new(held) == path) {
                    path.canonicalize()
                        .map_err(|err| invalid(format!("{}: {err}", path.display())))?
                } else {
                    git.check_prepared(&project, path).map_err(|reason| {
                        invalid(format!("prepared_rejected: {}: {reason}", path.display()))
                    })?
                };
                if canonical.contains(&resolved) {
                    return Err(invalid(format!(
                        "prepared_rejected: {}: duplicate_path",
                        path.display()
                    )));
                }
                canonical.push(resolved);
            }
            Ok(canonical)
        })
        .await
        .map_err(RpcError::internal)??;
        let wanted: Vec<String> = canonical
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();
        if let Some(path) = kept.iter().find(|path| !wanted.contains(path)) {
            return Err(RpcError::conflict(format!("prepared_in_use: {path}")));
        }
        let stored = Prepared {
            enrolled: wanted,
            ..prepared
        };
        self.shared.rail().set_prepared(&stored)?;
        self.shared.git.set_enrolled(&canonical);
        Ok(())
    }

    /// `project.prepareDirectory`: run the Project's `setup`, then its readiness command, in an
    /// enrolled directory no Agent holds; success makes it available again.
    pub(super) async fn prepare_directory(&self, path: &str) -> Result<(), RpcError> {
        let config = self.shared.rail().get_prepared()?;
        let canonical = Path::new(path)
            .canonicalize()
            .map_err(|err| invalid(format!("{path}: {err}")))?;
        let key = canonical.to_string_lossy().into_owned();
        if !config.enrolled.contains(&key) {
            return Err(invalid(format!("not_enrolled: {path}")));
        }
        let (Some(readiness), Some(ms)) = (config.readiness.clone(), config.timeout_ms) else {
            return Err(invalid("prepared_readiness_missing"));
        };
        let Some(_preparing) = self.shared.git.begin_preparing(&canonical) else {
            return Err(RpcError::conflict(format!("prepared_busy: {key}")));
        };
        if self.shared.rail().worktree_owner_of(&key)?.is_some() {
            return Err(RpcError::conflict(format!("prepared_in_use: {key}")));
        }
        let (git, project, checked) = (
            self.shared.git.bounded(),
            self.project_dir().to_owned(),
            canonical.clone(),
        );
        tokio::task::spawn_blocking(move || git.check_prepared(&project, &checked))
            .await
            .map_err(RpcError::internal)?
            .map_err(|reason| RpcError::conflict(format!("prepared_rejected: {key}: {reason}")))?;
        let mut outcome = Ok(());
        if let Some(setup) = &config.setup {
            outcome = run_command("setup", &canonical, setup, SETUP_TIMEOUT).await;
        }
        if outcome.is_ok() {
            outcome = run_command(
                "readiness",
                &canonical,
                &readiness,
                Duration::from_millis(ms),
            )
            .await;
        }
        let mut rail = self.shared.rail();
        match outcome {
            Ok(()) => rail.set_prepared_unavailable(&key, None),
            Err(message) => {
                let first = message.lines().next().unwrap_or_default().to_owned();
                rail.set_prepared_unavailable(&key, Some(&first))?;
                Err(RpcError::internal(message))
            }
        }
    }

    /// G2542a, G2542c: give node `id` exclusive use of one enrolled directory and wait for its
    /// readiness command; returns `cwd` mapped into it, like `provision_worktree`. No directory
    /// available is an error that changes no files; nothing falls back to another checkout.
    pub(super) async fn assign_prepared(
        &self,
        id: &str,
        cwd: &Path,
        config: Prepared,
    ) -> Result<(PathBuf, worktree::Worktree), RpcError> {
        let project = self.project_dir().to_owned();
        let (real_project, real_cwd) = real_paths(&project, cwd)?;
        let (Some(readiness), Some(ms)) = (config.readiness.clone(), config.timeout_ms) else {
            return Err(invalid("prepared_readiness_missing"));
        };
        self.shared.rail().node(id)?;
        let (git, plan_project, plan_id) =
            (self.shared.git.bounded(), project.clone(), id.to_owned());
        let plan = tokio::task::spawn_blocking(move || git.plan(&plan_project, &plan_id))
            .await
            .map_err(RpcError::internal)??;
        let mut reasons = Vec::new();
        for dir in &config.enrolled {
            let path = PathBuf::from(dir);
            let mut plan = plan.clone();
            plan.worktree.path = path.clone();
            if let Some(why) = self.shared.rail().prepared_unavailable(dir)? {
                reasons.push(format!("{dir}: unavailable: {why}"));
                continue;
            }
            if self.shared.git.is_preparing(&path) {
                reasons.push(format!("{dir}: preparing"));
                continue;
            }
            // The reservation is durable before any git command touches the directory.
            if !self.shared.rail().reserve_prepared(id, &plan)? {
                reasons.push(format!("{dir}: held by an Agent"));
                continue;
            }
            let release = |why: String| {
                report_undo(
                    "release the prepared directory",
                    self.shared.rail().clear_worktree(id),
                );
                why
            };
            if self.shared.git.is_preparing(&path) {
                reasons.push(release(format!("{dir}: preparing")));
                continue;
            }
            let (git, guarded_project, guarded) =
                (self.shared.git.bounded(), project.clone(), path.clone());
            let guard =
                tokio::task::spawn_blocking(move || git.check_prepared(&guarded_project, &guarded))
                    .await
                    .map_err(RpcError::internal)?;
            if let Err(reason) = guard {
                reasons.push(release(format!("{dir}: {reason}")));
                continue;
            }
            let (git, assign_project, assigned) =
                (self.shared.git.bounded(), project.clone(), plan.clone());
            let switched = tokio::task::spawn_blocking(move || {
                git.assign_prepared(&assign_project, &assigned)
            })
            .await
            .map_err(RpcError::internal)?;
            if let Err(err) = switched {
                self.undo_prepared(id, &plan).await;
                return Err(err);
            }
            if let Err(message) =
                run_command("readiness", &path, &readiness, Duration::from_millis(ms)).await
            {
                let first = message.lines().next().unwrap_or_default().to_owned();
                report_undo(
                    "mark the directory unavailable",
                    self.shared
                        .rail()
                        .set_prepared_unavailable(dir, Some(&first)),
                );
                self.undo_prepared(id, &plan).await;
                return Err(RpcError::internal(message));
            }
            let made = plan.worktree.clone();
            return match worktree::map_cwd(&real_project, &real_cwd, &made.path) {
                Some(mapped) if mapped.is_dir() => Ok((mapped, made)),
                _ => {
                    self.discard_worktree(id, made).await;
                    Err(invalid(format!(
                        "cwd_not_in_worktree: {} is not in the prepared directory",
                        cwd.display()
                    )))
                }
            };
        }
        Err(RpcError::conflict(format!(
            "no_prepared_directory: {}",
            reasons.join("; ")
        )))
    }

    /// Park the directory and drop the reservation; when parking is refused (edits), the
    /// reservation stays and the directory stays unavailable until reconciled.
    async fn undo_prepared(&self, id: &str, plan: &worktree::Provision) {
        let (git, project, plan) = (
            self.shared.git.bounded(),
            self.project_dir().to_owned(),
            plan.clone(),
        );
        match tokio::task::spawn_blocking(move || git.recover(&project, &plan)).await {
            Ok(Ok(())) => report_undo(
                "release the prepared directory",
                self.shared.rail().clear_worktree(id),
            ),
            Ok(Err(err)) => eprintln!("agents: prepared directory for {id} kept: {err}"),
            Err(err) => eprintln!("agents: prepared directory for {id} kept: {err}"),
        }
    }
}
