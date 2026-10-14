use agents::claude_code::plugins;

#[test]
fn q11_materializes_complete_pinned_plugins_offline() {
    let data = tempfile::tempdir().unwrap();
    let bundle = plugins::materialize(data.path()).unwrap();
    for (path, name, version) in bundle
        .directories()
        .iter()
        .zip([("hope", "13.1.0"), ("hunch", "0.9.4"), ("hold", "0.0.9")])
        .map(|(path, (name, version))| (path, name, version))
    {
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(path.join(".claude-plugin/plugin.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["name"], name);
        assert_eq!(manifest["version"], version);
    }
    assert!(bundle.directories()[0].join("hooks/judge.sh").is_file());
    assert!(bundle.directories()[1].join("hooks/memory.tsx").is_file());
}

#[tokio::test]
#[ignore = "requires real Claude; set ROUNDUP_CLAUDE to its executable"]
async fn q11_real_claude_loads_packaged_hook_dependencies() {
    let data = tempfile::tempdir().unwrap();
    let bundle = plugins::materialize(data.path()).unwrap();
    let executable = std::env::var_os("ROUNDUP_CLAUDE").unwrap();
    let runtime = bundle
        .runtime(std::path::Path::new(&executable))
        .await
        .unwrap();
    let command = runtime.command(&bundle).unwrap();
    let command = command.as_std();
    let args: Vec<_> = command
        .get_args()
        .map(|arg| arg.to_str().unwrap())
        .collect();
    assert_eq!(args.len(), 6);
    for (pair, directory) in args.as_chunks::<2>().0.iter().zip(bundle.directories()) {
        assert_eq!(pair[0], "--plugin-dir");
        assert_eq!(pair[1], directory.to_str().unwrap());
    }
    assert!(
        command
            .get_envs()
            .any(|(key, value)| key == "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS"
                && value == Some(std::ffi::OsStr::new("1")))
    );
}

#[test]
fn q11_every_asset_matches_pinned_provenance_and_source_bytes() {
    use sha2::{Digest, Sha256};
    use std::os::unix::fs::PermissionsExt;
    let data = tempfile::tempdir().unwrap();
    let bundle = plugins::materialize(data.path()).unwrap();
    let root = bundle.directories()[0].parent().unwrap();
    let inventory = include_str!("../assets/plugins/inventory.tsv");
    let mut counts = [0; 3];
    for row in inventory.lines().skip(1) {
        let columns: Vec<_> = row.split('\t').collect();
        let path = root.join(columns[0]);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            columns[3],
            "{}",
            columns[0]
        );
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            u32::from_str_radix(columns[1], 8).unwrap()
        );
        for (index, name) in ["hope/", "hunch/", "hold/"].iter().enumerate() {
            if columns[0].starts_with(name) {
                counts[index] += 1;
            }
        }
    }
    assert_eq!(counts, [123, 27, 7]);
    assert_eq!(inventory.lines().count(), 159);
}

#[test]
fn q11_a_missing_or_corrupt_asset_rejects_the_complete_bundle() {
    for mutation in ["missing", "corrupt", "extra", "symlink", "mode"] {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let data = tempfile::tempdir().unwrap();
        let bundle = plugins::materialize(data.path()).unwrap();
        let path = bundle.directories()[1].join("hooks/gate.tsx");
        match mutation {
            "missing" => std::fs::remove_file(&path).unwrap(),
            "corrupt" => std::fs::write(&path, "corrupt").unwrap(),
            "extra" => std::fs::write(bundle.directories()[0].join("extra.ts"), "extra").unwrap(),
            "symlink" => {
                std::fs::remove_file(&path).unwrap();
                symlink("/dev/null", &path).unwrap();
            }
            "mode" => {
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap()
            }
            _ => unreachable!(),
        }
        let error = bundle.validate().unwrap_err();
        assert!(
            matches!(error, plugins::Error::Integrity(_)),
            "{mutation}: {error}"
        );
        assert!(
            error
                .to_string()
                .contains("reinstall roundup's pinned bundle")
        );
    }
}

#[test]
fn q11_delivery_keeps_clean_and_preexisting_project_bytes_unchanged() {
    for preexisting in [false, true] {
        let project = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        if preexisting {
            std::fs::create_dir(project.path().join(".claude")).unwrap();
            for (path, bytes) in [
                ("CLAUDE.md", &b"keep\0instruction\n"[..]),
                (".claude/settings.json", &b"{\"hooks\":{}}\n"[..]),
                (".claude/user.bin", &b"\xff\0user"[..]),
            ] {
                std::fs::write(project.path().join(path), bytes).unwrap();
            }
        }
        let before = snapshot(project.path());
        let bundle = plugins::materialize(data.path()).unwrap();
        let second = plugins::materialize(data.path()).unwrap();
        assert_ne!(bundle.directories(), second.directories());
        assert_eq!(snapshot(project.path()), before);
        let root = bundle.directories()[0].parent().unwrap().to_owned();
        assert!(root.starts_with(data.path()));
        drop(bundle);
        assert!(!root.exists());
        second.validate().unwrap();
        drop(second);
        assert_eq!(snapshot(project.path()), before);
        assert_eq!(std::fs::read_dir(data.path()).unwrap().count(), 0);
    }
}

fn snapshot(root: &std::path::Path) -> std::collections::BTreeMap<std::path::PathBuf, Vec<u8>> {
    fn visit(
        root: &std::path::Path,
        dir: &std::path::Path,
        result: &mut std::collections::BTreeMap<std::path::PathBuf, Vec<u8>>,
    ) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                result.insert(path.strip_prefix(root).unwrap().to_owned(), Vec::new());
                visit(root, &path, result);
            } else {
                result.insert(
                    path.strip_prefix(root).unwrap().to_owned(),
                    std::fs::read(&path).unwrap(),
                );
            }
        }
    }
    let mut result = std::collections::BTreeMap::new();
    visit(root, root, &mut result);
    result
}

#[tokio::test]
async fn q11_an_unsupported_runtime_fails_actionably_even_on_zero_exit() {
    use std::os::unix::fs::PermissionsExt;
    for response in ["exit 1", "echo validation-passed; exit 0"] {
        let data = tempfile::tempdir().unwrap();
        let bundle = plugins::materialize(data.path()).unwrap();
        let runtime = data.path().join("unsupported-claude");
        std::fs::write(&runtime, format!("#!/bin/sh\n{response}\n")).unwrap();
        std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o755)).unwrap();
        let error = match bundle.runtime(&runtime).await {
            Ok(_) => panic!("silently accepted a runtime without hook loading"),
            Err(error) => error,
        };
        assert!(matches!(error, plugins::Error::UnsupportedRuntime(_)));
        assert!(
            error
                .to_string()
                .contains("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1")
        );
        assert!(error.to_string().contains("claude-code.update"));
        bundle.validate().unwrap();
    }
}

#[test]
fn q11_cold_materialization_produces_a_valid_bundle() {
    let data = tempfile::tempdir().unwrap();
    let bundle = plugins::materialize(data.path()).unwrap();
    bundle.validate().unwrap();
}
