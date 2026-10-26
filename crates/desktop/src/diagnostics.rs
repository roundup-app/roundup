//! Native shell diagnostics: content stays with its owner, not in the log.

use tauri::{Runtime, plugin::TauriPlugin};

pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Warn)
        .filter(|metadata| metadata.target() == "roundup::shell")
        .targets([tauri_plugin_log::Target::new(
            tauri_plugin_log::TargetKind::LogDir {
                file_name: Some("shell".into()),
            },
        )])
        .max_file_size(1_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .build()
}

/// Preserve the original error for the caller; only its typed cause reaches the sink.
pub(crate) fn startup<T>(result: tauri::Result<T>) -> tauri::Result<T> {
    result.inspect_err(|error| failure("start shell", error))
}

pub(crate) fn failure(operation: &'static str, error: &tauri::Error) {
    match error {
        tauri::Error::Io(error) | tauri::Error::CurrentDir(error) => {
            log::warn!(target: "roundup::shell", "{operation}: IO {:?}", error.kind());
        }
        tauri::Error::Json(error) => {
            log::warn!(target: "roundup::shell", "{operation}: JSON {:?} at {}:{}", error.classify(), error.line(), error.column());
        }
        error => {
            let cause = match error {
                tauri::Error::PluginInitialization(_, _) => "plugin initialization failed",
                tauri::Error::Setup(_) => "application setup failed",
                tauri::Error::Runtime(_) => "native runtime failed",
                tauri::Error::Menu(_) => "native menu failed",
                tauri::Error::WindowNotFound => "window not found",
                tauri::Error::WebviewNotFound => "webview not found",
                tauri::Error::UnknownPath => "system folder unavailable",
                tauri::Error::InvalidAppDirectoriesOverride(_, _) => "invalid application folder",
                _ => "shell operation failed (unclassified Tauri error)",
            };
            log::warn!(target: "roundup::shell", "{operation}: {cause}");
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
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
        assert!(store.open_paths().is_empty());
        std::fs::remove_file(data.join("projects.json")).unwrap();
        std::fs::create_dir(data.join("projects.json.tmp")).unwrap();
        store
            .set_name("original", Some(private.into()), None, "original")
            .unwrap();
        assert_eq!(store.name("original").as_deref(), Some(private));
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let config = crate::Config::locate(
            Some(data.join("missing-rupd").into_os_string()),
            std::path::Path::new("/unused/roundup"),
            dir.path(),
            std::process::id(),
        )
        .unwrap();
        let state = crate::AppState::new(config);
        assert!(
            tauri::async_runtime::block_on(state.open_project(app.handle(), &project)).is_err()
        );
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
}
