use desktop::{AppState, Config, build};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tauri::ipc::InvokeBody;
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[test]
fn s6_facts_work_without_a_project_and_use_only_configured_fixtures() {
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("claude");
    std::fs::write(&binary, "#!/bin/sh\nprintf '9.8.7 (Claude Code)\\n'\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut config = Config::locate(None, Path::new("/unused/roundup"), dir.path(), 1).unwrap();
    config.data_dir = Some(dir.path().join("data"));
    config.claude_bin = Some(binary.clone().into_os_string());
    let app = build(mock_builder(), config, None, |_, _| panic!("no launch"))
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default())
        .build()
        .unwrap();
    let invoke = |cmd: &str| -> Value {
        get_ipc_response(
            &window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::Json(json!({})),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .unwrap()
        .deserialize()
        .unwrap()
    };
    assert_eq!(invoke("recent_projects"), json!([]));
    assert_eq!(
        invoke("claude_binary"),
        json!({"path": binary, "version": "9.8.7 (Claude Code)"})
    );
    assert!(app.state::<AppState>().projects().is_empty());
}

#[test]
fn s6_launch_and_successful_opens_record_recents_even_when_persistence_fails() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let socket = dir.path().join("real.sock");
    let daemon = rupd::Daemon::open(&dir.path().join("daemon-data")).unwrap();
    tauri::async_runtime::block_on(async {
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        tauri::async_runtime::spawn(rupd::serve(listener, std::sync::Arc::new(daemon)));
    });
    let script = dir.path().join("rupd");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nln -s '{}' \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\nexec cat\n",
            socket.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    for launch in [false, true] {
        let mut config = Config::locate(
            Some(script.clone().into_os_string()),
            Path::new("/unused/roundup"),
            dir.path(),
            if launch { 2 } else { 1 },
        )
        .unwrap();
        let data = dir
            .path()
            .join(if launch { "launch-data" } else { "unwritable" });
        if !launch {
            std::fs::write(&data, "not a directory").unwrap();
        }
        config.data_dir = Some(data.clone());
        let mut app = build(
            mock_builder(),
            config.clone(),
            launch.then(|| project.clone()),
            |_, _| panic!("launch must succeed"),
        )
        .build(mock_context(noop_assets()))
        .unwrap();
        if launch {
            #[allow(deprecated)]
            app.run_iteration(|_, _| {});
        } else {
            tauri::async_runtime::block_on(
                app.state::<AppState>().open_project(app.handle(), &project),
            )
            .unwrap();
        }
        assert_eq!(
            app.state::<AppState>().recent_projects(),
            vec![project.display().to_string()]
        );
        assert_eq!(app.state::<AppState>().projects().len(), 1);
        app.state::<AppState>().close();
        if launch {
            let restored = AppState::new(config);
            assert_eq!(
                restored.recent_projects(),
                vec![project.display().to_string()]
            );
            assert!(restored.projects().is_empty());
        }
    }
}
