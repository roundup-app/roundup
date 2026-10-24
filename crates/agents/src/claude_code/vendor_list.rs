//! U3523a, U3523f: the Project's saved and live Claude Code sessions, listed through the bundled
//! Node sidecar (TypeScript Agent SDK) and `claude agents --json`. Vendor storage and paths stay
//! here (P4). The sidecar runs only while a listing does and is reaped when it ends or is dropped.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use rpc::RpcError;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};
use tokio::time::Instant;

use super::discovery::{ImportExclusion, io_error, source_revision};
use super::{Launcher, is_uuid};
use crate::worktree::canonical_path;

const BUDGET: Duration = Duration::from_secs(18);
const MAX_RECORD: u64 = 8 * 1024 * 1024;
const MAX_CWDS: usize = 64;
const MAX_FILES: usize = 10_000;
const MAX_NOTICE_BYTES: u64 = 64 * 1024;

/// A running program `claude agents --json` reported; each field only when it supplied one.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Live {
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub busy: Option<bool>,
    pub started_at_ms: Option<i64>,
}

/// One session offered once. `revision` binds an approval to the source file facts listed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listed {
    pub source: String,
    pub title: String,
    /// The first recorded directory inside the Project, relative to it.
    pub cwd: PathBuf,
    pub last_activity_ms: i64,
    pub revision: String,
    pub live: Option<Live>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Listing {
    /// Newest first, equal times by source identity.
    pub candidates: Vec<Listed>,
    pub excluded: Vec<ImportExclusion>,
    /// What the sidecar printed on stderr, kept for the reader.
    pub notices: Vec<String>,
    pub sdk: String,
}

/// The bundled runtime: `<dir>/node` and `<dir>/list.mjs` beside its `node_modules`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sidecar {
    pub dir: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    session_id: String,
    summary: Option<String>,
    custom_title: Option<String>,
    last_modified: i64,
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct Found {
    sdk: String,
    #[serde(default)]
    scoped: Vec<Row>,
    #[serde(default)]
    others: Vec<Row>,
    #[serde(default)]
    found: Option<bool>,
    #[serde(default)]
    error: Option<String>,
}

/// The sidecar child: killed if dropped, so a cancelled or superseded listing reaps it.
struct Running {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::BufReader<tokio::process::ChildStdout>,
    notices: tokio::task::JoinHandle<Vec<String>>,
    deadline: Instant,
}

impl Running {
    async fn ask(&mut self, request: &Value) -> Result<Found, RpcError> {
        let mut line = request.to_string();
        line.push('\n');
        let mut reply = String::new();
        let exchange = async {
            self.stdin.write_all(line.as_bytes()).await?;
            self.stdin.flush().await?;
            self.stdout.read_line(&mut reply).await
        };
        match tokio::time::timeout_at(self.deadline, exchange).await {
            Err(_) => return Err(too_slow()),
            Ok(Ok(0)) | Ok(Err(_)) => return Err(self.died().await),
            Ok(Ok(_)) => {}
        }
        let found: Found = serde_json::from_str(&reply).map_err(|err| {
            RpcError::internal(format!(
                "the listing sidecar answered something unreadable ({err}); reinstall roundup"
            ))
        })?;
        match found.error {
            Some(error) => Err(RpcError::not_accepted(format!(
                "the Claude Agent SDK refused the listing: {error}; update roundup and Claude Code"
            ))),
            None => Ok(found),
        }
    }

    async fn died(&mut self) -> RpcError {
        let status = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
        let _ = self.child.start_kill();
        let notices = (&mut self.notices).await.unwrap_or_default().join(" ");
        RpcError::internal(format!(
            "the listing sidecar stopped early ({}): {notices}; reinstall roundup",
            match status {
                Ok(Ok(status)) => status.to_string(),
                _ => "no exit status".into(),
            }
        ))
    }

