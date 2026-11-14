//! MC36: a Project's Machine is recorded by `project.setMachine` and read back by `project.get`, on a
//! real Daemon whose Terminals run the test-support herdr-core, which lists the Machine.
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]
use super::*;
use crate::tests::ask;
use std::os::unix::fs::PermissionsExt;

#[tokio::test]
async fn mc36_real_daemon_open_on_machine_records_it() {
    let dir = tempfile::tempdir().unwrap();
    let exe = std::env::current_exe().unwrap();
    let core = exe
        .ancestors()
        .skip(1)
        .take(2)
        .map(|d| d.join("herdr-core-test"))
        .find(|c| c.is_file())
        .expect("herdr-core-test is built beside the test binary");
    let wrapper = dir.path().join("core");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nROUNDUP_TEST_MACHINES=m exec {} \"$@\"\n",
            core.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = dir.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let data = project.join(".roundup");
    let fake = dir.path().join("fake-claude");
    std::fs::write(&fake, "#!/bin/sh\nwhile read line; do :; done\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = dir.path().join("rup");
    std::fs::write(&rup, "").unwrap();
    let launcher = agents::claude_code::Launcher::new(
        fake.to_str().unwrap(),
        dir.path().join("claude.json"),
        rup,
        None,
    );
    let daemon = Daemon::open_stores_idle(&project, &data, |_| {
        let bus = Bus::new();
        let terminals = Arc::new(
            terminal::Terminals::open(&data, bus.clone())
                .unwrap()
                .with_core(&wrapper),
        );
        agents::Agents::open_in(
            &project,
            &data,
            bus,
            terminals,
            launcher,
            agents::worktree::Git::from_env(),
            agents::Quiet::default().shared(),
        )
        .unwrap()
    })
    .unwrap();
    let set = ask(
        &daemon,
        r#"{"jsonrpc":"2.0","id":1,"method":"project.setMachine","params":{"machine":"m"}}"#,
    )
    .await;
    assert!(set.get("error").is_none(), "{set}");
    let get = ask(
        &daemon,
        r#"{"jsonrpc":"2.0","id":2,"method":"project.get"}"#,
    )
    .await;
    assert_eq!(get["result"]["machine"], "m", "{get}");
}
