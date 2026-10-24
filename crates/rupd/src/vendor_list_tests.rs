//! U3523a, U3523f: `import.list` through the real Daemon with isolated SDK storage, the real
//! TypeScript SDK sidecar and a fake CLI.

use super::*;
use crate::tests::ask;

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap()
}

fn executable(path: &Path, text: &str) {
    std::fs::write(path, text).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn git(project: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(project)
        .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
}

fn real_node() -> String {
    let output = std::process::Command::new("node")
        .args(["-p", "process.execPath"])
        .output()
        .expect("U3523f: Node runs the sidecar fixture");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

/// The packaged folder: the repository's `list.mjs` (its `node_modules` resolve through the real
/// path) and a `node` that journals each start's pid before it becomes the real runtime.
fn package(root: &Path, runtime: &str) -> (PathBuf, PathBuf) {
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
fn session(config: &Path, bucket: &Path, number: usize, cwds: &[&Path], sidechain: bool) -> String {
    let id = format!("{number:08}-1111-4111-8111-111111111111");
    let name: String = bucket
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dir = config.join("projects").join(name);
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
                e["reason"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        reasons[&ids["imported"]], "already in this Project",
        "{found}"
    );
    assert_eq!(reasons[&ids["internal"]], "inside roundup's own folder");
    assert!(reasons["99999999-1111-4111-8111-111111111111"].contains("no saved records"));
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
    assert!(
        message.contains("node") && message.contains("reinstall roundup"),
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
        let name: String = bucket
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let file = config
            .join("projects")
            .join(name)
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
