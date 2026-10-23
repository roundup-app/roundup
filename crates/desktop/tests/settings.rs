//! U3799: probe the built application's native menu and its event, without a webview.
use desktop::{Config, build, handle_menu_event};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tauri::Listener;
use tauri::menu::{MenuEvent, MenuItemKind};
use tauri::test::{mock_builder, mock_context, noop_assets};

#[test]
fn s_u3799_the_app_menu_holds_settings_with_cmd_comma_and_emits_open_app_settings() {
    let directory = tempfile::tempdir().unwrap();
    let mut config = Config::locate(
        None,
        &directory.path().join("roundup"),
        directory.path(),
        std::process::id(),
    )
    .unwrap();
    config.data_dir = Some(directory.path().join("data"));
    let app = build(mock_builder(), config, None, |_, _| {})
        .build(mock_context(noop_assets()))
        .unwrap();
    let MenuItemKind::Submenu(application) = app.menu().unwrap().items().unwrap().remove(0) else {
        panic!("no application menu")
    };
    let MenuItemKind::MenuItem(settings) = application.items().unwrap().remove(1) else {
        panic!("no settings item under About")
    };
    assert_eq!(settings.text().unwrap(), "Settings…");
    assert_eq!(settings.id().0, "app-settings");
    let count = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&count);
    app.listen("open-app-settings", move |_| {
        observed.fetch_add(1, Ordering::SeqCst);
    });
    handle_menu_event(
        app.handle(),
        &MenuEvent {
            id: settings.id().clone(),
        },
    );
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
