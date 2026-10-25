//! S2297a (`scenarios/app.md`): the webview renders at the display's rate.

#[cfg(target_vendor = "apple")]
fn u3787f_native_integration_keeps_safe_callers() {
    assert!(
        std::thread::spawn(|| native::Preferences::new().is_none())
            .join()
            .unwrap()
    );
}

#[cfg(target_vendor = "apple")]
fn s2297a_the_setup_turns_the_near_60_fps_feature_off() {
    let preferences = native::Preferences::new().expect("main-thread WebKit preferences");
    assert_eq!(preferences.is_on(), Some(true));
    preferences.turn_off().unwrap();
    assert_eq!(preferences.is_on(), Some(false));
}

fn s2297a_the_app_builds_with_the_setup_registered() {
    use desktop::{Config, build};
    use tauri::test::mock_builder;

    let dir = tempfile::tempdir().unwrap();
    let mut config = Config::locate(
        None,
        std::path::Path::new("/unused/roundup"),
        dir.path(),
        std::process::id(),
    )
    .unwrap();
    config.data_dir = Some(dir.path().join("data"));
    let mut context = desktop::context();
    context.config_mut().app.app_directories_override = Some(
        tauri::utils::config::AppDirectoriesOverride::Root(dir.path().join("data")),
    );
    build(mock_builder(), config, None, |app, code| app.exit(code))
        .build(context)
        .expect("the App builds from tauri.conf.json");
}

// WebKit asserts it is on the main thread, which libtest's worker threads are not, so this binary has its own `main`
// (`harness = false`) that speaks the part of libtest's protocol nextest uses: `--list` and `--exact <name>`.
fn main() {
    let tests: &[(&str, fn())] = &[
        #[cfg(target_vendor = "apple")]
        (
            "u3787f_native_integration_keeps_safe_callers",
            u3787f_native_integration_keeps_safe_callers,
        ),
        #[cfg(target_vendor = "apple")]
        (
            "s2297a_the_setup_turns_the_near_60_fps_feature_off",
            s2297a_the_setup_turns_the_near_60_fps_feature_off,
        ),
        (
            "s2297a_the_app_builds_with_the_setup_registered",
            s2297a_the_app_builds_with_the_setup_registered,
        ),
    ];
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--list") {
        if !args.iter().any(|arg| arg == "--ignored") {
            for (name, _) in tests {
                println!("{name}: test");
            }
        }
        return;
    }
    let mut failed = false;
    for (name, test) in tests {
        let wanted = args.iter().any(|arg| arg == name)
            || !args
                .iter()
                .any(|arg| arg.starts_with("s2297a_") || arg.starts_with("u3787f_"));
        if wanted {
            let ok = std::panic::catch_unwind(test).is_ok();
            println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
            failed |= !ok;
        }
    }
    std::process::exit(i32::from(failed));
}
