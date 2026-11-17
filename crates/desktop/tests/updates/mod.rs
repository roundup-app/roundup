//! U7208b to U7208d through the native App seam: the commands Settings › Updates calls.
use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;

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

/// Every payload of the Tauri event `name`, as the App sends it.
fn payloads(app: &App<MockRuntime>, name: &str) -> mpsc::Receiver<Value> {
    let (tx, rx) = mpsc::channel();
    app.listen(name, move |event| {
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
    let looked = payloads(&app, "updates-changed");
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

/// The bytes of every package the roundup feed serves.
const PACKAGE: usize = 5000;

/// A roundup feed whose answers a test changes as it runs. `/latest.json` offers `offer` with its
/// package at `/<version>` and a signature the package does not match, or answers 204 when `offer`
/// is `None`. A package answers `PACKAGE` bytes, or 404 once its version is in `gone`; asking for
/// a gone one moves the offer to `next`, as a merge replaces the `dev` release's build. `asked` keeps
/// every path asked.
#[derive(Default)]
struct Feed {
    offer: Option<&'static str>,
    gone: Vec<&'static str>,
    next: Option<&'static str>,
    asked: Vec<String>,
}

impl Feed {
    fn answer(&mut self, path: &str, origin: &str) -> (&'static str, Vec<u8>) {
        self.asked.push(path.to_owned());
        if path == "/latest.json" {
            return match self.offer {
                Some(version) => {
                    let latest = json!({
                        "version": version,
                        "url": format!("{origin}/{version}"),
                        "signature": "not a signature",
                    });
                    ("200 OK", latest.to_string().into_bytes())
                }
                None => ("204 No Content", Vec::new()),
            };
        }
        if self.gone.contains(&path.trim_start_matches('/')) {
            if let Some(next) = self.next.take() {
                self.offer = Some(next);
            }
            return ("404 Not Found", Vec::new());
        }
        ("200 OK", vec![0; PACKAGE])
    }
}

/// Serves `feed`; the URL of its `/latest.json`.
fn serve_roundup(feed: &Arc<Mutex<Feed>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let (feed, served) = (Arc::clone(feed), origin.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let mut request = [0; 1024];
            let read = stream.read(&mut request).unwrap_or(0);
            let request = String::from_utf8_lossy(&request[..read]).into_owned();
            let path = request.split_whitespace().nth(1).unwrap_or_default();
            let (status, body) = feed.lock().unwrap().answer(path, &served);
            let _ = write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(&body);
        }
    });
    format!("{origin}/latest.json")
}

/// The Stable build's `plugins.updater`, reading `feed` instead of the alpha feed, over plain HTTP.
fn updater_config(feed: &str) -> Value {
    let overlay = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.stable.conf.json");
    let overlay: Value = serde_json::from_slice(&std::fs::read(overlay).unwrap()).unwrap();
    let mut updater = overlay["plugins"]["updater"].clone();
    updater["endpoints"] = json!([feed]);
    updater["dangerousInsecureTransportProtocol"] = json!(true);
    updater
}

/// A Stable App reading the roundup feed at `url`, once its launch look has sent its facts.
struct Stable {
    _app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    /// The facts the launch look sent.
    launch: Value,
    /// Every `updates-changed` after the launch look.
    looked: mpsc::Receiver<Value>,
    /// Every `update-progress`, the launch look's included.
    progress: mpsc::Receiver<Value>,
}

fn stable_app(fx: &mut Fixture, url: &str) -> Stable {
    fx.config.channel = desktop::Channel::Stable;
    let mut context = mock_context(noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".to_owned(), updater_config(url));
    let (mut app, webview) = app_in(context, fx.config.clone(), None);
    let looked = payloads(&app, "updates-changed");
    let progress = payloads(&app, "update-progress");
    // Tauri runs the setup hook, which starts the look, when the event loop starts.
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    let launch = looked
        .recv_timeout(WAIT)
        .expect("the look sent no `updates-changed`");
    Stable {
        _app: app,
        webview,
        launch,
        looked,
        progress,
    }
}

/// A feed offering `offer`, served to a Stable App whose launch look found it ready.
fn offered(fx: &mut Fixture, offer: Feed) -> (Arc<Mutex<Feed>>, Stable) {
    let ready = offer.offer;
    let feed = Arc::new(Mutex::new(offer));
    let stable = stable_app(fx, &serve_roundup(&feed));
    assert_eq!(stable.launch["roundup"]["ready"], json!(ready));
    (feed, stable)
}

const SIGNATURE: &str = "signature: the update's signature did not match";

#[test]
fn u7208b_install_update_emits_progress_while_it_runs() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    let (_feed, stable) = offered(
        &mut fx,
        Feed {
            offer: Some("99.0.0"),
            ..Feed::default()
        },
    );
    assert!(
        stable.progress.try_recv().is_err(),
        "a look sent `update-progress`"
    );

    let error = invoke(&stable.webview, "install_update", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert_eq!(error["message"], SIGNATURE);
    let sent: Vec<Value> = stable.progress.try_iter().collect();
    let Some((installing, downloading)) = sent.split_last() else {
        panic!("install_update sent no `update-progress`")
    };
    assert_eq!(
        *installing,
        json!({"downloaded": PACKAGE, "total": PACKAGE, "stage": "installing"})
    );
    assert!(!downloading.is_empty(), "no `downloading` event: {sent:?}");
    for event in downloading {
        assert_eq!(event["stage"], "downloading", "{sent:?}");
        assert_eq!(event["total"], PACKAGE, "{sent:?}");
    }
}

#[test]
fn u7208b_the_click_installs_what_the_feed_offers_then() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    let (feed, stable) = offered(
        &mut fx,
        Feed {
            offer: Some("99.0.0"),
            ..Feed::default()
        },
    );
    {
        let mut feed = feed.lock().unwrap();
        feed.offer = Some("99.0.1");
        feed.gone.push("99.0.0");
        feed.asked.clear();
    }

    let error = invoke(&stable.webview, "install_update", json!({})).unwrap_err();

    assert_eq!(
        feed.lock().unwrap().asked,
        ["/latest.json", "/99.0.1"],
        "the click fetched only what the feed offers at the click"
    );
    // A test has no key to sign a package, so the newer build's own check is what stops it.
    assert_eq!(error["message"], SIGNATURE);
    let told = stable
        .looked
        .recv_timeout(WAIT)
        .expect("the click sent no `updates-changed`");
    assert_eq!(told["roundup"]["ready"], "99.0.1");
}

#[test]
fn u7208b_a_gone_build_reads_the_feed_again_and_installs_the_newer_one() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    let (feed, stable) = offered(
        &mut fx,
        Feed {
            offer: Some("99.0.0"),
            gone: vec!["99.0.0"],
            next: Some("99.0.1"),
            ..Feed::default()
        },
    );
    feed.lock().unwrap().asked.clear();

    let error = invoke(&stable.webview, "install_update", json!({})).unwrap_err();

    assert_eq!(
        feed.lock().unwrap().asked,
        ["/latest.json", "/99.0.0", "/latest.json", "/99.0.1"]
    );
    assert_eq!(
        error["message"], SIGNATURE,
        "the 404 of the replaced build is not the failure shown"
    );
}

