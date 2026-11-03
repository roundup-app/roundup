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
        "project-path-SENTINEL",
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

fn child(name: &str) -> bool {
    if std::env::var_os("S5810_CHILD").is_some() {
        return false;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            &format!("diagnostics::tests::{name}"),
            "--nocapture",
        ])
        .env("S5810_CHILD", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("Local data is incompatible with this build.")
    );
    true
}

fn sink(dir: &std::path::Path) -> tauri::App<tauri::test::MockRuntime> {
    let mut context = mock_context(noop_assets());
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.to_owned()),
    );
    mock_builder()
        .plugin(super::plugin())
        .build(context)
        .unwrap()
}

fn logs(app: &tauri::App<tauri::test::MockRuntime>) -> String {
    log::logger().flush();
    logs_at(&app.path().app_log_dir().unwrap())
}

fn logs_at(dir: &std::path::Path) -> String {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
        .collect()
}

fn refuse(project: &std::path::Path) {
    std::fs::create_dir_all(project.join(".roundup/agents")).unwrap();
}

#[test]
fn s5810a_startup_refusal_reaches_user_and_log() {
    if child("s5810a_startup_refusal_reaches_user_and_log") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let logger = sink(&dir.path().join("logs"));
    for custom in [true, false] {
        let root = dir.path().join(if custom { "custom" } else { "folder" });
        let project = root.join("parent-path-SENTINEL/my-project");
        refuse(&project);
        let config = crate::config::tests::startup_config(&root, false);
        std::fs::create_dir_all(config.data_dir.as_ref().unwrap()).unwrap();
        let names = if custom {
            serde_json::json!({project.display().to_string(): "Chosen name"})
        } else {
            serde_json::json!({})
        };
        std::fs::write(
            config.data_dir.as_ref().unwrap().join("projects.json"),
            serde_json::json!({"open":[], "recent":[], "names":names}).to_string(),
        )
        .unwrap();
        let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let copy = observed.clone();
        let mut app = crate::build_with_feedback(
            mock_builder(),
            config,
            Some(project),
            move |_, message, code| {
                // This is the native-message dispatch boundary, before dismissal may exit.
                copy.lock().unwrap().push((message, code));
            },
        )
        .build(mock_context(noop_assets()))
        .unwrap();
        #[allow(deprecated)]
        app.run_iteration(|_, _| {});
        let observed = observed.lock().unwrap();
        assert_eq!(observed.len(), 1);
        assert_eq!(observed[0].1, Some(1));
        let name = if custom { "Chosen name" } else { "my-project" };
        let prefix = format!("open startup Project \"{name}\":");
        assert!(observed[0].0.starts_with(&prefix), "{:?}", *observed);
        assert!(
            observed[0]
                .0
                .contains("Local data is incompatible with this build.")
        );
        // The recovery instructions may name the data folder; the identifier may not.
        assert!(
            !observed[0]
                .0
                .split(':')
                .next()
                .unwrap()
                .contains("parent-path-SENTINEL")
        );
        assert!(logs(&logger).contains(&observed[0].0));
    }
}

#[test]
fn s5810b_restore_reports_each_refusal_without_losing_projects() {
    if child("s5810b_restore_reports_each_refusal_without_losing_projects") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let logger = sink(&dir.path().join("logs"));
    for all in [false, true] {
        let root = dir.path().join(if all { "all" } else { "mixed" });
        std::fs::create_dir_all(&root).unwrap();
        let config = crate::config::tests::startup_config(&root, false);
        let paths: Vec<_> = ["first", "middle", "last"]
            .map(|name| root.join(name))
            .into();
        for (index, path) in paths.iter().enumerate() {
            std::fs::create_dir(path).unwrap();
            if all || index == 1 {
                refuse(path);
            }
        }
        std::fs::create_dir_all(config.data_dir.as_ref().unwrap()).unwrap();
        std::fs::write(config.data_dir.as_ref().unwrap().join("projects.json"), serde_json::json!({"open":paths, "recent":[], "names":{paths[1].display().to_string(): "Middle name"}}).to_string()).unwrap();
        let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let copy = observed.clone();
        let mut app =
            crate::build_with_feedback(mock_builder(), config, None, move |_, message, code| {
                assert_eq!(code, None, "restore must keep launching");
                copy.lock().unwrap().push(message);
            })
            .build(mock_context(noop_assets()))
            .unwrap();
        #[allow(deprecated)]
        app.run_iteration(|_, _| {});
        let _webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .unwrap();
        let listed = app.state::<crate::AppState>().projects().unwrap();
        assert_eq!(
            listed.iter().map(|p| p.path.clone()).collect::<Vec<_>>(),
            paths
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
        );
        for (index, project) in listed.iter().enumerate() {
            assert_eq!(project.running, !all && index != 1);
        }
        // Dispatch is native, so feedback does not depend on a webview listener existing.
        let observed = observed.lock().unwrap();
        assert_eq!(observed.len(), if all { 3 } else { 1 });
        for (message, name) in observed.iter().zip(if all {
            vec!["first", "Middle name", "last"]
        } else {
            vec!["Middle name"]
        }) {
            assert!(
                message.starts_with(&format!("restore Project \"{name}\":")),
                "{message}"
            );
            assert!(message.contains("Local data is incompatible with this build."));
            assert!(logs(&logger).contains(message));
        }
        app.state::<crate::AppState>().close();
    }
}

