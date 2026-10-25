//! R3696c: an unused Agents module needs no Terminal-owner worker at startup.
#[cfg(target_os = "linux")]
#[test]
fn r3696c_opening_agents_starts_no_owner_worker() {
    let threads = || std::fs::read_dir("/proc/self/task").unwrap().count();
    let dir = tempfile::tempdir().unwrap();
    let bus = rpc::Bus::new();
    let terminals =
        std::sync::Arc::new(terminal::Terminals::open(dir.path(), bus.clone()).unwrap());
    let launcher = agents::claude_code::Launcher::new(
        "false",
        dir.path().join("config"),
        dir.path().join("rup"),
        None,
    );
    let before = threads();
    let agents = agents::Agents::open_with(
        dir.path(),
        bus,
        terminals,
        launcher,
        agents::worktree::Git::from_env(),
    )
    .unwrap();
    let after = threads();
    drop(agents);
    assert_eq!(
        after, before,
        "opening an unused Agents module started a worker"
    );
}
