//! Scenario S1: starting a Daemon and the ways it fails.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]

use super::*;

#[test]
fn s1_a_daemon_that_exits_is_internal_and_carries_its_stderr() {
    let fx = Fixture::new("echo 'boom: cannot open the database' >&2\nexit 3");
    let (_app, webview) = app(fx.config.clone(), None);

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("boom: cannot open the database")
    );
}

#[test]
fn s1_a_daemon_silent_past_the_ready_bound_is_internal() {
    let fx = Fixture::new("exec cat");
    let mut config = fx.config.clone();
    config.ready_bound = Duration::from_millis(300);
    let (_app, webview) = app(config, None);

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("did not answer daemon.ping within 300ms")
    );
}

#[test]
fn z3799b_a_socket_without_the_complete_bound_signal_is_not_ready() {
    for signal in ["", partial_bound!(), "printf 'other-bound\\n'"] {
        let fx = Fixture::new(&format!(
            "ln -s '{{dir}}/real.sock' \"$RUPD_SOCKET\"\n{signal}\nexec 1>&-\nexec cat > /dev/null"
        ));
        fx.serve_real_daemon();
        let (_app, webview) = app(fx.config.clone(), None);

        let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

        assert_eq!(error["code"], code::INTERNAL);
        assert!(
            error["message"]
                .as_str()
                .unwrap()
                .contains("bound notification")
        );
        assert!(!fx.config.socket.exists());
    }
}

#[test]
fn s1_a_daemon_that_accepts_connections_but_never_answers_ping_is_silent_past_the_bound() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let listener = std::os::unix::net::UnixListener::bind(fx.real_daemon_socket()).unwrap();
    std::thread::spawn(move || {
        let held: Vec<_> = listener.incoming().collect();
        drop(held);
    });
    let mut config = fx.config.clone();
    config.ready_bound = Duration::from_millis(300);
    let (_app, webview) = app(config, None);

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("did not answer daemon.ping")
    );
}

#[test]
fn s1_stderr_that_is_not_utf8_does_not_stop_the_tail() {
    let fx = Fixture::new("printf 'bad \\377 line\\n' >&2\necho 'after the bad line' >&2\nexit 3");
    let (_app, webview) = app(fx.config.clone(), None);

    let error = invoke(&webview, "open_project", path_arg(&fx.project)).unwrap_err();

    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("after the bad line")
    );
}
