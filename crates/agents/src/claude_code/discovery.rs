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

// U3082b: the owner measured 50 s for week/600 MB. One metadata projection
// skips payload allocation; only confirmation materializes and validates payloads.
const MAX_PREVIEW: u64 = 4_000_000_000;
const MAX_RECORD: u64 = 8 * 1024 * 1024;
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

// Serde skips every unlisted field with IgnoredAny instead of building payload Values.
// Value preserves the existing treatment of optional fields with other JSON types.
#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Metadata {
    #[serde(rename = "type")]
    kind: Value,
    is_sidechain: Value,
    session_id: Value,
    cwd: Value,
    timestamp: Value,
    custom_title: Value,
    agent_name: Value,
    ai_title: Value,
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
    #[cfg(any(test, feature = "test-support"))]
    if let Some(observer) = &launcher.import_observer {
        observer(path, "open", 0);
    }
    let mut file = std::fs::File::open(path).map_err(|err| io_error(path, err))?;
    let metadata = file.metadata().map_err(|err| io_error(path, err))?;
    let revision = source_revision(&metadata);
    let result = scan_reader(
        launcher,
        path,
        (stem, &revision),
        project,
        window,
        check,
        (&mut file, metadata.len(), retained),
    )?;
    check()?;
    if source_revision(&file.metadata().map_err(|err| io_error(path, err))?) != revision
        || source_revision(&path.metadata().map_err(|err| io_error(path, err))?) != revision
    {
        return Err(RpcError::conflict(format!(
            "source changed since preview: {}; Refresh to try again",
            path.display()
        )));
    }
    Ok(result)
}

