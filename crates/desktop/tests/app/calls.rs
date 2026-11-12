//! Scenarios S2 and S3: calls, events and Daemon exits.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]

use super::*;
use desktop::handle_run_event;
use std::sync::Mutex;
use tauri::RunEvent;

#[test]
fn s2_rpc_ping_answers_pong() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);

    let reply = pong(invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "daemon.ping", "params": null }),
    ));

    assert_eq!(reply, Ok(json!(true)));
}

#[test]
fn s2_a_call_that_fails_in_the_daemon_fails_with_the_daemons_code_and_message() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let direct = tauri::async_runtime::block_on(async {
        let client = rpc::Client::connect(&fx.real_daemon_socket())
            .await
            .unwrap();
        client
            .request("todo.get", json!({ "id": 99 }))
            .await
            .unwrap_err()
    });

    let error = invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "todo.get", "params": { "id": 99 } }),
    )
    .unwrap_err();

    assert_eq!(
        error,
        json!({ "code": direct.code, "message": direct.message })
    );
    assert_eq!(error["code"], code::NOT_FOUND);
}

#[test]
fn s2_events_the_daemon_emits_in_one_burst_arrive_on_the_channel_in_order() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let (channel, received) = event_channel();
    tauri::async_runtime::block_on(app.state::<AppState>().subscribe(
        &fx.project.display().to_string(),
        channel,
        None,
    ))
    .unwrap();

    tauri::async_runtime::block_on(async {
        let client = rpc::Client::connect(&fx.real_daemon_socket())
            .await
            .unwrap();
        for n in 0..BURST {
            client
                .request("todo.create", json!({ "title": n.to_string() }))
                .await
                .unwrap();
        }
    });

    let titles: Vec<String> = (0..BURST)
        .map(|_| received.recv_timeout(WAIT).unwrap())
        .map(|event| {
            assert_eq!(event["name"], "todo.created");
            event["data"]["title"].as_str().unwrap().to_owned()
        })
        .collect();
    assert_eq!(
        titles,
        (0..BURST).map(|n| n.to_string()).collect::<Vec<_>>()
    );
}

#[test]
fn s2_subscribe_through_ipc_takes_a_channel_argument_and_answers_the_head() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let (channel, _received) = event_channel();

    let subscribed = invoke(
        &webview,
        "subscribe",
        json!({ "path": fx.project.display().to_string(), "channel": channel }),
    );
    let misnamed = invoke(
        &webview,
        "subscribe",
        json!({ "path": fx.project.display().to_string(), "events": channel }),
    );

    assert_eq!(subscribed, Ok(json!(0)));
    assert!(misnamed.is_err());
}

#[test]
fn s2_a_second_subscribe_replaces_the_first() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let (first, first_received) = event_channel();
    let (second, second_received) = event_channel();
    let state = app.state::<AppState>();
    tauri::async_runtime::block_on(state.subscribe(&fx.project.display().to_string(), first, None))
        .unwrap();
    tauri::async_runtime::block_on(state.subscribe(
        &fx.project.display().to_string(),
        second,
        None,
    ))
    .unwrap();

    invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "todo.create", "params": { "title": "only" } }),
    )
    .unwrap();

    second_received.recv_timeout(WAIT).unwrap();
    assert!(first_received.try_recv().is_err());
}

#[test]
fn s2_before_a_project_is_open_rpc_and_subscribe_fail_at_once_with_conflict() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (app, webview) = app(fx.config.clone(), None);

    let call = invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "daemon.ping", "params": null }),
    );
    let subscribe = tauri::async_runtime::block_on(app.state::<AppState>().subscribe(
        &fx.project.display().to_string(),
        Channel::<contracts::Event>::new(|_| Ok(())),
        None,
    ));

    assert_eq!(call.unwrap_err()["code"], code::CONFLICT);
    let error = subscribe.unwrap_err();
    assert_eq!(error.code, code::CONFLICT);
    assert!(error.message.contains("no Project is open"));
}

