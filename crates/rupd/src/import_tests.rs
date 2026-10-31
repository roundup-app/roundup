use super::*;
use std::path::PathBuf;
use std::time::Duration;

mod fixtures;
use fixtures::import_git;
pub(super) use fixtures::{
    import_daemon, import_fixture, import_rpc, import_source, import_tree_with_overviews,
};

fn import_daemon_with_clock(project: &Path, launcher: agents::claude_code::Launcher) -> Daemon {
    let data = project.join(".roundup");
    Daemon::open_stores(project, &data, |_| {
        let bus = Bus::new();
        let terminals = Arc::new(terminal::Terminals::open(&data, bus.clone()).unwrap());
        agents::Agents::open_in(
            project,
            &data,
            bus,
            terminals,
            launcher,
            agents::worktree::Git::from_env(),
        )
        .unwrap()
        .with_clock(|| 1_793_036_800_000)
    })
    .unwrap()
}

async fn import_resources(daemon: &Daemon, root: &Path) -> Value {
    fn files(dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files(&path, out);
            } else {
                out.push((path.clone(), std::fs::read(path).unwrap()));
            }
        }
    }
    let project = root.join("project");
    let mut retained = Vec::new();
    files(&root.join("config"), &mut retained);
    retained.sort_by(|a, b| a.0.cmp(&b.0));
    let db = rusqlite::Connection::open(project.join(".roundup/project.db")).unwrap();
    let mut statement = db.prepare("SELECT id, conversation_id, conversation_cwd, worktree_path, worktree_owner FROM nodes ORDER BY id").unwrap();
    let persisted: Vec<Value> = statement
        .query_map([], |row| {
            Ok(json!([
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?
            ]))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut rail = import_rpc(daemon, "rail.tree", Value::Null).await["result"].clone();
    for node in rail.as_array_mut().unwrap() {
        // Closed Status timestamps belong to the Daemon lifetime, not retained work.
        node["status"].as_object_mut().unwrap().remove("since");
    }
    json!({
        "rail": rail,
        "terminals": import_rpc(daemon, "terminal.list", Value::Null).await["result"],
        "persisted": persisted,
        "copies": retained,
        "refs": import_git(&project, &["show-ref"]),
        "worktrees": import_git(&project, &["worktree", "list", "--porcelain"]),
    })
}

#[tokio::test]
async fn u3126a_public_retry_after_original_deletion() {
    for mode in 0..3 {
        let (root, launcher, daemon, original, selection) = import_fixture(mode).await;
        let committed = import_rpc(
            &daemon,
            "project.importCommit",
            json!({"selections":[selection.clone()]}),
        )
        .await;
        let outcome = &committed["result"]["outcomes"][0];
        assert!(outcome["error"].is_null(), "{committed}");
        assert!(outcome["workstream"].is_string());
        assert!(outcome["agent"].is_string());
        let mut before = import_resources(&daemon, root.path()).await;
        assert_eq!(before["rail"].as_array().unwrap().len(), 2);
        let child = before["rail"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == outcome["agent"])
            .unwrap();
        assert_eq!(child["can_resume"], true);
        assert!(child["attempt"].is_null());
        assert!(child["terminal_id"].is_null());
        assert_eq!(before["terminals"], json!([]));
        assert_eq!(before["copies"].as_array().unwrap().len(), 2);
        drop(daemon);
        let daemon = import_daemon(&root.path().join("project"), launcher);
        assert_eq!(import_resources(&daemon, root.path()).await, before);
        std::fs::remove_file(&original).unwrap();
        before["copies"]
            .as_array_mut()
            .unwrap()
            .retain(|file| file[0] != json!(original));
        let replayed = import_rpc(
            &daemon,
            "project.importCommit",
            json!({"selections":[selection]}),
        )
        .await;
        assert_eq!(
            replayed["result"], committed["result"],
            "mode {mode}: {replayed}"
        );
        assert_eq!(import_resources(&daemon, root.path()).await, before);
        assert!(!root.path().join("launches").exists());
    }
}

#[tokio::test]
async fn u3126b_first_import_requires_its_original() {
    for mode in 0..3 {
        let (root, _launcher, daemon, original, selection) = import_fixture(mode).await;
        std::fs::remove_file(original).unwrap();
        let before = import_resources(&daemon, root.path()).await;
        assert_eq!(before["rail"], json!([]));
        assert_eq!(before["copies"], json!([]));
        let refused = import_rpc(
            &daemon,
            "project.importCommit",
            json!({"selections":[selection]}),
        )
        .await;
        let outcome = &refused["result"]["outcomes"][0];
        assert!(
            outcome["error"]["message"]
                .as_str()
                .unwrap()
                .contains("changed since preview"),
            "{refused}"
        );
        assert!(
            outcome["error"]["message"]
                .as_str()
                .unwrap()
                .contains("Refresh"),
            "{refused}"
        );
        assert!(outcome["workstream"].is_null());
        assert!(outcome["agent"].is_null());
        assert_eq!(import_resources(&daemon, root.path()).await, before);
        assert!(!root.path().join("launches").exists());
    }
}

#[tokio::test]
async fn u3082a_non_directory_entries_do_not_break_import() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let project = root.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let selected = import_source(&config, &project, 1, &at);
    let unrelated = import_source(&config, &root.path().join("unrelated"), 2, &at);
    std::fs::write(config.join("projects/.DS_Store"), b"finder").unwrap();
    let bucket = selected
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy();
    std::fs::write(
        config.join("projects").join(format!("{bucket}-file")),
        b"file",
    )
    .unwrap();
    let opened = Arc::new(std::sync::Mutex::new(Vec::new()));
    let observed = opened.clone();
    use std::os::unix::fs::PermissionsExt;
    let program = root.path().join("claude");
    let journal = root.path().join("launches");
    std::fs::write(
        &program,
        format!("#!/bin/sh\nprintf launched >> '{}'\n", journal.display()),
    )
    .unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut launcher = agents::claude_code::Launcher::new(
        program.to_string_lossy(),
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    launcher.import_observer = Some(Arc::new(move |path, phase, _| {
        if phase == "open" || phase == "probe" {
            observed.lock().unwrap().push(path.to_path_buf());
        }
    }));
    let daemon = import_daemon(&project, launcher);
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"week"})).await;
    let candidate = &found["result"]["candidates"][0];
    let selection = json!({"source":candidate["source"], "revision":candidate["revision"]});
    opened.lock().unwrap().clear();
    let commit = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[selection.clone()]}),
    )
    .await;
    let outcome = &commit["result"]["outcomes"][0];
    assert!(outcome["agent"].is_string(), "{commit}");
    assert_eq!(outcome["error"], Value::Null);
    assert_eq!(
        opened.lock().unwrap().as_slice(),
        std::slice::from_ref(&selected)
    );
    assert!(!opened.lock().unwrap().contains(&unrelated));
    let replay = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[selection]}),
    )
    .await;
    assert_eq!(replay, commit);
    let retained: Vec<_> = std::fs::read_dir(selected.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path != &selected)
        .collect();
    assert_eq!(retained.len(), 1);
    let mut original: Value = serde_json::from_slice(&std::fs::read(&selected).unwrap()).unwrap();
    let mut copied: Value = serde_json::from_slice(&std::fs::read(&retained[0]).unwrap()).unwrap();
    original.as_object_mut().unwrap().remove("sessionId");
    copied.as_object_mut().unwrap().remove("sessionId");
    assert_eq!(copied, original);
    let tree = import_rpc(&daemon, "rail.tree", Value::Null).await;
    let nodes: Vec<contracts::agent::RailNode> =
        serde_json::from_value(tree["result"].clone()).unwrap();
    let child = nodes
        .iter()
        .find(|node| node.id == outcome["agent"].as_str().unwrap())
        .unwrap();
    assert_eq!(child.kind, contracts::agent::NodeKind::Agent);
    assert_eq!(child.parent.as_deref(), outcome["workstream"].as_str());
    assert!(
        child.can_resume
            && child.terminal_id.is_none()
            && child.attempt.is_none()
            && child.status_revision.is_none()
    );
    assert_eq!(nodes.len(), 2);
    assert!(!journal.exists());
    assert_eq!(
        import_rpc(&daemon, "terminal.list", Value::Null).await["result"],
        json!([])
    );
}

