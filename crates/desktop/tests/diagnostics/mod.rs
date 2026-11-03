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
    let private = "credential-SENTINEL prompt-SENTINEL draft-SENTINEL terminal-SENTINEL project-path-SENTINEL";
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

#[test]
fn s5810d_foreign_startup_errors_are_redacted() {
    const CHILD: &str = "S5810D_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "diagnostics::tests::s5810d_foreign_startup_errors_are_redacted",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(output.status.success());
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(
            stderr.contains("start shell: plugin initialization failed"),
            "{stderr}"
        );
        for secret in [
            "credential-SENTINEL",
            "draft-SENTINEL",
            "terminal-SENTINEL",
            "project-path-SENTINEL",
            "input_tokens",
            "cost_usd",
        ] {
            assert!(!stderr.contains(secret), "{stderr}");
        }
        return;
    }
    u3787f_logs_report_causes_without_private_content();
}

fn logs(app: &tauri::App<tauri::test::MockRuntime>) -> String {
    log::logger().flush();
    std::fs::read_dir(app.path().app_log_dir().unwrap())
        .unwrap()
        .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
        .collect()
}

fn log_app(dir: &std::path::Path) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.to_owned()),
    );
    mock_builder()
        .plugin(super::plugin())
        .build(context)
        .unwrap()
}

fn startup_config(dir: &std::path::Path) -> crate::Config {
    let daemon = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("rupd");
    assert!(daemon.is_file(), "build rupd before the startup observer");
    let mut config = crate::Config::locate(
        Some(daemon.into_os_string()),
        &dir.join("roundup"),
        dir,
        std::process::id(),
    )
    .unwrap();
    config.data_dir = Some(dir.join("data"));
    config
}

fn refuse(project: &std::path::Path) {
    std::fs::create_dir(project.join(".roundup")).unwrap();
    std::fs::write(project.join(".roundup/retired.db"), b"retired").unwrap();
}

#[test]
fn s5810a_startup_refusal_reaches_user_and_log() {
    let root = tempfile::tempdir().unwrap();
    let sink = log_app(root.path());
    for custom in [false, true] {
        let dir = tempfile::Builder::new()
            .prefix("parent-SENTINEL")
            .tempdir()
            .unwrap();
        let project = dir.path().join("folder-name");
        std::fs::create_dir(&project).unwrap();
        refuse(&project);
        let config = startup_config(dir.path());
        let data = config.data_dir.as_ref().unwrap();
        std::fs::create_dir(data).unwrap();
        let names = if custom {
            serde_json::json!({project.display().to_string(): "Custom name"})
        } else {
            serde_json::json!({})
        };
        std::fs::write(
            data.join("projects.json"),
            serde_json::json!({"open": [], "recent": [], "names": names}).to_string(),
        )
        .unwrap();
        let reports = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = reports.clone();
        let app = crate::build_reporting(
            mock_builder(),
            config,
            Some(project),
            move |_, message, fatal| {
                recorded.lock().unwrap().push((message, fatal));
            },
        )
        .build(mock_context(noop_assets()))
        .unwrap();
        let reports = reports.lock().unwrap();
        assert_eq!(reports.len(), 1);
        let (message, fatal) = &reports[0];
        let name = if custom { "Custom name" } else { "folder-name" };
        assert!(
            message.starts_with(&format!("open startup Project: {name}:")),
            "{message}"
        );
        assert!(
            message.contains("Local data is incompatible with this build."),
            "{message}"
        );
        assert!(*fatal);
        assert!(logs(&sink).contains(message), "{}", logs(&sink));
        // The absolute path belongs only to rupd's recovery guidance, never the identifier.
        assert!(
            !message
                .split("Local data")
                .next()
                .unwrap()
                .contains("parent-SENTINEL")
        );
        app.state::<crate::AppState>().close();
    }
}

#[test]
fn s5810b_restore_reports_each_refusal_without_losing_projects() {
    let root = tempfile::tempdir().unwrap();
    let sink = log_app(root.path());
    for all in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let config = startup_config(dir.path());
        let paths: Vec<_> = ["first", "middle", "last"]
            .iter()
            .map(|name| {
                let path = dir.path().join(name);
                std::fs::create_dir(&path).unwrap();
                if all || *name == "middle" {
                    refuse(&path);
                }
                path
            })
            .collect();
        let data = config.data_dir.as_ref().unwrap();
        std::fs::create_dir(data).unwrap();
        std::fs::write(
            data.join("projects.json"),
            serde_json::json!({"open": paths, "recent": [], "names": {}}).to_string(),
        )
        .unwrap();
        let reports = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = reports.clone();
        let app = crate::build_reporting(mock_builder(), config, None, move |_, message, fatal| {
            assert!(!fatal, "restore must continue");
            recorded.lock().unwrap().push(message);
        })
        .build(mock_context(noop_assets()))
        .unwrap();
        let _webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let reports = reports.lock().unwrap();
        assert_eq!(reports.len(), if all { 3 } else { 1 });
        let state = app.state::<crate::AppState>();
        let listed = state.projects().unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|project| &project.path)
                .collect::<Vec<_>>(),
            paths
                .iter()
                .map(|path| path.to_str().unwrap())
                .collect::<Vec<_>>()
        );
        for project in listed {
            let failed = all || project.name == "middle";
            assert_eq!(project.running, !failed);
            if failed {
                let message = reports
                    .iter()
                    .find(|message| {
                        message.starts_with(&format!("restore Project: {}:", project.name))
                    })
                    .unwrap();
                assert!(message.contains("Local data is incompatible with this build."));
                assert!(logs(&sink).contains(message));
            }
        }
        state.close();
    }
}

