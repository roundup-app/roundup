//! U2875a: recent top-level conversations of one Project. Vendor storage stays here (P4).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rpc::RpcError;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::fs::MetadataExt;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, UNIX_EPOCH};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::{Launcher, is_uuid};

/// One conversation the user may import. `revision` binds the preview to the source file facts.
#[derive(Debug, PartialEq, Eq)]
pub struct ImportCandidate {
    pub source: String,
    pub title: String,
    /// The recorded working directory, relative to the Project.
    pub cwd: PathBuf,
    pub last_activity_ms: i64,
    pub revision: String,
}

/// A conversation that is not selectable, with the reason the user reads.
#[derive(Debug, PartialEq, Eq)]
pub struct ImportExclusion {
    pub source: String,
    pub reason: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportDiscovery {
    /// Newest first, equal times by source identity.
    pub candidates: Vec<ImportCandidate>,
    pub excluded: Vec<ImportExclusion>,
}

// U3082b: the owner measured 50 s for week/600 MB. Project only metadata,
// skipping payload allocation; commit alone validates every complete record.
const MAX_PREVIEW: u64 = 4_000_000_000;
const MAX_RECORD: u64 = 8 * 1024 * 1024;
const MAX_METADATA: usize = 8 * 1024 * 1024;
const MAX_SNAPSHOT: usize = 512 * 1024 * 1024;
const MAX_FILES: usize = 10_000;

pub(super) fn encoded(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .encode_utf16()
        .map(|unit| {
            char::from_u32(u32::from(unit))
                .filter(|c| c.is_ascii_alphanumeric())
                .unwrap_or('-')
        })
        .collect()
}

fn is_possible_bucket(bucket: &Path, project: &Path) -> bool {
    let prefix = encoded(project);
    // Long vendor bucket names can be truncated/hashed: keep them for record validation.
    if prefix.len() > 200 {
        return true;
    }
    let name = bucket.file_name().unwrap_or_default().to_string_lossy();
    name == prefix
        || name
            .strip_prefix(&prefix)
            .is_some_and(|rest| rest.starts_with('-'))
}

enum Scan {
    Member(ImportCandidate),
    OtherProject,
    Out,
    Excluded(String),
}

impl Launcher {
    /// Read the effective Claude storage for conversations of `project` active in
    /// `[now_ms - period_ms, now_ms]`. A missing or unreadable storage is an error, never empty.
    pub async fn discover_recent(
        &self,
        project: &Path,
        now_ms: i64,
        period_ms: i64,
    ) -> Result<ImportDiscovery, RpcError> {
        let generation = self.discovery.0.fetch_add(1, Ordering::SeqCst) + 1;
        let deadline = Instant::now() + Duration::from_secs(18);
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &self.import_observer {
            observer(project, "request", 0);
        }
        // Wait without occupying a blocking worker. An abandoned reader keeps the
        // owned permit until its next record boundary, even if its caller goes away.
        let reader =
            tokio::time::timeout_at(deadline.into(), self.discovery.1.clone().lock_owned())
                .await
                .map_err(|_| {
                    RpcError::not_accepted("discovery took too long; Refresh to try again")
                })?;
        if self.discovery.0.load(Ordering::SeqCst) != generation {
            return Err(RpcError::conflict(
                "discovery superseded; Refresh to try again",
            ));
        }
        let launcher = self.clone();
        let project = project.to_path_buf();
        tokio::task::spawn_blocking(move || {
            let _reader = reader;
            #[cfg(any(test, feature = "test-support"))]
            if let Some(observer) = &launcher.import_observer {
                observer(&project, "worker", 0);
            }
            let found = launcher.discover(&project, (now_ms, period_ms), generation, deadline);
            #[cfg(any(test, feature = "test-support"))]
            if let Some(observer) = &launcher.import_observer {
                observer(&project, "finished", 0);
            }
            found
        })
        .await
        .map_err(RpcError::internal)?
    }

    fn discover(
        &self,
        project: &Path,
        window: (i64, i64),
        generation: u64,
        deadline: Instant,
    ) -> Result<ImportDiscovery, RpcError> {
        let (now_ms, period_ms) = window;
        let check = || {
            if self.discovery.0.load(Ordering::SeqCst) != generation {
                Err(RpcError::conflict(
                    "discovery superseded; Refresh to try again",
                ))
            } else if Instant::now() >= deadline {
                Err(RpcError::not_accepted(
                    "discovery took too long; Refresh to try again",
                ))
            } else {
                Ok(())
            }
        };
        check()?;
        let project = project
            .canonicalize()
            .map_err(|err| io_error(project, err))?;
        let root = self.conversation_dir.join("projects");
        let buckets = std::fs::read_dir(&root).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                RpcError::not_found(format!(
                    "Claude Code has no saved conversations here ({}): {err}",
                    root.display()
                ))
            } else {
                io_error(&root, err)
            }
        })?;
        let mut found: Vec<(String, Scan)> = Vec::new();
        let mut metadata_bytes = 0;
        for (index, bucket) in buckets.enumerate() {
            check()?;
            if index >= MAX_FILES {
                return Err(RpcError::not_accepted("too many storage buckets"));
            }
            let bucket = bucket.map_err(|err| io_error(&root, err))?.path();
            if !bucket
                .metadata()
                .map_err(|err| io_error(&bucket, err))?
                .is_dir()
            {
                continue;
            }
            let possible = is_possible_bucket(&bucket, &project);
            let files = match std::fs::read_dir(&bucket) {
                Ok(files) => files,
                Err(error) if possible => {
                    return Err(io_error(&bucket, error));
                }
                Err(_) => continue,
            };
            for file in files {
                check()?;
                if found.len() >= MAX_FILES {
                    return Err(RpcError::not_accepted(
                        "storage contains too many conversation files to inspect",
                    ));
                }
                let path = file.map_err(|err| io_error(&bucket, err))?.path();
                if path.extension().is_none_or(|ext| ext != "jsonl") {
                    continue;
                }
                let metadata = path.metadata().map_err(|err| io_error(&path, err))?;
                if !metadata.is_file() {
                    continue;
                }
                let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                let old = metadata
                    .modified()
                    .ok()
                    .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
                    .is_some_and(|at| {
                        i128::try_from(at.as_millis()).unwrap_or(i128::MAX)
                            < i128::from(now_ms.saturating_sub(period_ms))
                    });
                let result = if !possible {
                    Scan::OtherProject
                } else if old {
                    Scan::Out
                } else {
                    scan(
                        self,
                        &path,
                        &stem,
                        &project,
                        (now_ms, period_ms),
                        &check,
                        None,
                    )?
                };
                if let Scan::Member(candidate) = &result {
                    metadata_bytes += candidate.title.len() + candidate.cwd.as_os_str().len();
                    if metadata_bytes > 16 * 1024 * 1024 {
                        return Err(RpcError::not_accepted(
                            "conversation metadata exceeds 16 MiB; narrow the period",
                        ));
                    }
                }
                found.push((stem.to_string(), result));
            }
        }
        let mut counts: HashMap<String, usize> = HashMap::new();
        for (source, _) in &found {
            *counts.entry(source.clone()).or_default() += 1;
        }
        let mut out = ImportDiscovery::default();
        for (source, scan) in found {
            match scan {
                _ if counts[&source] > 1 => out.excluded.push(ImportExclusion {
                    source,
                    reason: "duplicate source identity".into(),
                }),
                Scan::Member(candidate) => out.candidates.push(candidate),
                Scan::Excluded(reason) => out.excluded.push(ImportExclusion { source, reason }),
                Scan::OtherProject | Scan::Out => {}
            }
        }
        out.candidates.sort_by(|a, b| {
            b.last_activity_ms
                .cmp(&a.last_activity_ms)
                .then_with(|| a.source.cmp(&b.source))
        });
        out.excluded.sort_by(|a, b| a.source.cmp(&b.source));
        out.excluded.dedup();
        Ok(out)
    }
}

