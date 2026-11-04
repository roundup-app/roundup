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

/// A Daemon stand-in that answers one request, `open_project`'s ping, and then goes silent.
fn serve_one_answer(socket: PathBuf) {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::os::unix::net::UnixListener::bind(socket).unwrap();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut writer = stream.try_clone().unwrap();
        let mut lines = BufReader::new(stream).lines();
        let first: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        writeln!(writer, "{}", json!({"id": first["id"], "result": null})).unwrap();
        // Hold the connection open and unanswered until the test ends.
        for _ in lines {}
    });
}

#[test]
fn s5981a_an_unsaved_daemon_fails_the_call_and_the_app_stays_open() {
    let fx = Fixture::new("{link}\ncat > /dev/null\ntouch '{dir}/stdin-closed'");
    serve_one_answer(fx.real_daemon_socket());
    let (app, webview) = app(fx.config.clone(), None);
    let exited = daemon_exited(&app);
    open(&webview, &fx.project);

    let error = invoke(&webview, "exit_for_update", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(error["message"].as_str().unwrap().contains("my-project"));
    // Nothing was ended: the Daemon is still running and its stdin is still open.
    assert!(exited.recv_timeout(Duration::from_millis(300)).is_err());
    assert!(!fx.dir.path().join("stdin-closed").exists());
}
