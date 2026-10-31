//! U3523a, U3523f: `import.list` through the real Daemon with isolated SDK storage, the real
//! TypeScript SDK sidecar and a fake CLI.

use super::*;
use crate::import_tests::{
    import_daemon, import_fixture, import_rpc, import_source, import_tree_with_overviews,
};
use crate::tests::ask;

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap()
}

pub(super) fn executable(path: &Path, text: &str) {
    std::fs::write(path, text).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

pub(super) fn git(project: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(project)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
}

pub(super) fn real_node() -> String {
    let output = std::process::Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .expect("U3523f: Node runs the sidecar fixture");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

/// The packaged folder: the repository's `list.mjs` (its `node_modules` resolve through the real
/// path) and a `node` that journals each start's pid before it becomes the real runtime.
pub(super) fn package(root: &Path, runtime: &str) -> (PathBuf, PathBuf) {
    let dir = root.join("sidecar");
    std::fs::create_dir_all(&dir).unwrap();
    let journal = root.join("children");
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../agents/sidecar/list.mjs");
    std::os::unix::fs::symlink(source.canonicalize().unwrap(), dir.join("list.mjs")).unwrap();
    executable(
        &dir.join("node"),
        &format!("#!/bin/sh\necho $$ >> '{}'\n{runtime}\n", journal.display()),
    );
    (dir, journal)
}

fn record(cwd: &Path, id: &str, sidechain: bool) -> String {
    json!({"type":"user", "uuid":uuid_for(id, cwd), "parentUuid":null, "isSidechain":sidechain,
        "cwd":cwd, "sessionId":id, "timestamp":now(), "message":{"role":"user", "content":"hello"}})
    .to_string()
}

fn uuid_for(id: &str, cwd: &Path) -> String {
    let n = cwd.to_string_lossy().len() % 1000;
    format!("{}-{n:012}", &id[..23])
}

/// A session file in the bucket Claude Code names for `bucket`, holding one record per cwd.
pub(super) fn session(
    config: &Path,
    bucket: &Path,
    number: usize,
    cwds: &[&Path],
    sidechain: bool,
) -> String {
    let id = format!("{number:08}-1111-4111-8111-111111111111");
    // Deliberately historical fixture labels: the SDK, never a cwd encoder, resolves them.
    let dir = config.join("projects").join(bucket.file_name().unwrap());
    std::fs::create_dir_all(&dir).unwrap();
    let lines: Vec<String> = cwds.iter().map(|cwd| record(cwd, &id, sidechain)).collect();
    std::fs::write(dir.join(format!("{id}.jsonl")), lines.join("\n") + "\n").unwrap();
    id
}

async fn list(daemon: &Daemon) -> Value {
    ask(
        daemon,
        &json!({"jsonrpc":"2.0", "id":1, "method":"import.list", "params":{"period":"month"}})
            .to_string(),
    )
    .await
}

fn daemon(project: &Path, launcher: agents::claude_code::Launcher) -> Daemon {
    crate::tests::daemon_with_launcher(project, &project.join(".roundup"), launcher)
}

fn gone(pid: &str) -> bool {
    !Path::new("/proc").join(pid.trim()).exists()
}

async fn eventually_gone(pid: &str) -> bool {
    for _ in 0..40 {
        if gone(pid) {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    false
}

#[tokio::test]
async fn u3523a_vendor_results_merge_with_project_membership() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    let config = root.path().join("config");
    std::fs::create_dir_all(project.join("sub")).unwrap();
    git(&project, &["init", "-q", "-b", "main"]);
    git(&project, &["commit", "-q", "--allow-empty", "-m", "base"]);
    let external = root.path().join("external-worktree");
    git(
        &project,
        &[
            "worktree",
            "add",
            "-q",
            "--detach",
            external.to_str().unwrap(),
        ],
    );
    std::fs::create_dir_all(external.join("pkg")).unwrap();
    let deleted = root.path().join("deleted-worktree");
    git(
        &project,
        &[
            "worktree",
            "add",
            "-q",
            "--detach",
            deleted.to_str().unwrap(),
        ],
    );
    std::fs::remove_dir_all(&deleted).unwrap();
    let sibling = root.path().join("project-sibling");
    std::fs::create_dir(&sibling).unwrap();
    let elsewhere = root.path().join("elsewhere");
    std::fs::create_dir(&elsewhere).unwrap();
    let internal = project.join(".roundup/worktrees/agent");
    std::fs::create_dir_all(&internal).unwrap();

    let sub = project.join("sub");
    let ids = [
        ("root", session(&config, &project, 1, &[&project], false)),
        ("nested", session(&config, &sub, 2, &[&sub], false)),
        (
            "moved",
            session(&config, &project, 3, &[&project, &sub], false),
        ),
        (
            "deleted",
            session(&config, &deleted, 4, &[&deleted, &project], false),
        ),
        (
            "external",
            session(&config, &external, 5, &[&external.join("pkg")], false),
        ),
        ("sibling", session(&config, &sibling, 6, &[&sibling], false)),
        (
            "unrelated",
            session(&config, &elsewhere, 7, &[&elsewhere], false),
        ),
        ("subagent", session(&config, &project, 8, &[&project], true)),
        (
            "internal",
            session(&config, &internal, 9, &[&internal], false),
        ),
        (
            "imported",
            session(&config, &project, 10, &[&project], false),
        ),
        ("live", session(&config, &project, 11, &[&project], false)),
    ]
    .into_iter()
    .collect::<std::collections::HashMap<_, _>>();

    let argv = root.path().join("argv");
    let cli = root.path().join("claude");
    executable(
        &cli,
        &format!(
            "#!/bin/sh\necho \"$@\" >> '{}'\nprintf '%s' '[{{\"sessionId\":\"{}\",\"pid\":4242,\"cwd\":\"{}\",\"name\":\"live one\",\"status\":\"busy\",\"startedAt\":1700000000000}},{{\"sessionId\":\"99999999-1111-4111-8111-111111111111\",\"pid\":7}}]'\n",
            argv.display(),
            ids["live"],
            project.display()
        ),
    );
    let (dir, journal) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
    let launcher = agents::claude_code::Launcher::new(
        cli.to_string_lossy(),
        config.join(".claude.json"),
        "rup".into(),
        None,
    )
    .with_sidecar(dir);
    let daemon = daemon(&project, launcher);
    assert!(
        !journal.exists(),
        "U3523f: opening a Project runs no sidecar"
    );

    // Already imported: the older import path brings it in first.
    let discovered = ask(
        &daemon,
        &json!({"jsonrpc":"2.0", "id":1, "method":"project.importDiscover", "params":{"period":"month"}})
            .to_string(),
    )
    .await;
    let imported = discovered["result"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["source"] == ids["imported"])
        .unwrap_or_else(|| panic!("{discovered}"))
        .clone();
    let committed = ask(
        &daemon,
        &json!({"jsonrpc":"2.0", "id":2, "method":"project.importCommit",
            "params":{"selections":[{"source":imported["source"], "revision":imported["revision"]}]}})
        .to_string(),
    )
    .await;
    assert!(
        committed["result"]["outcomes"][0]["error"].is_null(),
        "{committed}"
    );

    let found = list(&daemon).await;
    let result = &found["result"];
    assert!(
        result.get("error").is_none() && found.get("error").is_none(),
        "{found}"
    );
    let mut listed: Vec<(String, String)> = result["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["source"].as_str().unwrap().to_owned(),
                c["cwd"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    listed.sort();
    let mut expected = vec![
        (ids["root"].clone(), ""),
        (ids["nested"].clone(), "sub"),
        (ids["moved"].clone(), ""),
        (ids["deleted"].clone(), ""),
        (ids["external"].clone(), "pkg"),
        (ids["live"].clone(), ""),
    ]
    .into_iter()
    .map(|(source, cwd)| (source, cwd.to_owned()))
    .collect::<Vec<_>>();
    expected.sort();
    assert_eq!(listed, expected, "{found}");
    let reasons: std::collections::HashMap<String, String> = result["excluded"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["source"].as_str().unwrap().to_owned(),
                e["cause"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(reasons[&ids["imported"]], "alreadyImported", "{found}");
    assert_eq!(reasons[&ids["internal"]], "insideRoundup");
    assert_eq!(
        reasons["99999999-1111-4111-8111-111111111111"],
        "liveWithoutRecords"
    );
    // The SDK lists no subagent-only record, so it is neither offered nor excluded by name.
    for ineligible in ["sibling", "unrelated", "subagent"] {
        assert!(
            !reasons.contains_key(&ids[ineligible]),
            "{ineligible} is not this Project's"
        );
    }
    let live = result["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["source"] == ids["live"])
        .unwrap()["live"]
        .clone();
    assert_eq!(live["pid"], 4242);
    assert_eq!(live["name"], "live one");
    assert_eq!(live["busy"], true);
    assert_eq!(live["started_at_ms"], 1_700_000_000_000_i64);
    assert_eq!(result["sdk"], "0.3.309");

    let calls = std::fs::read_to_string(&argv).unwrap();
    let project_real = project.canonicalize().unwrap();
    let external_real = external.canonicalize().unwrap();
    for root in [&project_real, &external_real] {
        assert!(
            calls
                .lines()
                .any(|l| l == format!("agents --json --cwd {}", root.display())),
            "{calls}"
        );
    }
}

#[tokio::test]
async fn u3523f_runtime_is_lazy_bounded_and_reaped() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    let config = root.path().join("config");
    std::fs::create_dir_all(&project).unwrap();
    session(&config, &project, 1, &[&project], false);
    let cli = root.path().join("claude");
    executable(&cli, "#!/bin/sh\nprintf '[]'\n");
    let launcher = |dir: PathBuf, bin: &Path| {
        agents::claude_code::Launcher::new(
            bin.to_string_lossy(),
            config.join(".claude.json"),
            "rup".into(),
            None,
        )
        .with_sidecar(dir)
    };

    // Completed: the child ran once and is gone when the answer arrives.
    let (dir, journal) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
    let open = daemon(&project, launcher(dir, &cli));
    assert!(!journal.exists(), "opening a Project spawns nothing");
    let found = list(&open).await;
    assert_eq!(
        found["result"]["candidates"].as_array().unwrap().len(),
        1,
        "{found}"
    );
    let started = std::fs::read_to_string(&journal).unwrap();
    assert_eq!(started.lines().count(), 1);
    assert!(gone(started.trim()), "a completed listing reaps its child");
    drop(open);

    // Cancelled: a sidecar that never answers is killed when its caller goes away.
    let hung_root = tempfile::tempdir().unwrap();
    let (dir, journal) = package(hung_root.path(), "exec sleep 600");
    let hung = daemon(&project, launcher(dir, &cli));
    let waited = tokio::time::timeout(std::time::Duration::from_millis(600), list(&hung)).await;
    assert!(waited.is_err(), "the hung sidecar never answers");
    let started = std::fs::read_to_string(&journal).unwrap();
    assert!(
        eventually_gone(started.lines().next().unwrap()).await,
        "a dropped listing reaps its child"
    );
    drop(hung);

    // Missing runtime: the cause and recovery, never an empty list.
    let empty_root = tempfile::tempdir().unwrap();
    let missing = empty_root.path().join("sidecar");
    std::fs::create_dir(&missing).unwrap();
    let broken = daemon(&project, launcher(missing, &cli));
    let refused = list(&broken).await;
    let message = refused["error"]["message"]
        .as_str()
        .unwrap_or_else(|| panic!("{refused}"));
    let recovery = if cfg!(debug_assertions) {
        "--local-node"
    } else {
        "reinstall roundup"
    };
    assert!(
        message.contains("node") && message.contains(recovery),
        "{message}"
    );
    assert!(refused.get("result").is_none());
    drop(broken);

    // Missing CLI: likewise.
    let cli_root = tempfile::tempdir().unwrap();
    let (dir, _) = package(cli_root.path(), &format!("exec '{}' \"$@\"", real_node()));
    let no_cli = daemon(&project, launcher(dir, &root.path().join("no-such-claude")));
    let refused = list(&no_cli).await;
    let message = refused["error"]["message"]
        .as_str()
        .unwrap_or_else(|| panic!("{refused}"));
    assert!(
        message.contains("Claude Code") && message.contains("ROUNDUP_CLAUDE_BIN"),
        "{message}"
    );
}

fn aged(config: &Path, id: &str, at: std::time::SystemTime) {
    let file = std::fs::read_dir(config.join("projects"))
        .unwrap()
        .flat_map(|bucket| std::fs::read_dir(bucket.unwrap().path()).unwrap())
        .map(|entry| entry.unwrap().path())
        .find(|path| path.file_name().unwrap().to_string_lossy().starts_with(id))
        .unwrap();
    std::fs::File::options()
        .write(true)
        .open(file)
        .unwrap()
        .set_modified(at)
        .unwrap();
}

#[tokio::test]
async fn u3523a_period_live_sessions_and_source_failures() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    let config = root.path().join("config");
    std::fs::create_dir_all(&project).unwrap();
    let recent = [
        session(&config, &project, 1, &[&project], false),
        session(&config, &project, 2, &[&project], false),
    ];
    let old = session(&config, &project, 3, &[&project], false);
    let old_live = session(&config, &project, 4, &[&project], false);
    // Equal times order by session id; the window is the day, so older files fall outside it.
    let hour = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    let tenth_day = hour - std::time::Duration::from_secs(10 * 86_400);
    for id in &recent {
        aged(&config, &id[..8], hour);
    }
    aged(&config, &old[..8], tenth_day);
    aged(&config, &old_live[..8], tenth_day);

    let cli = root.path().join("claude");
    executable(
        &cli,
        &format!("#!/bin/sh\nprintf '[{{\"sessionId\":\"{old_live}\",\"pid\":9}}]'\n"),
    );
    let launcher = |dir: PathBuf, bin: &Path| {
        agents::claude_code::Launcher::new(
            bin.to_string_lossy(),
            config.join(".claude.json"),
            "rup".into(),
            None,
        )
        .with_sidecar(dir)
    };
    let (dir, _) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
    let daemon = daemon(&project, launcher(dir, &cli));
    let day = async |daemon: &Daemon| {
        ask(
            daemon,
            &json!({"jsonrpc":"2.0", "id":1, "method":"import.list", "params":{"period":"day"}})
                .to_string(),
        )
        .await
    };

    let first = day(&daemon).await;
    let sources: Vec<&str> = first["result"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["source"].as_str().unwrap())
        .collect();
    let mut expected = vec![recent[0].as_str(), recent[1].as_str()];
    expected.sort();
    assert_eq!(sources[..2], expected, "{first}");
    assert!(sources.contains(&old_live.as_str()), "{first}");
    assert!(!sources.contains(&old.as_str()), "{first}");
    assert_eq!(sources.len(), 3, "{first}");

    // Refresh binds to the source as it now is.
    let target = first["result"]["candidates"][0]["source"].as_str().unwrap();
    let before = first["result"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["source"] == target)
        .unwrap()["revision"]
        .clone();
    let file = std::fs::read_dir(config.join("projects"))
        .unwrap()
        .flat_map(|b| std::fs::read_dir(b.unwrap().path()).unwrap())
        .map(|e| e.unwrap().path())
        .find(|p| p.to_string_lossy().contains(target))
        .unwrap();
    let mut text = std::fs::read_to_string(&file).unwrap();
    text.push_str(&record(&project, target, false));
    text.push('\n');
    std::fs::write(&file, text).unwrap();
    let again = day(&daemon).await;
    let after = again["result"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["source"] == target)
        .unwrap()["revision"]
        .clone();
    assert_ne!(before, after, "{again}");
    drop(daemon);

    // A true empty result is a success, not a failure.
    let empty_project = root.path().join("empty");
    std::fs::create_dir(&empty_project).unwrap();
    let none_cli = root.path().join("claude-none");
    executable(&none_cli, "#!/bin/sh\nprintf '[]'\n");
    let (dir, _) = package(
        &root.path().join("e"),
        &format!("exec '{}' \"$@\"", real_node()),
    );
    let quiet = self::daemon(&empty_project, launcher(dir, &none_cli));
    let found = day(&quiet).await;
    assert_eq!(found["result"]["candidates"], json!([]), "{found}");
    drop(quiet);

    // Each source fails on its own and names itself.
    let (dir, _) = package(
        &root.path().join("s"),
        "read line\nprintf '{\"sdk\":\"x\",\"error\":\"storage unreadable\"}\\n'\nexec cat >/dev/null",
    );
    let sdk_down = self::daemon(&project, launcher(dir, &cli));
    let refused = day(&sdk_down).await;
    let message = refused["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("Agent SDK") && message.contains("storage unreadable"),
        "{refused}"
    );
    assert!(refused.get("result").is_none());
    drop(sdk_down);
    let bad_cli = root.path().join("claude-bad");
    executable(&bad_cli, "#!/bin/sh\necho nope >&2\nexit 3\n");
    let (dir, _) = package(
        &root.path().join("c"),
        &format!("exec '{}' \"$@\"", real_node()),
    );
    let cli_down = self::daemon(&project, launcher(dir, &bad_cli));
    let refused = day(&cli_down).await;
    let message = refused["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("agents --json") && message.contains("update Claude Code"),
        "{refused}"
    );
    assert!(refused.get("result").is_none());
    drop(cli_down);

    // One active listing: a newer one replaces the running one, which is refused, not late.
    let (dir, _) = package(&root.path().join("h"), "exec sleep 600");
    let hung = self::daemon(&project, launcher(dir, &cli));
    let (replaced, waiting) = tokio::join!(
        day(&hung),
        tokio::time::timeout(std::time::Duration::from_millis(800), day(&hung))
    );
    assert!(waiting.is_err());
    assert!(
        replaced["error"]["message"]
            .as_str()
            .is_some_and(|m| m.contains("newer listing")),
        "{replaced}"
    );
}

#[tokio::test]
async fn u3523h_unrelated_sessions_are_not_read() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    let config = root.path().join("config");
    std::fs::create_dir_all(&project).unwrap();
    git(&project, &["init", "-q", "-b", "main"]);
    let mut eligible = Vec::new();
    for n in 1..=10 {
        eligible.push(session(&config, &project, n, &[&project], false));
    }
    eligible.sort();
    // Unrelated sessions: some in a folder that exists, some in one that is gone. Each is 1 MB
    // and holds a later cwd inside the Project, which only a read could find: an opened session
    // becomes an extra candidate, so exactly the ten eligible ones means none was opened.
    let elsewhere = root.path().join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    for n in 0..3000usize {
        let bucket = if n % 2 == 0 {
            elsewhere.clone()
        } else {
            root.path().join(format!("gone-{}", n % 7))
        };
        let id = session(&config, &bucket, 100 + n, &[&bucket, &project], false);
        let file = config
            .join("projects")
            .join(bucket.file_name().unwrap())
            .join(format!("{id}.jsonl"));
        let pad = vec![b' '; 1024 * 1024];
        let mut body = std::fs::read(&file).unwrap();
        body.extend_from_slice(&pad);
        std::fs::write(&file, body).unwrap();
    }
    let cli = root.path().join("claude");
    executable(&cli, "#!/bin/sh\nprintf '[]'\n");
    let (dir, _) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
    let launcher = agents::claude_code::Launcher::new(
        cli.to_string_lossy(),
        config.join(".claude.json"),
        "rup".into(),
        None,
    )
    .with_sidecar(dir);
    let daemon = daemon(&project, launcher);
    // `import.list` is the SDK-backed listing; `project.importDiscover` answers the same period.
    for method in ["import.list", "project.importDiscover"] {
        let started = std::time::Instant::now();
        let answer = ask(
            &daemon,
            &json!({"jsonrpc":"2.0", "id":1, "method":method, "params":{"period":"month"}})
                .to_string(),
        )
        .await;
        let elapsed = started.elapsed();
        let mut sources: Vec<String> = answer["result"]["candidates"]
            .as_array()
            .unwrap_or_else(|| panic!("{method}: {answer}"))
            .iter()
            .map(|c| c["source"].as_str().unwrap().to_owned())
            .collect();
        sources.sort();
        assert_eq!(sources, eligible, "{method}: {answer}");
        assert!(
            elapsed < std::time::Duration::from_secs(10),
            "{method}: {elapsed:?}"
        );
    }
}

#[tokio::test]
async fn u3523d_agent_listing_binds_user_confirmation() {
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("project");
    let config = root.path().join("config");
    std::fs::create_dir_all(&project).unwrap();
    git(&project, &["init", "-q", "-b", "main"]);
    git(&project, &["commit", "-q", "--allow-empty", "-m", "base"]);
    session(&config, &project, 1, &[&project], false);
    session(&config, &project, 2, &[&project], false);
    let cli = root.path().join("claude");
    executable(&cli, "#!/bin/sh\nprintf '[]\\n'\n");
    let (package, _) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
    let launcher = agents::claude_code::Launcher::new(
        cli.to_string_lossy(),
        config.join(".claude.json"),
        "rup".into(),
        None,
    )
    .with_sidecar(package);
    let daemon = daemon(&project, launcher);
    let rpc = |method: &str, params: Value| {
        json!({"jsonrpc":"2.0", "id":1, "method":method, "params":params}).to_string()
    };
    let discovered = ask(
        &daemon,
        &rpc("project.importDiscover", json!({"period":"month"})),
    )
    .await;
    let seed = &discovered["result"]["candidates"][0];
    let imported = ask(
        &daemon,
        &rpc(
            "project.importCommit",
            json!({"selections":[{"source":seed["source"],"revision":seed["revision"]}]}),
        ),
    )
    .await;
    let id = imported["result"]["outcomes"][0]["agent"].as_str().unwrap();
    let ctx = daemon.ctx(Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    });
    let module = daemon.modules.get("import").unwrap();
    let listed = module
        .call(&ctx, "import.list", json!({"period":"month"}))
        .await
        .unwrap();
    let pick = &listed["candidates"][0];
    let preview = ask(
        &daemon,
        &rpc(
            "project.importDiscover",
            json!({"period":"month", "agent":id}),
        ),
    )
    .await;
    assert_eq!(
        preview["result"]["candidates"][0]["revision"],
        pick["revision"]
    );
    let commit = daemon.modules.get("project").unwrap();
    assert!(commit.call(&ctx, "project.importCommit", json!({"agent":id,"selections":[{"source":pick["source"],"revision":pick["revision"]}]})).await.is_err());
    for (agent, source, revision) in [
        (id, pick["source"].clone(), json!("forged")),
        (id, json!("unlisted"), pick["revision"].clone()),
        ("other", pick["source"].clone(), pick["revision"].clone()),
    ] {
        let refused = ask(
            &daemon,
            &rpc(
                "project.importCommit",
                json!({"agent":agent,"selections":[{"source":source,"revision":revision}]}),
            ),
        )
        .await;
        assert!(refused["error"].is_object(), "{refused}");
    }
    let result = ask(&daemon, &rpc("project.importCommit", json!({"agent":id,"selections":[{"source":pick["source"],"revision":pick["revision"]}]}))).await;
    assert!(
        result["result"]["outcomes"][0]["agent"].is_string(),
        "{result}"
    );
}

#[tokio::test]
async fn u3523e_live_resume_failure_keeps_import_recoverable() {
    let (root, launcher, daemon, _original, seed) = import_fixture(0).await;
    let seeded = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[seed]}),
    )
    .await;
    let listing_agent = seeded["result"]["outcomes"][0]["agent"].as_str().unwrap();
    let project = root.path().join("project");
    let config = root.path().join("config");
    let at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let original = import_source(&config, &project, 2, &at);
    let mut record: Value = serde_json::from_slice(&std::fs::read(&original).unwrap()).unwrap();
    record["uuid"] = json!("22222222-1111-4111-8111-111111111111");
    record["isSidechain"] = json!(false);
    record["message"] = json!({"role":"user", "content":"Continue this work"});
    std::fs::write(&original, format!("{record}\n")).unwrap();
    let bytes = std::fs::read(&original).unwrap();
    let source = "00000002-1111-4111-8111-111111111111";
    let cli = root.path().join("fake-claude");
    std::fs::write(&cli, format!("#!/bin/sh\nif [ \"$1\" = agents ]; then printf '%s' '[{{\"sessionId\":\"{source}\",\"pid\":424242,\"cwd\":\"{}\"}}]'; exit 0; fi\nexit 1\n", project.display())).unwrap();
    let (package, _) = package(root.path(), &format!("exec '{}' \"$@\"", real_node()));
    drop(daemon);
    let launcher = launcher.with_sidecar(package);
    let daemon = import_daemon(&project, launcher.clone());
    let ctx = daemon.ctx(Actor {
        kind: ActorKind::Agent,
        id: listing_agent.into(),
        parent: None,
    });
    let listed = daemon.modules["import"]
        .call(&ctx, "import.list", json!({"period":"month"}))
        .await
        .unwrap();
    let pick = listed["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["source"] == source)
        .unwrap();
    let params =
        json!({"agent":listing_agent,"selections":[{"source":source,"revision":pick["revision"]}]});
    // Listing succeeds, but a missing executable makes normal resume fail before acknowledgement.
    std::fs::remove_file(&cli).unwrap();
    let reply = import_rpc(&daemon, "project.importCommit", params.clone()).await;
    let outcome = &reply["result"]["outcomes"][0];
    assert!(outcome["error"].is_object(), "{reply}");
    let id = outcome["agent"].as_str().unwrap();
    assert!(outcome["workstream"].is_string());
    let tree = import_rpc(&daemon, "rail.tree", Value::Null).await;
    let node = tree["result"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .unwrap();
    assert_eq!(node["can_resume"], true, "{tree}");
    assert_eq!(std::fs::read(&original).unwrap(), bytes);
    drop(daemon);
    // Recovery must use the retained copy even when the external conversation disappears.
    std::fs::remove_file(&original).unwrap();
    let daemon = import_daemon(&project, launcher);
    // Replay returns the published identities and never attempts another automatic launch.
    let replay = import_rpc(&daemon, "project.importCommit", params).await;
    assert_eq!(replay["result"]["outcomes"][0]["agent"], id);
    assert!(
        replay["result"]["outcomes"][0]["error"].is_null(),
        "{replay}"
    );
    assert_eq!(
        import_rpc(&daemon, "terminal.list", Value::Null).await["result"],
        json!([])
    );
    let tree = import_tree_with_overviews(&daemon, &[json!(id)]).await;
    let recovered = tree["result"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == id)
        .unwrap();
    assert!(recovered["overview"]["id"].is_string(), "{tree}");
    assert_ne!(recovered["overview"]["id"], source);
    let retry = import_rpc(&daemon, "agent.resume", json!({"id":id})).await;
    assert!(
        retry["error"].is_object(),
        "retry reaches the missing executable: {retry}"
    );
    assert!(!original.exists());
}
