use super::preview_tests::*;
use super::*;

#[tokio::test]
async fn u3065_root_project_keeps_root_and_descendant_conversations() {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    let nested = root.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let config = root.path().join("config");
    let project = Path::new("/");
    let mut expected = Vec::new();
    for (index, cwd) in [project, root.path(), nested.as_path()]
        .into_iter()
        .enumerate()
    {
        let id = format!("{index:08}-1111-4111-8111-111111111111");
        let complete = record("user", cwd, "2026-10-18T12:00:00Z").replace(SESSION, &id) + "\n";
        store(&config, "x", &id, &(complete.clone() + "{\"torn\":"));
        expected.push((id, cwd.strip_prefix(project).unwrap().to_path_buf()));
    }
    let found = launcher(&config)
        .discover_recent(project, NOW, 7 * DAY)
        .await
        .unwrap();
    assert!(found.excluded.is_empty());
    let actual: Vec<_> = found
        .candidates
        .into_iter()
        .map(|candidate| (candidate.source, candidate.cwd))
        .collect();
    assert_eq!(actual, expected);
}

#[tokio::test]
async fn u3065_root_project_keeps_cwd_exclusions() {
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    let linked = root.path().join("linked");
    std::fs::create_dir(&linked).unwrap();
    std::fs::write(linked.join(".git"), "gitdir: /unused/worktrees/linked\n").unwrap();
    let missing = root.path().join("missing");
    let config = root.path().join("config");
    let mut expected = Vec::new();
    for (index, (cwd, reason)) in [
        (&linked, "inside a Worktree"),
        (&missing, "missing directory"),
    ]
    .into_iter()
    .enumerate()
    {
        let id = format!("{index:08}-1111-4111-8111-111111111111");
        let text = record("user", cwd, "2026-10-18T12:00:00Z").replace(SESSION, &id) + "\n";
        store(&config, "x", &id, &text);
        expected.push((id, reason));
    }
    let found = launcher(&config)
        .discover_recent(Path::new("/"), NOW, 7 * DAY)
        .await
        .unwrap();
    assert!(found.candidates.is_empty());
    assert_eq!(found.excluded.len(), expected.len());
    for (got, (source, reason)) in found.excluded.iter().zip(expected) {
        assert_eq!(got.source, source);
        assert!(got.reason.starts_with(reason), "{}", got.reason);
    }
}

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
                std::fs::set_permissions(&bucket, std::fs::Permissions::from_mode(0o000)).unwrap();
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

#[test]
fn u3037b_incomplete_metadata_coverage_is_explicit() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().canonicalize().unwrap();
    let header = record("user", &project, "2026-10-18T12:00:00Z") + "\n";
    let result = scan_records(
        &launcher(root.path()),
        (Path::new("source.jsonl"), SESSION),
        &project,
        (NOW, DAY),
        &|| Ok(()),
        None,
        (header.as_bytes(), header.len() as u64 + 1),
    )
    .unwrap();
    assert!(
        matches!(result, Scan::Excluded(reason) if reason.contains("source.jsonl") && reason.contains("incomplete metadata coverage"))
    );
    // The same reader seam enforces the ceiling before invoking Read.
    let input = std::io::empty();
    let result = scan_records(
        &launcher(root.path()),
        (Path::new("source.jsonl"), SESSION),
        &project,
        (NOW, DAY),
        &|| Ok(()),
        None,
        (input, 4_000_000_001),
    )
    .unwrap();
    assert!(
        matches!(result, Scan::Excluded(reason) if reason.contains("source.jsonl") && reason.contains("preview limit"))
    );
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
        (input, 4_000_000_000),
    )
    .unwrap();
    let Scan::Member(candidate) = result else {
        panic!("at-limit source was refused")
    };
    assert_eq!(candidate.title, "At the ceiling");
    assert_eq!(candidate.cwd, PathBuf::new());
    assert_eq!(candidate.last_activity_ms, NOW - DAY);
    assert_eq!(
        repeated.bytes + header.len() as u64 + (body_size - full_records) + trailer.len() as u64,
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
        ("{broken}\n".into(), "malformed record"),
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
