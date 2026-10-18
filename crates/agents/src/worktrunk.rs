//! Optional Project-owned worktrunk enrichment; never a source of Base-relative git state.
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Seek};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

const LIMIT: u64 = 8 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);
const LOCAL_INTERVAL: Duration = Duration::from_secs(5);
const FULL_INTERVAL: Duration = Duration::from_secs(60);
const ARGV: &[&str] = &[
    "list",
    "--format=json",
    "--config",
    "/dev/null",
    "--config-set",
    "list.summary=false",
    "--config-set",
    "list.json-schema=2",
];

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Identity {
    pub agent: String,
    pub path: PathBuf,
    pub branch: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Facts {
    pub ci: Option<(String, bool)>,
    pub pr: Option<(u64, bool)>,
}

#[derive(Deserialize)]
struct Envelope {
    schema: u32,
    #[serde(rename = "repo")]
    _repo: BTreeMap<String, serde_json::Value>,
    collected: Collected,
    items: Vec<Row>,
}
#[derive(Deserialize)]
struct Collected {
    ci: bool,
    summary: bool,
}
#[derive(Deserialize)]
struct Row {
    branch: Option<String>,
    worktree: Option<Location>,
    checks: Option<Checks>,
    pr: Option<Pr>,
}
#[derive(Deserialize)]
struct Location {
    path: PathBuf,
    #[serde(default)]
    duplicate_branch: bool,
    #[serde(default)]
    detached: bool,
}
#[derive(Deserialize)]
struct Checks {
    status: Option<String>,
    stale: bool,
    source: String,
}
#[derive(Deserialize)]
struct Pr {
    number: Option<std::num::NonZeroU64>,
    mergeable: Option<bool>,
}

fn parse(bytes: &[u8]) -> Result<Envelope, String> {
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > LIMIT {
        return Err("worktrunk stdout exceeded 8 MiB".into());
    }
    let envelope: Envelope = serde_json::from_slice(bytes).map_err(|err| err.to_string())?;
    if envelope.schema != 2 || envelope.collected.summary {
        return Err("unsupported worktrunk schema/configuration".into());
    }
    // Deserializing the envelope rejects scalar/array repository shapes without binding
    // local ownership to a forge URL (fork PRs can target a different repository).
    if envelope.items.iter().any(|row| {
        row.checks
            .as_ref()
            .is_some_and(|checks| !matches!(checks.source.as_str(), "pr" | "branch"))
    }) {
        return Err("unsupported check source".into());
    }
    Ok(envelope)
}

impl Row {
    fn facts(&self) -> Facts {
        let ci = self.checks.as_ref().and_then(|checks| {
            let status = if self
                .pr
                .as_ref()
                .is_some_and(|pr| pr.mergeable == Some(false))
            {
                Some("conflicts")
            } else {
                checks.status.as_deref().map(|status| match status {
                    "passed" | "failed" | "running" => status,
                    _ => "unknown",
                })
            };
            status.map(|state| (state.to_owned(), checks.stale))
        });
        Facts {
            ci,
            pr: self
                .pr
                .as_ref()
                .and_then(|pr| pr.number)
                .map(|number| (number.get(), false)),
        }
    }
}

struct Cached {
    facts: Facts,
    success: Instant,
}
#[derive(Default)]
struct Lane {
    started: Option<Instant>,
    running: bool,
}
#[derive(Default)]
struct State {
    lanes: [Lane; 2],
    facts: BTreeMap<Identity, Cached>,
}

/// A single holder lives in `Shared`. Workers own no Agents/Project reference;
/// dropping the holder cancels both groups, even while a forge CLI is stalled.
pub(super) struct Collector {
    state: Arc<Mutex<State>>,
    cancelled: Arc<AtomicBool>,
    executable: PathBuf,
}
impl Default for Collector {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            cancelled: Arc::new(AtomicBool::new(false)),
            executable: PathBuf::from("wt"),
        }
    }
}
impl Drop for Collector {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

impl Collector {
    /// Admission is memory-only. Neither git ownership reads nor wt execution can
    /// hold this lock or the git execution lock across collection.
    pub(super) fn refresh(&self, shared: &Arc<super::Shared>) {
        for full in [false, true] {
            let now = Instant::now();
            if !self.admit(full, now) {
                continue;
            }
            let weak = Arc::downgrade(shared);
            let state = Arc::clone(&self.state);
            let cancelled = Arc::clone(&self.cancelled);
            let executable = self.executable.clone();
            let project = shared.project_dir.clone();
            let git = shared.git.reader();
            // The Rail snapshot is taken on the worker; no filesystem read is added
            // to worktree_state's interaction path.
            tokio::task::spawn_blocking(move || {
                let snapshot = weak.upgrade().and_then(|shared| identities(&shared));
                let result = snapshot
                    .as_ref()
                    .ok_or_else(|| "Project unavailable".into())
                    .and_then(|ids| collect(&executable, &project, &git, ids, full, &cancelled));
                let current = weak.upgrade().and_then(|shared| identities(&shared));
                publish(
                    &state,
                    full,
                    result,
                    current.unwrap_or_default(),
                    &cancelled,
                    Instant::now(),
                );
            });
        }
    }

