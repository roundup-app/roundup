//! S6505a: one task per open Project owns its Daemon, through the native App seam.
use super::*;

/// The first start runs until `go`, then exits; every later start stays up. Each start is counted.
const EXIT_ONCE: &str = "echo x >> '{dir}/starts'\n\
     {link}\n\
     if [ \"$(wc -l < '{dir}/starts')\" -eq 1 ]; then read go < '{dir}/go'; exit 0; fi\n\
     exec cat";

fn open_in_flight(
    app: &App<MockRuntime>,
    project: &Path,
) -> tauri::async_runtime::JoinHandle<Result<desktop::Project, rpc::RpcError>> {
    let handle = app.handle().clone();
    let project = project.to_path_buf();
    tauri::async_runtime::spawn(async move {
        handle
            .state::<AppState>()
            .open_project(&handle, &project)
            .await
    })
}

#[test]
fn s6505a_a_reopen_retires_the_delayed_retry() {
    let mut fx = Fixture::new(EXIT_ONCE);
    fx.config.reopen_waits = [Duration::from_millis(600); 3];
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    assert_eq!(exited.recv_timeout(WAIT).unwrap()["recovery"], "waiting");

    invoke(&webview, "open_project", path_arg(&fx.project)).unwrap();

    // Long enough for the retired retry to have started a Daemon had it survived.
    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(fx.file("starts").lines().count(), 2);
}

#[test]
fn s6505a_a_failed_user_open_leaves_no_project() {
    let fx = Fixture::new("echo 'boom: no start' >&2\nexit 3");
    let (_app, webview) = app(fx.config.clone(), None);

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert_eq!(invoke(&webview, "projects", json!({})).unwrap(), json!([]));
    let error = invoke(
        &webview,
        "rpc",
        json!({ "path": fx.project.display().to_string(), "method": "daemon.ping", "params": null }),
    )
    .unwrap_err();
    assert_eq!(error["code"], code::CONFLICT);
}

#[test]
fn s6505a_a_command_to_an_ended_task_is_not_open() {
    let fx = Fixture::new(
        "echo x >> '{dir}/starts'\n\
         if [ \"$(wc -l < '{dir}/starts')\" -eq 1 ]; then {link}; read go < '{dir}/go'; exit 0; fi\n\
         read go < '{dir}/go'\n\
         {link}\n\
         exec cat",
    );
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    exited.recv_timeout(WAIT).unwrap();
    let path = fx.project.display().to_string();
    let reopening = open_in_flight(&app, &fx.project);
    eventually("the reopen to start", || {
        fx.file("starts").lines().count() == 2
    });
    let handle = app.handle().clone();
    let rpc_path = path.clone();
    let calling = tauri::async_runtime::spawn(async move {
        handle
            .state::<AppState>()
            .rpc(&rpc_path, "daemon.ping", Value::Null)
            .await
    });

    app.state::<AppState>().close_project(&path).unwrap();

    let opened =
        tauri::async_runtime::block_on(async { tokio::time::timeout(WAIT, reopening).await })
            .expect("the open settles")
            .unwrap()
            .unwrap_err();
    assert_eq!(opened.code, code::CONFLICT);
    tauri::async_runtime::block_on(async { tokio::time::timeout(WAIT, calling).await })
        .expect("the rpc settles")
        .unwrap()
        .unwrap_err();
    let error = invoke(
        &webview,
        "rpc",
        json!({ "path": path, "method": "daemon.ping", "params": null }),
    )
    .unwrap_err();
    assert_eq!(error["code"], code::CONFLICT);
    assert!(error["message"].as_str().unwrap().contains(&path));
}

#[test]
fn s6505a_an_unconfirmed_project_stops_every_leave() {
    let fx = Fixture::new(
        "ln -s \"{dir}/real-$(basename \"$1\").sock\" \"$RUPD_SOCKET\"\n\
         printf 'rupd-bound\\n'\n\
         cat > /dev/null\n\
         touch \"{dir}/stdin-closed-$(basename \"$1\")\"",
    );
    fx.serve_real_daemon_named("my-project");
    let silent = fx.second_project("silent-project");
    super::update_exit::serve_one_answer(fx.dir.path().join("real-silent-project.sock"));
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    open(&webview, &silent);

    let error = invoke(&webview, "exit_for_update", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("silent-project")
    );
    // The confirmed Project was not left either: its Daemon runs and its stdin is open.
    assert!(exited.recv_timeout(Duration::from_millis(300)).is_err());
    assert!(!fx.dir.path().join("stdin-closed-my-project").exists());
    assert!(!fx.dir.path().join("stdin-closed-silent-project").exists());
}

#[test]
fn s6505a_close_during_backoff_starts_no_daemon() {
    let mut fx = Fixture::new(EXIT_ONCE);
    fx.config.reopen_waits = [Duration::from_millis(600); 3];
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);
    fx.release();
    assert_eq!(exited.recv_timeout(WAIT).unwrap()["recovery"], "waiting");

    invoke(
        &webview,
        "close_project",
        json!({ "path": fx.project.display().to_string() }),
    )
    .unwrap();

    std::thread::sleep(Duration::from_millis(1500));
    assert_eq!(fx.file("starts").lines().count(), 1);
    assert_eq!(invoke(&webview, "projects", json!({})).unwrap(), json!([]));
}
