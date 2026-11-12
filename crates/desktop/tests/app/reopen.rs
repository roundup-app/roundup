//! Scenario S5: reopening a Project.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]

use super::*;
use desktop::handle_run_event;
use tauri::RunEvent;

#[test]
fn s5_reopening_with_the_same_path_starts_a_new_working_daemon() {
    let fx = Fixture::new("{link}\nread go < '{dir}/go'\nexit 0");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();

    let reopened = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    assert_eq!(
        reopened,
        json!({ "name": "my-project", "path": fx.project.display().to_string() })
    );
    let reply = invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "daemon.ping", "params": null }),
    );
    assert_eq!(pong(reply), Ok(json!(true)));

    fx.release();
}

#[test]
fn s5_subscribe_after_reopen_receives_the_new_daemons_events() {
    let fx = Fixture::new("{link}\nread go < '{dir}/go'\nexit 0");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();
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
        client
            .request("todo.create", json!({ "title": "after reopen" }))
            .await
            .unwrap();
    });

    let event = received.recv_timeout(WAIT).unwrap();
    assert_eq!(event["name"], "todo.created");

    fx.release();
}

#[test]
fn s5_daemon_exited_fires_again_when_the_reopened_daemon_exits() {
    let fx = Fixture::new("{link}\nread go < '{dir}/go'\nexit 0");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    fx.release();

    assert_eq!(
        exited.recv_timeout(WAIT).unwrap(),
        json!({ "path": fx.project.display().to_string(), "code": 0, "recovery": "waiting" })
    );
}