async fn refused_import_revision(change: &str) {
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let path = import_source(&config, root.path(), 1, &at);
    let mut launcher = agents::claude_code::Launcher::new(
        "must-not-launch",
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    let armed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let active = armed.clone();
    let source = path.clone();
    launcher.import_observer = Some(Arc::new(move |_, phase, _| {
        if phase == "record" && active.swap(false, std::sync::atomic::Ordering::SeqCst) {
            std::fs::File::options()
                .append(true)
                .open(&source)
                .unwrap()
                .write_all(b"{}\n")
                .unwrap();
        }
    }));
    let daemon = import_daemon(root.path(), launcher);
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"week"})).await;
    let candidate = &found["result"]["candidates"][0];
    let selection = json!({"source":candidate["source"], "revision":candidate["revision"]});
    let before = import_rpc(&daemon, "rail.tree", Value::Null).await;
    if change == "replace" {
        let metadata = std::fs::metadata(&path).unwrap();
        let text = std::fs::read_to_string(&path)
            .unwrap()
            .replace("Imported work", "Replaced work");
        let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap()).unwrap();
        file.write_all(text.as_bytes()).unwrap();
        file.as_file()
            .set_modified(metadata.modified().unwrap())
            .unwrap();
        file.persist(&path).unwrap();
        use std::os::unix::fs::MetadataExt;
        assert_ne!(metadata.ino(), std::fs::metadata(&path).unwrap().ino());
        assert_eq!(metadata.len(), std::fs::metadata(&path).unwrap().len());
        assert_eq!(
            metadata.modified().unwrap(),
            std::fs::metadata(&path).unwrap().modified().unwrap()
        );
    } else if change == "during" {
        armed.store(true, std::sync::atomic::Ordering::SeqCst);
    } else {
        std::fs::File::options()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"{}\n")
            .unwrap();
    }
    let refused = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[selection]}),
    )
    .await;
    let error = refused["result"]["outcomes"][0]["error"]["message"]
        .as_str()
        .unwrap();
    assert!(
        error.contains("changed since preview") && error.contains("Refresh"),
        "{refused}"
    );
    assert_eq!(import_rpc(&daemon, "rail.tree", Value::Null).await, before);
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        1
    );
    assert!(!root.path().join(".roundup/worktrees").exists());
    // Refresh proves unchanged-source success through the same public seam.
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"week"})).await;
    let candidate = &found["result"]["candidates"][0];
    let success = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[{"source":candidate["source"], "revision":candidate["revision"]}]}),
    )
    .await;
    assert!(
        success["result"]["outcomes"][0]["agent"].is_string(),
        "{success}"
    );
}

