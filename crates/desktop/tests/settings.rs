//! U3799: probe the built application's native menu and its event, without a webview.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use desktop::{Config, build, handle_menu_event};
use std::sync::{
    Arc, Mutex,
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
    let Some(MenuItemKind::MenuItem(settings)) = application.get("app-settings") else {
        panic!("no settings item in the application menu")
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

#[test]
fn u7208f_the_update_item_emits_open_app_settings_with_updates() {
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
    let payloads = Arc::new(Mutex::new(Vec::new()));
    let observed = Arc::clone(&payloads);
    app.listen("open-app-settings", move |event| {
        observed.lock().unwrap().push(event.payload().to_owned());
    });
    for id in ["install-update", "app-settings"] {
        handle_menu_event(app.handle(), &MenuEvent { id: id.into() });
    }
    // Choosing Update available installs nothing and names the page; Settings… names none.
    assert_eq!(*payloads.lock().unwrap(), ["\"updates\"", "null"]);
}
