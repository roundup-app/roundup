//! The App: starts a Daemon for each open Project and passes calls and events to the webview (`scenarios/app.md`).

pub mod alert;
mod config;
mod daemon;
mod diagnostics;
mod facts;
#[cfg(any(test, feature = "idle-perf"))]
mod idle;
mod launch;
mod menu;
mod open;
mod paste;
mod state;
mod store;
mod window;

use std::path::{Path, PathBuf};

pub use config::{CALL_BOUND, Config, READY_BOUND};
use contracts::Event;
use rpc::RpcError;
use serde_json::Value;
pub use state::{AppState, Listed, Project};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Builder, Manager, RunEvent, Runtime, State};

/// `exit` ends the App with a code; `run` passes `AppHandle::exit`. It is a parameter because the
/// mock runtime cannot exit and a test must see that a refused start asks for it.
pub fn build<R: Runtime>(
    builder: Builder<R>,
    config: Config,
    project_dir: Option<PathBuf>,
    exit: impl Fn(&AppHandle<R>, i32) + Send + 'static,
) -> Builder<R> {
    let builder = builder.manage(std::sync::Mutex::new(launch::Delivery::default()));
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
        .manage(AppState::new(config))
        .manage(menu::Choice::default())
        .manage(menu::ProjectMenu::default())
        .menu(menu::app_menu)
        .on_menu_event(|app, event| handle_menu_event(app, &event))
        .invoke_handler(invoke_handler())
        .setup(move |app| {
            app.manage(std::sync::Arc::new(alert::Alerts::new(Box::new(alert::Plugin(app.handle().clone())))));
            #[cfg(target_vendor = "apple")]
            native::project_menu_hints(app.handle(), Vec::new())?;
            let state = app.state::<AppState>();
            match app.path().app_data_dir() {
                Ok(dir) => state.use_data_dir(dir),
                Err(err) => diagnostics::failure("locate data folder; names and open Projects are not retained", &err),
            }
            tauri::async_runtime::block_on(state.restore(app.handle()));
            if let Some(ref project_dir) = project_dir
                && let Err(err) =
                    tauri::async_runtime::block_on(state.open_project(app.handle(), project_dir))
            {
                // An Err from setup makes Tauri panic (SIGABRT); a refused start is not a bug.
                log::warn!(target: "roundup::shell", "open startup Project: RPC failure code {}", err.code);
                exit(app.handle(), 1);
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

fn invoke_handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    let handler: fn(tauri::ipc::Invoke<R>) -> bool = tauri::generate_handler![
        launch::native_open,
        ask_removal,
        projects,
        recent_projects,
        claude_binary,
        open_project,
        close_project,
        rename_project,
        rpc,
        subscribe,
        terminal_output,
        terminal_output_stop,
        open_target,
        open_in_editor,
        alert::state_alert,
        save_pasted_image,
        menu::select_project_menu,
        menu::show_context_menu
    ];
    #[cfg(feature = "idle-perf")]
    let handler = idle::with_handler(handler);
    handler
}

/// The Tauri context built from `tauri.conf.json` and `capabilities/`; tests build it on the mock
/// runtime to check what the webview is allowed to call. Defined once because embedding it twice
/// in one test binary is a duplicate-symbol linker warning.
pub fn context<R: Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

/// Dispatch the native menu event through the same path used by the App builder.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: &tauri::menu::MenuEvent) {
    menu::app_chosen(app, event);
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
    )?;
    let config = Config::from_env()?;
    let context = config.context()?;
    let project_dir = std::env::args_os()
        .nth(1)
        .filter(|argument| !argument.to_string_lossy().contains("://"))
        .map(std::path::absolute)
        .transpose()?;
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(launch::second_launch));
    diagnostics::startup(
        build(
            builder.plugin(diagnostics::plugin()),
            config,
            project_dir,
            |app, code| app.exit(code),
        )
        .build(context),
    )?
    .run(|app, event| handle_run_event(app, &event));
    Ok(())
}

#[tauri::command]
fn recent_projects(state: State<'_, AppState>) -> Vec<String> {
    state.recent_projects()
}

#[tauri::command]
async fn claude_binary(
    state: State<'_, AppState>,
) -> Result<Option<facts::ClaudeBinary>, RpcError> {
    Ok(state.claude_binary().await)
}

