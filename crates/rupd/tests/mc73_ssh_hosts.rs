//! MC73: the Add dialog's ssh-config list.

#[test]
fn mc73_ssh_hosts_lists_concrete_hosts_without_patterns_or_added_machines() {
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    std::fs::write(
        &config,
        "Host *\n  ServerAliveInterval 30\n\nHost build-box gpu-?\n  User me\n\nHost added\n  HostName a.example\n\nHost !skip\n  User x\n\nHost nas\n  HostName n.example\n",
    )
    .unwrap();

    let hosts = rupd::ssh_hosts(&config, &["added".to_owned()]);

    assert_eq!(hosts, ["build-box", "nas"]);
    assert!(rupd::ssh_hosts(&dir.path().join("missing"), &[]).is_empty());
}
