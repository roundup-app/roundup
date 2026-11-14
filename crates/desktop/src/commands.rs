//! The commands the webview invokes, and the handler that registers them.

use std::path::Path;

use contracts::Event;
use rpc::RpcError;
use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Runtime, State};

#[cfg(feature = "idle-perf")]
use crate::idle;
use crate::{
    AppState, Listed, Project, alert, facts, feedback, fork, fork_app, launch, menu, menu_bar,
    open, paste,
};

pub(crate) fn invoke_handler<R: Runtime>()
-> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
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
    fork::require_checkout(&fork::checkout())?;
    let home = fork::home(|name| std::env::var_os(name))
        .ok_or_else(|| RpcError::internal("no home folder for the Fork"))?;
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
