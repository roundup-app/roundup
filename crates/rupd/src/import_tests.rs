use super::*;
use crate::tests::ask;

use std::path::PathBuf;
use std::time::Duration;

fn import_daemon(project: &Path, launcher: agents::claude_code::Launcher) -> Daemon {
    let data = project.join(".roundup");
    Daemon::open_stores(project, &data, None, |_| {
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
    })
    .unwrap()
}

fn import_source(config: &Path, cwd: &Path, number: usize, timestamp: &str) -> PathBuf {
    let cwd = cwd.canonicalize().unwrap_or_else(|_| cwd.to_path_buf());
    let bucket: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dir = config.join("projects").join(bucket);
    std::fs::create_dir_all(&dir).unwrap();
    let id = format!("{number:08}-1111-4111-8111-111111111111");
    let file = dir.join(format!("{id}.jsonl"));
    let record = json!({"type":"user", "cwd":cwd, "sessionId":id, "timestamp":timestamp});
    std::fs::write(&file, format!("{record}\n")).unwrap();
    file
}

async fn import_rpc(daemon: &Daemon, method: &str, params: Value) -> Value {
    ask(
        daemon,
        &json!({"jsonrpc":"2.0", "id":1, "method":method,"params":params}).to_string(),
    )
    .await
}

fn import_git(project: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(project)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).unwrap()
}

async fn import_fixture(
    mode: u8,
) -> (
    tempfile::TempDir,
    agents::claude_code::Launcher,
    Daemon,
    PathBuf,
    Value,
) {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    std::fs::create_dir(&project).unwrap();
    import_git(&project, &["init", "-b", "main"]);
    import_git(
        &project,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "base",
        ],
    );
    let config = root.path().join("config");
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let original = import_source(&config, &project, 1, &at);
    let bin = root.path().join("fake-claude");
    std::fs::write(
        &bin,
        format!(
            "#!/bin/sh\necho launched >> '{}'\nexit 1\n",
            root.path().join("launches").display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    let launcher = agents::claude_code::Launcher::new(
        bin.to_string_lossy(),
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    let daemon = import_daemon(&project, launcher.clone());
    let setting = import_rpc(&daemon, "project.setWorktrees", json!({"on":mode != 0})).await;
    assert!(setting.get("error").is_none(), "{setting}");
    if mode == 2 {
        let prepared = project.join("prepared");
        import_git(
            &project,
            &["worktree", "add", "--detach", prepared.to_str().unwrap()],
        );
        let setting = import_rpc(
            &daemon,
            "project.setPrepared",
            json!({"enrolled":[prepared], "readiness":"true", "timeout_ms":1000}),
        )
        .await;
        assert!(setting.get("error").is_none(), "{setting}");
    }
    let found = import_rpc(&daemon, "project.importDiscover", json!({"period":"week"})).await;
    let candidates = found["result"]["candidates"].as_array().unwrap();
    assert_eq!(candidates.len(), 1, "{found}");
    let selection = json!({"source":candidates[0]["source"], "revision":candidates[0]["revision"]});
    (root, launcher, daemon, original, selection)
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
            outcome["error"]
                .as_str()
                .unwrap()
                .contains("changed since preview"),
            "{refused}"
        );
        assert!(
            outcome["error"].as_str().unwrap().contains("Refresh"),
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
        &[selected.clone(), selected.clone()]
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
            .replace("\"user\"", "\"edit\"");
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
    let error = refused["result"]["outcomes"][0]["error"].as_str().unwrap();
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
        refused["result"]["outcomes"][0]["error"]
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
    assert!(refused["result"]["outcomes"][0]["error"].is_string());
    assert!(opened.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn u3037d_retries_bound_discovery_work() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    import_source(&config, root.path(), 1, "2026-10-20T12:00:00Z");
    let opens = Arc::new(AtomicUsize::new(0));
    let workers = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let active_workers = workers.clone();
    let peak_workers = peak.clone();
    let (entered, waiting) = tokio::sync::oneshot::channel();
    let entered = std::sync::Mutex::new(Some(entered));
    let (release, gate) = std::sync::mpsc::channel();
    let gate = std::sync::Mutex::new(gate);
    let observed = opens.clone();
    let requests = AtomicUsize::new(0);
    let (requested, registered) = tokio::sync::oneshot::channel();
    let requested = std::sync::Mutex::new(Some(requested));
    let mut launcher = agents::claude_code::Launcher::new(
        "must-not-launch",
        config.join(".claude.json"),
        "rup".into(),
        None,
    );
    launcher.import_observer = Some(Arc::new(move |_, phase, _bytes| {
        if phase == "request" {
            if requests.fetch_add(1, Ordering::SeqCst) == 1 {
                requested.lock().unwrap().take().unwrap().send(()).unwrap();
            }
        } else if phase == "worker" {
            peak_workers.fetch_max(
                active_workers.fetch_add(1, Ordering::SeqCst) + 1,
                Ordering::SeqCst,
            );
        } else if phase == "finished" {
            active_workers.fetch_sub(1, Ordering::SeqCst);
        } else if phase == "open" {
            observed.fetch_add(1, Ordering::SeqCst);
        } else if phase == "record"
            && let Some(entered) = entered.lock().unwrap().take()
        {
            entered.send(()).unwrap();
            gate.lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
    }));
    let daemon = Arc::new(import_daemon(root.path(), launcher));
    let first = daemon.clone();
    let first = tokio::spawn(async move {
        import_rpc(&first, "project.importDiscover", json!({"period":"day"})).await
    });
    waiting.await.unwrap();
    let second = daemon.clone();
    let second = tokio::spawn(async move {
        import_rpc(&second, "project.importDiscover", json!({"period":"month"})).await
    });
    registered.await.unwrap();
    // Ping still works while the filesystem reader waits; synchronous discovery used to block it.
    assert!(
        import_rpc(&daemon, "daemon.ping", Value::Null)
            .await
            .get("result")
            .is_some()
    );
    assert_eq!(opens.load(Ordering::SeqCst), 1);
    assert_eq!(workers.load(Ordering::SeqCst), 1);
    release.send(()).unwrap();
    let first = first.await.unwrap();
    let second = second.await.unwrap();
    assert!(first.get("error").is_some(), "{first}");
    assert!(second.get("result").is_some(), "{second}");
    assert_eq!(opens.load(Ordering::SeqCst), 2);
    assert_eq!(peak.load(Ordering::SeqCst), 1);
    assert_eq!(workers.load(Ordering::SeqCst), 0);
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
                SystemTime::now()
                    - Duration::from_secs(if i < 630 { age as u64 * 86400 } else { 0 }),
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
