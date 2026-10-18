use super::*;
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;

const LOCAL: &[u8] = include_bytes!("../../tests/fixtures/worktrunk-v0.80.0/local.json");
const FULL: &[u8] = include_bytes!("../../tests/fixtures/worktrunk-v0.80.0/full.json");

fn envelope(items: Value) -> Vec<u8> {
    serde_json::to_vec(
        &json!({"schema":2,"repo":{},"collected":{"ci":true,"summary":false},"items":items}),
    )
    .unwrap()
}

#[test]
fn u2556a_supported_json_and_rejected_shapes() {
    for bytes in [
        LOCAL,
        FULL,
        &envelope(json!([])),
        &envelope(json!([{"branch":null,"worktree":null,"checks":null,"pr":null}])),
    ] {
        assert!(parse(bytes).is_ok(), "{}", String::from_utf8_lossy(bytes));
    }
    let mut invalid = vec![
        b"[]".to_vec(), b"null".to_vec(), b"{}".to_vec(), b"{\"schema\":2".to_vec(),
        envelope(json!([{"branch":3}])),
        envelope(json!([{"branch":"feature","worktree":{"path":1}}])),
        envelope(json!([{"checks":{"status":true,"source":"pr","stale":false}}])),
        envelope(json!([{"checks":{"status":"passed","source":"pr","stale":"false"}}])),
        envelope(json!([{"checks":{"status":"passed","source":"review","stale":false}}])),
        envelope(json!([{"pr":{"number":0}}])), envelope(json!([{"pr":{"number":-1}}])),
        envelope(json!([{"pr":{"number":1.2}}])), envelope(json!([{"pr":{"number":"12"}}])),
        br#"{"schema":2,"repo":{},"collected":{"ci":true,"summary":false},"items":[{"pr":{"number":18446744073709551616}}]}"#.to_vec(),
        vec![b' '; usize::try_from(LIMIT + 1).unwrap()],
    ];
    for replacement in [json!(1), json!(3), json!("2"), Value::Null] {
        let mut value: Value = serde_json::from_slice(LOCAL).unwrap();
        value["schema"] = replacement;
        invalid.push(serde_json::to_vec(&value).unwrap());
    }
    for bytes in invalid {
        assert!(
            parse(&bytes).is_err(),
            "accepted {}",
            String::from_utf8_lossy(&bytes[..bytes.len().min(100)])
        );
    }
}

#[test]
fn u2556a_optional_network_facts() {
    let recorded = parse(include_bytes!(
        "../../tests/fixtures/worktrunk-v0.80.0/full-network.json"
    ))
    .unwrap();
    for row in recorded.items {
        assert_eq!(
            row.facts(),
            Facts {
                ci: Some(("passed".into(), false)),
                pr: Some((42, false))
            }
        );
    }
    for (checks, pr, expected) in [
        (Value::Null, Value::Null, Facts { ci: None, pr: None }),
        (
            json!({"status":null,"source":"pr","stale":false}),
            json!({"number":null}),
            Facts { ci: None, pr: None },
        ),
        (
            json!({"status":"passed","source":"pr","stale":true}),
            json!({"number":42,"review":"changes_requested"}),
            Facts {
                ci: Some(("passed".into(), true)),
                pr: Some((42, false)),
            },
        ),
        (
            json!({"status":"future","source":"pr","stale":false}),
            json!({"number":8,"review":"approved"}),
            Facts {
                ci: Some(("unknown".into(), false)),
                pr: Some((8, false)),
            },
        ),
        (
            json!({"status":null,"source":"pr","stale":true}),
            json!({"number":9,"mergeable":false}),
            Facts {
                ci: Some(("conflicts".into(), true)),
                pr: Some((9, false)),
            },
        ),
        (
            Value::Null,
            json!({"review":"approved"}),
            Facts { ci: None, pr: None },
        ),
    ] {
        let parsed = parse(&envelope(
            json!([{"checks":checks,"pr":pr,"unrelated":{"nested":123}}]),
        ))
        .unwrap();
        assert_eq!(parsed.items[0].facts(), expected);
    }
}

