//! U3787f: observe the production sink with private-content fixtures.
use tauri::{
    Manager,
    test::{mock_builder, mock_context, noop_assets},
};

pub(crate) fn u3787f_logs_report_causes_without_private_content() {
    let dir = tempfile::tempdir().unwrap();
    let mut context = mock_context(noop_assets());
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.path().to_owned()),
    );
    let app = mock_builder()
        .plugin(super::plugin())
        .build(context)
        .unwrap();
    let private = "credential-SENTINEL prompt-SENTINEL draft-SENTINEL terminal-SENTINEL";
    let data = dir.path().join(private);
    std::fs::create_dir(&data).unwrap();
    std::fs::write(data.join("projects.json"), format!(r#"{{"open":"{private}","names":{{}},"usage":{{"input_tokens":987654,"cost_usd":123456}}}}"#)).unwrap();
    let store = crate::store::Store::new(Some(data.clone()));
    assert!(store.open_paths().is_err());
    std::fs::remove_file(data.join("projects.json")).unwrap();
    std::fs::create_dir(data.join("projects.json.tmp")).unwrap();
    let store = crate::store::Store::new(Some(data.clone()));
    store
        .set_name("original", Some(private.into()), None, "original")
        .unwrap();
    assert_eq!(store.name("original").unwrap().as_deref(), Some(private));
    crate::daemon::tests::refuse_missing_executable(app.handle(), dir.path(), &data);
    let window_file = app
        .path()
        .app_config_dir()
        .unwrap()
        .join(".window-state.json");
    std::fs::create_dir_all(window_file.parent().unwrap()).unwrap();
    let invalid_window = format!(r#"{{"{private}":{{"width":"{private}"}}}}"#);
    std::fs::write(&window_file, &invalid_window).unwrap();
    app.handle()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&window_file).unwrap(),
        invalid_window
    );
    let failed = mock_builder()
        .plugin(
            tauri::plugin::Builder::<tauri::test::MockRuntime, ()>::new("fixture")
                .setup(move |_, _| Err(private.into()))
                .build(),
        )
        .build(mock_context(noop_assets()));
    assert!(super::startup(failed).is_err());
    log::error!(target: "third_party", "{private} input_tokens=987654 cost_usd=123456");
    log::logger().flush();
    let logs = std::fs::read_dir(app.path().app_log_dir().unwrap())
        .unwrap()
        .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
        .collect::<String>();
    assert!(
        logs.contains("restore Project store") && logs.contains("Data"),
        "{logs}"
    );
    assert!(
        logs.contains("save Project store") && logs.contains("IsADirectory"),
        "{logs}"
    );
    assert!(
        logs.contains("start shell") && logs.contains("plugin initialization"),
        "{logs}"
    );
    assert!(logs.contains("start Project Daemon: IO NotFound"), "{logs}");
    assert!(
        logs.contains("restore window state; original file retained: JSON Data"),
        "{logs}"
    );
    for secret in [
        "credential-SENTINEL",
        "prompt-SENTINEL",
        "draft-SENTINEL",
        "terminal-SENTINEL",
        "input_tokens",
        "cost_usd",
        "987654",
        "123456",
    ] {
        assert!(!logs.contains(secret), "leaked {secret}: {logs}");
    }
}
