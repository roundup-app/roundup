//! Scenarios S8, S10 and the window grants: several open Projects, stored Projects and window operations.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]

use super::*;
use desktop::handle_run_event;
use tauri::RunEvent;

#[test]
fn s8_rpc_reaches_only_that_projects_daemon() {
    let fx = Fixture::new(TWO_DAEMONS);
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    open(&webview, &other);

    invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "todo.create", "params": { "title": "mine" } }),
    )
    .unwrap();

    let mine = invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "todo.list", "params": null }),
    )
    .unwrap();
    let theirs = invoke(
        &webview,
        "rpc",
        json!({ "path": other.display().to_string(), "method": "todo.list", "params": null }),
    )
    .unwrap();
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!(theirs, json!([]));
}

#[test]
fn s8_events_reach_only_that_projects_channel() {
    let fx = Fixture::new(TWO_DAEMONS);
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    open(&webview, &other);
    let (mine, mine_received) = event_channel();
    let (theirs, theirs_received) = event_channel();
    let state = app.state::<AppState>();
    tauri::async_runtime::block_on(state.subscribe(&fx.project.display().to_string(), mine, None))
        .unwrap();
    tauri::async_runtime::block_on(state.subscribe(&other.display().to_string(), theirs, None))
        .unwrap();

    invoke(
        &webview,
        "rpc",
        json!({ "path": other.display().to_string(), "method": "todo.create", "params": { "title": "theirs" } }),
    )
    .unwrap();

    let event = theirs_received.recv_timeout(WAIT).unwrap();
    assert_eq!(event["data"]["title"], "theirs");
    assert!(
        mine_received
            .recv_timeout(Duration::from_millis(300))
            .is_err()
    );
}

#[test]
fn s8_a_path_that_is_not_open_is_conflict_for_every_call() {
    let fx = Fixture::new(TWO_DAEMONS);
    fx.serve_real_daemon_named("my-project");
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let stranger = fx.dir.path().join("stranger").display().to_string();
    let (channel, _received) = event_channel();

    let calls = [
        invoke(
            &webview,
            "rpc",
            json!({ "path": stranger, "method": "daemon.ping", "params": null }),
        ),
        invoke(
            &webview,
            "subscribe",
            json!({ "path": stranger, "channel": channel }),
        ),
        invoke(&webview, "close_project", json!({ "path": stranger })),
        invoke(
            &webview,
            "rename_project",
            json!({ "path": stranger, "name": "x" }),
        ),
    ];

    for call in calls {
        let error = call.unwrap_err();
        assert_eq!(error["code"], code::CONFLICT);
        assert!(error["message"].as_str().unwrap().contains(&stranger));
    }
}

#[test]
fn s8_close_project_ends_that_daemon_and_the_other_goes_on() {
    let fx = Fixture::new(
        "ln -s \"{dir}/real-$(basename \"$1\").sock\" \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\ncat > /dev/null\ntouch \"{dir}/stdin-closed-$(basename \"$1\")\"",
    );
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    open(&webview, &other);

    let closed = invoke(
        &webview,
        "close_project",
        json!({ "path": fx.project.display().to_string() }),
    );

    assert_eq!(closed, Ok(Value::Null));
    eventually("the closed Daemon seeing its stdin close", || {
        fx.dir.path().join("stdin-closed-my-project").exists()
    });
    assert!(!fx.dir.path().join("stdin-closed-other-project").exists());
    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([project_json(&other, "other-project", true)]))
    );
    assert_eq!(
        pong(invoke(
            &webview,
            "rpc",
            json!({ "path": other.display().to_string(), "method": "daemon.ping", "params": null })
        )),
        Ok(json!(true))
    );
    assert!(
        exited.recv_timeout(Duration::from_millis(300)).is_err(),
        "a close the App asked for is not an exit"
    );
}

#[test]
fn s8_one_exit_among_two_names_its_path_and_the_other_keeps_answering() {
    let fx = Fixture::new(
        "ln -s \"{dir}/real-$(basename \"$1\").sock\" \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\nif [ \"$(basename \"$1\")\" = my-project ]; then read go < '{dir}/go'; exit 7; fi\nexec cat",
    );
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    open(&webview, &other);

    fx.release();

    assert_eq!(
        exited.recv_timeout(WAIT).unwrap(),
        json!({ "path": fx.project.display().to_string(), "code": 7, "recovery": "waiting" })
    );
    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([
            project_json(&fx.project, "my-project", false),
            project_json(&other, "other-project", true),
        ]))
    );
    assert_eq!(
        pong(invoke(
            &webview,
            "rpc",
            json!({ "path": other.display().to_string(), "method": "daemon.ping", "params": null })
        )),
        Ok(json!(true))
    );
}

#[test]
fn s8_closing_one_daemon_leaves_the_other_answering() {
    let fx = Fixture::new(TWO_DAEMONS);
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    open(&webview, &other);
    let ping = |path: &Path| {
        invoke(
            &webview,
            "rpc",
            json!({ "path": path.display().to_string(), "method": "daemon.ping", "params": null }),
        )
    };
    assert_eq!(pong(ping(&fx.project)), Ok(json!(true)));
    assert_eq!(pong(ping(&other)), Ok(json!(true)));

    invoke(
        &webview,
        "close_project",
        json!({ "path": fx.project.display().to_string() }),
    )
    .unwrap();

    assert_eq!(pong(ping(&other)), Ok(json!(true)));
    assert_eq!(ping(&fx.project).unwrap_err()["code"], code::CONFLICT);
}