// The reader is also the synthetic filesystem seam for the 4 GB policy ceiling.
fn scan_reader(
    launcher: &Launcher,
    path: &Path,
    identity: (&str, &str),
    project: &Path,
    window: (i64, i64),
    check: &impl Fn() -> Result<(), RpcError>,
    input: (impl Read, u64, Option<&mut Vec<u8>>),
) -> Result<Scan, RpcError> {
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = launcher;
    let (stem, revision) = identity;
    let (now_ms, period_ms) = window;
    let (input, len, mut retained) = input;
    let preview = retained.is_none();
    if preview && len > MAX_PREVIEW {
        return Ok(Scan::Excluded(format!(
            "{}: source exceeds 4,000,000,000 byte metadata read limit",
            path.display()
        )));
    }
    // Capture the length: growth never extends this pass or allocates a source-sized buffer.
    let mut reader = BufReader::with_capacity(64 * 1024, input.take(len));
    let mut line = Vec::with_capacity(MAX_RECORD as usize);
    let mut consumed = 0u64;
    let mut complete = false;
    let mut cwds: Vec<PathBuf> = Vec::new();
    let mut latest: Option<i64> = None;
    let (mut custom, mut agent, mut ai) = (None, None, None);
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
        consumed += size as u64;
        if size as u64 == MAX_RECORD && line.last() != Some(&b'\n') {
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
        if line.iter().find(|byte| !byte.is_ascii_whitespace()) != Some(&b'{') {
            return Ok(Scan::Excluded("malformed record".into()));
        }
        let parsed = if preview {
            serde_json::from_slice::<Metadata>(&line)
        } else {
            // Full JSON/UTF-8 validation only for the selected source; retention uses
            // these same bytes, never a second read of the mutable source.
            serde_json::from_slice::<Value>(&line).and_then(serde_json::from_value::<Metadata>)
        };
        let Ok(record) = parsed else {
            return Ok(Scan::Excluded(
                "malformed record or unsupported metadata layout".into(),
            ));
        };
        if record.is_sidechain == true {
            return Ok(Scan::Excluded("subagent record".into()));
        }
        if record.session_id.as_str().is_some_and(|id| id != stem) {
            return Ok(Scan::Excluded("identity does not match source".into()));
        }
        if let Some(cwd) = record.cwd.as_str().filter(|cwd| !cwd.is_empty()) {
            let cwd = PathBuf::from(cwd);
            if !cwds.contains(&cwd) {
                if cwds.len() >= 64 {
                    return Ok(Scan::Excluded("too many recorded directories".into()));
                }
                cwds.push(cwd);
            }
        }
        if let Some(ms) = record.timestamp.as_str().and_then(millis)
            && ms <= now_ms
        {
            latest = latest.max(Some(ms));
        }
        let name = |value: &Value| {
            value
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
        };
        match record.kind.as_str() {
            Some("custom-title") => custom = name(&record.custom_title).or(custom),
            Some("agent-name") => agent = name(&record.agent_name).or(agent),
            Some("ai-title") => ai = name(&record.ai_title).or(ai),
            _ => {}
        }
        let metadata_size = cwds.iter().map(|cwd| cwd.as_os_str().len()).sum::<usize>()
            + [&custom, &agent, &ai]
                .into_iter()
                .flatten()
                .map(String::len)
                .sum::<usize>();
        if metadata_size > MAX_RECORD as usize {
            return Ok(Scan::Excluded(
                "retained metadata exceeds 8 MiB limit".into(),
            ));
        }
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &launcher.import_observer {
            observer(path, "record-buffer", line.len() as u64);
            observer(path, "metadata-buffer", metadata_size as u64);
        }
    }
    check()?;
    if consumed != len {
        return Ok(Scan::Excluded(format!(
            "{}: incomplete metadata coverage; source ended before captured size",
            path.display()
        )));
    }
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
        revision: revision.to_owned(),
    }))
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
    async fn u3037b_middle_metadata_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
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
            let mut previous_len = None;
            for variant in [false, true] {
                let middle = if title {
                    format!(
                        "{{\"type\":\"custom-title\",\"customTitle\":\"{}\"}}\n",
                        if variant {
                            "User chosen title"
                        } else {
                            "Another good name"
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
                if let Some(len) = previous_len {
                    assert_eq!(text.len(), len);
                }
                previous_len = Some(text.len());
                store(&config, "x", SESSION, &text);
                let path = config
                    .join("projects")
                    .join(encoded(&project))
                    .join(format!("{SESSION}.jsonl"));
                std::fs::File::open(path)
                    .unwrap()
                    .set_modified(UNIX_EPOCH + Duration::from_millis(NOW as u64))
                    .unwrap();
                let found = launcher(&config)
                    .discover_recent(&project, NOW, 7 * DAY)
                    .await
                    .unwrap();
                assert!(found.excluded.is_empty(), "{found:?}");
                if title || variant {
                    assert_eq!(found.candidates.len(), 1, "{found:?}");
                    assert_eq!(found.candidates[0].last_activity_ms, NOW - DAY);
                    if title {
                        assert_eq!(
                            found.candidates[0].title,
                            if variant {
                                "User chosen title"
                            } else {
                                "Another good name"
                            }
                        );
                    }
                } else {
                    assert!(found.candidates.is_empty(), "{found:?}");
                }
            }
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
        for middle in [false, true] {
            for broken in [
                b"{broken}\n".as_slice(),
                b"{\"payload\":\"\xff\"}\n".as_slice(),
            ] {
                let mut bytes = valid.as_bytes().to_vec();
                if middle {
                    bytes.extend_from_slice(&b"{}\n".repeat(140_000));
                }
                bytes.extend_from_slice(broken);
                if middle {
                    bytes.extend_from_slice(&b"{}\n".repeat(140_000));
                }
                std::fs::write(&path, bytes).unwrap();
                let found = launcher.discover_recent(&project, NOW, DAY).await.unwrap();
                if let Some(candidate) = found.candidates.first() {
                    let refused = launcher
                        .read_import_snapshot(&project, SESSION, &candidate.revision, NOW)
                        .unwrap_err();
                    assert!(refused.message.contains("malformed record"), "{refused:?}");
                } else {
                    assert!(found.excluded[0].reason.contains("malformed record"));
                }
            }
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

    #[tokio::test]
    async fn u3037b_source_changed_during_metadata_pass_is_refused() {
        use std::io::Write;
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
        let once = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut launcher = launcher(&config);
        launcher.import_observer = Some(std::sync::Arc::new(move |path, phase, _| {
            if phase == "record" && !once.swap(true, Ordering::SeqCst) {
                std::fs::File::options()
                    .append(true)
                    .open(path)
                    .unwrap()
                    .write_all(b"{}\n")
                    .unwrap();
            }
        }));
        let error = launcher
            .discover_recent(&project, NOW, DAY)
            .await
            .unwrap_err();
        assert!(
            error.message.contains("changed since preview") && error.message.contains("Refresh"),
            "{error:?}"
        );
    }

    #[test]
    fn u3037b_metadata_and_coverage_bounds_are_explicit() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().canonicalize().unwrap();
        let launcher = launcher(root.path());
        let header = record("user", &project, "2026-10-18T12:00:00Z") + "\n";
        let oversized_metadata = header.clone()
            + &format!(
                "{{\"type\":\"custom-title\",\"customTitle\":\"{}\"}}\n{{\"type\":\"agent-name\",\"agentName\":\"{}\"}}\n",
                "x".repeat(5 * 1024 * 1024),
                "y".repeat(5 * 1024 * 1024)
            );
        for (text, declared, cause) in [
            (
                header.as_bytes(),
                header.len() as u64 + 1,
                "incomplete metadata coverage",
            ),
            (
                oversized_metadata.as_bytes(),
                oversized_metadata.len() as u64,
                "retained metadata exceeds",
            ),
        ] {
            let found = scan_reader(
                &launcher,
                Path::new("source.jsonl"),
                (SESSION, "revision"),
                &project,
                (NOW, DAY),
                &|| Ok(()),
                (text, declared, None),
            )
            .unwrap();
            assert!(matches!(found, Scan::Excluded(ref reason) if reason.contains(cause)));
        }
    }

    #[test]
    #[ignore = "U3037b synthetic 4 GB read-ceiling observer; run separately from fast tests"]
    fn u3037b_preview_bounds_are_explicit() {
        struct Repeated {
            header: std::io::Cursor<Vec<u8>>,
            record: Vec<u8>,
            offset: usize,
            bytes: std::sync::Arc<std::sync::atomic::AtomicU64>,
        }
        impl Read for Repeated {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let prefix = self.header.read(buffer)?;
                if prefix != 0 {
                    self.bytes.fetch_add(prefix as u64, Ordering::Relaxed);
                    return Ok(prefix);
                }
                let n = buffer.len().min(self.record.len() - self.offset);
                buffer[..n].copy_from_slice(&self.record[self.offset..self.offset + n]);
                self.offset = (self.offset + n) % self.record.len();
                self.bytes.fetch_add(n as u64, Ordering::Relaxed);
                Ok(n)
            }
        }
        let root = tempfile::tempdir().unwrap();
        let project = root.path().canonicalize().unwrap();
        let launcher = launcher(root.path());
        let header = record("user", &project, "2026-10-18T12:00:00Z")
            + "\n{\"type\":\"custom-title\",\"customTitle\":\"Exact ceiling\"}\n";
        let bytes = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
        for len in [4_000_000_000, 4_000_000_001] {
            bytes.store(0, Ordering::Relaxed);
            // Repeat a bounded record forever: Take must stop at the captured length.
            // The final partial record is the permitted torn tail.
            let payload = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(65536 - 15));
            let input = Repeated {
                header: std::io::Cursor::new(header.as_bytes().to_vec()),
                record: payload.into_bytes(),
                offset: 0,
                bytes: bytes.clone(),
            };
            let result = scan_reader(
                &launcher,
                Path::new("source.jsonl"),
                (SESSION, "revision"),
                &project,
                (NOW, DAY),
                &|| Ok(()),
                (input, len, None),
            )
            .unwrap();
            if len == 4_000_000_000 {
                let Scan::Member(candidate) = result else {
                    panic!("at-limit source was excluded");
                };
                assert_eq!(candidate.title, "Exact ceiling");
                assert_eq!(candidate.last_activity_ms, NOW - DAY);
                assert_eq!(candidate.cwd, PathBuf::new());
                assert_eq!(bytes.load(Ordering::Relaxed), len);
            } else {
                assert!(
                    matches!(result, Scan::Excluded(reason) if reason.contains("source.jsonl") && reason.contains("read limit"))
                );
                assert_eq!(bytes.load(Ordering::Relaxed), 0);
            }
        }
    }

    fn rss_kib() -> u64 {
        std::fs::read_to_string("/proc/self/status")
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    line.strip_prefix("VmRSS:")?
                        .split_whitespace()
                        .next()?
                        .parse()
                        .ok()
                })
            })
            .unwrap_or(0)
    }

    #[tokio::test]
    #[ignore = "U3082b generates 400 MB of real storage; run in the test profile separately"]
    async fn u3082b_large_preview_finishes_under_two_seconds() {
        use std::io::Write;
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        for variant in 0..3 {
            let header = record(
                "user",
                &project,
                if variant == 2 {
                    "2026-10-01T12:00:00Z"
                } else {
                    "2026-10-18T12:00:00Z"
                },
            ) + "\n";
            store(&config, "x", SESSION, &header);
            let path = config
                .join("projects")
                .join(encoded(&project))
                .join(format!("{SESSION}.jsonl"));
            let title = format!(
                "{{\"type\":\"custom-title\",\"customTitle\":\"Near the end\",\"payload\":\"{}\"}}\n",
                "x".repeat(60_000)
            );
            let activity = record(
                "user",
                &project,
                if variant == 2 {
                    "2026-10-18T12:00:00Z"
                } else {
                    "2026-10-01T12:00:00Z"
                },
            ) + "\n";
            let end = b"{\"torn\":";
            let payload = format!("{{\"payload\":\"{}\"}}\n", "x".repeat(65536 - 15));
            let mut writer =
                std::io::BufWriter::new(std::fs::File::options().append(true).open(&path).unwrap());
            let title_start = if variant == 1 {
                200_000_000
            } else {
                400_000_000 - 256 * 1024 - title.len() / 2
            };
            let activity_start = if variant == 2 {
                200_000_000
            } else {
                399_999_000
            };
            let mut events = [
                (title_start, title.as_bytes()),
                (activity_start, activity.as_bytes()),
                (400_000_000 - end.len(), end.as_slice()),
            ];
            events.sort_by_key(|(offset, _)| *offset);
            let mut written = header.len();
            for (offset, text) in events {
                let mut remaining = offset - written;
                while remaining >= payload.len() {
                    writer.write_all(payload.as_bytes()).unwrap();
                    remaining -= payload.len();
                }
                writer.write_all(&vec![b'\n'; remaining]).unwrap();
                writer.write_all(text).unwrap();
                written = offset + text.len();
            }
            writer.flush().unwrap();
            assert_eq!(std::fs::metadata(&path).unwrap().len(), 400_000_000);
            let bytes = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
            let observed = bytes.clone();
            let baseline = rss_kib();
            let peak = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(baseline));
            let observed_peak = peak.clone();
            let mut launcher = launcher(&config);
            launcher.import_observer =
                Some(std::sync::Arc::new(move |_, phase, count| match phase {
                    "bytes" => {
                        observed.fetch_add(count, Ordering::Relaxed);
                    }
                    "record-buffer" | "metadata-buffer" => {
                        assert!(count <= 8 * 1024 * 1024, "{phase}: {count}");
                        if observed.load(Ordering::Relaxed) % (1024 * 1024) < 65536 {
                            observed_peak.fetch_max(rss_kib(), Ordering::Relaxed);
                        }
                    }
                    _ => {}
                }));
            let start = Instant::now();
            let found = launcher
                .discover_recent(&project, NOW, 7 * DAY)
                .await
                .unwrap();
            let elapsed = start.elapsed();
            assert_eq!(found.candidates.len(), 1, "{found:?}");
            let candidate = &found.candidates[0];
            assert_eq!(candidate.title, "Near the end");
            assert_eq!(candidate.cwd, PathBuf::new());
            assert_eq!(candidate.last_activity_ms, NOW - DAY);
            assert!(!candidate.revision.is_empty());
            let bytes = bytes.load(Ordering::Relaxed);
            assert_eq!(bytes, 400_000_000);
            eprintln!(
                "U3082b 400 MB variant {variant}: {elapsed:?}; {bytes} content bytes read; peak additional RSS {} KiB",
                peak.load(Ordering::Relaxed).saturating_sub(baseline)
            );
            assert!(elapsed < Duration::from_secs(2), "{elapsed:?}");
            // Confirmation is outside the preview measurements: this revision must
            // retain the complete source even though preview skipped its payload records.
            let (confirmed, retained) = launcher
                .read_import_snapshot(&project, SESSION, &candidate.revision, NOW)
                .unwrap();
            assert_eq!(&confirmed, candidate);
            assert_eq!(retained.len(), 400_000_000 - b"{\"torn\":".len());
        }
    }

    #[tokio::test]
    async fn u3037b_oversized_records_are_explicitly_refused() {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = root.path().join("config");
        let complete = record("user", &project, "2026-10-18T12:00:00Z") + "\n";
        for prefix in [String::new(), "{}\n".repeat(140_000)] {
            store(
                &config,
                "x",
                SESSION,
                &(complete.clone()
                    + &prefix
                    + &format!("{{\"payload\":\"{}\"}}\n", "x".repeat(9 * 1024 * 1024))),
            );
            let found = launcher(&config)
                .discover_recent(&project, NOW, DAY)
                .await
                .unwrap();
            assert!(found.candidates.is_empty());
            assert!(found.excluded[0].reason.contains("record exceeds"));
        }
    }
}