#[test]
fn s5810c_fatal_startup_stages_report_before_exit() {
    const NAME: &str = "diagnostics::tests::s5810c_fatal_startup_stages_report_before_exit";
    if let Ok(stage) = std::env::var("S5810_STAGE") {
        if stage == "config" || stage == "idle" {
            assert!(crate::run().is_err());
        } else if stage == "context" || stage == "argument" {
            let dir = tempfile::tempdir().unwrap();
            std::env::set_current_dir(dir.path()).unwrap();
            dir.close().unwrap();
            assert!(crate::run().is_err());
        } else {
            let dir = tempfile::tempdir().unwrap();
            let logger = sink(&dir.path().join("logs"));
            if stage == "preferences" || stage == "missing-daemon" {
                let config =
                    crate::config::tests::startup_config(dir.path(), stage == "missing-daemon");
                let project = dir.path().join("project");
                std::fs::create_dir(&project).unwrap();
                if stage == "preferences" {
                    std::fs::create_dir_all(config.data_dir.as_ref().unwrap()).unwrap();
                    std::fs::write(
                        config.data_dir.as_ref().unwrap().join("projects.json"),
                        r#"{"private-preference-SENTINEL":true}"#,
                    )
                    .unwrap();
                }
                let feedback = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
                let copy = feedback.clone();
                let log_dir = logger.path().app_log_dir().unwrap();
                let mut app = crate::build_with_feedback(
                    mock_builder(),
                    config,
                    Some(project),
                    move |_, message, code| {
                        assert_eq!(code, Some(1));
                        assert!(
                            logs_at(&log_dir).contains(&message),
                            "report must flush before exit dispatch"
                        );
                        copy.lock().unwrap().push(message);
                    },
                )
                .build(mock_context(noop_assets()))
                .unwrap();
                #[allow(deprecated)]
                app.run_iteration(|_, _| {});
                assert_eq!(feedback.lock().unwrap().len(), 1);
                assert!(logs(&logger).contains(if stage == "preferences" {
                    "refuse Project preferences"
                } else {
                    "cannot start"
                }));
            } else if stage == "setup" || stage == "window" {
                let config = crate::config::tests::startup_config(dir.path(), false);
                let builder =
                    crate::build_with_feedback(mock_builder(), config, None, |_, _, _| {
                        panic!("a fatal Tauri failure must not reach Project feedback")
                    });
                let mut context = mock_context(noop_assets());
                let builder = if stage == "setup" {
                    builder.setup(|_| Err("foreign-private-SENTINEL".into()))
                } else {
                    context
                        .config_mut()
                        .app
                        .windows
                        .push(tauri::utils::config::WindowConfig {
                            label: "invalid foreign-private-SENTINEL".into(),
                            ..Default::default()
                        });
                    builder
                };
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut app = super::startup(builder.build(context)).unwrap();
                    #[allow(deprecated)]
                    app.run_iteration(|_, _| {});
                }));
                assert!(outcome.is_err(), "the fatal runtime failure must propagate");
                assert!(
                    logs(&logger)
                        .contains("run shell: native runtime or application setup panicked")
                );
            } else {
                let error = match stage.as_str() {
                    "io" => {
                        tauri::Error::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
                    }
                    "json" => {
                        tauri::Error::Json(serde_json::from_str::<u32>("\"private\"").unwrap_err())
                    }
                    _ => panic!("unknown stage"),
                };
                assert!(super::startup::<()>(Err(error)).is_err());
                assert!(logs(&logger).contains("start shell:"));
            }
        }
        eprintln!("observer: returned after reporting");
        return;
    }
    #[cfg(not(feature = "idle-perf"))]
    let prelog = [
        ("config", "configure App: the Daemon socket path"),
        ("context", "resolve App context: IO NotFound"),
        ("argument", "resolve startup Project: IO NotFound"),
    ];
    #[cfg(feature = "idle-perf")]
    let prelog = [("idle", "check idle performance profile: R24 requires")];
    for (stage, expected) in prelog.into_iter().chain([
        (
            "preferences",
            "refuse Project preferences: Local Project preferences",
        ),
        ("missing-daemon", "cannot start"),
        ("io", "start shell: IO PermissionDenied"),
        ("json", "start shell: JSON Data"),
        (
            "setup",
            "run shell: native runtime or application setup panicked",
        ),
        (
            "window",
            "run shell: native runtime or application setup panicked",
        ),
    ]) {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", NAME, "--nocapture"])
            .env("S5810_STAGE", stage)
            .env_remove("ROUNDUP_DATA_DIR")
            .env_remove("ROUNDUP_ALLOW_WINDOW")
            .env_remove("ROUNDUP_IDLE_EVIDENCE_DIR");
        if stage == "config" {
            command.env("TMPDIR", format!("/{}", "d".repeat(120)));
        }
        if stage == "context" {
            command.env("ROUNDUP_DATA_DIR", "relative");
        }
        let output = command.output().unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "{stage}: {stderr}");
        assert!(!stderr.contains("private-preference-SENTINEL"), "{stderr}");
        assert!(!stderr.contains("foreign-private-SENTINEL"), "{stderr}");
        let report = stderr
            .find(expected)
            .unwrap_or_else(|| panic!("{stage}: {stderr}"));
        assert!(report < stderr.find("observer: returned after reporting").unwrap());
    }
}