#[test]
fn s8_when_the_app_exits_every_daemons_stdin_closes() {
    let fx = Fixture::new(
        "ln -s \"{dir}/real-$(basename \"$1\").sock\" \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\ncat > /dev/null\ntouch \"{dir}/stdin-closed-$(basename \"$1\")\"",
    );
    let other = fx.second_project("other-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("other-project");
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    open(&webview, &other);

    handle_run_event(app.handle(), &RunEvent::Exit);

    eventually("both Daemons seeing their stdin close", || {
        fx.dir.path().join("stdin-closed-my-project").exists()
            && fx.dir.path().join("stdin-closed-other-project").exists()
    });
}

#[test]
fn s10_the_open_projects_are_stored_in_order_after_open_and_close() {
    let fx = Fixture::new(TWO_DAEMONS);
    let other = fx.second_project("other-project");
    let third = fx.second_project("third-project");
    for name in ["my-project", "other-project", "third-project"] {
        fx.serve_real_daemon_named(name);
    }
    let (_app, webview) = app(fx.config.clone(), None);
    for project in [&fx.project, &other, &third] {
        open(&webview, project);
    }
    let stored = || -> Vec<String> {
        let saved: Value = serde_json::from_slice(
            &std::fs::read(fx.dir.path().join("data/projects.json")).unwrap(),
        )
        .unwrap();
        serde_json::from_value(saved["open"].clone()).unwrap()
    };
    assert_eq!(
        stored(),
        [&fx.project, &other, &third].map(|p| p.display().to_string())
    );

    invoke(
        &webview,
        "close_project",
        json!({ "path": other.display().to_string() }),
    )
    .unwrap();

    assert_eq!(
        stored(),
        [&fx.project, &third].map(|p| p.display().to_string())
    );
}

#[test]
fn s10_a_launch_reopens_the_stored_projects_in_order_drops_a_vanished_folder_and_keeps_a_failing_one()
 {
    let fx = Fixture::new(
        "if [ \"$(basename \"$1\")\" = broken-project ]; then echo 'boom' >&2; exit 3; fi\nprintf '%s\\n' \"$1\" >> '{dir}/started'\nln -s \"{dir}/real-$(basename \"$1\").sock\" \"$RUPD_SOCKET\"\nprintf 'rupd-bound\\n'\nexec cat",
    );
    let broken = fx.second_project("broken-project");
    let gone = fx.second_project("gone-project");
    let third = fx.second_project("third-project");
    fx.serve_real_daemon_named("my-project");
    fx.serve_real_daemon_named("third-project");
    let saved = json!({ "open": [
        fx.project.display().to_string(),
        gone.display().to_string(),
        broken.display().to_string(),
        third.display().to_string(),
    ], "recent": [], "names": { fx.project.display().to_string(): "kept" } });
    std::fs::create_dir_all(fx.dir.path().join("data")).unwrap();
    std::fs::write(fx.dir.path().join("data/projects.json"), saved.to_string()).unwrap();
    std::fs::remove_dir(&gone).unwrap();

    let (mut app, webview) = app(fx.config.clone(), None);
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});

    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([
            project_json(&fx.project, "kept", true),
            project_json(&broken, "broken-project", false),
            project_json(&third, "third-project", true),
        ]))
    );
    assert_eq!(
        fx.file("started").lines().collect::<Vec<_>>(),
        [
            fx.project.display().to_string(),
            third.display().to_string()
        ]
    );
}

#[test]
fn u449_window_configuration_uses_one_title_row() {
    let context = desktop::context::<MockRuntime>();
    let windows = &context.config().app.windows;
    assert_eq!(windows.len(), 1);
    let window = &windows[0];
    assert_eq!(window.title, "roundup");
    assert_eq!(window.title_bar_style, tauri::TitleBarStyle::Overlay);
    assert!(
        window.hidden_title,
        "the webview supplies the centred title"
    );
    assert!(window.decorations, "native traffic lights remain enabled");
}

#[test]
fn u450_native_window_title_command_accepts_full_text_before_a_project_opens() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = real_context_app(fx.config);
    let title = format!("Project — {}", "長".repeat(300));
    assert_eq!(
        invoke(
            &webview,
            "plugin:window-bar|set_window_title",
            json!({ "title": title })
        ),
        Ok(Value::Null)
    );
}

#[test]
fn u451_native_window_operations_are_granted() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = real_context_app(fx.config);
    for operation in ["drag_window", "zoom_window"] {
        assert_eq!(
            invoke(
                &webview,
                &format!("plugin:window-bar|{operation}"),
                json!({})
            ),
            Ok(Value::Null)
        );
    }
}

#[test]
fn s9_window_operations_do_not_grant_arbitrary_window_selection() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (app, webview) = real_context_app(fx.config);
    let _other = WebviewWindowBuilder::new(&app, "other", WebviewUrl::default())
        .build()
        .unwrap();
    for command in ["set_title", "start_dragging", "toggle_maximize", "create"] {
        let rejected = invoke(
            &webview,
            &format!("plugin:window|{command}"),
            json!({ "label": "other", "value": "wrong window" }),
        )
        .unwrap_err();
        assert!(
            rejected.as_str().unwrap().contains("not allowed"),
            "{rejected}"
        );
    }
}

#[test]
fn s9_native_window_operations_ignore_a_webview_supplied_target() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = real_context_app(fx.config);
    for operation in ["set_window_title", "drag_window", "zoom_window"] {
        assert_eq!(
            invoke(
                &webview,
                &format!("plugin:window-bar|{operation}"),
                json!({ "title": "roundup", "label": "a-window-that-does-not-exist" }),
            ),
            Ok(Value::Null),
            "the operation uses its injected window, never the supplied target"
        );
    }
}