    fn admit(&self, full: bool, now: Instant) -> bool {
        let mut state = self.state.lock().expect("worktrunk cache poisoned");
        let lane = &mut state.lanes[usize::from(full)];
        let interval = if full { FULL_INTERVAL } else { LOCAL_INTERVAL };
        if lane.running
            || lane
                .started
                .is_some_and(|start| now.duration_since(start) < interval)
        {
            return false;
        }
        lane.started = Some(now);
        lane.running = true;
        true
    }

    /// Callers must supply the currently registered identity, never a row index.
    /// No RPC exposes these facts before #2558's atomic contract change.
    pub(super) fn facts(&self, identity: &Identity, now: Instant) -> Option<Facts> {
        let state = self.state.lock().expect("worktrunk cache poisoned");
        let cached = state.facts.get(identity)?;
        let mut facts = cached.facts.clone();
        if now.duration_since(cached.success) >= FULL_INTERVAL {
            stale(&mut facts);
        }
        Some(facts)
    }
}

fn identities(shared: &super::Shared) -> Option<Vec<Identity>> {
    Some(
        shared
            .rail()
            .tree()
            .ok()?
            .into_iter()
            .filter_map(|node| {
                let record = node.worktree?;
                Some(Identity {
                    agent: node.id,
                    path: PathBuf::from(record.path),
                    branch: record.branch,
                })
            })
            .collect(),
    )
}

fn stale(facts: &mut Facts) {
    if let Some((_, stale)) = &mut facts.ci {
        *stale = true;
    }
    if let Some((_, stale)) = &mut facts.pr {
        *stale = true;
    }
}

type Results = BTreeMap<Identity, Facts>;
fn publish(
    state: &Mutex<State>,
    full: bool,
    result: Result<Results, String>,
    current: Vec<Identity>,
    cancelled: &AtomicBool,
    now: Instant,
) {
    let mut state = state.lock().expect("worktrunk cache poisoned");
    state.lanes[usize::from(full)].running = false;
    if cancelled.load(Ordering::Acquire) {
        state.facts.clear();
        return;
    }
    let current: BTreeSet<_> = current.into_iter().collect();
    state.facts.retain(|id, _| current.contains(id));
    if !full {
        if result.is_err() {
            for cached in state.facts.values_mut() {
                stale(&mut cached.facts);
            }
        }
        return;
    }
    match result {
        Ok(results) => {
            for id in current {
                match results.get(&id) {
                    Some(facts) if facts.ci.is_some() || facts.pr.is_some() => {
                        state.facts.insert(
                            id,
                            Cached {
                                facts: facts.clone(),
                                success: now,
                            },
                        );
                    }
                    Some(_) => {
                        // Null/missing forge facts cannot turn a previous result fresh.
                        if let Some(cached) = state.facts.get_mut(&id) {
                            stale(&mut cached.facts);
                        }
                    }
                    None => {
                        state.facts.remove(&id);
                    }
                }
            }
        }
        Err(_) => {
            for cached in state.facts.values_mut() {
                stale(&mut cached.facts);
            }
        }
    }
}

fn collect(
    executable: &Path,
    project: &Path,
    git: &super::worktree::Git,
    identities: &[Identity],
    full: bool,
    cancelled: &AtomicBool,
) -> Result<Results, String> {
    let deadline = Instant::now() + TIMEOUT;
    let git = git.read_until(deadline);
    if !git
        .collection_permitted(project)
        .map_err(|err| err.message)?
    {
        return Err("configured merge driver prevents read-only collection".into());
    }
    let registered = git
        .registered_worktrees(project)
        .map_err(|err| err.message)?;
    let envelope = parse(&execute_until(
        executable, project, full, cancelled, deadline,
    )?)?;
    if envelope.collected.ci != full {
        return Err("unexpected collection mode".into());
    }
    // Re-read registration after wt: an external checkout must not relabel an old reply.
    let current = git
        .registered_worktrees(project)
        .map_err(|err| err.message)?;
    Ok(match_rows(&envelope, identities, &registered, &current))
}

fn match_rows(
    envelope: &Envelope,
    identities: &[Identity],
    registered: &[(PathBuf, Option<String>)],
    current: &[(PathBuf, Option<String>)],
) -> Results {
    let mut rows: BTreeMap<PathBuf, Vec<&Row>> = BTreeMap::new();
    for row in &envelope.items {
        if let Some(location) = &row.worktree
            && let Ok(path) = location.path.canonicalize()
        {
            rows.entry(path).or_default().push(row);
        }
    }
    let mut owners: BTreeMap<PathBuf, Vec<&Identity>> = BTreeMap::new();
    for id in identities {
        if let Ok(path) = id.path.canonicalize() {
            owners.entry(path).or_default().push(id);
        }
    }
    let mut results = Results::new();
    for (path, ids) in owners {
        let [id] = ids.as_slice() else {
            continue;
        };
        let Some(entries) = rows.get(&path) else {
            continue;
        };
        let [row] = entries.as_slice() else {
            continue;
        };
        let reference = Some(format!("refs/heads/{}", id.branch));
        let owns = |entries: &[(PathBuf, Option<String>)]| {
            entries
                .iter()
                .filter(|(p, b)| p == &path && b == &reference)
                .count()
                == 1
                && entries.iter().filter(|(_, b)| b == &reference).count() == 1
        };
        if row.branch.as_deref() != Some(&id.branch)
            || !owns(registered)
            || !owns(current)
            || row
                .worktree
                .as_ref()
                .is_some_and(|w| w.duplicate_branch || w.detached)
        {
            continue;
        }
        results.insert((*id).clone(), row.facts());
    }
    results
}

#[cfg(test)]
fn execute(
    executable: &Path,
    project: &Path,
    full: bool,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    execute_until(
        executable,
        project,
        full,
        cancelled,
        Instant::now() + TIMEOUT,
    )
}

fn execute_until(
    executable: &Path,
    project: &Path,
    full: bool,
    cancelled: &AtomicBool,
    deadline: Instant,
) -> Result<Vec<u8>, String> {
    let mut command = Command::new(executable);
    // The release also supports WORKTRUNK__* scalar overrides. Remove them so
    // neither file config nor ambient environment can add executable columns.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("WORKTRUNK_") {
            command.env_remove(key);
        }
    }
    command
        .current_dir(project)
        .args(ARGV)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .env("WORKTRUNK_CONFIG_PATH", "/dev/null")
        .env("WORKTRUNK_SYSTEM_CONFIG_PATH", "/dev/null")
        .env("WORKTRUNK_PROJECT_CONFIG_PATH", "/dev/null")
        .env("WORKTRUNK_VERBOSE", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "core.fsmonitor")
        .env("GIT_CONFIG_VALUE_0", "false")
        .env("GIT_CONFIG_KEY_1", "core.hooksPath")
        .env("GIT_CONFIG_VALUE_1", "/dev/null");
    if full {
        command.arg("--full");
    }
    // Reuse Git::output's isolated group/file strategy: inherited pipes cannot
    // keep a finished parent alive, and cancellation always reaps the direct child.
    let mut stdout = tempfile::tempfile().map_err(|err| err.to_string())?;
    let mut child = command
        .stdout(stdout.try_clone().map_err(|err| err.to_string())?)
        .process_group(0)
        .spawn()
        .map_err(|err| err.to_string())?;
    let result = loop {
        if cancelled.load(Ordering::Acquire) {
            break Err("Project closed".into());
        }
        if Instant::now() >= deadline {
            break Err("worktrunk timed out".into());
        }
        match stdout.metadata() {
            Ok(meta) if meta.len() > LIMIT => break Err("worktrunk stdout exceeded 8 MiB".into()),
            Err(err) => break Err(err.to_string()),
            _ => {}
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(status)) => break Err(format!("worktrunk exited {status}")),
            Err(err) => break Err(err.to_string()),
            Ok(None) => std::thread::sleep(Duration::from_millis(5)),
        }
    };
    if let Some(pid) = i32::try_from(child.id())
        .ok()
        .and_then(rustix::process::Pid::from_raw)
    {
        // The child may already be reaped; ESRCH is harmless. Descendants must die too.
        let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
    }
    // Always reap on timeout/cancellation, including when a descendant retains stdout.
    let reaped = child.wait().map_err(|err| err.to_string());
    result?;
    reaped?;
    stdout.rewind().map_err(|err| err.to_string())?;
    let mut bytes = Vec::new();
    stdout
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > LIMIT {
        return Err("worktrunk stdout exceeded 8 MiB".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests;

impl super::Agents {
    // #2558 owns exposing this tested internal seam with the additive contract.
    #[expect(
        dead_code,
        reason = "#2628 keeps enrichment crate-private until #2558 changes every caller"
    )]
    pub(crate) fn worktree_facts(&self, id: &str) -> Option<Facts> {
        let record = self.shared.node(id).ok()?.worktree?;
        self.shared.worktrunk.facts(
            &Identity {
                agent: id.to_owned(),
                path: PathBuf::from(record.path),
                branch: record.branch,
            },
            Instant::now(),
        )
    }
}
