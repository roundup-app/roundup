//! S2297a (`scenarios/app.md`): the webview renders at the display's rate.

#[cfg(target_vendor = "apple")]
mod webkit {
    use desktop::webkit_rate::{Missing, is_on, new_preferences, turn_off, webkit_features};
    use objc2::runtime::NSObject;
    use objc2_foundation::NSArray;

    #[test]
    fn s2297a_the_setup_turns_the_near_60_fps_feature_off() {
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

    #[test]
    fn s2297a_a_webkit_without_the_feature_keeps_its_rate_and_says_so() {
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

#[test]
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