impl Launcher {
    /// The complete records of one selected conversation, only while they still match the
    /// `revision` the user previewed (U2875c). A changed or vanished source is a conflict.
    pub fn read_import_snapshot(
        &self,
        project: &Path,
        source: &str,
        revision: &str,
        now_ms: i64,
    ) -> Result<(ImportCandidate, Vec<u8>), RpcError> {
        let changed = || {
            RpcError::conflict(format!(
                "source changed since preview: {source}; Refresh to try again"
            ))
        };
        if !is_uuid(source) {
            return Err(changed());
        }
        let project = project
            .canonicalize()
            .map_err(|err| io_error(project, err))?;
        let file = format!("{source}.jsonl");
        let mut selected = None;
        let root = self.conversation_dir.join("projects");
        let buckets = std::fs::read_dir(&root).map_err(|err| io_error(&root, err))?;
        for (index, bucket) in buckets.enumerate() {
            if index >= MAX_FILES {
                return Err(RpcError::not_accepted("too many storage buckets"));
            }
            let bucket = bucket.map_err(|err| io_error(&root, err))?.path();
            if !bucket
                .metadata()
                .map_err(|err| io_error(&bucket, err))?
                .is_dir()
            {
                continue;
            }
            if !is_possible_bucket(&bucket, &project) {
                continue;
            }
            let path = bucket.join(&file);
            #[cfg(any(test, feature = "test-support"))]
            if let Some(observer) = &self.import_observer {
                observer(&path, "probe", 0);
            }
            if path.try_exists().map_err(|err| io_error(&path, err))? {
                if selected.is_some() {
                    return Err(changed());
                }
                selected = Some(path);
            }
        }
        if let Some(path) = selected {
            if source_revision(&path.metadata().map_err(|err| io_error(&path, err))?) != revision {
                return Err(changed());
            }
            let mut bytes = Vec::new();
            let deadline = Instant::now() + Duration::from_secs(18);
            let check = || {
                if Instant::now() < deadline {
                    Ok(())
                } else {
                    Err(RpcError::not_accepted(
                        "source validation took too long; Refresh to try again",
                    ))
                }
            };
            match scan(
                self,
                &path,
                source,
                &project,
                (now_ms, i64::MAX),
                &check,
                Some(&mut bytes),
            )? {
                Scan::Member(candidate) if candidate.revision == revision => {
                    return Ok((candidate, bytes));
                }
                Scan::Excluded(reason) => {
                    return Err(RpcError::conflict(format!(
                        "cannot import {source}: {reason}; Refresh to try again"
                    )));
                }
                _ => {}
            }
        }
        Err(changed())
    }
}

pub(super) fn io_error(path: &Path, error: impl std::fmt::Display) -> RpcError {
    RpcError::internal(format!("{}: {error}", path.display()))
}

fn source_revision(metadata: &std::fs::Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
        metadata.mode()
    )
}

fn scan(
    launcher: &Launcher,
    path: &Path,
    stem: &str,
    project: &Path,
    window: (i64, i64),
    check: &impl Fn() -> Result<(), RpcError>,
    retained: Option<&mut Vec<u8>>,
) -> Result<Scan, RpcError> {
    if !is_uuid(stem) {
        return Ok(Scan::Excluded("unsupported source name".into()));
    }
    let metadata = path.metadata().map_err(|err| io_error(path, err))?;
    let len = metadata.len();
    if retained.is_none() && len > MAX_PREVIEW {
        return Ok(Scan::Excluded(
            "source exceeds 4,000,000,000 byte preview limit".into(),
        ));
    }
    #[cfg(any(test, feature = "test-support"))]
    if let Some(observer) = &launcher.import_observer {
        observer(path, "open", 0);
    }
    let mut file = std::fs::File::open(path).map_err(|err| io_error(path, err))?;
    let revision = source_revision(&file.metadata().map_err(|err| io_error(path, err))?);
    // Capture size once: an append cannot extend this read or its deadline.
    let result = scan_records(
        launcher,
        (path, stem),
        project,
        window,
        check,
        retained,
        file.by_ref().take(len),
    )?;
    check()?;
    if source_revision(&metadata) != revision
        || source_revision(&file.metadata().map_err(|err| io_error(path, err))?) != revision
        || source_revision(&path.metadata().map_err(|err| io_error(path, err))?) != revision
    {
        return Err(RpcError::conflict(format!(
            "source changed since preview: {}; Refresh to try again",
            path.display()
        )));
    }
    Ok(match result {
        Scan::Member(mut candidate) => {
            candidate.revision = revision;
            Scan::Member(candidate)
        }
        other => other,
    })
}

