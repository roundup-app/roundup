//! Global preferences remain available before opening any Project.
use desktop::{AppState, Config};
use serde_json::json;

#[tokio::test]
async fn u4688a_global_naming_without_a_project_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::locate(None, &dir.path().join("roundup"), dir.path(), 1).unwrap();
    config.data_dir = Some(dir.path().join("data"));
    let settings = json!({"automaticRenaming":false,"namingGuide":"役割\n動作-対象"});
    let app = AppState::new(config.clone());
    app.rpc("", "daemon.setNaming", settings.clone())
        .await
        .unwrap();
    drop(app);
    let reopened = AppState::new(config);
    assert_eq!(
        reopened
            .rpc("", "daemon.getNaming", serde_json::Value::Null)
            .await
            .unwrap(),
        settings
    );
    assert!(
        reopened
            .rpc(
                "",
                "daemon.setNaming",
                json!({"automaticRenaming":true,"namingGuide":" \n "})
            )
            .await
            .is_err()
    );
    assert_eq!(
        reopened
            .rpc("", "daemon.getNaming", serde_json::Value::Null)
            .await
            .unwrap(),
        settings
    );
}