#[test]
fn s3_when_the_app_exits_the_daemons_stdin_closes() {
    let fx = Fixture::new("{link}\ncat > /dev/null\ntouch '{dir}/stdin-closed'");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    let marker = fx.dir.path().join("stdin-closed");
    assert!(!marker.exists());

    handle_run_event(app.handle(), &RunEvent::Exit);

    eventually("the Daemon seeing its stdin close", || marker.exists());
}

#[test]
fn s3_when_the_daemon_exits_on_its_own_the_webview_gets_daemon_exited_with_its_code() {
    let fx = Fixture::new("{link}\nread go < '{dir}/go'\nexit 7");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);

    fx.release();

    assert_eq!(
        exited.recv_timeout(WAIT).unwrap(),
        json!({ "path": fx.project.display().to_string(), "code": 7, "recovery": "waiting" })
    );
}

#[test]
fn s3_a_daemon_ended_by_a_signal_has_a_null_code() {
    let fx = Fixture::new("{link}\nread go < '{dir}/go'\nkill -9 $$");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);

    fx.release();

    assert_eq!(
        exited.recv_timeout(WAIT).unwrap(),
        json!({ "path": fx.project.display().to_string(), "code": null, "recovery": "waiting" })
    );
}

#[test]
fn s3_after_the_daemon_exits_rpc_fails_with_internal() {
    let fx = Fixture::new("{link}\nread go < '{dir}/go'\nexit 0");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();

    let error = invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "daemon.ping", "params": null }),
    )
    .unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
}

#[test]
fn s1_the_webview_may_listen_for_daemon_exited_through_the_real_capabilities() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = real_context_app(fx.config.clone());

    let listen = invoke(
        &webview,
        "plugin:event|listen",
        json!({ "event": "daemon-exited", "target": { "kind": "Any" }, "handler": 7 }),
    );

    let event_id = listen.expect("the capability grants core:event:allow-listen");
    let unlisten = invoke(
        &webview,
        "plugin:event|unlisten",
        json!({ "event": "daemon-exited", "eventId": event_id }),
    );
    assert_eq!(unlisten, Ok(Value::Null));
}

#[test]
fn s1_a_failed_roundup_project_start_exits_non_zero_without_panicking() {
    let fx = Fixture::new("echo 'cannot open the database' >&2\nexit 3");
    let exits = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&exits);
    let mut app = build(
        mock_builder(),
        fx.config.clone(),
        Some(fx.project.clone()),
        move |_, code| recorded.lock().unwrap().push(code),
    )
    .build(mock_context(noop_assets()))
    .unwrap();

    // Tauri runs the setup hook, where the project is opened, when the event loop starts.
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});

    assert_eq!(*exits.lock().unwrap(), [1]);
}

#[test]
fn s1_a_socket_path_of_103_bytes_is_accepted_and_104_is_rejected() {
    let socket_name_len = "/roundup-1.sock".len();
    let dir_of = |socket_len: usize| {
        PathBuf::from(format!("/{}", "d".repeat(socket_len - socket_name_len - 1)))
    };

    let accepted = Config::locate(None, Path::new("/a/roundup"), &dir_of(103), 1).unwrap();
    let rejected = Config::locate(None, Path::new("/a/roundup"), &dir_of(104), 1);

    assert_eq!(accepted.socket.as_os_str().len(), 103);
    assert!(rejected.is_err());
}

#[test]
fn s1_a_project_path_ending_in_dotdot_is_named_after_the_directory_it_reaches() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (_app, webview) = app(fx.config.clone(), None);
    let through_dotdot = fx.project.join("..");

    let opened = invoke(&webview, "open_project", path_arg(&through_dotdot)).unwrap();

    let reached = fx.dir.path().file_name().unwrap().to_str().unwrap();
    assert_eq!(opened["name"], reached);
}
