//! The App's entry points: the Tauri context, run events and `run`.

use tauri::{AppHandle, Manager, RunEvent, Runtime};

#[cfg(feature = "idle-perf")]
use crate::idle;
use crate::{AppState, Channel, Config, build_with_feedback, diagnostics};

/// The Tauri context built from `tauri.conf.json` and `capabilities/`; tests build it on the mock
/// runtime to check what the webview is allowed to call. Defined once because embedding it twice
/// in one test binary is a duplicate-symbol linker warning.
pub fn context<R: Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

/// Dispatch the native menu event through the same path used by the App builder.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::menu::MenuEvent) {
    crate::menu::app_chosen(app, event);
    #[cfg(target_os = "macos")]
    crate::menu_bar::dock_chosen(app, event.id().as_ref());
}

pub fn handle_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit) {
        app.state::<AppState>().close();
    }
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(feature = "idle-perf")]
    idle::guard(
        std::env::var("ROUNDUP_ALLOW_WINDOW").ok().as_deref(),
        std::env::var_os("ROUNDUP_DATA_DIR").as_deref(),
        std::env::var_os("ROUNDUP_IDLE_EVIDENCE_DIR").as_deref(),
    )
    .inspect_err(|cause| {
        diagnostics::report("check idle performance profile", cause);
    })?;
    let context = crate::context();
    let channel = Channel::of(&context.config().identifier);
    // CH7077d: opened from Finder, an installed build has launchd's PATH; it takes the login
    // shell's, so `claude` and `herdr-core` resolve. Before any thread starts, as it sets PATH.
    if channel.installed()
        && let Err(error) = fix_path_env::fix()
    {
        let cause = match error {
            fix_path_env::Error::Shell(error) => format!("IO {:?}", error.kind()),
            fix_path_env::Error::InvalidOutput(_) => "unreadable shell output".to_owned(),
            fix_path_env::Error::EchoFailed(_) => "the login shell failed".to_owned(),
        };
        diagnostics::report("read the login shell's PATH", &cause);
    }
    let config = Config::from_env(channel).inspect_err(|cause| {
        diagnostics::report("configure App", &cause.to_string());
    })?;
    let context = config.apply(context).inspect_err(|error| {
        diagnostics::report("resolve App context", &format!("IO {:?}", error.kind()));
    })?;
    let project_dir = std::env::args_os()
        .nth(1)
        .filter(|argument| !argument.to_string_lossy().contains("://"))
        .map(std::path::absolute)
        .transpose()
        .inspect_err(|error| {
            diagnostics::report("resolve startup Project", &format!("IO {:?}", error.kind()));
        })?;
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        crate::launch::second_launch,
    ));
    diagnostics::startup(|| {
        build_with_feedback(
            builder.plugin(diagnostics::plugin()),
            config,
            project_dir,
            diagnostics::message,
        )
        .build(context)?
        .run(|app, event| handle_run_event(app, &event));
        Ok(())
    })?;
    Ok(())
}