    /// End the child by closing its input; the notices it printed come back.
    async fn finish(self) -> Vec<String> {
        let Self {
            mut child,
            stdin,
            notices,
            ..
        } = self;
        drop(stdin);
        if tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
        }
        notices.await.unwrap_or_default()
    }
}

fn too_slow() -> RpcError {
    RpcError::not_accepted("listing took too long; Refresh to try again")
}

impl Sidecar {
    /// `ROUNDUP_SIDECAR_DIR`, else the `sidecar` folder beside the running Daemon.
    pub(super) fn beside(exe: &Path, var: Option<std::ffi::OsString>) -> Option<Self> {
        Some(Self {
            dir: var.map_or_else(|| exe.with_file_name("sidecar"), PathBuf::from),
        })
    }

    async fn start(&self, config: &Path, deadline: Instant) -> Result<Running, RpcError> {
        let node = self.dir.join("node");
        let script = self.dir.join("list.mjs");
        if let Some(missing) = [&node, &script].into_iter().find(|p| !p.is_file()) {
            return Err(RpcError::not_found(format!(
                "roundup's bundled Node runtime is incomplete: {} is missing; reinstall roundup (or point ROUNDUP_SIDECAR_DIR at a complete sidecar folder)",
                missing.display()
            )));
        }
        let mut child = tokio::process::Command::new(&node)
            .arg(&script)
            .current_dir(&self.dir)
            .env("CLAUDE_CONFIG_DIR", config)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .map_err(|err| {
                RpcError::not_found(format!(
                    "cannot start the bundled Node runtime {}: {err}; reinstall roundup",
                    node.display()
                ))
            })?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = tokio::io::BufReader::new(child.stdout.take().expect("piped stdout"));
        let mut stderr = child.stderr.take().expect("piped stderr");
        let notices = tokio::spawn(async move {
            let mut text = Vec::new();
            let _ = (&mut stderr)
                .take(MAX_NOTICE_BYTES)
                .read_to_end(&mut text)
                .await;
            // Keep draining so a chatty SDK never blocks on a full pipe.
            let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
            String::from_utf8_lossy(&text)
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(str::to_owned)
                .collect()
        });
        Ok(Running {
            child,
            stdin,
            stdout,
            notices,
            deadline,
        })
    }
}

/// `claude agents --json --cwd <path>`: the running programs started under `path`.
async fn live_rows(
    bin: &str,
    path: &Path,
    deadline: Instant,
) -> Result<Vec<(String, Live)>, RpcError> {
    let output = tokio::time::timeout_at(
        deadline,
        tokio::process::Command::new(bin)
            .args(["agents", "--json", "--cwd"])
            .arg(path)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| too_slow())?
    .map_err(|err| {
        RpcError::not_found(format!(
            "cannot run Claude Code `{bin}` to read live sessions: {err}; install Claude Code or set ROUNDUP_CLAUDE_BIN"
        ))
    })?;
    let incompatible = |why: String| {
        RpcError::not_accepted(format!(
            "`{bin} agents --json` is not usable ({why}); update Claude Code"
        ))
    };
    if !output.status.success() {
        return Err(incompatible(format!(
            "{}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let rows: Vec<Value> =
        serde_json::from_slice(&output.stdout).map_err(|err| incompatible(err.to_string()))?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let id = ["sessionId", "session_id", "id"]
                .iter()
                .find_map(|key| row[key].as_str())?
                .to_ascii_lowercase();
            let text = |keys: &[&str]| {
                keys.iter()
                    .find_map(|key| row[key].as_str())
                    .map(str::to_owned)
            };
            let busy = row["busy"].as_bool().or_else(|| {
                match row["status"].as_str().or_else(|| row["state"].as_str())? {
                    "busy" | "working" | "running" => Some(true),
                    "idle" | "waiting" => Some(false),
                    _ => None,
                }
            });
            let started = &row["startedAt"];
            let started_at_ms = started.as_i64().or_else(|| {
                started.as_str().and_then(|text| {
                    let at = time::OffsetDateTime::parse(
                        text,
                        &time::format_description::well_known::Rfc3339,
                    )
                    .ok()?;
                    i64::try_from(at.unix_timestamp_nanos() / 1_000_000).ok()
                })
            });
            Some((
                id,
                Live {
                    pid: row["pid"].as_u64().and_then(|pid| u32::try_from(pid).ok()),
                    cwd: text(&["cwd"]),
                    name: text(&["name"]),
                    busy,
                    started_at_ms,
                },
            ))
        })
        .collect())
}

/// `cwd` below `root` by path components (never string prefixes), as a path relative to it.
fn below<'a>(cwd: &'a Path, root: &Path) -> Option<&'a Path> {
    cwd.strip_prefix(root).ok()
}

