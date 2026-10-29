//! U3787e: production startup and actual native geometry, on AppKit's main thread.
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{Listener, Manager};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

type Bounds = (f64, f64, f64, f64);

fn saved() -> serde_json::Value {
    serde_json::json!({"main":{"width":2640,"height":1400,"x":80,"y":120,
        "prev_x":80,"prev_y":120,"scale":2.0,"maximized":false,
        "fullscreen":false,"visible":false,"decorated":true}})
}

fn observe(
    record: Option<Vec<u8>>,
    check: impl FnOnce(tauri::AppHandle, std::path::PathBuf, mpsc::Receiver<bool>, Bounds)
    + Send
    + 'static,
) {
    let dir = tempfile::tempdir().unwrap();
    let mut probe_context = tauri::test::mock_context(tauri::test::noop_assets());
    probe_context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.path().to_path_buf()),
    );
    let probe = tauri::test::mock_builder().build(probe_context).unwrap();
    let path = probe.path().app_config_dir().unwrap();
    std::fs::create_dir_all(&path).unwrap();
    if let Some(record) = record {
        std::fs::write(path.join(".window-state.json"), record).unwrap();
    }
    let drafts = path.join("drafts.json");
    std::fs::write(&drafts, "original draft 雪").unwrap();
    let mut context = desktop::context();
    context.config_mut().app.app_directories_override =
        probe.config().app.app_directories_override.clone();
    for window in &mut context.config_mut().app.windows {
        window.url = tauri::WebviewUrl::External("about:blank".parse().unwrap());
    }
    let mut config =
        desktop::Config::locate(None, std::path::Path::new("/unused"), dir.path(), 1).unwrap();
    config.data_dir = Some(dir.path().join("projects"));
    let (sender, restored) = mpsc::channel();
    let (fullscreen_sender, fullscreen_completed) = mpsc::channel();
    let observer = tauri::plugin::Builder::<tauri::Wry, ()>::new("restore-observer")
        .on_window_ready(move |window| {
            if window.label() != "main" {
                return;
            }
            let fullscreen_sender = fullscreen_sender.clone();
            window.listen("window-fullscreen-completed", move |event| {
                fullscreen_sender
                    .send(serde_json::from_str(event.payload()).unwrap())
                    .unwrap();
            });
            let restored_window = window.clone();
            let sender = sender.clone();
            window.listen("window-state-restored", move |_| {
                let window = &restored_window;
                // This event precedes reveal. Native geometry is applied asynchronously
                // and the OS may clamp it at reveal, so geometry is asserted after reveal.
                // Fullscreen changes the monitor work area; retain the normal-display
                // expectation before reveal can start that transition.
                sender
                    .send((window.is_visible().unwrap(), expected(window)))
                    .unwrap();
            });
        })
        .build();
    let app = desktop::build(
        tauri::Builder::default().plugin(observer),
        config,
        None,
        |app, code| app.exit(code),
    )
    .build(context)
    .unwrap();
    let handle = app.handle().clone();
    let (ready, startup) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Tauri emits Ready after setup finishes constructing the webview;
            // the earlier restore event alone does not make it discoverable yet.
            startup.recv_timeout(Duration::from_secs(5)).unwrap();
            let (visible_before_reveal, normal_bounds) =
                restored.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(!visible_before_reveal);
            assert!(
                handle
                    .get_webview_window("main")
                    .unwrap()
                    .is_visible()
                    .unwrap()
            );
            check(handle.clone(), path, fullscreen_completed, normal_bounds);
            assert_eq!(
                std::fs::read_to_string(drafts).unwrap(),
                "original draft 雪"
            );
        }));
        handle.exit(i32::from(outcome.is_err()));
        outcome
    });
    assert_eq!(
        app.run_return(move |_, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                ready.send(()).unwrap();
            }
        }),
        0
    );
    worker.join().unwrap().unwrap();
}