#[test]
fn s5810c_fatal_startup_stages_report_before_exit() {
    const STAGE: &str = "S5810C_STAGE";
    let Ok(stage) = std::env::var(STAGE) else {
        for (stage, expected) in [
            ("config", "configure App: Daemon socket path exceeds"),
            ("context", "create App context: IO NotFound"),
            ("argument", "resolve startup Project argument: IO NotFound"),
            ("io", "start shell: IO PermissionDenied"),
            ("json", "start shell: JSON"),
            ("setup", "start shell: application setup failed"),
            (
                "preferences",
                "refuse Project preferences: Local Project preferences",
            ),
            ("missing", "open startup Project: Project: cannot start "),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let mut child = std::process::Command::new(std::env::current_exe().unwrap());
            child
                .args([
                    "--exact",
                    "diagnostics::tests::s5810c_fatal_startup_stages_report_before_exit",
                    "--nocapture",
                ])
                .env(STAGE, stage)
                .current_dir(dir.path())
                .env_remove("ROUNDUP_DATA_DIR");
            if stage == "config" {
                child.env("TMPDIR", dir.path().join("x".repeat(120)));
            }
            if stage == "context" {
                child.env("ROUNDUP_DATA_DIR", "relative-profile");
            }
            let output = child.output().unwrap();
            let stderr = String::from_utf8(output.stderr).unwrap();
            assert!(
                output.status.success(),
                "{stage}: {stderr}\n{}",
                String::from_utf8_lossy(&output.stdout)
            );
            assert!(stderr.contains(expected), "{stage}: {stderr}");
            assert!(!stderr.contains("private-SENTINEL"), "{stderr}");
        }
        return;
    };
    if matches!(stage.as_str(), "config" | "context" | "argument") {
        if stage != "config" {
            std::fs::remove_dir(std::env::current_dir().unwrap()).unwrap();
        }
        assert!(crate::run().is_err());
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let sink = log_app(root.path());
    if matches!(stage.as_str(), "preferences" | "missing") {
        let mut config = crate::Config::locate(
            Some(root.path().join("missing-rupd").into_os_string()),
            &root.path().join("roundup"),
            root.path(),
            1,
        )
        .unwrap();
        let data = root.path().join("data");
        std::fs::create_dir(&data).unwrap();
        config.data_dir = Some(data.clone());
        if stage == "preferences" {
            std::fs::write(data.join("projects.json"), br#"{"private-SENTINEL":true}"#).unwrap();
        }
        let project = root.path().join("Project");
        std::fs::create_dir(&project).unwrap();
        let feedback = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = feedback.clone();
        let app = crate::build_reporting(
            mock_builder(),
            config,
            Some(project),
            move |_, message, fatal| {
                assert!(fatal);
                recorded.lock().unwrap().push(message);
            },
        )
        .build(mock_context(noop_assets()))
        .unwrap();
        let feedback = feedback.lock().unwrap();
        assert_eq!(feedback.len(), 1);
        assert!(logs(&sink).contains(&feedback[0]));
        assert!(!logs(&sink).contains("private-SENTINEL"));
        app.state::<crate::AppState>().close();
    } else {
        let error = match stage.as_str() {
            "io" => tauri::Error::Io(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "private-SENTINEL",
            )),
            "json" => tauri::Error::Json(
                serde_json::from_str::<Vec<String>>(r#"{"private-SENTINEL":true}"#).unwrap_err(),
            ),
            "setup" => {
                let error: Box<dyn std::error::Error> =
                    Box::new(std::io::Error::other("private-SENTINEL"));
                tauri::Error::Setup(error.into())
            }
            _ => unreachable!(),
        };
        assert!(super::startup::<()>(Err(error)).is_err());
        assert!(logs(&sink).contains("start shell:"));
        assert!(!logs(&sink).contains("private-SENTINEL"));
    }
}
