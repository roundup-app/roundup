//! S2297a (`scenarios/app.md`): the webview renders at the display's rate.

#[cfg(target_vendor = "apple")]
mod capture_panel;
mod saved_window;
mod store_durability;

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
    let app = build(mock_builder(), config, None, |app, code| app.exit(code))
        .build(context)
        .expect("the App builds from tauri.conf.json");
    use tauri_plugin_store::StoreExt;
    app.store_builder("registration.json")
        .disable_auto_save()
        .build()
        .unwrap();
}

// WebKit asserts it is on the main thread, which libtest's worker threads are not, so this binary has its own `main`
// (`harness = false`) that speaks the part of libtest's protocol nextest uses: `--list` and `--exact <name>`.
fn main() {
    // Compile native observers everywhere; only AppKit CI executes them.
    #[cfg(not(target_vendor = "apple"))]
    let _native_observers: &[fn()] = &[
        saved_window::u3787e_restore_uses_saved_normal_bounds,
        saved_window::u3787e_missing_invalid_and_offscreen_state_are_reachable,
        saved_window::u3787e_missing_state_is_reachable,
        saved_window::u3787e_invalid_state_is_reachable,
        saved_window::u3787e_corrupt_state_is_reachable,
        saved_window::u3787e_maximized_state_keeps_normal_bounds,
        saved_window::u3787e_fullscreen_state_keeps_normal_bounds,
    ];

    let tests: &[(&str, fn())] = &[
        #[cfg(target_vendor = "apple")]
        ("u3787e_restore_uses_saved_normal_bounds", saved_window::u3787e_restore_uses_saved_normal_bounds),
        #[cfg(target_vendor = "apple")]
        ("u3787e_missing_invalid_and_offscreen_state_are_reachable", saved_window::u3787e_missing_invalid_and_offscreen_state_are_reachable),
        #[cfg(target_vendor = "apple")]
        ("u3787e_missing_state_is_reachable", saved_window::u3787e_missing_state_is_reachable),
        #[cfg(target_vendor = "apple")]
        ("u3787e_invalid_state_is_reachable", saved_window::u3787e_invalid_state_is_reachable),
        #[cfg(target_vendor = "apple")]
        ("u3787e_corrupt_state_is_reachable", saved_window::u3787e_corrupt_state_is_reachable),
        #[cfg(target_vendor = "apple")]
        ("u3787e_maximized_state_keeps_normal_bounds", saved_window::u3787e_maximized_state_keeps_normal_bounds),
        #[cfg(target_vendor = "apple")]
        ("u3787e_fullscreen_state_keeps_normal_bounds", saved_window::u3787e_fullscreen_state_keeps_normal_bounds),
        #[cfg(target_vendor = "apple")]
        ("u3787f_panel_uses_invoking_display", capture_panel::u3787f_panel_uses_invoking_display),
        #[cfg(target_vendor = "apple")]
        ("u3787f_panel_does_not_activate_main_window", capture_panel::u3787f_panel_does_not_activate_main_window),
        ("u3787f_store_migrates_all_key_families_native_reopen", store_durability::u3787f_store_migrates_all_key_families_native_reopen),
        #[cfg(target_os = "linux")]
        ("u3787f_failed_migration_keeps_recovery_native_readback", store_durability::u3787f_failed_migration_keeps_recovery_native_readback),
        ("u3787f_interrupted_migration_preserves_both_stores_native_reopen", store_durability::u3787f_interrupted_migration_preserves_both_stores_native_reopen),
        ("u3787f_failed_migration_keeps_recovery_native_invalid_existing", store_durability::u3787f_failed_migration_keeps_recovery_native_invalid_existing),
        ("u3787f_failed_migration_keeps_recovery_native_serialization", store_durability::u3787f_failed_migration_keeps_recovery_native_serialization),
        ("u3787f_failed_migration_keeps_recovery_native_partial_write", store_durability::u3787f_failed_migration_keeps_recovery_native_partial_write),
        #[cfg(target_os = "linux")]
        ("u3787f_failed_migration_keeps_recovery_native_commit", store_durability::u3787f_failed_migration_keeps_recovery_native_commit),
        #[cfg(target_os = "linux")]
        ("u3787f_interrupted_migration_preserves_both_stores_native_before_commit", store_durability::u3787f_interrupted_migration_preserves_both_stores_native_before_commit),

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
            || !args.iter().any(|arg| {
                arg.starts_with("s2297a_")
                    || arg.starts_with("u3787f_")
                    || arg.starts_with("u3787e_")
            });
        if wanted {
            let ok = std::panic::catch_unwind(test).is_ok();
            println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
            failed |= !ok;
        }
    }
    std::process::exit(i32::from(failed));
}