#[tauri::command]
fn projects(state: State<'_, AppState>) -> Vec<Listed> {
    state.projects()
}

#[tauri::command]
async fn open_project<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    path: String,
) -> Result<Project, RpcError> {
    state.open_project(&app, Path::new(&path)).await
}

#[tauri::command]
fn close_project(state: State<'_, AppState>, path: String) -> Result<(), RpcError> {
    state.close_project(&path)
}

#[tauri::command]
fn rename_project(
    state: State<'_, AppState>,
    path: String,
    name: String,
    base: Option<String>,
) -> Result<Project, RpcError> {
    state.rename_project(&path, &name, base.as_deref())
}

#[tauri::command]
async fn rpc(
    state: State<'_, AppState>,
    path: String,
    method: String,
    params: Value,
) -> Result<Value, RpcError> {
    state.rpc(&path, &method, params).await
}

#[tauri::command]
async fn subscribe(
    state: State<'_, AppState>,
    path: String,
    channel: Channel<Event>,
    after: Option<u64>,
) -> Result<u64, RpcError> {
    state.subscribe(&path, channel, after).await
}

/// X14: raw `ArrayBuffer` bodies of one Terminal's bytes, and JSON gaps, on one ordered channel.
#[tauri::command]
async fn terminal_output(
    state: State<'_, AppState>,
    path: String,
    id: String,
    channel: Channel<InvokeResponseBody>,
) -> Result<u64, RpcError> {
    state.terminal_output(&path, &id, channel).await
}

#[tauri::command]
fn terminal_output_stop(
    state: State<'_, AppState>,
    path: String,
    id: String,
) -> Result<(), RpcError> {
    state.terminal_output_stop(&path, &id)
}

#[tauri::command]
fn open_target(target: open::Target) -> Result<(), RpcError> {
    open::launch(&open::check(target)?)
}

#[tauri::command]
async fn open_in_editor(path: String, line: Option<u32>) -> Result<(), RpcError> {
    // LaunchServices discovery waits for the system, so it must not block the window's event loop.
    tauri::async_runtime::spawn_blocking(move || open::open_in_editor(&path, line))
        .await
        .map_err(|error| RpcError::new(rpc::code::INTERNAL, error.to_string()))?
}

/// The image's bytes are the request body and its media type the `type` header, so no byte list crosses as JSON.
#[tauri::command]
fn save_pasted_image(request: tauri::ipc::Request<'_>) -> Result<String, RpcError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(RpcError::new(
            rpc::code::INVALID_PARAMS,
            "the image's bytes are the request body",
        ));
    };
    let media_type = request
        .headers()
        .get("type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    paste::save_in_cache(media_type, bytes).map(|path| path.display().to_string())
}

/// The three removal answers have distinct authority; a native failure grants none.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemovalQuestion {
    title: String,
    message: String,
    this_label: String,
    all_label: String,
    cancel_label: String,
}

#[tauri::command]
async fn ask_removal<R: Runtime>(
    app: AppHandle<R>,
    question: RemovalQuestion,
) -> Result<String, RpcError> {
    #[cfg(target_vendor = "apple")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        native::removal_alert(
            &app,
            question.title,
            question.message,
            [
                question.this_label,
                question.all_label,
                question.cancel_label,
            ],
            move |answer| {
                let _ = send.send(answer.to_owned());
            },
        )
        .map_err(|error| RpcError::new(rpc::code::INTERNAL, error.to_string()))?;
        receive
            .await
            .map_err(|error| RpcError::new(rpc::code::INTERNAL, error.to_string()))
    }
    #[cfg(not(target_vendor = "apple"))]
    {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
        let (send, receive) = tokio::sync::oneshot::channel();
        let yes = question.this_label.clone();
        let no = question.all_label.clone();
        app.dialog()
            .message(question.message)
            .title(question.title)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                question.this_label,
                question.all_label,
                question.cancel_label,
            ))
            .show_with_result(move |result| {
                let answer = match result {
                    MessageDialogResult::Custom(label) if label == yes => "this",
                    MessageDialogResult::Custom(label) if label == no => "all",
                    _ => "cancel",
                };
                let _ = send.send(answer.to_owned());
            });
        receive
            .await
            .map_err(|error| RpcError::new(rpc::code::INTERNAL, error.to_string()))
    }
}
