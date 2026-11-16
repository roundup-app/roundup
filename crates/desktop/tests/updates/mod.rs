//! U7208b to U7208d through the native App seam: the commands Settings › Updates calls.
use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

/// A `herdr-core` on a `PATH` of its own, so its script uses shell built-ins only: `--version` prints
/// the version kept in `core-version`, and `update` runs `update_body` after noting that it ran.
fn fake_core(fx: &mut Fixture, version: &str, update_body: &str) {
    let update_body = update_body.replace("{dir}", &fx.dir.path().display().to_string());
    let bin = fx.dir.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    std::fs::write(fx.dir.path().join("core-version"), version).unwrap();
    let script = bin.join("herdr-core");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\ncase \"$1\" in\n  --version) read version < '{dir}/core-version'; printf 'hc %s\\n' \"$version\" ;;\n  update) echo ran >> '{dir}/ran'\n{update_body}\n ;;\nesac\n",
            dir = fx.dir.path().display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    fx.config.search_path = bin.into_os_string();
}

/// A release feed that answers every request with `body`, once `go` is sent; its URL.
fn serve_feed(body: &'static str) -> (String, mpsc::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/core/latest.json", listener.local_addr().unwrap());
    let (go, wait) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        let _ = wait.recv();
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let _ = stream.read(&mut [0; 1024]);
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    (url, go)
}

fn updates_changed(app: &App<MockRuntime>) -> mpsc::Receiver<Value> {
    let (tx, rx) = mpsc::channel();
    app.listen("updates-changed", move |event| {
        tx.send(serde_json::from_str(event.payload()).unwrap())
            .unwrap();
    });
    rx
}

#[test]
fn u7208b_install_update_without_a_ready_version_fails() {
    let fx = Fixture::new(SERVE_AND_WAIT);
    let (_app, webview) = app(fx.config.clone(), None);

    let error = invoke(&webview, "install_update", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert_eq!(error["message"], "no update is ready");
}

#[test]
fn u7208c_update_core_runs_herdr_core_update_and_reads_the_new_version() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    fake_core(&mut fx, "0.1.21", "echo 0.1.22 > '{dir}/core-version'");
    let (_app, webview) = app(fx.config.clone(), None);
    assert_eq!(
        invoke(&webview, "updates", json!({})).unwrap()["core"],
        json!({"version": "0.1.21", "ready": null})
    );

    let facts = invoke(&webview, "update_core", json!({})).unwrap();

    assert_eq!(fx.file("ran"), "ran\n");
    assert_eq!(facts["core"], json!({"version": "0.1.22", "ready": null}));
    assert_eq!(facts["roundup"], Value::Null);
}

#[test]
fn u7208c_a_failed_core_update_names_its_last_line() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    fake_core(
        &mut fx,
        "0.1.21",
        "echo 'fetching' >&2; echo 'no space left on device' >&2; echo >&2; exit 3",
    );
    let (_app, webview) = app(fx.config.clone(), None);

    let error = invoke(&webview, "update_core", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert_eq!(error["message"], "no space left on device");
    assert_eq!(
        invoke(&webview, "updates", json!({})).unwrap()["core"],
        json!({"version": "0.1.21", "ready": null})
    );
}

#[test]
fn u7208d_updates_answers_the_versions_and_what_is_ready() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    fake_core(&mut fx, "0.1.21", "");
    let (url, go) = serve_feed(r#"{"version":"0.1.22","generation":3}"#);
    fx.config.core_feed = Some(url);
    let (mut app, webview) = app(fx.config.clone(), None);
    let looked = updates_changed(&app);
    // Tauri runs the setup hook, which starts the look, when the event loop starts.
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    assert_eq!(
        invoke(&webview, "updates", json!({})).unwrap(),
        json!({"roundup": null, "core": {"version": "0.1.21", "ready": null}}),
        "nothing is ready before the feed is read"
    );

    go.send(()).unwrap();
    let expected = json!({"roundup": null, "core": {"version": "0.1.21", "ready": "0.1.22"}});
    let sent = looked
        .recv_timeout(WAIT)
        .expect("the look sent no `updates-changed`");

    assert_eq!(sent, expected);
    assert_eq!(invoke(&webview, "updates", json!({})).unwrap(), expected);
    assert_eq!(fx.file("ran"), "", "a look never runs herdr-core update");
}