/// Saved 1320x700 at (40, 60), clamped as the restore clamps it to the display under test:
/// the runner's work area may be smaller than the record, and then the window is moved to it.
fn expected(main: &tauri::Window) -> Bounds {
    let scale = main.scale_factor().unwrap();
    let area = *main.current_monitor().unwrap().unwrap().work_area();
    let (area_w, area_h) = (
        f64::from(area.size.width) / scale,
        f64::from(area.size.height) / scale,
    );
    let width = 1320.0_f64.min(area_w.max(1280.0));
    let height = 700.0_f64.min(area_h - 32.0).max(100.0);
    let origin = area.position.to_logical::<f64>(scale);
    let fits = 40.0 * scale >= f64::from(area.position.x)
        && 60.0 * scale >= f64::from(area.position.y)
        && (40.0 + width) * scale <= f64::from(area.position.x) + f64::from(area.size.width)
        && 60.0 * scale + 32.0 <= f64::from(area.position.y) + f64::from(area.size.height);
    let (x, y) = if fits {
        (40.0, 60.0)
    } else {
        (origin.x, origin.y)
    };
    (width, height, x, y)
}

pub fn u3787e_restore_uses_saved_normal_bounds() {
    observe(
        Some(serde_json::to_vec(&saved()).unwrap()),
        |app, path, fullscreen_completed, normal_bounds| {
            let main = app.get_webview_window("main").unwrap();
            assert!(!main.is_maximized().unwrap());
            assert!(!main.is_fullscreen().unwrap());
            let scale = main.scale_factor().unwrap();
            let (want_w, want_h, want_x, want_y) = normal_bounds;
            wait(|| {
                let size = main.outer_size().unwrap().to_logical::<f64>(scale);
                let position = main.outer_position().unwrap().to_logical::<f64>(scale);
                // Tao queues resize and reposition separately; width alone can precede the move.
                (size.width - want_w).abs() <= 1.0
                    && (position.x - want_x).abs() <= 1.0
                    && (position.y - want_y).abs() <= 1.0
            });
            let inner = main.inner_size().unwrap().to_logical::<f64>(scale);
            // The runner's display and title bar decide the height; the saved one is only an upper bound.
            assert!(inner.height <= want_h + 1.0, "{inner:?} want {want_h}");
            assert!(inner.height >= 100.0, "{inner:?}");
            let position = main.outer_position().unwrap().to_logical::<f64>(scale);
            assert!((position.x - want_x).abs() <= 1.0, "{position:?}");
            assert!((position.y - want_y).abs() <= 1.0, "{position:?}");
            let original = main.outer_size().unwrap();
            let original_position = main.outer_position().unwrap();
            // Actual native transitions, with native state/geometry as the completion signal.
            for fullscreen in [false, true] {
                if fullscreen {
                    main.set_fullscreen(true).unwrap();
                    fullscreen_transition(&main, &fullscreen_completed, true);
                } else {
                    main.maximize().unwrap();
                }
                wait(|| {
                    if fullscreen {
                        main.is_fullscreen().unwrap()
                    } else {
                        main.is_maximized().unwrap()
                    }
                });
                app.save_window_state(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::FULLSCREEN,
                )
                .unwrap();
                let stored: serde_json::Value = serde_json::from_slice(
                    &std::fs::read(path.join(".window-state.json")).unwrap(),
                )
                .unwrap();
                assert_eq!(
                    stored["main"]["width"].as_f64().unwrap()
                        / stored["main"]["scale"].as_f64().unwrap(),
                    want_w
                );
                if fullscreen {
                    main.set_fullscreen(false).unwrap();
                    fullscreen_transition(&main, &fullscreen_completed, false);
                } else {
                    main.unmaximize().unwrap();
                }
                wait(|| {
                    !main.is_fullscreen().unwrap()
                        && !main.is_maximized().unwrap()
                        && main.outer_size().unwrap() == original
                        // The exit animation moves the frame back after the size; the panel check below starts from the settled frame.
                        && main.outer_position().unwrap() == original_position
                });
            }
            #[cfg(target_vendor = "apple")]
            {
                let position = main.outer_position().unwrap().to_logical::<f64>(scale);
                let panel = native::CapturePanel::new(
                    app.clone(),
                    tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .unwrap();
                panel.show().unwrap();
                panel.dismiss().unwrap();
                panel.release().unwrap();
                assert_eq!(
                    main.outer_position().unwrap().to_logical::<f64>(scale),
                    position
                );
                assert_eq!(main.outer_size().unwrap(), original);
            }
        },
    );
}

// The read is the wait; the deadline bounds a missing native transition, with no fixed delay.
fn wait(mut completed: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !completed() {
        assert!(
            Instant::now() < deadline,
            "native transition did not settle"
        );
        std::thread::yield_now();
    }
}

pub fn u3787e_missing_invalid_and_offscreen_state_are_reachable() {
    let mut record = saved();
    record["main"]["x"] = i32::MAX.into();
    record["main"]["y"] = i32::MAX.into();
    observe(Some(serde_json::to_vec(&record).unwrap()), reachable);
}
pub fn u3787e_missing_state_is_reachable() {
    observe(None, reachable);
}
pub fn u3787e_invalid_state_is_reachable() {
    let mut record = saved();
    record["main"]["width"] = 0.into();
    observe(Some(serde_json::to_vec(&record).unwrap()), reachable);
}
pub fn u3787e_corrupt_state_is_reachable() {
    observe(
        Some(b"{broken".to_vec()),
        |app, path, fullscreen_completed, normal_bounds| {
            reachable(
                app.clone(),
                path.clone(),
                fullscreen_completed,
                normal_bounds,
            );
            assert!(app.save_window_state(StateFlags::all()).is_err());
            assert_eq!(
                std::fs::read(path.join(".window-state.json")).unwrap(),
                b"{broken"
            );
        },
    );
}
fn reachable(app: tauri::AppHandle, _: std::path::PathBuf, _: mpsc::Receiver<bool>, _: Bounds) {
    let main = app.get_webview_window("main").unwrap();
    let scale = main.scale_factor().unwrap();
    let area = *main.current_monitor().unwrap().unwrap().work_area();
    // A display narrower than the 1280 minimum can only show its own width.
    let floor = 1280.0_f64.min(f64::from(area.size.width) / scale) - 1.0;
    wait(|| main.inner_size().unwrap().to_logical::<f64>(scale).width >= floor);
    let position = main.outer_position().unwrap();
    let monitor = main.current_monitor().unwrap().unwrap();
    let area = monitor.work_area();
    assert!(position.x >= area.position.x && position.y >= area.position.y);
    assert!(i64::from(position.y) + 32 <= i64::from(area.position.y) + i64::from(area.size.height));
}

pub fn u3787e_maximized_state_keeps_normal_bounds() {
    state_reopens(false);
}
pub fn u3787e_fullscreen_state_keeps_normal_bounds() {
    state_reopens(true);
}
fn state_reopens(fullscreen: bool) {
    let mut record = saved();
    record["main"][if fullscreen {
        "fullscreen"
    } else {
        "maximized"
    }] = true.into();
    observe(
        Some(serde_json::to_vec(&record).unwrap()),
        move |app, _, fullscreen_completed, normal_bounds| {
            let main = app.get_webview_window("main").unwrap();
            let (want_w, _, want_x, want_y) = normal_bounds;
            if fullscreen {
                fullscreen_transition(&main, &fullscreen_completed, true);
            } else {
                wait(|| main.is_maximized().unwrap());
            }
            if fullscreen {
                main.set_fullscreen(false).unwrap();
                fullscreen_transition(&main, &fullscreen_completed, false);
            } else {
                main.unmaximize().unwrap();
            }
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                let full = main.is_fullscreen().unwrap();
                let zoomed = main.is_maximized().unwrap();
                let size = main
                    .outer_size()
                    .unwrap()
                    .to_logical::<f64>(main.scale_factor().unwrap());
                let position = main
                    .outer_position()
                    .unwrap()
                    .to_logical::<f64>(main.scale_factor().unwrap());
                if !full
                    && !zoomed
                    && (size.width - want_w).abs() <= 1.0
                    && (position.x - want_x).abs() <= 1.0
                    && (position.y - want_y).abs() <= 1.0
                {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "normal bounds did not settle: fullscreen={full}, maximized={zoomed}, size={size:?}, position={position:?}; want width={want_w}, position=({want_x}, {want_y})"
                );
                std::thread::yield_now();
            }
        },
    );
}

// AppKit's didEnter/didExit notification is the fence between native input operations.
fn fullscreen_transition(
    main: &tauri::WebviewWindow,
    completed: &mpsc::Receiver<bool>,
    want: bool,
) {
    let result = completed.recv_timeout(Duration::from_secs(8));
    assert!(
        matches!(result, Ok(fullscreen) if fullscreen == want),
        "fullscreen completion {want} missing: {result:?}; fullscreen={:?}, maximized={:?}, size={:?}, position={:?}",
        main.is_fullscreen(),
        main.is_maximized(),
        main.outer_size(),
        main.outer_position()
    );
}
