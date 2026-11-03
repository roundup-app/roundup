use super::{Command, Shim, rail, start, tool_names};

#[tokio::test]
async fn u5740b_public_commands_are_absent() {
    let help = Command::new(env!("CARGO_BIN_EXE_rup"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(help.status.success());
    assert!(!String::from_utf8(help.stdout).unwrap().contains("reaction"));
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    for id in [&rail.m, &rail.a] {
        let mut shim = Shim::start(&project, id).await;
        assert!(
            tool_names(&mut shim)
                .await
                .iter()
                .all(|name| !name.starts_with("reaction_"))
        );
    }
}