#[test]
fn s5_after_an_exit_a_different_path_opens_a_second_daemon_beside_the_exited_one() {
    let fx = Fixture::new(
        "{link}\nif [ \"$(basename \"$1\")\" = my-project ]; then read go < '{dir}/go'; exit 0; fi\nexec cat",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    let other = fx.second_project("other-project");

    open(&webview, &other);

    assert_eq!(
        invoke(&webview, "projects", json!({})),
        Ok(json!([
            { "name": "my-project", "path": fx.project.display().to_string(), "running": false },
            { "name": "other-project", "path": other.display().to_string(), "running": true },
        ]))
    );
}

#[test]
fn s5_a_failed_reopen_is_internal() {
    let fx = Fixture::new(
        "n_file='{dir}/n'\n\
         n=$(( $(cat \"$n_file\" 2>/dev/null || echo 0) + 1 ))\n\
         echo \"$n\" > \"$n_file\"\n\
         if [ \"$n\" -eq 1 ]; then\n\
         {link}\n\
         read go < '{dir}/go'\n\
         exit 0\n\
         else\n\
         echo 'boom: reopen failed' >&2\n\
         exit 3\n\
         fi\n",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("boom: reopen failed")
    );
}

#[test]
fn s5_after_a_failed_reopen_a_different_path_opens_a_second_daemon() {
    let fx = Fixture::new(
        "n_file='{dir}/n'\n\
         n=$(( $(cat \"$n_file\" 2>/dev/null || echo 0) + 1 ))\n\
         echo \"$n\" > \"$n_file\"\n\
         if [ \"$n\" -eq 1 ]; then\n\
         {link}\n\
         read go < '{dir}/go'\n\
         exit 0\n\
         elif [ \"$n\" -le 5 ]; then\n\
         echo 'boom: reopen failed' >&2\n\
         exit 3\n\
         else\n\
         {link}\n\
         exec cat\n\
         fi\n",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();
    let other = fx.second_project("other-project");

    open(&webview, &other);

    let listed = invoke(&webview, "projects", json!({})).unwrap();
    assert_eq!(listed[0]["running"], false);
    assert_eq!(listed[1]["running"], true);
}

#[test]
fn s5_after_a_failed_reopen_the_same_path_can_be_retried() {
    let fx = Fixture::new(
        "n_file='{dir}/n'\n\
         n=$(( $(cat \"$n_file\" 2>/dev/null || echo 0) + 1 ))\n\
         echo \"$n\" > \"$n_file\"\n\
         if [ \"$n\" -eq 1 ]; then\n\
         {link}\n\
         read go < '{dir}/go'\n\
         exit 0\n\
         elif [ \"$n\" -le 5 ]; then\n\
         echo 'boom: reopen failed' >&2\n\
         exit 3\n\
         else\n\
         {link}\n\
         exec cat\n\
         fi\n",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    let reopened = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    assert_eq!(
        reopened,
        json!({ "name": "my-project", "path": fx.project.display().to_string() })
    );
}

#[test]
fn s5_until_the_reopen_rpc_still_fails_with_internal() {
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
fn s5_while_the_reopened_daemon_runs_opening_its_path_again_starts_nothing() {
    let fx = Fixture::new("{link}\necho x >> '{dir}/starts'\nread go < '{dir}/go'\nexit 0");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    assert_eq!(fx.file("starts").lines().count(), 2);

    fx.release();
}

#[test]
fn s5_a_second_open_of_a_path_still_starting_waits_and_starts_nothing() {
    let fx = Fixture::new(
        "n_file='{dir}/n'\n\
         n=$(( $(cat \"$n_file\" 2>/dev/null || echo 0) + 1 ))\n\
         echo \"$n\" > \"$n_file\"\n\
         if [ \"$n\" -eq 1 ]; then\n\
         {link}\n\
         read go < '{dir}/go'\n\
         exit 0\n\
         else\n\
         touch '{dir}/reopening-started'\n\
         read go < '{dir}/go'\n\
         {link}\n\
         exec cat\n\
         fi\n",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();

    let handle = app.handle().clone();
    let project = fx.project.clone();
    let reopening = tauri::async_runtime::spawn(async move {
        handle
            .state::<AppState>()
            .open_project(&handle, &project)
            .await
    });
    let started = fx.dir.path().join("reopening-started");
    eventually("the reopen to start", || started.exists());
    let handle = app.handle().clone();
    let project = fx.project.clone();
    let second = tauri::async_runtime::spawn(async move {
        handle
            .state::<AppState>()
            .open_project(&handle, &project)
            .await
    });

    fx.release();
    let reopened = tauri::async_runtime::block_on(reopening).unwrap().unwrap();
    assert_eq!(reopened.path, fx.project.display().to_string());
    let waited = tauri::async_runtime::block_on(second).unwrap().unwrap();
    assert_eq!(waited, reopened);
    assert_eq!(fx.file("n").trim(), "2");
}

#[test]
fn s5_a_reopen_past_the_socket_limit_fails_open_project_with_internal() {
    let fx = Fixture::with_socket_len(
        "{link}\nread go < '{dir}/go'\nexit 0",
        SOCKET_PATH_LIMIT - REOPEN_PREFIX_LEN,
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(
        error["message"].as_str().unwrap().contains("104"),
        "{error}"
    );
}

#[test]
fn s5_a_refused_reopen_does_not_burn_a_run_number() {
    let fx = Fixture::new(
        "n_file='{dir}/n'\n\
         n=$(( $(cat \"$n_file\" 2>/dev/null || echo 0) + 1 ))\n\
         echo \"$n\" > \"$n_file\"\n\
         if [ \"$n\" -eq 1 ]; then\n\
         {link}\n\
         read go < '{dir}/go'\n\
         exit 0\n\
         elif [ \"$n\" -eq 10 ]; then\n\
         printf '%s' \"$RUPD_SOCKET\" > '{dir}/socket'\n\
         {link}\n\
         exec cat\n\
         else\n\
         printf '%s\\n' \"$RUPD_SOCKET\" >> '{dir}/attempted-sockets'\n\
         echo 'boom: reopen failed' >&2\n\
         exit 3\n\
         fi\n",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();

    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();
    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    let attempted = std::fs::read_to_string(fx.dir.path().join("attempted-sockets")).unwrap();
    let tried: BTreeSet<&str> = attempted.lines().collect();
    assert_eq!(
        tried.len(),
        1,
        "both refusals must try the same socket path, not a growing one: {attempted:?}"
    );
    let succeeded = std::fs::read_to_string(fx.dir.path().join("socket")).unwrap();
    assert_eq!(*tried.iter().next().unwrap(), succeeded);
}

#[test]
fn s3_when_the_app_exits_the_socket_file_it_owned_is_gone() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    open(&webview, &fx.project);
    assert!(fx.config.socket.symlink_metadata().is_ok());

    handle_run_event(app.handle(), &RunEvent::Exit);

    assert!(fx.config.socket.symlink_metadata().is_err());
}