#[tokio::test]
async fn u3082c_appended_source_is_refused() {
    refused_import_revision("append").await;
}

#[tokio::test]
async fn u3082c_replaced_source_is_refused() {
    refused_import_revision("replace").await;
}

#[tokio::test]
async fn u3082c_source_changed_during_validation_is_refused() {
    refused_import_revision("during").await;
}

#[tokio::test]
async fn u3037b_commit_reads_only_selected_contents() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let selected = import_source(&config, root.path(), 1, &at);
    let other = import_source(&config, root.path(), 2, &at);
    let opened = Arc::new(std::sync::Mutex::new(Vec::new()));
    let journal = opened.clone();
    let mut launcher = agents::claude_code::Launcher::new(
        "must-not-launch",
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    launcher.import_observer = Some(Arc::new(move |path, phase, _bytes| {
        if phase == "open" {
            journal.lock().unwrap().push(path.to_path_buf());
        }
    }));
    let daemon = import_daemon(root.path(), launcher);
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"week"})).await;
    let candidate = found["result"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["source"] == "00000001-1111-4111-8111-111111111111")
        .unwrap();
    let selection = json!({"source":candidate["source"], "revision":candidate["revision"]});
    // Malformed unrelated history would make a rescan fail, but is never read.
    std::fs::write(&other, vec![b'x'; 1024 * 1024]).unwrap();
    opened.lock().unwrap().clear();
    let committed = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[selection.clone()]}),
    )
    .await;
    assert_eq!(
        committed["result"]["outcomes"][0]["error"],
        Value::Null,
        "{committed}"
    );
    assert!(committed["result"]["outcomes"][0]["agent"].is_string());
    assert_eq!(
        opened.lock().unwrap().as_slice(),
        std::slice::from_ref(&selected)
    );
    let source = std::fs::read(&selected).unwrap();
    let retained: Vec<PathBuf> = std::fs::read_dir(selected.parent().unwrap())
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| p != &selected && p != &other)
        .collect();
    assert_eq!(retained.len(), 1);
    // The existing continuation copier changes identity and cwd, retaining the complete record.
    assert!(
        std::fs::read_to_string(&retained[0])
            .unwrap()
            .contains("timestamp")
    );
    assert_eq!(std::fs::read(&selected).unwrap(), source);
    assert_eq!(
        import_rpc(&daemon, "terminal.list", Value::Null).await["result"],
        json!([])
    );

    // An unimported changed preview is refused without inspecting other contents.
    let changed = import_source(&config, root.path(), 3, &at);
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"day"})).await;
    let candidate = found["result"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["source"] == "00000003-1111-4111-8111-111111111111")
        .unwrap();
    let selection = json!({"source":candidate["source"], "revision":candidate["revision"]});
    use std::io::Write;
    std::fs::OpenOptions::new()
        .append(true)
        .open(&changed)
        .unwrap()
        .write_all(b"{}\n")
        .unwrap();
    opened.lock().unwrap().clear();
    let refused = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[selection.clone()]}),
    )
    .await;
    assert!(
        refused["result"]["outcomes"][0]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("changed since preview")
    );
    assert!(opened.lock().unwrap().is_empty());
    let duplicate = import_source(&config, &root.path().join("sub"), 3, &at);
    std::fs::write(duplicate, std::fs::read(&changed).unwrap()).unwrap();
    opened.lock().unwrap().clear();
    let refused = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[selection]}),
    )
    .await;
    assert_eq!(
        refused["result"]["outcomes"][0]["error"]["code"],
        rpc::code::CONFLICT
    );
    assert!(opened.lock().unwrap().is_empty());
}