fn scan_records(
    launcher: &Launcher,
    source: (&Path, &str),
    project: &Path,
    window: (i64, i64),
    check: &impl Fn() -> Result<(), RpcError>,
    mut retained: Option<&mut Vec<u8>>,
    input: impl Read,
) -> Result<Scan, RpcError> {
    let (path, stem) = source;
    let (now_ms, period_ms) = window;
    let preview = retained.is_none();
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = launcher;
    let mut reader = BufReader::with_capacity(64 * 1024, input);
    let mut line = Vec::with_capacity(MAX_RECORD as usize);
    #[cfg(any(test, feature = "test-support"))]
    if let Some(observer) = &launcher.import_observer {
        observer(path, "buffer", line.capacity() as u64);
    }
    let mut complete = false;
    let mut cwds: Vec<PathBuf> = Vec::new();
    let mut latest: Option<i64> = None;
    let (mut custom, mut agent, mut ai): (Option<String>, Option<String>, Option<String>) =
        (None, None, None);
    loop {
        check()?;
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &launcher.import_observer {
            observer(path, "record", 0);
        }
        line.clear();
        let read = reader
            .by_ref()
            .take(MAX_RECORD)
            .read_until(b'\n', &mut line);
        let size = read.map_err(|err| io_error(path, err))?;
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &launcher.import_observer {
            observer(path, "bytes", size as u64);
        }
        if size == 0 {
            break;
        }
        if size as u64 == MAX_RECORD
            && line.last() != Some(&b'\n')
            && !reader
                .fill_buf()
                .map_err(|err| io_error(path, err))?
                .is_empty()
        {
            return Ok(Scan::Excluded("record exceeds 8 MiB limit".into()));
        }
        if line.last() != Some(&b'\n') {
            break;
        }
        complete = true;
        if let Some(bytes) = &mut retained {
            if bytes.len() + line.len() > MAX_SNAPSHOT {
                return Ok(Scan::Excluded(
                    "conversation exceeds 512 MiB import limit".into(),
                ));
            }
            bytes.extend_from_slice(&line);
        }
        if line == b"\n" {
            continue;
        }
        // Serde structs also accept arrays; vendor records must be objects.
        if line.trim_ascii_start().first() != Some(&b'{') {
            return Ok(Scan::Excluded("malformed record".into()));
        }
        // Unknown fields use Serde's IgnoredAny: inspect framing without
        // materializing payloads or validating their UTF-8. Selected snapshots
        // still go through Value so every complete payload is validated at commit.
        if !preview && serde_json::from_slice::<Value>(&line).is_err() {
            return Ok(Scan::Excluded("malformed record".into()));
        }
        let Ok(record) = serde_json::from_slice::<Metadata>(&line) else {
            return Ok(Scan::Excluded("malformed record".into()));
        };
        if record.is_sidechain == Some(true) {
            return Ok(Scan::Excluded("subagent record".into()));
        }
        if record.session_id.as_deref().is_some_and(|id| id != stem) {
            return Ok(Scan::Excluded("identity does not match source".into()));
        }
        let cwd = record
            .cwd
            .as_deref()
            .filter(|cwd| !cwd.is_empty())
            .map(PathBuf::from)
            .filter(|cwd| !cwds.contains(cwd));
        if cwd.is_some() && cwds.len() >= 64 {
            return Ok(Scan::Excluded("too many recorded directories".into()));
        }
        let mut next_titles = [custom.as_deref(), agent.as_deref(), ai.as_deref()];
        let title = match record.kind.as_deref() {
            Some("custom-title") => Some((0, record.custom_title)),
            Some("agent-name") => Some((1, record.agent_name)),
            Some("ai-title") => Some((2, record.ai_title)),
            _ => None,
        }
        .and_then(|(index, text)| {
            text.filter(|text| !text.trim().is_empty())
                .map(|text| (index, text))
        });
        if let Some((index, text)) = &title {
            next_titles[*index] = Some(text);
        }
        let metadata_bytes = cwds
            .iter()
            .chain(cwd.iter())
            .map(|cwd| cwd.as_os_str().len())
            .sum::<usize>()
            + next_titles
                .into_iter()
                .flatten()
                .map(str::len)
                .sum::<usize>();
        if metadata_bytes > MAX_METADATA {
            return Ok(Scan::Excluded("metadata exceeds 8 MiB limit".into()));
        }
        if let Some(cwd) = cwd {
            cwds.push(cwd);
        }
        if let Some((index, text)) = title {
            match index {
                0 => custom = Some(text),
                1 => agent = Some(text),
                _ => ai = Some(text),
            }
        }
        if let Some(ms) = record.timestamp.as_deref().and_then(millis)
            && ms <= now_ms
        {
            latest = latest.max(Some(ms));
        }
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &launcher.import_observer {
            observer(path, "metadata", metadata_bytes as u64);
        }
    }
    check()?;
    if !complete {
        return Ok(Scan::Excluded("no complete records".into()));
    }
    let mut inside = Vec::new();
    let mut outside = false;
    for cwd in &cwds {
        match cwd.canonicalize() {
            Ok(real) if real.starts_with(project) => inside.push(real),
            Ok(_) => outside = true,
            Err(err) if cwd.starts_with(project) => {
                return Ok(Scan::Excluded(format!(
                    "missing directory {}: {err}",
                    cwd.display()
                )));
            }
            Err(_) => outside = true,
        }
    }
    match (inside.as_slice(), outside) {
        ([], true) => return Ok(Scan::OtherProject),
        ([], false) => return Ok(Scan::Excluded("no recorded working directory".into())),
        ([_], false) => {}
        _ => return Ok(Scan::Excluded("ambiguous Project membership".into())),
    }
    let cwd = &inside[0];
    let relative = cwd.strip_prefix(project).unwrap_or(Path::new(""));
    if relative
        .components()
        .next()
        .is_some_and(|c| c.as_os_str() == ".roundup")
        || in_linked_worktree(cwd, project)
    {
        return Ok(Scan::Excluded("inside a Worktree".into()));
    }
    let Some(latest) = latest else {
        return Ok(Scan::Excluded("activity unknown or in the future".into()));
    };
    if latest < now_ms.saturating_sub(period_ms) {
        return Ok(Scan::Out);
    }
    Ok(Scan::Member(ImportCandidate {
        source: stem.to_owned(),
        title: custom
            .or(agent)
            .or(ai)
            .unwrap_or_else(|| "Untitled conversation".into()),
        cwd: relative.to_path_buf(),
        last_activity_ms: latest,
        revision: String::new(),
    }))
}