/// Where a recorded directory lands in the Project: the folder itself or a descendant, or the
/// same place under one of the Project's registered Worktrees. roundup's own `.roundup/` is
/// never a place. The folder need not exist.
fn map_into_project(
    cwd: &Path,
    project: &Path,
    worktrees: &[PathBuf],
) -> Result<Option<PathBuf>, &'static str> {
    let cwd = canonical_path(cwd);
    if let Some(inside) = below(&cwd, project) {
        return if inside.starts_with(".roundup") {
            Err("inside roundup's own folder")
        } else {
            Ok(Some(inside.to_path_buf()))
        };
    }
    Ok(worktrees
        .iter()
        .filter(|root| root.as_path() != project)
        .find_map(|root| below(&cwd, root))
        .map(Path::to_path_buf))
}

/// The directories one saved session recorded, in order, and what else decides eligibility.
struct Records {
    cwds: Vec<PathBuf>,
    sidechain: bool,
    foreign_identity: bool,
}

fn read_records(path: &Path, stem: &str, deadline: Instant) -> Result<Records, RpcError> {
    let file = std::fs::File::open(path).map_err(|err| io_error(path, err))?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut out = Records {
        cwds: Vec::new(),
        sidechain: false,
        foreign_identity: false,
    };
    let mut line = Vec::new();
    loop {
        if Instant::now() >= deadline {
            return Err(too_slow());
        }
        line.clear();
        let size = reader
            .by_ref()
            .take(MAX_RECORD + 1)
            .read_until(b'\n', &mut line)
            .map_err(|err| io_error(path, err))?;
        if size == 0 {
            return Ok(out);
        }
        if line.len() as u64 > MAX_RECORD {
            // A record this long carries a payload, not the few fields read here; skip its rest.
            while line.last() != Some(&b'\n') {
                line.clear();
                let more = reader
                    .by_ref()
                    .take(MAX_RECORD)
                    .read_until(b'\n', &mut line)
                    .map_err(|err| io_error(path, err))?;
                if more == 0 {
                    break;
                }
            }
            continue;
        }
        // Only a record naming a directory or a subagent matters; the rest is never parsed.
        let mentions = |needle: &[u8]| line.windows(needle.len()).any(|w| w == needle);
        if !(mentions(b"\"cwd\"") || mentions(b"\"isSidechain\"") || mentions(b"\"sessionId\"")) {
            continue;
        }
        #[derive(Deserialize, Default)]
        #[serde(default, rename_all = "camelCase")]
        struct Record {
            cwd: Option<String>,
            session_id: Option<String>,
            is_sidechain: Option<bool>,
        }
        let Ok(record) = serde_json::from_slice::<Record>(&line) else {
            continue;
        };
        out.sidechain |= record.is_sidechain == Some(true);
        out.foreign_identity |= record.session_id.as_deref().is_some_and(|id| id != stem);
        if let Some(cwd) = record.cwd.filter(|cwd| !cwd.is_empty()) {
            let cwd = PathBuf::from(cwd);
            if !out.cwds.contains(&cwd) && out.cwds.len() < MAX_CWDS {
                out.cwds.push(cwd);
            }
        }
    }
}

