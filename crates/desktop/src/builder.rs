//! Builds the App: plugins, managed state, menu and the setup that starts the Projects.

use std::path::{Path, PathBuf};

use rpc::RpcError;
use tauri::{AppHandle, Builder, Manager, Runtime};

#[cfg(feature = "idle-perf")]
use crate::idle;
use crate::{
    AppState, Config, alert, commands, diagnostics, fork_app, launch, menu, menu_bar, navigation,
    updater, window,
};

/// Build with stderr feedback and an observable fatal exit. The native entry point additionally
/// presents dialogs through `build_with_feedback`; mock runtimes never open OS dialogs here.
pub fn build<R: Runtime>(
    builder: Builder<R>,
    config: Config,
    project_dir: Option<PathBuf>,
    exit: impl Fn(&AppHandle<R>, i32) + Send + 'static,
) -> Builder<R> {
    build_with_feedback(builder, config, project_dir, move |app, _, code| {
        if let Some(code) = code {
            exit(app, code);
        }
    })
}

pub(crate) fn build_with_feedback<R: Runtime>(
    builder: Builder<R>,
    config: Config,
    project_dir: Option<PathBuf>,
    feedback: impl Fn(&AppHandle<R>, String, Option<i32>) + Send + 'static,
) -> Builder<R> {
    let data_dir = config.data_dir.clone();
    let dev_port = config.dev_port.unwrap_or(navigation::DEFAULT_DEV_PORT);
    let installed = config.channel.installed();
    let refusal = config.refusal.clone();
    let builder = builder.manage(std::sync::Mutex::new(launch::Delivery::default()));
    // CH7077e: only an installed build has a feed to read.
    let builder = if installed {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };
    #[cfg(target_os = "macos")]
    let builder = builder
        .plugin(launch::plugin())
        .plugin(tauri_plugin_deep_link::init());
    #[cfg(target_vendor = "apple")]
    let builder = native::register_capture(builder.plugin(native::plugin()));
    #[cfg(feature = "idle-perf")]
    let builder = builder.plugin(idle::plugin());
    builder
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(window::plugin())
        .plugin(navigation::plugin(dev_port))
        .manage(fork_app::Identity::of(config.data_dir.as_deref()))
        .manage(AppState::new(config))
        .manage(menu::Choice::default())
        .manage(menu::ProjectMenu::default())
        .manage(menu_bar::MenuBar::<R>::default())
        .menu(menu::app_menu)
        .on_menu_event(|app, event| crate::handle_menu_event(app, &event))
        .invoke_handler(commands::invoke_handler())
        .setup(move |app| {
            app.manage(std::sync::Arc::new(alert::Alerts::new(Box::new(
                alert::Plugin(app.handle().clone()),
            ))));
            log::info!(target: "roundup::shell", "start App {}", app.package_info().version);
            // CH7077a, CH7077c: a build that must open nothing says why before any Daemon starts.
            if let Some(refusal) = refusal.clone() {
                let message = diagnostics::report("open roundup", &refusal);
                feedback(app.handle(), message, Some(1));
                return Ok(());
            }
            show_fork(app, data_dir.as_deref());
            if installed {
                updater::watch(app.handle());
            }
            #[cfg(target_vendor = "apple")]
            native::project_menu_hints(app.handle(), Vec::new())?;
            let state = app.state::<AppState>();
            let initialized = app
                .path()
                .app_data_dir()
                .map_err(|error| {
                    RpcError::internal({
                        diagnostics::failure("locate App data folder", &error);
                        "App data folder unavailable".to_owned()
                    })
                })
                .and_then(|dir| state.use_data_dir(dir));
            if let Err(error) = initialized {
                let message = diagnostics::report("refuse Project preferences", &error.message);
                feedback(app.handle(), message, Some(1));
                return Ok(());
            }
            if let Err(error) = tauri::async_runtime::block_on(
                state.restore_with_feedback(app.handle(), |message| {
                    feedback(app.handle(), message, None)
                }),
            ) {
                let message = diagnostics::report("restore Project preferences", &error.message);
                feedback(app.handle(), message, Some(1));
                return Ok(());
            }
            if let Some(ref project_dir) = project_dir
                && let Err(err) =
                    tauri::async_runtime::block_on(state.open_project(app.handle(), project_dir))
            {
                // An Err from setup makes Tauri panic (SIGABRT); a refused start is not a bug.
                let message =
                    state.report_project_failure("open startup Project", project_dir, &err)?;
                feedback(app.handle(), message, Some(1));
                return Ok(());
            }
            if let Some(path) = project_dir {
                launch::deliver(
                    app.handle(),
                    launch::NativeOpen::Project {
                        path: path.to_string_lossy().into_owned(),
                    },
                );
            }
            Ok(())
        })
}

/// FA5980c, FA5980d: a Fork App sets its own Dock icon and window title; the live App sets neither.
fn show_fork<R: Runtime>(app: &mut tauri::App<R>, data_dir: Option<&Path>) {
    let identity = app.state::<fork_app::Identity>();
    let Some(fork) = identity.0.clone() else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&fork_app::window_title(Some(&fork.name), "roundup"));
    }
    #[cfg(not(target_vendor = "apple"))]
    let _ = data_dir;
    #[cfg(target_vendor = "apple")]
    if let Some(png) = data_dir
        .and_then(fork_app::fork_icon)
        .and_then(|image| fork_app::png(&image))
    {
        native::set_application_icon(&png);
    }
}