#[test]
fn u7208b_a_gone_build_with_nothing_newer_names_the_replacement() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    let (_feed, stable) = offered(
        &mut fx,
        Feed {
            offer: Some("99.0.0"),
            gone: vec!["99.0.0"],
            ..Feed::default()
        },
    );

    let error = invoke(&stable.webview, "install_update", json!({})).unwrap_err();

    assert_eq!(error["code"], code::INTERNAL);
    assert_eq!(
        error["message"],
        "replaced: the offered build was replaced and the feed offers no newer one"
    );
}

#[test]
fn u7208b_with_nothing_newer_at_the_click_the_app_is_up_to_date() {
    let mut fx = Fixture::new(SERVE_AND_WAIT);
    let (feed, stable) = offered(
        &mut fx,
        Feed {
            offer: Some("99.0.0"),
            ..Feed::default()
        },
    );
    {
        let mut feed = feed.lock().unwrap();
        feed.offer = None;
        feed.asked.clear();
    }

    let answer = invoke(&stable.webview, "install_update", json!({}));

    assert_eq!(answer, Ok(Value::Null));
    assert_eq!(feed.lock().unwrap().asked, ["/latest.json"]);
    let told = stable
        .looked
        .recv_timeout(WAIT)
        .expect("the click sent no `updates-changed`");
    assert_eq!(told["roundup"]["ready"], Value::Null);
    assert_eq!(
        invoke(&stable.webview, "updates", json!({})).unwrap()["roundup"]["ready"],
        Value::Null
    );
}