/// Every saved source file by session id; an id in two buckets is listed under both.
fn index_sources(root: &Path) -> Result<HashMap<String, Vec<PathBuf>>, RpcError> {
    let mut files: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let buckets = match std::fs::read_dir(root) {
        Ok(buckets) => buckets,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(files),
        Err(err) => return Err(io_error(root, err)),
    };
    let mut seen = 0;
    for bucket in buckets {
        let bucket = bucket.map_err(|err| io_error(root, err))?.path();
        if !bucket.is_dir() {
            continue;
        }
        for file in std::fs::read_dir(&bucket).map_err(|err| io_error(&bucket, err))? {
            seen += 1;
            if seen > MAX_FILES * 10 {
                return Err(RpcError::not_accepted(
                    "storage contains too many conversation files to inspect",
                ));
            }
            let path = file.map_err(|err| io_error(&bucket, err))?.path();
            if path.extension().is_some_and(|ext| ext == "jsonl")
                && let Some(stem) = path.file_stem().and_then(|stem| stem.to_str())
                && is_uuid(stem)
            {
                files
                    .entry(stem.to_ascii_lowercase())
                    .or_default()
                    .push(path);
            }
        }
    }
    Ok(files)
}

impl Launcher {
    /// The bundled sidecar, found beside the running Daemon unless `ROUNDUP_SIDECAR_DIR` says.
    #[must_use]
    pub fn with_sidecar(mut self, dir: PathBuf) -> Self {
        self.sidecar = Some(Sidecar { dir });
        self
    }

    /// The Project's sessions active in `[now_ms - period_ms, now_ms]`: saved ones from the SDK,
    /// live ones from `claude agents --json`, merged on session id. `worktrees` are the Project's
    /// registered Worktree roots. A missing runtime or CLI is an error, never an empty list.
    pub async fn list_vendor(
        &self,
        project: &Path,
        worktrees: &[PathBuf],
        window: (i64, i64),
    ) -> Result<Listing, RpcError> {
        let (now_ms, period_ms) = window;
        let deadline = Instant::now() + BUDGET;
        let sidecar = self.sidecar.as_ref().ok_or_else(|| {
            RpcError::not_found(
                "roundup's bundled Node runtime was not found; reinstall roundup (or set ROUNDUP_SIDECAR_DIR)",
            )
        })?;
        let project = canonical_path(project);
        let mut roots = vec![project.clone()];
        roots.extend(
            worktrees
                .iter()
                .filter(|root| **root != project && !root.starts_with(project.join(".roundup")))
                .cloned(),
        );
        let mut live: HashMap<String, Live> = HashMap::new();
        for root in &roots {
            for (id, row) in live_rows(&self.bin, root, deadline).await? {
                live.entry(id).or_insert(row);
            }
        }
        let mut running = sidecar.start(&self.conversation_dir, deadline).await?;
        let found = running
            .ask(&json!({
                "op": "list",
                "dirs": roots.iter().map(|root| root.to_string_lossy()).collect::<Vec<_>>(),
                "since": now_ms.saturating_sub(period_ms),
                // A running program is listed however long ago its file last changed.
                "include": live.keys().collect::<Vec<_>>(),
            }))
            .await?;
        let sdk = found.sdk.clone();
        let root = self.conversation_dir.join("projects");
        let rows: Vec<(Row, bool)> = found
            .scoped
            .into_iter()
            .map(|row| (row, true))
            .chain(found.others.into_iter().map(|row| (row, false)))
            .collect();
        let (mut listing, reads) = tokio::task::spawn_blocking({
            let project = project.clone();
            let roots = roots.clone();
            move || assemble(&root, &project, &roots, rows, live, now_ms, deadline)
        })
        .await
        .map_err(RpcError::internal)??;
        // A session the compatibility projection admitted must also be readable through the SDK.
        for source in reads {
            let read = running
                .ask(&json!({"op": "read", "sessionId": source}))
                .await?;
            if read.found == Some(false) {
                listing.candidates.retain(|c| c.source != source);
                listing.excluded.push(ImportExclusion {
                    source,
                    reason: "the SDK cannot read this session".into(),
                    modified_ms: None,
                });
            }
        }
        listing.notices = running.finish().await;
        listing.sdk = sdk;
        listing.excluded.sort_by(|a, b| a.source.cmp(&b.source));
        Ok(listing)
    }
}

