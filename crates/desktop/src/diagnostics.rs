//! Native shell diagnostics: content stays with its owner, not in the log.

#[cfg(test)]
mod tests {
    use tauri::{Manager, test::{mock_builder, mock_context, noop_assets}};

    #[test]
    fn u3787f_logs_report_causes_without_private_content() {
        let dir = tempfile::tempdir().unwrap();
        let mut context = mock_context(noop_assets());
        context.config_mut().app.app_directories_override = Some(
            tauri::utils::config::AppDirectoriesOverride::Root(dir.path().to_owned()),
        );
        let app = mock_builder().plugin(super::plugin()).build(context).unwrap();
        let private = "credential-SENTINEL prompt-SENTINEL draft-SENTINEL terminal-SENTINEL";
        let data = dir.path().join(private);
        std::fs::create_dir(&data).unwrap();
        std::fs::write(data.join("projects.json"), format!(r#"{{"names":{{"{private}":12}},"usage":{{"input_tokens":987654,"cost_usd":123456}}}}"#)).unwrap();
        let store = crate::store::Store::new(Some(data.clone()));
        assert!(store.open_paths().is_empty());
        std::fs::remove_file(data.join("projects.json")).unwrap();
        std::fs::remove_dir(&data).unwrap();
        std::fs::write(&data, private).unwrap();
        store.set_name("original", Some(private.into()), None, "original").unwrap();
        assert_eq!(store.name("original").as_deref(), Some(private));
        let failed = mock_builder()
            .plugin(tauri::plugin::Builder::new("fixture")
                .setup(move |_, _| Err(private.into())).build())
            .build(mock_context(noop_assets()));
        assert!(super::startup(failed).is_err());
        log::error!(target: "third_party", "{private} input_tokens=987654 cost_usd=123456");
        log::logger().flush();
        let logs = std::fs::read_dir(app.path().app_log_dir().unwrap()).unwrap()
            .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
            .collect::<String>();
        assert!(logs.contains("restore Project store") && logs.contains("Data"), "{logs}");
        assert!(logs.contains("save Project store") && logs.contains("NotADirectory"), "{logs}");
        assert!(logs.contains("start shell") && logs.contains("plugin initialization"), "{logs}");
        for secret in ["credential-SENTINEL", "prompt-SENTINEL", "draft-SENTINEL", "terminal-SENTINEL", "input_tokens", "cost_usd", "987654", "123456"] {
            assert!(!logs.contains(secret), "leaked {secret}: {logs}");
        }
    }
}
