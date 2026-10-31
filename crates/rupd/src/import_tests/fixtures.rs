use super::super::*;
use crate::tests::ask;

use std::path::PathBuf;

pub(crate) fn import_daemon(project: &Path, launcher: agents::claude_code::Launcher) -> Daemon {
    crate::tests::daemon_with_launcher(project, &project.join(".roundup"), launcher)
}

pub(crate) fn import_source(config: &Path, cwd: &Path, number: usize, timestamp: &str) -> PathBuf {
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
    let record = json!({"type":"user", "cwd":cwd, "sessionId":id, "timestamp":timestamp, "uuid":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "message":{"role":"user","content":"Imported work"}});
    std::fs::write(&file, format!("{record}\n")).unwrap();
    file
}

pub(crate) async fn import_rpc(daemon: &Daemon, method: &str, params: Value) -> Value {
    ask(
        daemon,
        &json!({"jsonrpc":"2.0", "id":1, "method":method,"params":params}).to_string(),
    )
    .await
}

pub(super) fn import_git(project: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(project)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).unwrap()
}

pub(crate) async fn import_fixture(
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

type Originals = Vec<(PathBuf, Vec<u8>)>;

// Construct the SDK's observed layout only; this is never production path encoding.
pub(super) fn journey_sources(
    root: &Path,
    project: &Path,
    config: &Path,
) -> (PathBuf, [String; 3], Originals) {
    use crate::vendor_list_tests::{git, session};
    let sub = project.join("sub");
    let long = project.join("long".repeat(55));
    std::fs::create_dir(&sub).unwrap();
    std::fs::create_dir(&long).unwrap();
    let removed = root.join("removed-worktree");
    git(
        project,
        &["worktree", "add", "--detach", removed.to_str().unwrap()],
    );
    let historical: Vec<_> = (0..65)
        .map(|n| project.join(format!("removed-{n}")))
        .collect();
    let mut cwds = vec![project];
    cwds.extend(historical.iter().map(PathBuf::as_path));
    cwds.push(&sub);
    let moved = session(config, project, 2, &cwds, false);
    let deleted = session(config, &removed, 3, &[&removed, project], false);
    std::fs::remove_dir_all(&removed).unwrap();
    let live = session(config, &long, 4, &[&long], false);
    let historical = config
        .join("projects")
        .join(long.file_name().unwrap())
        .join(format!("{live}.jsonl"));
    let bytes = std::fs::read(&historical).unwrap();
    std::fs::remove_file(historical).unwrap();
    agents::claude_code::Launcher::new("unused", config.join(".claude.json"), "rup".into(), None)
        .save_for_test(&long, &live, &bytes)
        .unwrap();
    let originals = std::fs::read_dir(config.join("projects"))
        .unwrap()
        .flat_map(|bucket| std::fs::read_dir(bucket.unwrap().path()).unwrap())
        .map(|entry| {
            let path = entry.unwrap().path();
            let bytes = std::fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    (long, [moved, deleted, live], originals)
}

#[tokio::test]
async fn u4251b_sdk_membership_survives_snapshot_validation() {
    use crate::vendor_list_tests::{executable, git, package, real_node, session};
    let (root, _, daemon, _, seed) = import_fixture(0).await;
    let seeded = import_rpc(
        &daemon,
        "project.importCommit",
        json!({"selections":[seed]}),
    )
    .await;
    assert!(
        seeded["result"]["outcomes"][0]["error"].is_null(),
        "{seeded}"
    );
    drop(daemon);
    let project = root.path().join("project");
    let config = root.path().join("config");
    let (_, [moved, deleted, _], mut originals) = journey_sources(root.path(), &project, &config);
    // The third source is a real registered external Worktree, mapped back into the Project.
    let linked = root.path().join("linked");
    git(
        &project,
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    );
    let linked_id = session(&config, &linked, 5, &[&linked], false);
    let linked_source = config
        .join("projects/linked")
        .join(format!("{linked_id}.jsonl"));
    originals.push((
        linked_source.clone(),
        std::fs::read(&linked_source).unwrap(),
    ));
    let cli = root.path().join("quiet-claude");
    executable(&cli, "#!/bin/sh\nprintf '[]'\n");
    let (sidecar, _) = package(
        &root.path().join("membership"),
        &format!("exec '{}' \"$@\"", real_node()),
    );
    let launcher = agents::claude_code::Launcher::new(
        cli.to_string_lossy(),
        config.join(".claude.json"),
        "rup".into(),
        None,
    )
    .with_sidecar(sidecar);
    let daemon = super::import_daemon_with_clock(&project, launcher.clone());
    let listed = import_rpc(&daemon, "project.importDiscover", json!({"period":"month"})).await;
    let picks = listed["result"]["candidates"].as_array().unwrap();
    let sources = [moved, deleted, linked_id];
    let selections: Vec<_> = sources
        .iter()
        .map(|id| {
            let rows: Vec<_> = picks.iter().filter(|p| p["source"] == *id).collect();
            assert_eq!(rows.len(), 1, "{listed}");
            assert_eq!(rows[0]["cwd"], "");
            json!({"source":id,"revision":rows[0]["revision"]})
        })
        .collect();
    let params = json!({"selections":selections});
    let committed = import_rpc(&daemon, "project.importCommit", params.clone()).await;
    // RO2: `rail.tree` answers from the cache, so read it until the background read lands.
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(50));
    let tree = loop {
        tick.tick().await;
        let tree = import_rpc(&daemon, "rail.tree", Value::Null).await;
        let imported = committed["result"]["outcomes"].as_array().unwrap();
        let ready =
            imported.iter().all(|outcome| {
                tree["result"].as_array().unwrap().iter().any(|node| {
                    node["id"] == outcome["agent"] && node["overview"]["id"].is_string()
                })
            });
        if ready {
            break tree;
        }
    };
    for outcome in committed["result"]["outcomes"].as_array().unwrap() {
        assert!(outcome["error"].is_null(), "{committed}");
        let node = tree["result"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == outcome["agent"])
            .unwrap();
        assert!(node["attempt"].is_null());
        assert!(node["terminal_id"].is_null());
        let saved = node["overview"]["id"].as_str().unwrap();
        let retained = launcher.record_conversation(&project, saved).unwrap();
        let records: Vec<Value> = retained
            .split(|b| *b == b'\n')
            .filter(|l| !l.is_empty())
            .map(|line| serde_json::from_slice(line).unwrap())
            .collect();
        assert!(records.iter().all(|record| record["sessionId"] == saved));
        let source = outcome["source"].as_str().unwrap();
        let original = &originals
            .iter()
            .find(|(path, _)| path.file_stem().unwrap() == source)
            .unwrap()
            .1;
        let expected: Vec<Value> = original
            .split(|b| *b == b'\n')
            .filter(|l| !l.is_empty())
            .map(|line| {
                let mut record: Value = serde_json::from_slice(line).unwrap();
                record["sessionId"] = json!(saved);
                record
            })
            .collect();
        assert_eq!(records, expected);
    }
    for (path, bytes) in originals {
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
    assert_eq!(
        import_rpc(&daemon, "terminal.list", Value::Null).await["result"],
        json!([])
    );
    assert_eq!(
        import_rpc(&daemon, "project.importCommit", params).await["result"],
        committed["result"]
    );
}