// This projection owns the untyped vendor boundary; payload fields are never retained.
#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Metadata {
    #[serde(rename = "type")]
    kind: Option<String>,
    is_sidechain: Option<bool>,
    session_id: Option<String>,
    cwd: Option<String>,
    timestamp: Option<String>,
    custom_title: Option<String>,
    agent_name: Option<String>,
    ai_title: Option<String>,
}

fn millis(text: &str) -> Option<i64> {
    let at = OffsetDateTime::parse(text, &Rfc3339).ok()?;
    i64::try_from(at.unix_timestamp_nanos() / 1_000_000).ok()
}

/// A linked git Worktree has a `.git` file; the Project's own `.git` is not one.
fn in_linked_worktree(cwd: &Path, project: &Path) -> bool {
    cwd.ancestors()
        .take_while(|dir| *dir != project)
        .any(|dir| dir.join(".git").is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000;
    const SESSION: &str = "11111111-1111-4111-8111-111111111111";

    fn record(kind: &str, cwd: &Path, ts: &str) -> String {
        format!(
            r#"{{"type":"{kind}","isSidechain":false,"cwd":"{}","sessionId":"{SESSION}","timestamp":"{ts}"}}"#,
            cwd.display()
        )
    }

    fn store(config: &Path, bucket: &str, id: &str, text: &str) {
        let cwd = text
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .find_map(|record| record["cwd"].as_str().map(str::to_owned))
            .unwrap();
        let cwd = PathBuf::from(cwd);
        let bucket = if bucket == "y" {
            cwd.join("duplicate")
        } else {
            cwd
        };
        let dir = config.join("projects").join(encoded(&bucket));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{id}.jsonl")), text).unwrap();
    }

    fn launcher(config: &Path) -> Launcher {
        Launcher::new("claude", config.join(".claude.json"), "rup".into(), None)
    }

    /// 2026-10-19T12:00:00Z
    const NOW: i64 = 1_792_411_200_000;

    #[tokio::test]
    async fn u2875a_activity_is_not_file_mtime() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("project");
        let sub = project.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let elsewhere = root.path().join("other");
        std::fs::create_dir_all(&elsewhere).unwrap();
        let config = root.path().join("config");
        let old = record("user", &sub, "2026-10-01T00:00:00Z");
        // Fresh file mtime, old activity: out of a seven-day period.
        store(&config, "a", SESSION, &format!("{old}\n"));
        let found = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap();
        assert!(found.candidates.is_empty());
        let wide = launcher(&config)
            .discover_recent(&project, NOW, 30 * DAY)
            .await
            .unwrap();
        assert_eq!(wide.candidates[0].cwd, PathBuf::from("sub"));
        assert_eq!(wide.candidates[0].title, "Untitled conversation");

        // Latest valid activity counts; a future-only record is excluded with a reason.
        let recent = record("user", &sub, "2026-10-18T00:00:00Z");
        let title = r#"{"type":"custom-title","customTitle":"Named"}"#;
        let torn = r#"{"type":"user","cwd":"/x"#;
        store(
            &config,
            "a",
            SESSION,
            &format!("{old}\n{recent}\n{title}\n{torn}"),
        );
        let found = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap();
        assert_eq!(found.candidates.len(), 1);
        assert_eq!(found.candidates[0].title, "Named");
        store(
            &config,
            "a",
            SESSION,
            &format!("{}\n", record("user", &sub, "2027-01-01T00:00:00Z")),
        );
        let future = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap();
        assert!(future.candidates.is_empty());
        assert_eq!(
            future.excluded[0].reason,
            "activity unknown or in the future"
        );

        // Another Project, a directory outside via symlink, and a missing cwd never select.
        let other = "22222222-2222-4222-8222-222222222222";
        store(
            &config,
            "b",
            other,
            &format!(
                "{}\n",
                record("user", &elsewhere, "2026-10-18T00:00:00Z").replace(SESSION, other)
            ),
        );
        std::os::unix::fs::symlink(&elsewhere, project.join("link")).unwrap();
        let third = "33333333-3333-4333-8333-333333333333";
        let via = project.join("link");
        store(
            &config,
            "c",
            third,
            &format!(
                "{}\n",
                record("user", &via, "2026-10-18T00:00:00Z").replace(SESSION, third)
            ),
        );
        let fourth = "44444444-4444-4444-8444-444444444444";
        let gone = project.join("gone");
        store(
            &config,
            "d",
            fourth,
            &format!(
                "{}\n",
                record("user", &gone, "2026-10-18T00:00:00Z").replace(SESSION, fourth)
            ),
        );
        let found = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap();
        assert!(found.candidates.is_empty());
        assert!(
            found
                .excluded
                .iter()
                .any(|e| e.source == fourth && e.reason.starts_with("missing directory"))
        );
        assert!(
            found
                .excluded
                .iter()
                .all(|e| e.source != other && e.source != third)
        );
    }

    #[tokio::test]
    async fn u2875a_sources_are_ordered_and_not_duplicated() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        let config = root.path().join("config");
        let b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        let a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        for id in [b, a] {
            let r = record("user", &project, "2026-10-18T00:00:00Z").replace(SESSION, id);
            store(&config, "x", id, &format!("{r}\n"));
        }
        let found = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap();
        let ids: Vec<_> = found.candidates.iter().map(|c| c.source.as_str()).collect();
        assert_eq!(ids, [a, b]);
        let r = record("user", &project, "2026-10-18T00:00:00Z").replace(SESSION, a);
        store(&config, "y", a, &format!("{r}\n"));
        let found = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap();
        assert_eq!(found.candidates.len(), 1);
        assert_eq!(found.excluded[0].reason, "duplicate source identity");
        assert!(
            launcher(&root.path().join("none"))
                .discover_recent(&project, NOW, DAY)
                .await
                .is_err()
        );
    }
    fn observed(config: &Path) -> (Launcher, std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>) {
        let opened = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let journal = opened.clone();
        let mut launcher = launcher(config);
        launcher.import_observer = Some(std::sync::Arc::new(move |path, phase, _bytes| {
            if phase == "open" {
                journal.lock().unwrap().push(path.to_path_buf());
            }
        }));
        (launcher, opened)
    }

    #[tokio::test]
    async fn u3037a_bucket_pruning_keeps_possible_members() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("a.b_c-d🦊");
        let sub = project.join("nested");
        let collision = root.path().join("a-b-c-d--");
        let sibling = root.path().join("a.b_c-d🦊sibling");
        let outside = root.path().join("other");
        for dir in [&sub, &collision, &sibling, &outside] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let config = root.path().join("config");
        for (i, cwd) in [&project, &sub, &collision, &sibling, &outside]
            .into_iter()
            .enumerate()
        {
            let id = format!("{i:08}-1111-4111-8111-111111111111");
            store(
                &config,
                "x",
                &id,
                &(record("user", cwd, "2026-10-18T12:00:00Z").replace(SESSION, &id) + "\n"),
            );
        }
        // A canonical recorded escape in an encoded matching bucket still fails membership.
        let escape = project.join("escape");
        std::os::unix::fs::symlink(&outside, &escape).unwrap();
        let id = "eeeeeeee-1111-4111-8111-111111111111";
        store(
            &config,
            "x",
            id,
            &(record("user", &escape, "2026-10-18T12:00:00Z").replace(SESSION, id) + "\n"),
        );
        let alias = root.path().join("alias");
        std::os::unix::fs::symlink(&project, &alias).unwrap();
        let (launcher, opened) = observed(&config);
        let found = launcher
            .discover_recent(&alias, NOW, 7 * DAY)
            .await
            .unwrap();
        assert_eq!(found.candidates.len(), 2);
        let opens = opened.lock().unwrap();
        assert_eq!(opens.len(), 4); // Project, nested, encoding collision and escape.
        assert!(opens.iter().all(|path| {
            !path.starts_with(config.join("projects").join(encoded(&sibling)))
                && !path.starts_with(config.join("projects").join(encoded(&outside)))
        }));
    }

    #[tokio::test]
    async fn u3037a_long_bucket_prefixes_remain_possible_members() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("a".repeat(100)).join("b".repeat(100));
        std::fs::create_dir_all(&project).unwrap();
        let config = root.path().join("config");
        let name = encoded(&project).chars().take(200).collect::<String>() + "-100y1g";
        let bucket = config.join("projects").join(name);
        std::fs::create_dir_all(&bucket).unwrap();
        std::fs::write(
            bucket.join(format!("{SESSION}.jsonl")),
            record("user", &project, "2026-10-18T12:00:00Z") + "\n",
        )
        .unwrap();
        let found = launcher(&config)
            .discover_recent(&project, NOW, DAY)
            .await
            .unwrap();
        assert_eq!(found.candidates.len(), 1);
        assert_eq!(found.candidates[0].cwd, Path::new(""));
    }

    #[tokio::test]
    async fn u3037a_old_files_are_not_opened() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        store(
            &config,
            "x",
            SESSION,
            &(record("user", &project, "2026-10-18T12:00:00Z") + "\n"),
        );
        let path = config
            .join("projects")
            .join(encoded(&project))
            .join(format!("{SESSION}.jsonl"));
        let file = std::fs::File::options().write(true).open(&path).unwrap();
        let boundary = UNIX_EPOCH + Duration::from_millis((NOW - DAY) as u64);
        file.set_modified(boundary - Duration::from_millis(1))
            .unwrap();
        let (launcher, opened) = observed(&config);
        assert!(
            launcher
                .discover_recent(&project, NOW, DAY)
                .await
                .unwrap()
                .candidates
                .is_empty()
        );
        assert!(opened.lock().unwrap().is_empty());
        file.set_modified(boundary).unwrap();
        assert_eq!(
            launcher
                .discover_recent(&project, NOW, DAY)
                .await
                .unwrap()
                .candidates
                .len(),
            1
        );
        assert_eq!(*opened.lock().unwrap(), [path]);
    }

    #[tokio::test]
    async fn u3037b_streaming_preserves_candidate_and_revision() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let fixture = include_str!("../../tests/fixtures/import-2.1.300/top-level.jsonl")
            .replace("/fixture/project", project.to_str().unwrap())
            .replace("00000001-1111-4111-8111-111111111111", SESSION);
        let complete = fixture + &format!("{}\n", record("user", &project, "2026-10-18T12:00:00Z"));
        store(&config, "x", SESSION, &(complete.clone() + "{\"torn\":"));
        let launcher = launcher(&config);
        let mut candidates = launcher
            .discover_recent(&project, NOW, 7 * DAY)
            .await
            .unwrap()
            .candidates;
        assert_eq!(candidates.len(), 1);
        let candidate = candidates.pop().unwrap();
        assert_eq!(candidate.title, "Observed import name");
        assert!(!candidate.revision.is_empty());
        let (retained, bytes) = launcher
            .read_import_snapshot(&project, SESSION, &candidate.revision, NOW)
            .unwrap();
        assert_eq!(retained, candidate);
        assert_eq!(bytes, complete.as_bytes());
    }

    #[tokio::test]
    async fn u3037b_source_changed_during_preview_is_refused() {
        use std::io::Write;
        for replace in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let project = root.path().join("project");
            std::fs::create_dir(&project).unwrap();
            let config = root.path().join("config");
            store(
                &config,
                "x",
                SESSION,
                &(record("user", &project, "2026-10-18T12:00:00Z") + "\n"),
            );
            let changed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let mut launcher = launcher(&config);
            launcher.import_observer = Some(std::sync::Arc::new(move |path, phase, _| {
                if phase == "record" && !changed.swap(true, Ordering::SeqCst) {
                    if replace {
                        let bytes = std::fs::read(path).unwrap();
                        let replacement = path.with_extension("replacement");
                        std::fs::write(&replacement, bytes).unwrap();
                        std::fs::rename(replacement, path).unwrap();
                    } else {
                        std::fs::File::options()
                            .append(true)
                            .open(path)
                            .unwrap()
                            .write_all(b"{}\n")
                            .unwrap();
                    }
                }
            }));
            let refused = launcher
                .discover_recent(&project, NOW, DAY)
                .await
                .unwrap_err();
            assert!(
                refused.message.contains("changed since preview"),
                "{refused:?}"
            );
            assert!(refused.message.contains("Refresh"));
        }
    }

    #[tokio::test]
    async fn u3037b_preview_preserves_records_crossing_boundaries() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let header = record("user", &project, "2026-10-01T00:00:00Z") + "\n";
        let metadata = format!(
            "{{\"type\":\"custom-title\",\"customTitle\":\"Boundary rename\",\"timestamp\":\"2026-10-18T12:00:00Z\",\"payload\":\"{}\"}}\n",
            "x".repeat(60_000)
        );
        for len in [300_000, 400_000, 800_000] {
            for boundary in [256 * 1024, len - 256 * 1024] {
                let mut bytes = header.as_bytes().to_vec();
                bytes.resize(boundary - metadata.len() / 2, b'\n');
                bytes.extend_from_slice(metadata.as_bytes());
                bytes.resize(len - 8, b'\n');
                bytes.extend_from_slice(b"{\"torn\":");
                store(&config, "x", SESSION, std::str::from_utf8(&bytes).unwrap());
                let launcher = launcher(&config);
                let found = launcher
                    .discover_recent(&project, NOW, 7 * DAY)
                    .await
                    .unwrap();
                assert_eq!(found.candidates.len(), 1, "{len}/{boundary}: {found:?}");
                assert!(found.excluded.is_empty());
                let candidate = &found.candidates[0];
                assert_eq!(candidate.title, "Boundary rename", "{len}/{boundary}");
                assert_eq!(candidate.last_activity_ms, NOW - DAY);
                let (confirmed, retained) = launcher
                    .read_import_snapshot(&project, SESSION, &candidate.revision, NOW)
                    .unwrap();
                assert_eq!(&confirmed, candidate);
                assert_eq!(retained, bytes[..bytes.len() - 8]);
            }
        }
    }

    #[tokio::test]
    async fn u3037b_middle_metadata_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let other = "22222222-2222-4222-8222-222222222222";
        store(
            &config,
            "x",
            other,
            &(record("user", &project, "2026-10-16T12:00:00Z").replace(SESSION, other) + "\n"),
        );
        let diagnostic = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(60_000));
        for title in [false, true] {
            let header = record(
                "user",
                &project,
                if title {
                    "2026-10-18T12:00:00Z"
                } else {
                    "2026-10-01T00:00:00Z"
                },
            ) + "\n";
            let mut lengths = Vec::new();
            for variant in [false, true] {
                let middle = if title {
                    format!(
                        "{{\"type\":\"custom-title\",\"customTitle\":\"{}\"}}\n",
                        if variant {
                            "Other chosen name"
                        } else {
                            "First chosen name"
                        }
                    )
                } else {
                    record(
                        "user",
                        &project,
                        if variant {
                            "2026-10-18T12:00:00Z"
                        } else {
                            "2026-10-01T12:00:00Z"
                        },
                    ) + "\n"
                };
                let text = header.clone() + &diagnostic.repeat(7) + &middle + &diagnostic.repeat(7);
                lengths.push(text.len());
                store(&config, "x", SESSION, &text);
                let path = config
                    .join("projects")
                    .join(encoded(&project))
                    .join(format!("{SESSION}.jsonl"));
                std::fs::File::options()
                    .write(true)
                    .open(&path)
                    .unwrap()
                    .set_modified(UNIX_EPOCH + Duration::from_millis(NOW as u64))
                    .unwrap();
                let launcher = launcher(&config);
                let found = launcher
                    .discover_recent(&project, NOW, 7 * DAY)
                    .await
                    .unwrap();
                assert!(found.excluded.is_empty(), "{found:?}");
                if title || variant {
                    assert_eq!(
                        found
                            .candidates
                            .iter()
                            .map(|candidate| candidate.source.as_str())
                            .collect::<Vec<_>>(),
                        [SESSION, other]
                    );
                    let candidate = &found.candidates[0];
                    assert_eq!(candidate.last_activity_ms, NOW - DAY);
                    if title {
                        assert_eq!(
                            candidate.title,
                            if variant {
                                "Other chosen name"
                            } else {
                                "First chosen name"
                            }
                        );
                    }
                    let (confirmed, _) = launcher
                        .read_import_snapshot(&project, SESSION, &candidate.revision, NOW)
                        .unwrap();
                    assert_eq!(&confirmed, candidate);
                } else {
                    assert_eq!(
                        found
                            .candidates
                            .iter()
                            .map(|candidate| candidate.source.as_str())
                            .collect::<Vec<_>>(),
                        [other]
                    );
                }
            }
            assert_eq!(lengths[0], lengths[1]);
        }
    }

    #[tokio::test]
    async fn u3037b_malformed_complete_record_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let valid = record("user", &project, "2026-10-18T12:00:00Z") + "\n";
        store(&config, "x", SESSION, &valid);
        let launcher = launcher(&config);
        let path = config
            .join("projects")
            .join(encoded(&project))
            .join(format!("{SESSION}.jsonl"));
        for broken in [
            b"{\"payload\":\"\xff\"}\n".as_slice(),
            b"{\"payload\":{\"nested\":\"\xff\"}}\n".as_slice(),
        ] {
            let mut bytes = valid.as_bytes().to_vec();
            bytes.extend_from_slice(broken);
            std::fs::write(&path, bytes).unwrap();
            let found = launcher.discover_recent(&project, NOW, DAY).await.unwrap();
            assert_eq!(found.candidates.len(), 1, "payload is deferred: {found:?}");
            let refused = launcher
                .read_import_snapshot(&project, SESSION, &found.candidates[0].revision, NOW)
                .unwrap_err();
            assert!(refused.message.contains("malformed record"), "{refused:?}");
        }
    }

    #[tokio::test]
    async fn u3082d_io_errors_name_their_paths() {
        use std::os::unix::fs::PermissionsExt;
        for operation in [
            "project canonicalization",
            "projects enumeration",
            "bucket enumeration",
            "source metadata",
            "source open",
            "source read",
            "snapshot open",
            "snapshot read",
        ] {
            let root = tempfile::tempdir().unwrap();
            let project = root.path().join("project");
            std::fs::create_dir(&project).unwrap();
            let config = root.path().join("config");
            store(
                &config,
                "x",
                SESSION,
                &(record("user", &project, "2026-10-18T12:00:00Z") + "\n"),
            );
            let projects = config.join("projects");
            let bucket = projects.join(encoded(&project));
            let path = bucket.join(format!("{SESSION}.jsonl"));
            let mut launcher = launcher(&config);
            let revision = launcher
                .discover_recent(&project, NOW, DAY)
                .await
                .unwrap()
                .candidates[0]
                .revision
                .clone();
            let affected = match operation {
                "project canonicalization" => {
                    std::fs::remove_dir(&project).unwrap();
                    project.clone()
                }
                "projects enumeration" => {
                    std::fs::remove_dir_all(&projects).unwrap();
                    std::fs::write(&projects, b"file").unwrap();
                    projects.clone()
                }
                "bucket enumeration" => {
                    std::fs::set_permissions(&bucket, std::fs::Permissions::from_mode(0o000))
                        .unwrap();
                    bucket.clone()
                }
                "source metadata" => {
                    std::fs::remove_file(&path).unwrap();
                    std::os::unix::fs::symlink(root.path().join("missing"), &path).unwrap();
                    path.clone()
                }
                _ => {
                    let target = path.clone();
                    launcher.import_observer = Some(std::sync::Arc::new(move |file, phase, _| {
                        if file == target && phase == "open" {
                            std::fs::remove_file(&target).unwrap();
                            if operation.ends_with("read") {
                                std::fs::create_dir(&target).unwrap();
                            }
                        }
                    }));
                    path.clone()
                }
            };
            let result = if operation.starts_with("snapshot") {
                launcher
                    .read_import_snapshot(&project, SESSION, &revision, NOW)
                    .map(|_| ())
            } else {
                launcher
                    .discover_recent(&project, NOW, DAY)
                    .await
                    .map(|_| ())
            };
            if operation == "bucket enumeration" {
                std::fs::set_permissions(&bucket, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
            let error = result.unwrap_err();
            assert!(
                error.message.contains(&affected.display().to_string()),
                "{operation}: {error:?}"
            );
            assert!(error.message.contains("os error"), "{operation}: {error:?}");
        }
    }

    fn rss() -> u64 {
        std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|status| {
                status.lines().find_map(|line| {
                    line.strip_prefix("VmRSS:")?
                        .split_whitespace()
                        .next()?
                        .parse::<u64>()
                        .ok()
                })
            })
            .unwrap_or(0)
    }

    #[tokio::test]
    #[ignore = "U3082b generates three 400 MB variants; run in the test profile separately"]
    async fn u3082b_large_preview_finishes_under_two_seconds() {
        use std::io::Write;
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let header = record("user", &project, "2026-10-01T12:00:00Z") + "\n";
        store(&config, "x", SESSION, &header);
        let path = config
            .join("projects")
            .join(encoded(&project))
            .join(format!("{SESSION}.jsonl"));
        let title = format!(
            "{{\"type\":\"custom-title\",\"customTitle\":\"Chosen title\",\"payload\":\"{}\"}}\n",
            "x".repeat(60_000)
        );
        let activity = record("user", &project, "2026-10-18T12:00:00Z");
        let activity = activity.trim_end_matches('}').to_owned()
            + &format!(",\"payload\":\"{}\"}}\n", "x".repeat(60_000));
        let payload = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(65536 - 15));
        for variant in ["near-end", "middle-title", "middle-activity"] {
            let mut writer = std::io::BufWriter::new(std::fs::File::create(&path).unwrap());
            writer.write_all(header.as_bytes()).unwrap();
            let mut position = header.len();
            let mut blocks = [
                (
                    if variant == "middle-title" {
                        200_000_000
                    } else {
                        399_700_000
                    },
                    title.as_bytes(),
                ),
                (
                    if variant == "middle-activity" {
                        200_000_000
                    } else {
                        399_500_000
                    },
                    activity.as_bytes(),
                ),
                (400_000_000 - 8, b"{\"torn\":".as_slice()),
            ];
            blocks.sort_by_key(|(offset, _)| *offset);
            for (offset, block) in blocks {
                let mut remaining = offset - position;
                while remaining >= payload.len() {
                    writer.write_all(payload.as_bytes()).unwrap();
                    remaining -= payload.len();
                }
                if remaining >= 15 {
                    let partial = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(remaining - 15));
                    writer.write_all(partial.as_bytes()).unwrap();
                } else {
                    writer.write_all(&vec![b'\n'; remaining]).unwrap();
                }
                writer.write_all(block).unwrap();
                position = offset + block.len();
            }
            writer.flush().unwrap();
            drop(writer);
            assert_eq!(std::fs::metadata(&path).unwrap().len(), 400_000_000);
            let bytes = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let observed = bytes.clone();
            let mut launcher = launcher(&config);
            launcher.import_observer =
                Some(std::sync::Arc::new(move |_, phase, count| match phase {
                    "bytes" => {
                        observed.fetch_add(count, Ordering::Relaxed);
                    }
                    "buffer" | "metadata" => assert!(count <= 8 * 1024 * 1024),
                    _ => {}
                }));
            let baseline = rss();
            let peak = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(baseline));
            let sampling = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
            let observed = peak.clone();
            let active = sampling.clone();
            let sampler = std::thread::spawn(move || {
                while active.load(Ordering::Relaxed) {
                    observed.fetch_max(rss(), Ordering::Relaxed);
                    std::thread::sleep(Duration::from_millis(1));
                }
            });
            let start = Instant::now();
            let result = launcher.discover_recent(&project, NOW, 7 * DAY).await;
            let elapsed = start.elapsed();
            sampling.store(false, Ordering::Relaxed);
            sampler.join().unwrap();
            let additional = peak.load(Ordering::Relaxed).saturating_sub(baseline);
            #[cfg(target_os = "linux")]
            assert!(
                baseline > 0 && additional < 64 * 1024,
                "{additional} KiB additional RSS"
            );
            eprintln!("U3082b 400 MB {variant}: peak additional RSS {additional} KiB");
            let found = result.unwrap();
            assert_eq!(found.candidates.len(), 1, "{variant}: {found:?}");
            let candidate = &found.candidates[0];
            assert_eq!(candidate.title, "Chosen title");
            assert_eq!(candidate.cwd, PathBuf::new());
            assert_eq!(candidate.last_activity_ms, NOW - DAY);
            assert!(!candidate.revision.is_empty());
            let bytes = bytes.load(Ordering::Relaxed);
            assert_eq!(bytes, 400_000_000);
            eprintln!("U3082b 400 MB {variant}: {elapsed:?}; {bytes} content bytes read");
            assert!(elapsed < Duration::from_secs(2), "{variant}: {elapsed:?}");
            // Confirmation is outside the preview timer and validates every payload.
            let (confirmed, retained) = launcher
                .read_import_snapshot(&project, SESSION, &candidate.revision, NOW)
                .unwrap();
            assert_eq!(&confirmed, candidate);
            assert_eq!(retained.len(), 399_999_992);
        }
    }

    #[test]
    #[ignore = "U3037b streams a synthetic 4 GB reader; run separately from fast tests"]
    fn u3037b_preview_bounds_are_explicit_at_read_ceiling() {
        struct Repeating {
            record: Vec<u8>,
            offset: usize,
            bytes: u64,
        }
        impl Read for Repeating {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                let len = out.len().min(self.record.len() - self.offset);
                out[..len].copy_from_slice(&self.record[self.offset..self.offset + len]);
                self.offset = (self.offset + len) % self.record.len();
                self.bytes += len as u64;
                Ok(len)
            }
        }
        let root = tempfile::tempdir().unwrap();
        let project = root.path().canonicalize().unwrap();
        let header = record("user", &project, "2026-10-18T12:00:00Z") + "\n";
        let trailer = b"{\"type\":\"custom-title\",\"customTitle\":\"At the ceiling\"}\n";
        let payload = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(65536 - 15));
        let mut repeated = Repeating {
            record: payload.into_bytes(),
            offset: 0,
            bytes: 0,
        };
        let body_size = 4_000_000_000 - header.len() as u64 - trailer.len() as u64;
        let full_records = body_size / 65536 * 65536;
        let input = std::io::Cursor::new(header.as_bytes())
            .chain(repeated.by_ref().take(full_records))
            .chain(std::io::repeat(b'\n').take(body_size - full_records))
            .chain(std::io::Cursor::new(trailer));
        let result = scan_records(
            &launcher(root.path()),
            (&project.join("synthetic.jsonl"), SESSION),
            &project,
            (NOW, DAY),
            &|| Ok(()),
            None,
            input.take(4_000_000_000),
        )
        .unwrap();
        let Scan::Member(candidate) = result else {
            panic!("at-limit source was refused")
        };
        assert_eq!(candidate.title, "At the ceiling");
        assert_eq!(candidate.cwd, PathBuf::new());
        assert_eq!(candidate.last_activity_ms, NOW - DAY);
        assert_eq!(
            repeated.bytes
                + header.len() as u64
                + (body_size - full_records)
                + trailer.len() as u64,
            4_000_000_000
        );
    }

    #[tokio::test]
    async fn u3037b_preview_bounds_are_explicit() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let complete = record("user", &project, "2026-10-18T12:00:00Z") + "\n";
        for (suffix, cause) in [
            (
                format!("{{\"payload\":\"{}\"}}\n", "x".repeat(9 * 1024 * 1024)),
                "record exceeds",
            ),
            (
                format!(
                    "{{\"type\":\"custom-title\",\"customTitle\":\"{}\"}}\n{{\"type\":\"agent-name\",\"agentName\":\"{}\"}}\n",
                    "x".repeat(5 * 1024 * 1024),
                    "y".repeat(5 * 1024 * 1024)
                ),
                "metadata exceeds",
            ),
            ("{\"timestamp\":[]}\n".into(), "malformed record"),
            ("[]\n".into(), "malformed record"),
        ] {
            store(&config, "x", SESSION, &(complete.clone() + &suffix));
            let found = launcher(&config)
                .discover_recent(&project, NOW, DAY)
                .await
                .unwrap();
            assert!(found.candidates.is_empty());
            assert_eq!(found.excluded[0].source, SESSION);
            assert!(found.excluded[0].reason.contains(cause), "{found:?}");
        }
        // Only sparse file facts are needed to prove refusal before any content open.
        store(&config, "x", SESSION, &complete);
        let path = config
            .join("projects")
            .join(encoded(&project))
            .join(format!("{SESSION}.jsonl"));
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(4_000_000_000)
            .unwrap();
        let (at_limit, opened) = observed(&config);
        let found = at_limit.discover_recent(&project, NOW, DAY).await.unwrap();
        // The sparse source's zero-filled record is invalid, but the exact-size
        // source must pass the size gate and reach content inspection.
        assert!(found.excluded[0].reason.contains("record exceeds"));
        assert_eq!(
            opened.lock().unwrap().as_slice(),
            std::slice::from_ref(&path)
        );
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(4_000_000_001)
            .unwrap();
        let (launcher, opened) = observed(&config);
        let found = launcher.discover_recent(&project, NOW, DAY).await.unwrap();
        assert!(found.candidates.is_empty());
        assert_eq!(found.excluded[0].source, SESSION);
        assert!(
            found.excluded[0]
                .reason
                .contains("4,000,000,000 byte preview limit")
        );
        assert!(opened.lock().unwrap().is_empty());
    }
}