/// Decide each SDK row against the Project. Returns the listing and the sources the compatibility
/// projection admitted, which the SDK is then asked to read.
fn assemble(
    root: &Path,
    project: &Path,
    roots: &[PathBuf],
    rows: Vec<(Row, bool)>,
    mut live: HashMap<String, Live>,
    _now_ms: i64,
    deadline: Instant,
) -> Result<(Listing, Vec<String>), RpcError> {
    let files = index_sources(root)?;
    let mut out = Listing::default();
    let mut admitted = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (row, scoped) in rows {
        let source = row.session_id.to_ascii_lowercase();
        if !seen.insert(source.clone()) || !is_uuid(&source) {
            continue;
        }
        let exclude = |out: &mut Listing, reason: &str| {
            out.excluded.push(ImportExclusion {
                source: source.clone(),
                reason: reason.into(),
                modified_ms: Some(row.last_modified),
            });
        };
        let paths = files.get(&source).map(Vec::as_slice).unwrap_or_default();
        let path = match paths {
            [path] => path,
            [] => {
                // A session the SDK read from elsewhere than local files cannot be retained.
                if scoped {
                    exclude(&mut out, "saved records not found");
                }
                continue;
            }
            _ => {
                exclude(&mut out, "duplicate source identity");
                continue;
            }
        };
        let before = path.metadata().map_err(|err| io_error(path, err))?;
        let records = read_records(path, &source, deadline)?;
        let after = path.metadata().map_err(|err| io_error(path, err))?;
        if source_revision(&before) != source_revision(&after) {
            return Err(RpcError::conflict(format!(
                "source changed while listing: {source}; Refresh to try again"
            )));
        }
        let live_row = live.remove(&source);
        let recorded = records
            .cwds
            .iter()
            .cloned()
            .chain(row.cwd.iter().map(PathBuf::from))
            .chain(
                live_row
                    .iter()
                    .filter_map(|l| l.cwd.as_deref())
                    .map(PathBuf::from),
            );
        let mut internal = false;
        let mut mapped = None;
        for cwd in recorded {
            match map_into_project(&cwd, project, roots) {
                Ok(Some(relative)) => {
                    mapped = Some(relative);
                    break;
                }
                Ok(None) => {}
                Err(_) => internal = true,
            }
        }
        let Some(relative) = mapped else {
            if internal {
                exclude(&mut out, "inside roundup's own folder");
            }
            continue;
        };
        if records.sidechain {
            exclude(&mut out, "subagent record");
            continue;
        }
        if records.foreign_identity {
            exclude(&mut out, "identity does not match source");
            continue;
        }
        if !scoped {
            admitted.push(source.clone());
        }
        let title = row
            .custom_title
            .filter(|t| !t.trim().is_empty())
            .or(row.summary.filter(|t| !t.trim().is_empty()))
            .unwrap_or_else(|| "Untitled conversation".into());
        out.candidates.push(Listed {
            source,
            title,
            cwd: relative,
            last_activity_ms: row.last_modified,
            revision: source_revision(&after),
            live: live_row,
        });
    }
    // A running program with no saved records yet cannot be imported; say so.
    for (source, _) in live {
        out.excluded.push(ImportExclusion {
            source,
            reason: "live session has no saved records yet".into(),
            modified_ms: None,
        });
    }
    out.candidates.sort_by(|a, b| {
        b.last_activity_ms
            .cmp(&a.last_activity_ms)
            .then_with(|| a.source.cmp(&b.source))
    });
    Ok((out, admitted))
}
