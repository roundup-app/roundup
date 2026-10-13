use agents::claude_code::plugins;

#[test]
fn q11_materializes_complete_pinned_plugins_offline() {
    let data = tempfile::tempdir().unwrap();
    let bundle = plugins::materialize(data.path()).unwrap();
    for (path, name, version) in bundle.directories().iter().zip([
        ("hope", "13.1.0"), ("hunch", "0.9.4"), ("hold", "0.0.9"),
    ]).map(|(path, (name, version))| (path, name, version)) {
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(path.join(".claude-plugin/plugin.json")).unwrap(),
        ).unwrap();
        assert_eq!(manifest["name"], name);
        assert_eq!(manifest["version"], version);
    }
    assert!(bundle.directories()[0].join("hooks/judge.sh").is_file());
    assert!(bundle.directories()[1].join("hooks/memory.tsx").is_file());
}
