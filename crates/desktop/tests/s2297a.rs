//! S2297a (`scenarios/app.md`): the webview renders at the display's rate.

#[cfg(target_vendor = "apple")]
mod webkit {
    use desktop::webkit_rate::{Missing, is_on, new_preferences, turn_off, webkit_features};
    use objc2::runtime::NSObject;
    use objc2_foundation::NSArray;

    pub fn s2297a_the_setup_turns_the_near_60_fps_feature_off() {
        let preferences = new_preferences().expect("WebKit has WKPreferences");
        let features = webkit_features().expect("this WebKit lists its features");
        assert_eq!(
            is_on(&preferences),
            Some(true),
            "WebKit ships the feature on"
        );
        turn_off(&preferences, Some(&*features)).unwrap();
        assert_eq!(is_on(&preferences), Some(false));
    }

    pub fn s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so() {
        let preferences = new_preferences().expect("WebKit has WKPreferences");
        let features = webkit_features().expect("this WebKit lists its features");

        let gap = turn_off(&preferences, None).unwrap_err();
        assert_eq!(gap, Missing::Features);
        assert!(gap.to_string().contains("_features"));

        let no_setter = NSObject::new();
        let gap = turn_off(&no_setter, Some(&*features)).unwrap_err();
        assert_eq!(gap, Missing::Setter);
        assert!(gap.to_string().contains("_setEnabled:forFeature:"));

        let empty = NSArray::new();
        let gap = turn_off(&preferences, Some(&*empty)).unwrap_err();
        assert_eq!(gap, Missing::Feature);
        assert!(
            gap.to_string()
                .contains("PreferPageRenderingUpdatesNear60FPSEnabled")
        );
        assert_eq!(is_on(&preferences), Some(true), "a gap changes nothing");
    }
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
            "s2297a_the_setup_turns_the_near_60_fps_feature_off",
            webkit::s2297a_the_setup_turns_the_near_60_fps_feature_off,
        ),
        #[cfg(target_vendor = "apple")]
        (
            "s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so",
            webkit::s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so,
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
            || !args.iter().any(|arg| arg.starts_with("s2297a_"));
        if wanted {
            let ok = std::panic::catch_unwind(test).is_ok();
            println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
            failed |= !ok;
        }
    }
    std::process::exit(i32::from(failed));
}
