//! U2875a: recent top-level conversations of one Project. Vendor storage stays here (P4).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rpc::RpcError;
use serde_json::Value;
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::{Launcher, is_uuid};

/// One conversation the user may import. `revision` is the hash of its complete records.
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
    pub reason: &'static str,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportDiscovery {
    /// Newest first, equal times by source identity.
    pub candidates: Vec<ImportCandidate>,
    pub excluded: Vec<ImportExclusion>,
}

enum Scan {
    Member(ImportCandidate),
    OtherProject,
    Out,
    Excluded(&'static str),
}

impl Launcher {
    /// Read the effective Claude storage for conversations of `project` active in
    /// `[now_ms - period_ms, now_ms]`. A missing or unreadable storage is an error, never empty.
    pub fn discover_recent(
        &self,
        project: &Path,
        now_ms: i64,
        period_ms: i64,
    ) -> Result<ImportDiscovery, RpcError> {
        let project = project.canonicalize().map_err(RpcError::internal)?;
        let root = self.conversation_dir.join("projects");
        let buckets = std::fs::read_dir(&root).map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                RpcError::not_found("Claude Code has no saved conversations here")
            } else {
                RpcError::internal(format!("cannot read Claude Code storage: {err}"))
            }
        })?;
        let mut found: Vec<(String, Scan)> = Vec::new();
        for bucket in buckets {
            let bucket = bucket.map_err(RpcError::internal)?.path();
            let Ok(files) = std::fs::read_dir(&bucket) else {
                continue;
            };
            for file in files.flatten() {
                let path = file.path();
                if path.extension().is_none_or(|ext| ext != "jsonl") || !path.is_file() {
                    continue;
                }
                let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                found.push((
                    stem.to_string(),
                    scan(&path, &stem, &project, now_ms, period_ms),
                ));
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
                    reason: "duplicate source identity",
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
    /// The complete records of one selected conversation, only while they still hash to the
    /// `revision` the user previewed (U2875c). A changed or vanished source is a conflict.
    pub fn read_import_snapshot(
        &self,
        project: &Path,
        source: &str,
        revision: &str,
        now_ms: i64,
    ) -> Result<(ImportCandidate, Vec<u8>), RpcError> {
        let changed = || RpcError::conflict(format!("source changed since preview: {source}"));
        let found = self.discover_recent(project, now_ms, i64::MAX)?;
        let candidate = found
            .candidates
            .into_iter()
            .find(|c| c.source == source && c.revision == revision)
            .ok_or_else(changed)?;
        let file = format!("{source}.jsonl");
        let buckets = std::fs::read_dir(self.conversation_dir.join("projects"))
            .map_err(RpcError::internal)?;
        for bucket in buckets.flatten() {
            let Ok(mut bytes) = std::fs::read(bucket.path().join(&file)) else {
                continue;
            };
            bytes.truncate(
                bytes
                    .iter()
                    .rposition(|b| *b == b'\n')
                    .map_or(0, |at| at + 1),
            );
            return if hex(&Sha256::digest(&bytes)) == revision {
                Ok((candidate, bytes))
            } else {
                Err(changed())
            };
        }
        Err(changed())
    }
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn scan(path: &Path, stem: &str, project: &Path, now_ms: i64, period_ms: i64) -> Scan {
    if !is_uuid(stem) {
        return Scan::Excluded("unsupported source name");
    }
    let Ok(mut bytes) = std::fs::read(path) else {
        return Scan::Excluded("unreadable");
    };
    // An incomplete trailing record is ignored.
    bytes.truncate(
        bytes
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |at| at + 1),
    );
    let mut cwds: Vec<PathBuf> = Vec::new();
    let mut latest: Option<i64> = None;
    let (mut custom, mut agent, mut ai) = (None, None, None);
    for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
        let Ok(record) = serde_json::from_slice::<Value>(line) else {
            return Scan::Excluded("malformed record");
        };
        if !record.is_object() {
            return Scan::Excluded("malformed record");
        }
        if record["isSidechain"] == true {
            return Scan::Excluded("subagent record");
        }
        if let Some(id) = record["sessionId"].as_str()
            && id != stem
        {
            return Scan::Excluded("identity does not match source");
        }
        if let Some(cwd) = record["cwd"].as_str().filter(|cwd| !cwd.is_empty()) {
            let cwd = PathBuf::from(cwd);
            if !cwds.contains(&cwd) {
                cwds.push(cwd);
            }
        }
        if let Some(ms) = record["timestamp"].as_str().and_then(millis)
            && ms <= now_ms
        {
            latest = latest.max(Some(ms));
        }
        let name = |key: &str| {
            record[key]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
        };
        match record["type"].as_str() {
            Some("custom-title") => custom = name("customTitle").or(custom),
            Some("agent-name") => agent = name("agentName").or(agent),
            Some("ai-title") => ai = name("aiTitle").or(ai),
            _ => {}
        }
    }
    if bytes.is_empty() {
        return Scan::Excluded("no complete records");
    }
    let mut inside = Vec::new();
    let mut outside = false;
    for cwd in &cwds {
        match cwd.canonicalize() {
            Ok(real) if real.starts_with(project) => inside.push(real),
            Ok(_) => outside = true,
            Err(_) if cwd.starts_with(project) => return Scan::Excluded("missing directory"),
            Err(_) => outside = true,
        }
    }
    match (inside.as_slice(), outside) {
        ([], true) => return Scan::OtherProject,
        ([], false) => return Scan::Excluded("no recorded working directory"),
        ([_], false) => {}
        _ => return Scan::Excluded("ambiguous Project membership"),
    }
    let cwd = &inside[0];
    let relative = cwd.strip_prefix(project).unwrap_or(Path::new(""));
    if relative
        .components()
        .next()
        .is_some_and(|c| c.as_os_str() == ".roundup")
        || in_linked_worktree(cwd, project)
    {
        return Scan::Excluded("inside a Worktree");
    }
    let Some(latest) = latest else {
        return Scan::Excluded("activity unknown or in the future");
    };
    if latest < now_ms.saturating_sub(period_ms) {
        return Scan::Out;
    }
    Scan::Member(ImportCandidate {
        source: stem.to_owned(),
        title: custom
            .or(agent)
            .or(ai)
            .unwrap_or_else(|| "Untitled conversation".into()),
        cwd: relative.to_path_buf(),
        last_activity_ms: latest,
        revision: hex(&Sha256::digest(&bytes)),
    })
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
        let dir = config.join("projects").join(bucket);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{id}.jsonl")), text).unwrap();
    }

    fn launcher(config: &Path) -> Launcher {
        Launcher::new("claude", config.join(".claude.json"), "rup".into(), None)
    }

    /// 2026-10-19T12:00:00Z
    const NOW: i64 = 1_792_411_200_000;

    #[test]
    fn u2875a_activity_is_not_file_mtime() {
        let root = tempfile::tempdir().unwrap();
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
            .unwrap();
        assert!(found.candidates.is_empty());
        let wide = launcher(&config)
            .discover_recent(&project, NOW, 30 * DAY)
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
            .unwrap();
        assert!(found.candidates.is_empty());
        assert!(
            found
                .excluded
                .iter()
                .any(|e| e.source == fourth && e.reason == "missing directory")
        );
        assert!(
            found
                .excluded
                .iter()
                .all(|e| e.source != other && e.source != third)
        );
    }

    #[test]
    fn u2875a_sources_are_ordered_and_not_duplicated() {
        let root = tempfile::tempdir().unwrap();
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
            .unwrap();
        let ids: Vec<_> = found.candidates.iter().map(|c| c.source.as_str()).collect();
        assert_eq!(ids, [a, b]);
        let r = record("user", &project, "2026-10-18T00:00:00Z").replace(SESSION, a);
        store(&config, "y", a, &format!("{r}\n"));
        let found = launcher(&config)
            .discover_recent(&project, NOW, 7 * DAY)
            .unwrap();
        assert_eq!(found.candidates.len(), 1);
        assert_eq!(found.excluded[0].reason, "duplicate source identity");
        assert!(
            launcher(&root.path().join("none"))
                .discover_recent(&project, NOW, DAY)
                .is_err()
        );
    }
}