fn git(project: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(project)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}
fn repository() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "Collector fixture"]);
    git(
        dir.path(),
        &["config", "user.email", "collector@example.invalid"],
    );
    std::fs::write(dir.path().join("tracked"), b"original\n").unwrap();
    git(dir.path(), &["add", "tracked"]);
    git(dir.path(), &["commit", "-m", "fixture"]);
    dir
}
fn identity(project: &Path) -> Identity {
    Identity {
        agent: "agent-1".into(),
        path: project.to_owned(),
        branch: "main".into(),
    }
}
fn row(project: &Path) -> Value {
    json!({"branch":"main","worktree":{"path":project},"checks":{"status":"passed","source":"pr","stale":false},"pr":{"number":23}})
}
fn executable(dir: &Path, body: &str) -> PathBuf {
    let path = dir.join("collector-fixture");
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[test]
fn u2556a_path_identity_and_read_only_collection() {
    let repo = repository();
    let path = repo.path().canonicalize().unwrap();
    let id = identity(&path);
    let git_read = super::super::worktree::Git::from_env().reader();
    let refs = git(&path, &["show-ref"]);
    let file = std::fs::read(path.join("tracked")).unwrap();
    let fixture = envelope(json!([row(&path)]));
    std::fs::write(path.join("output.json"), fixture).unwrap();
    let command = executable(&path, "cat output.json");
    let results = collect(
        &command,
        &path,
        &git_read,
        std::slice::from_ref(&id),
        true,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(results[&id].pr, Some((23, false)));
    assert_eq!(git(&path, &["show-ref"]), refs);
    assert_eq!(std::fs::read(path.join("tracked")).unwrap(), file);
}

#[test]
fn u2556a_ambiguous_unowned_and_mismatching_rows_enrich_nothing() {
    let repo = repository();
    let path = repo.path().canonicalize().unwrap();
    let id = identity(&path);
    let registered = vec![(path.clone(), Some("refs/heads/main".into()))];
    for items in [
        json!([row(&path), row(&path)]),
        json!([{"branch":"main","checks":{"status":"passed","source":"pr","stale":false}}]),
        json!([{"branch":"other","worktree":{"path":path}}]),
        json!([{"branch":"main","worktree":{"path":path,"duplicate_branch":true}}]),
        json!([{"branch":"main","worktree":{"path":path,"detached":true}}]),
    ] {
        let parsed = parse(&envelope(items)).unwrap();
        assert!(
            match_rows(&parsed, std::slice::from_ref(&id), &registered, &registered).is_empty()
        );
    }
    let parsed = parse(&envelope(json!([row(&path)]))).unwrap();
    for (ids, owned) in [
        (vec![], registered.clone()),
        (vec![id.clone(), id.clone()], registered.clone()),
        (vec![id.clone()], vec![]),
    ] {
        assert!(match_rows(&parsed, &ids, &owned, &registered).is_empty());
    }
    let foreign = repository();
    let foreign_path = foreign.path().canonicalize().unwrap();
    let parsed = parse(&envelope(json!([row(&foreign_path)]))).unwrap();
    assert!(
        match_rows(
            &parsed,
            &[identity(&foreign_path)],
            &registered,
            &registered
        )
        .is_empty()
    );
}

#[test]
fn u2556b_refresh_is_bounded_and_coalesced() {
    let collector = Collector::default();
    let start = Instant::now();
    assert!(collector.admit(false, start));
    assert!(collector.admit(true, start));
    for _ in 0..117 {
        assert!(!collector.admit(false, start));
        assert!(!collector.admit(true, start + FULL_INTERVAL));
    }
    let cancelled = AtomicBool::new(false);
    publish(
        &collector.state,
        false,
        Err("failed".into()),
        vec![],
        &cancelled,
        start,
    );
    publish(
        &collector.state,
        true,
        Err("failed".into()),
        vec![],
        &cancelled,
        start,
    );
    assert!(!collector.admit(false, start + LOCAL_INTERVAL - Duration::from_nanos(1)));
    assert!(collector.admit(false, start + LOCAL_INTERVAL));
    assert!(!collector.admit(true, start + FULL_INTERVAL - Duration::from_nanos(1)));
    assert!(collector.admit(true, start + FULL_INTERVAL));
}

#[test]
fn u2556b_failures_preserve_local_state() {
    let collector = Collector::default();
    let start = Instant::now();
    let repo = repository();
    let id = identity(repo.path());
    let cancelled = AtomicBool::new(false);
    let facts = Facts {
        ci: Some(("passed".into(), true)),
        pr: Some((4, false)),
    };
    publish(
        &collector.state,
        true,
        Ok(BTreeMap::from([(id.clone(), facts.clone())])),
        vec![id.clone()],
        &cancelled,
        start,
    );
    assert_eq!(collector.facts(&id, start), Some(facts));
    assert_eq!(
        collector.facts(&id, start + FULL_INTERVAL).unwrap().pr,
        Some((4, true))
    );
    publish(
        &collector.state,
        true,
        Err("offline/login/schema/process".into()),
        vec![id.clone()],
        &cancelled,
        start,
    );
    assert_eq!(
        collector.facts(&id, start).unwrap(),
        Facts {
            ci: Some(("passed".into(), true)),
            pr: Some((4, true))
        }
    );
    let git_read = super::super::worktree::Git::from_env().bounded();
    let worktree = super::super::worktree::Worktree {
        path: repo.path().to_owned(),
        branch: "main".into(),
        base: "main".into(),
    };
    let state = git_read.state(repo.path(), &worktree).unwrap();
    assert_eq!((state.ahead, state.behind, state.dirty), (0, 0, false));
}

#[test]
fn u2556b_late_results_do_not_cross_identity() {
    for mutation in ["remove", "branch", "path"] {
        let (dir, _bus, shared) = super::super::store::tests::shared_over_temp_dir(Arc::new(|| 0));
        let node = shared
            .rail()
            .insert(contracts::agent::NodeKind::Agent, "fixture", None, None)
            .unwrap();
        let mut record = contracts::agent::Worktree {
            path: dir.path().to_string_lossy().into_owned(),
            branch: "main".into(),
            base: "main".into(),
        };
        shared.rail().set_worktree(&node.id, &record).unwrap();
        let original = identities(&shared).unwrap().remove(0);
        let agents = super::super::store::tests::owner_agents(shared.clone(), dir.path());
        match mutation {
            "remove" => shared.rail().remove(&node.id).unwrap(),
            "branch" => {
                record.branch = "replacement".into();
                shared.rail().set_worktree(&node.id, &record).unwrap();
            }
            "path" => {
                record.path = dir
                    .path()
                    .join("replacement")
                    .to_string_lossy()
                    .into_owned();
                shared.rail().set_worktree(&node.id, &record).unwrap();
            }
            _ => unreachable!(),
        }
        publish(
            &shared.worktrunk.state,
            true,
            Ok(BTreeMap::from([(
                original,
                Facts {
                    ci: None,
                    pr: Some((1, false)),
                },
            )])),
            identities(&shared).unwrap(),
            &shared.worktrunk.cancelled,
            Instant::now(),
        );
        assert!(
            agents.worktree_facts(&node.id).is_none(),
            "late reply crossed {mutation}"
        );
    }
}

#[test]
fn u2556b_missing_nonzero_malformed_and_oversized_collectors_are_unavailable() {
    let repo = repository();
    let cancelled = AtomicBool::new(false);
    assert!(execute(&repo.path().join("missing"), repo.path(), true, &cancelled).is_err());
    for body in ["exit 1", "printf '{'", "head -c 8388609 /dev/zero"] {
        let command = executable(repo.path(), body);
        assert!(
            execute(&command, repo.path(), true, &cancelled)
                .and_then(|bytes| parse(&bytes))
                .is_err()
        );
    }
}

#[test]
fn u2556b_cancellation_kills_and_reaps_the_process_group() {
    let repo = repository();
    let command = executable(repo.path(), "sleep 120 &\necho $$ $! > ready\nwait");
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancellation = cancelled.clone();
    let path = repo.path().to_owned();
    let worker = std::thread::spawn(move || execute(&command, &path, true, &cancellation));
    let deadline = Instant::now() + TIMEOUT;
    // The fixture emits ready only after the descendant is in the owned group.
    let pids = loop {
        if let Ok(text) = std::fs::read_to_string(repo.path().join("ready"))
            && text.split_whitespace().count() == 2
        {
            break text;
        }
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    };
    cancelled.store(true, Ordering::Release);
    assert!(worker.join().unwrap().is_err());
    for raw in pids.split_whitespace() {
        let pid: i32 = raw.parse().unwrap();
        // A killed descendant can briefly be an init-owned zombie on Linux.
        // It cannot keep executing or retain the collector's output handles.
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"));
        assert!(stat.is_err() || stat.unwrap().split_whitespace().nth(2) == Some("Z"));
    }
}

#[test]
fn u2556b_timeout_ends_a_stalled_collector() {
    let repo = repository();
    let command = executable(repo.path(), "sleep 120");
    let start = Instant::now();
    assert!(
        execute(&command, repo.path(), true, &AtomicBool::new(false))
            .unwrap_err()
            .contains("timed out")
    );
    assert!(start.elapsed() >= TIMEOUT);
    assert!(start.elapsed() < TIMEOUT + Duration::from_secs(2));
}

#[test]
#[ignore = "release observer: set ROUNDUP_TEST_WT to the pinned v0.80.0 executable"]
fn u2556b_collection_cannot_run_configured_commands() {
    let binary = PathBuf::from(std::env::var_os("ROUNDUP_TEST_WT").expect("pinned wt executable"));
    assert_eq!(
        Command::new(&binary)
            .arg("--version")
            .output()
            .unwrap()
            .stdout,
        b"wt v0.80.0\n"
    );
    if let Some(project) = std::env::var_os("ROUNDUP_TEST_WT_PROJECT") {
        for full in [false, true] {
            let bytes =
                execute(&binary, Path::new(&project), full, &AtomicBool::new(false)).unwrap();
            assert_eq!(parse(&bytes).unwrap().collected.ci, full);
        }
        return;
    }
    let repo = repository();
    let project = repo.path();
    std::fs::create_dir_all(project.join(".config")).unwrap();
    std::fs::write(project.join(".config/wt.toml"),"[post-switch]\nsentinel = 'touch SENTINEL-hook'\n[post-create]\nsentinel = 'touch SENTINEL-create'\n").unwrap();
    let config = project.join("hostile.toml");
    std::fs::write(&config,"[list]\nsummary=true\nfull=true\n[list.custom-columns.Pwn]\ntemplate='{{ branch }}'\ncommand='touch SENTINEL-column'\n[commit.generation]\ncommand='touch SENTINEL-generation'\n").unwrap();
    let before = git(project, &["show-ref"]);
    let bytes = std::fs::read(project.join("tracked")).unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--ignored",
            "--exact",
            "worktrunk::tests::u2556b_collection_cannot_run_configured_commands",
            "--nocapture",
        ])
        .env("ROUNDUP_TEST_WT_PROJECT", project)
        .env("WORKTRUNK_CONFIG_PATH", &config)
        .env("WORKTRUNK_SYSTEM_CONFIG_PATH", &config)
        .env(
            "WORKTRUNK_PROJECT_CONFIG_PATH",
            project.join(".config/wt.toml"),
        )
        .env("WORKTRUNK__LIST__FULL", "true")
        .env("WORKTRUNK__LIST__SUMMARY", "true")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(git(project, &["show-ref"]), before);
    assert_eq!(std::fs::read(project.join("tracked")).unwrap(), bytes);
    assert!(!std::fs::read_dir(project).unwrap().any(|file| {
        file.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("SENTINEL")
    }));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn u2556b_117_worktrees_share_collectors_without_blocking_git_and_close_cancels() {
    let repo = repository();
    let (_data, _bus, mut shared) =
        super::super::store::tests::shared_over_temp_dir(Arc::new(|| 0));
    let fixture_dir = tempfile::tempdir().unwrap();
    let project = repo.path();
    let command = executable(
        fixture_dir.path(),
        &format!(
            "case \"$*\" in *--full*) echo full >> '{}' ; sleep 120 ;; *) echo local >> '{}' ; printf '%s' '{{\"schema\":2,\"repo\":{{}},\"collected\":{{\"ci\":false,\"summary\":false}},\"items\":[]}}' ;; esac",
            fixture_dir.path().join("starts").display(),
            fixture_dir.path().join("starts").display()
        ),
    );
    {
        let shared = Arc::get_mut(&mut shared).unwrap();
        shared.project_dir = project.to_owned();
        shared.worktrunk.executable = command;
    }
    for index in 0..117 {
        let (path, branch) = if index == 0 {
            (project.to_owned(), "main".to_owned())
        } else {
            let path = fixture_dir.path().join(format!("tree-{index}"));
            let branch = format!("branch-{index}");
            git(
                project,
                &["worktree", "add", "-b", &branch, path.to_str().unwrap()],
            );
            (path, branch)
        };
        let mut rail = shared.rail();
        let node = rail
            .insert(
                contracts::agent::NodeKind::Workstream,
                "fixture",
                None,
                None,
            )
            .unwrap();
        rail.set_worktree(
            &node.id,
            &contracts::agent::Worktree {
                path: path.to_string_lossy().into_owned(),
                branch,
                base: "main".into(),
            },
        )
        .unwrap();
    }
    let start = Instant::now();
    for _ in 0..117 {
        shared.worktrunk.refresh(&shared);
    }
    let admission = start.elapsed();
    let deadline = start + TIMEOUT;
    loop {
        let starts = std::fs::read_to_string(fixture_dir.path().join("starts")).unwrap_or_default();
        if starts.lines().count() == 2 && !shared.worktrunk.state.lock().unwrap().lanes[0].running {
            break;
        }
        assert!(Instant::now() < deadline, "collectors did not start");
        tokio::task::yield_now().await;
    }
    let read_start = Instant::now();
    let state = shared
        .git
        .bounded()
        .state(
            project,
            &super::super::worktree::Worktree {
                path: project.to_owned(),
                branch: "main".into(),
                base: "main".into(),
            },
        )
        .unwrap();
    let read_time = read_start.elapsed();
    assert_eq!((state.ahead, state.behind, state.dirty), (0, 0, false));
    assert!(shared.worktrunk.state.lock().unwrap().lanes[1].running);
    assert_eq!(
        std::fs::read_to_string(fixture_dir.path().join("starts"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    eprintln!(
        "117 registered worktrees: 117 requests admitted in {admission:?}; 2 collector starts (1 local, 1 stalled full); Base-relative git read {read_time:?}"
    );
    let state = shared.worktrunk.state.clone();
    let close = Instant::now();
    drop(shared);
    while state.lock().unwrap().lanes[1].running {
        assert!(
            close.elapsed() < TIMEOUT,
            "Project close did not cancel/reap full collector"
        );
        tokio::task::yield_now().await;
    }
    eprintln!(
        "Project close cancelled/reaped stalled collector in {:?}",
        close.elapsed()
    );
}

#[test]
fn u2556b_configured_git_merge_driver_prevents_collection() {
    let repo = repository();
    git(
        repo.path(),
        &["config", "merge.sentinel.driver", "touch SENTINEL-driver"],
    );
    let command = executable(repo.path(), "touch SENTINEL-collector");
    let result = collect(
        &command,
        repo.path(),
        &super::super::worktree::Git::from_env(),
        &[identity(repo.path())],
        true,
        &AtomicBool::new(false),
    );
    assert!(result.unwrap_err().contains("merge driver"));
    assert!(!repo.path().join("SENTINEL-driver").exists());
    assert!(!repo.path().join("SENTINEL-collector").exists());
}