#[tokio::test]
#[ignore = "U3037c generates 3.5 GB of real storage; run with --release separately from fast tests"]
async fn u3037c_large_storage_discovery_finishes_before_deadline() {
    large_storage_discovery(false).await;
}

#[tokio::test]
#[ignore = "U3082b generates 900 MB of real storage; run separately from fast tests"]
async fn u3082b_week_and_month_load_large_storage() {
    large_storage_discovery(true).await;
}

async fn large_storage_discovery(owner_storage: bool) {
    use std::io::{BufWriter, Write};
    use std::time::{Instant, SystemTime, UNIX_EPOCH};
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let project = root.path().join("project");
    let unrelated = root.path().join("unrelated-project");
    std::fs::create_dir(&project).unwrap();
    std::fs::create_dir(&unrelated).unwrap();
    let project = project.canonicalize().unwrap();
    let unrelated = unrelated.canonicalize().unwrap();
    let now = time::OffsetDateTime::now_utc();
    let file_clock = SystemTime::now();
    let mut total = 0u64;
    let file_count = if owner_storage { 153 } else { 1260 };
    let total_size = if owner_storage {
        900_000_000
    } else {
        3_500_000_000
    };
    for i in 0..file_count {
        let age = match i {
            0..=4 => 0,
            5..=7 => 3,
            8..=10 => 15,
            _ => 60,
        };
        let cwd = if owner_storage {
            match i {
                0..=10 => project.clone(),
                11 => project.join("old"),
                _ => unrelated.join(format!("bucket-{i}")),
            }
        } else if i < 630 {
            project.clone()
        } else {
            unrelated.clone()
        };
        std::fs::create_dir_all(&cwd).unwrap();
        let stamp = (now - time::Duration::days(age))
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        let path = import_source(&config, &cwd, i, &stamp);
        let header = std::fs::read(&path).unwrap();
        let size = if i == 0 {
            if owner_storage {
                400_000_000
            } else {
                397_000_000
            }
        } else if i <= 10 {
            1_000
        } else if i == file_count - 1 {
            total_size - total
        } else if owner_storage {
            3_000_000
        } else {
            2_484_000
        };
        let mut writer = BufWriter::new(std::fs::File::create(&path).unwrap());
        writer.write_all(&header).unwrap();
        let trailer = if owner_storage && i == 0 {
            b"{\"type\":\"custom-title\",\"customTitle\":\"Near the end\"}\n{\"torn\":".as_slice()
        } else {
            b"".as_slice()
        };
        let mut remaining = size - header.len() as u64 - trailer.len() as u64;
        while remaining > 0 {
            let len = remaining.min(65536) as usize;
            let record = if len >= 15 {
                format!("{{\"payload\":\"{}\"}}\n", "x".repeat(len - 15))
            } else {
                "\n".repeat(len)
            };
            writer.write_all(record.as_bytes()).unwrap();
            remaining -= record.len() as u64;
        }
        writer.write_all(trailer).unwrap();
        writer.flush().unwrap();
        writer
            .get_ref()
            .set_modified(
                file_clock - Duration::from_secs(if i < 630 { age as u64 * 86400 } else { 0 }),
            )
            .unwrap();
        assert_eq!(std::fs::metadata(path).unwrap().len(), size);
        total += size;
    }
    assert_eq!(total, total_size);
    if owner_storage {
        assert_eq!(
            std::fs::read_dir(config.join("projects")).unwrap().count(),
            143
        );
    }
    let bytes = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let observed = bytes.clone();
    let mut launcher = agents::claude_code::Launcher::new(
        "must-not-launch",
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    launcher.import_observer = Some(Arc::new(move |_, phase, count| {
        if phase == "bytes" {
            observed.fetch_add(count, std::sync::atomic::Ordering::Relaxed);
        }
    }));
    let daemon = Arc::new(import_daemon(&project, launcher));
    let socket = root.path().join("observer.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let service = tokio::spawn(serve(listener, daemon));
    let client = rpc::Client::connect(&socket).await.unwrap();
    for (period, expected) in [("day", 5), ("week", 8), ("month", 11)] {
        if owner_storage && period == "day" {
            continue;
        }
        bytes.store(0, std::sync::atomic::Ordering::Relaxed);
        let rss = || {
            std::fs::read_to_string("/proc/self/status")
                .ok()
                .and_then(|status| {
                    status.lines().find_map(|line| {
                        line.strip_prefix("VmRSS:")
                            .and_then(|value| value.split_whitespace().next()?.parse::<u64>().ok())
                    })
                })
                .unwrap_or(0)
        };
        let baseline = rss();
        let peak = Arc::new(std::sync::atomic::AtomicU64::new(baseline));
        let sampling = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let observed = peak.clone();
        let active = sampling.clone();
        let sampler = std::thread::spawn(move || {
            while active.load(std::sync::atomic::Ordering::Relaxed) {
                observed.fetch_max(rss(), std::sync::atomic::Ordering::Relaxed);
                std::thread::sleep(Duration::from_millis(1));
            }
        });
        let started = Instant::now();
        let response = client
            .request("project.importDiscover", json!({"period":period}))
            .await
            .unwrap();
        let elapsed = started.elapsed();
        sampling.store(false, std::sync::atomic::Ordering::Relaxed);
        sampler.join().unwrap();
        #[cfg(target_os = "linux")]
        {
            assert!(
                baseline > 0,
                "the Linux storage observer needs /proc RSS readings"
            );
            assert!(
                peak.load(std::sync::atomic::Ordering::Relaxed)
                    .saturating_sub(baseline)
                    < 64 * 1024,
                "discovery retained a large source in memory"
            );
        }
        eprintln!(
            "{} peak additional RSS: {} KiB (baseline {baseline} KiB)",
            if owner_storage { "U3082b" } else { "U3037c" },
            peak.load(std::sync::atomic::Ordering::Relaxed)
                .saturating_sub(baseline)
        );
        eprintln!(
            "{} {period}: {elapsed:?}; total {total}; content bytes {}; generated at {:?}",
            if owner_storage { "U3082b" } else { "U3037c" },
            bytes.load(std::sync::atomic::Ordering::Relaxed),
            UNIX_EPOCH.elapsed().unwrap()
        );
        assert_eq!(
            response["candidates"].as_array().map(Vec::len),
            Some(expected),
            "{response}"
        );
        if owner_storage {
            assert_eq!(response["candidates"][0]["title"], "Near the end");
            assert_eq!(response["candidates"][0]["cwd"], "");
        }
        let sources: Vec<_> = response["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|candidate| candidate["source"].as_str().unwrap())
            .collect();
        let expected_sources: Vec<_> = (0..expected)
            .map(|i| format!("{i:08}-1111-4111-8111-111111111111"))
            .collect();
        assert_eq!(sources, expected_sources);
        assert!(elapsed < Duration::from_secs(10), "{period}: {elapsed:?}");
    }
    assert_eq!(
        client.request("terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
    service.abort();
}

#[tokio::test]
async fn u3791b_import_preserves_rpc_code_and_uncertainty() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let config = root.path().join("config");
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let path = import_source(&config, &project, 1, &at);
    let mut launcher = agents::claude_code::Launcher::new(
        "unused-claude",
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    let armed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let active = armed.clone();
    launcher.import_observer = Some(Arc::new(move |_, phase, _| {
        if phase == "open" && active.swap(false, std::sync::atomic::Ordering::SeqCst) {
            std::fs::remove_file(&path).unwrap();
        }
    }));
    let daemon = import_daemon(&project, launcher);
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"day"})).await;
    let source = &found["result"]["candidates"][0]["source"];
    let revision = &found["result"]["candidates"][0]["revision"];
    assert!(revision.is_string(), "{found}");
    armed.store(true, std::sync::atomic::Ordering::SeqCst);
    let reply = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[{"source":source,"revision":revision}]}),
    )
    .await;
    let outcome = &reply["result"]["outcomes"][0];
    assert_eq!(&outcome["source"], source);
    assert_eq!(outcome["error"]["code"], rpc::code::INTERNAL);
    assert_eq!(outcome["error"]["outcome"], "unknown");
    assert!(
        outcome["error"]["message"]
            .as_str()
            .unwrap()
            .contains("projects")
    );
    assert!(outcome["workstream"].is_null());
    assert!(outcome["agent"].is_null());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn u4251c_sdk_lookup_continues_the_selected_conversation() {
    for moved_is_live in [false, true] {
        use crate::vendor_list_tests::{executable, package, real_node};
        use notify::Watcher;
        let (root, _launcher, daemon, _, seed) = import_fixture(0).await;
        let seeded = import_rpc(
            &daemon,
            "project.importCommit",
            json!({"selections":[seed]}),
        )
        .await;
        let listing_agent = seeded["result"]["outcomes"][0]["agent"]
            .as_str()
            .unwrap()
            .to_owned();
        let project = root.path().join("project");
        let config = root.path().join("config");
        let (long, [moved, deleted, hashed], originals) =
            fixtures::journey_sources(root.path(), &project, &config);
        let live = if moved_is_live {
            moved.clone()
        } else {
            hashed.clone()
        };
        let effective = if moved_is_live {
            project.clone()
        } else {
            long.clone()
        };
        let journal = root.path().join("continued");
        let (events, mut changes) = tokio::sync::mpsc::unbounded_channel();
        let observed = journal.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
                if event
                    .as_ref()
                    .is_ok_and(|event| event.paths.contains(&observed))
                {
                    let _ = events.send(event);
                }
            })
            .unwrap();
        watcher
            .watch(root.path(), notify::RecursiveMode::NonRecursive)
            .unwrap();
        let cli = root.path().join("fake-claude");
        executable(
            &cli,
            &format!(
                r#"#!/bin/sh
if [ "$1" = agents ]; then printf '%s' '[{{"sessionId":"{live}","pid":424242,"cwd":"{}"}}]'; exit 0; fi
if [ "$1" = plugin ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi
printf 'launch %s\n' "$*" >> '{}'
pwd >> '{}'
while IFS= read -r line; do printf 'prompt %s\n' "$line" >> '{}'; done
"#,
                effective.display(),
                journal.display(),
                journal.display(),
                journal.display()
            ),
        );
        let (package, _) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
        drop(daemon);
        let rup = root.path().join("rup");
        executable(&rup, "#!/bin/sh\nexit 0\n");
        let launcher = agents::claude_code::Launcher::new(
            cli.to_string_lossy(),
            config.join(".claude.json"),
            rup,
            None,
        )
        .with_sidecar(package);
        for (path, bytes) in &originals {
            let source = path.file_stem().unwrap().to_str().unwrap();
            assert_eq!(
                launcher.record_conversation(&project, source).unwrap(),
                *bytes
            );
        }
        let daemon = std::sync::Arc::new(import_daemon(&project, launcher.clone()));
        let ctx = daemon.ctx(Actor {
            kind: ActorKind::Agent,
            id: listing_agent.clone(),
            parent: None,
        });
        let listed = daemon.modules["import"]
            .call(&ctx, "import.list", json!({"period":"month"}))
            .await
            .unwrap();
        let picks = listed["candidates"].as_array().unwrap();
        assert_eq!(picks.len(), 3, "{listed}");
        for source in [&moved, &deleted, &hashed] {
            assert_eq!(picks.iter().filter(|p| p["source"] == *source).count(), 1);
        }
        let params = json!({"agent":listing_agent,"selections":picks.iter().map(|p| json!({"source":p["source"],"revision":p["revision"]})).collect::<Vec<_>>()});
        let mut commit = {
            let daemon = daemon.clone();
            let params = params.clone();
            tokio::spawn(async move { import_rpc(&daemon, "project.importCommit", params).await })
        };
        let ack = async {
            loop {
                let tree = import_rpc(&daemon, "rail.tree", Value::Null).await;
                if let Some(node) = tree["result"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|n| n["attempt"].is_string() && journal.exists())
                {
                    let reply = import_rpc(&daemon,"agent.signal",json!({"id":node["id"],"attempt":node["attempt"],"payload":{"hook_event_name":"SessionStart","source":"resume","session_id":live}})).await;
                    assert!(
                        reply["error"].is_null(),
                        "{reply}; node={node}; tree={tree}"
                    );
                    break;
                }
                if commit.is_finished() {
                    panic!(
                        "commit ended before live acknowledgement: {:?}",
                        (&mut commit).await
                    );
                }
                changes.recv().await.unwrap().unwrap();
            }
        };
        tokio::time::timeout(Duration::from_secs(30), ack)
            .await
            .unwrap();
        let reply = commit.await.unwrap();
        let outcomes = reply["result"]["outcomes"].as_array().unwrap();
        assert_eq!(outcomes.len(), 3, "{reply}");
        for outcome in outcomes {
            assert!(outcome["error"].is_null(), "{reply}");
        }
        for field in ["agent", "workstream"] {
            assert_eq!(
                outcomes
                    .iter()
                    .map(|o| o[field].as_str().unwrap())
                    .collect::<std::collections::HashSet<_>>()
                    .len(),
                3
            );
        }
        for (path, bytes) in &originals {
            assert_eq!(&std::fs::read(path).unwrap(), bytes);
        }
        let imported = outcomes.iter().find(|p| p["source"] == live).unwrap()["agent"]
            .as_str()
            .unwrap();
        let resumable: Vec<Value> = outcomes
            .iter()
            .filter(|p| p["source"] != live)
            .map(|p| p["agent"].clone())
            .collect();
        let tree = fixtures::import_tree_with_overviews(&daemon, &resumable).await;
        for outcome in outcomes.iter().filter(|p| p["source"] != live) {
            let node = tree["result"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == outcome["agent"])
                .unwrap();
            assert_eq!(node["can_resume"], true);
            assert!(node["attempt"].is_null());
            assert!(node["overview"]["id"].is_string());
        }
        let prompt = {
            let daemon = daemon.clone();
            let id = imported.to_owned();
            tokio::spawn(async move {
                import_rpc(
                    &daemon,
                    "agent.prompt",
                    json!({"id":id,"text":"continue the imported work"}),
                )
                .await
            })
        };
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                if std::fs::read_to_string(&journal)
                    .unwrap_or_default()
                    .contains("continue the imported work")
                {
                    break;
                }
                changes.recv().await.unwrap().unwrap();
            }
        })
        .await
        .unwrap();
        let submitted = import_rpc(&daemon,"agent.signal",json!({"id":imported,"attempt":"1","payload":{"hook_event_name":"UserPromptSubmit","prompt":"continue the imported work"}})).await;
        assert!(submitted["error"].is_null(), "{submitted}");
        let prompt = prompt.await.unwrap();
        assert!(prompt["error"].is_null(), "{prompt}");
        let launches = std::fs::read_to_string(&journal).unwrap();
        assert!(launches.contains(&format!("--resume {live}")), "{launches}");
        assert!(
            launches
                .lines()
                .any(|line| line == effective.to_str().unwrap()),
            "{launches}"
        );
        assert_eq!(
            launches
                .lines()
                .filter(|line| line.starts_with("launch "))
                .count(),
            1
        );
        let replay = import_rpc(&daemon, "project.importCommit", params.clone()).await;
        assert_eq!(replay["result"], reply["result"]);
        import_rpc(&daemon, "agent.stop", json!({"id":imported})).await;
        drop(daemon);
        let daemon = import_daemon(&project, launcher);
        let replay = import_rpc(&daemon, "project.importCommit", params).await;
        assert_eq!(replay["result"], reply["result"]);
        assert_eq!(std::fs::read_to_string(&journal).unwrap(), launches);
    }
}
