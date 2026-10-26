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
    let record = json!({"type":"user", "cwd":cwd, "sessionId":id, "timestamp":timestamp});
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
    let unshortened: String = long
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let hash = long
        .to_string_lossy()
        .chars()
        .fold(0_i32, |h, c| h.wrapping_mul(31).wrapping_add(c as i32))
        .unsigned_abs();
    let mut digits = Vec::new();
    let mut value = hash;
    while value > 0 {
        digits.push(char::from_digit(value % 36, 36).unwrap());
        value /= 36;
    }
    let bucket = format!(
        "{}-{}",
        &unshortened[..200],
        digits.into_iter().rev().collect::<String>()
    );
    std::fs::rename(
        config.join("projects").join(&unshortened),
        config.join("projects").join(bucket),
    )
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
