//! `exit_for_update` through the native App seam.
use super::*;

#[test]
fn s5981a_exit_for_update_ends_the_daemon_without_closing_its_stdin() {
    let fx = Fixture::new("{link}\ncat > /dev/null\ntouch '{dir}/stdin-closed'");
    fx.serve_real_daemon();
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);

    invoke(&webview, "exit_for_update", json!({})).unwrap();

    // SIGKILL: no code, and the Daemon's own stop (which follows a closed stdin) never ran.
    assert_eq!(
        exited.recv_timeout(WAIT).unwrap()["code"],
        Value::Null,
        "ended by a signal"
    );
    handle_run_event(app.handle(), &RunEvent::Exit);
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert!(!fx.dir.path().join("stdin-closed").exists());
}
