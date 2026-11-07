//! The App: starts a Daemon for each open Project and passes calls and events to the webview (`scenarios/app.md`).

pub mod alert;
mod config;
mod daemon;
mod diagnostics;
mod facts;
mod feedback;
mod fork;
mod fork_app;
#[cfg(any(test, feature = "idle-perf"))]
mod idle;
mod launch;
mod menu;
mod menu_bar;
mod navigation;
mod open;
mod paste;
mod reopen;
mod state;
mod store;
mod update;
mod window;

use std::path::{Path, PathBuf};

pub use config::{CALL_BOUND, Config, READY_BOUND};
use contracts::Event;
use rpc::RpcError;
use serde_json::Value;
pub use state::{AppState, Listed, Project};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Builder, Manager, RunEvent, Runtime, State};

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

fn build_with_feedback<R: Runtime>(
    builder: Builder<R>,
    config: Config,
    project_dir: Option<PathBuf>,
    feedback: impl Fn(&AppHandle<R>, String, Option<i32>) + Send + 'static,
) -> Builder<R> {
    let data_dir = config.data_dir.clone();
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
        .plugin(navigation::plugin())
        .manage(fork_app::Identity::of(config.data_dir.as_deref()))
        .manage(AppState::new(config))
        .manage(menu::Choice::default())
        .manage(menu::ProjectMenu::default())
        .manage(menu_bar::MenuBar::<R>::default())
        .menu(menu::app_menu)
        .on_menu_event(|app, event| handle_menu_event(app, &event))
        .invoke_handler(invoke_handler())
        .setup(move |app| {
            app.manage(std::sync::Arc::new(alert::Alerts::new(Box::new(
                alert::Plugin(app.handle().clone()),
            ))));
            show_fork(app, data_dir.as_deref());
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

fn invoke_handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    let handler: fn(tauri::ipc::Invoke<R>) -> bool = tauri::generate_handler![
        launch::native_open,
        ask_removal,
        projects,
        recent_projects,
        claude_binary,
        open_project,
        canonical_project_path,
        close_project,
        exit_for_update,
        fork_branch,
        fork_make,
        rename_project,
        rpc,
        subscribe,
        action_serve,
        action_answer,
        terminal_output,
        terminal_output_stop,
        open_target,
        open_in_editor,
        list_editors,
        alert::state_alert,
        save_pasted_image,
        feedback::feedback_capture,
        menu_bar::set_menu_bar,
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
    #[cfg(target_os = "macos")]
    menu_bar::dock_chosen(app, event.id().as_ref());
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
    let config = Config::from_env().inspect_err(|cause| {
        diagnostics::report("configure App", cause);
    })?;
    let context = config.context().inspect_err(|error| {
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
    let builder = builder.plugin(tauri_plugin_single_instance::init(launch::second_launch));
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

#[tauri::command]
fn recent_projects(state: State<'_, AppState>) -> Result<Vec<String>, RpcError> {
    state.recent_projects()
}

#[tauri::command]
async fn claude_binary(
    state: State<'_, AppState>,
) -> Result<Option<facts::ClaudeBinary>, RpcError> {
    Ok(state.claude_binary().await)
}

#[tauri::command]
fn projects(state: State<'_, AppState>) -> Result<Vec<Listed>, RpcError> {
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
fn canonical_project_path(path: String) -> Result<String, RpcError> {
    Path::new(&path)
        .canonicalize()
        .map(|resolved| resolved.display().to_string())
        .map_err(|error| {
            RpcError::new(
                rpc::code::INVALID_PARAMS,
                format!("cannot resolve Project folder {path}: {error}"),
            )
        })
}

#[tauri::command]
fn close_project(state: State<'_, AppState>, path: String) -> Result<(), RpcError> {
    state.close_project(&path)
}

/// S5981a: ends every Daemon without stopping its Agents, then exits the App.
#[tauri::command]
async fn exit_for_update<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), RpcError> {
    state.exit_for_update().await?;
    // After the answer: the exit tears the webview down, so the call would never return.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        app.exit(0);
    });
    Ok(())
}

/// FS5979: the branch the live App's source checkout is on.
#[tauri::command]
async fn fork_branch() -> Result<String, RpcError> {
    tokio::task::spawn_blocking(|| fork::branch(&fork::checkout()))
        .await
        .map_err(RpcError::internal)
}

/// FS5979: makes the Fork with `data.fork` through an open Project's Daemon, then starts the branch's App on it.
#[tauri::command]
async fn fork_make(
    state: State<'_, AppState>,
    name: String,
    colour: contracts::data::ForkColour,
    projects: Vec<fork::Pick>,
) -> Result<(), RpcError> {
    let home = update::home().ok_or_else(|| RpcError::internal("no home folder for the Fork"))?;
    let live = state
        .projects()?
        .into_iter()
        .find(|listed| listed.running)
        .ok_or_else(|| RpcError::internal("open a Project to fork"))?;
    let first = projects
        .first()
        .map(|pick| pick.key.clone())
        .ok_or_else(|| RpcError::new(rpc::code::INVALID_PARAMS, "tick at least one Project"))?;
    let folder = fork::fork_path(&home, &name);
    let params = fork::params(name, colour, &projects, &folder)?;
    let reply = state
        .rpc(&live.path, "data.fork", serde_json::json!(params))
        .await?;
    serde_json::from_value::<contracts::data::ForkResult>(reply).map_err(RpcError::internal)?;
    // FA5980b: a failed make leaves no bundle and does not stop the Fork from opening plain.
    if let Err(error) = std::env::current_exe()
        .map_err(|error| error.to_string())
        .and_then(|binary| fork_app::make(&folder, &binary))
    {
        log::warn!("make the Fork's .app: {error}");
    }
    let checkout = fork::checkout();
    tokio::task::spawn_blocking(move || fork::open(&checkout, &folder, &first))
        .await
        .map_err(RpcError::internal)?
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
    params: Option<contracts::SubscribeParams>,
) -> Result<u64, RpcError> {
    state.subscribe(&path, channel, params).await
}

/// NA6: the webview answers the Daemon's relayed `action.list` and `action.run`.
#[tauri::command]
async fn action_serve(
    state: State<'_, AppState>,
    path: String,
    channel: Channel<serde_json::Value>,
    registration: String,
) -> Result<(), RpcError> {
    state.action_serve(&path, channel, registration).await
}

#[tauri::command]
async fn action_answer(
    state: State<'_, AppState>,
    path: String,
    line: serde_json::Value,
    registration: String,
) -> Result<(), RpcError> {
    state.action_answer(&path, &registration, line).await
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
async fn open_target(target: open::Target, editor: Option<String>) -> Result<(), RpcError> {
    // LaunchServices discovery waits for the system, so it must not block the window's event loop.
    tauri::async_runtime::spawn_blocking(move || {
        open::launch(&open::check(target)?, editor.as_deref())
    })
    .await
    .map_err(|error| RpcError::new(rpc::code::INTERNAL, error.to_string()))?
}

/// U6372a: the code editors of the Settings choice that are installed.
#[tauri::command]
async fn list_editors() -> Result<Vec<open::EditorChoice>, RpcError> {
    tauri::async_runtime::spawn_blocking(open::installed_editors)
        .await
        .map_err(|error| RpcError::new(rpc::code::INTERNAL, error.to_string()))
}

#[tauri::command]
async fn open_in_editor(
    path: String,
    line: Option<u32>,
    editor: Option<String>,
) -> Result<(), RpcError> {
    // LaunchServices discovery waits for the system, so it must not block the window's event loop.
    tauri::async_runtime::spawn_blocking(move || {
        open::open_in_editor(&path, line, editor.as_deref())
    })
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
