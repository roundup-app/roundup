//! The App: starts a Daemon for each open Project and passes calls and events to the webview (`scenarios/app.md`).

mod config;
mod daemon;
mod state;
mod store;

use std::path::{Path, PathBuf};

pub use config::{CALL_BOUND, Config, READY_BOUND};
use contracts::Event;
use rpc::RpcError;
use serde_json::Value;
pub use state::{AppState, Listed, Project};
use tauri::ipc::Channel;
use tauri::{AppHandle, Builder, Manager, RunEvent, Runtime, State};

/// `exit` ends the App with a code; `run` passes `AppHandle::exit`. It is a parameter because the
/// mock runtime cannot exit and a test must see that a refused start asks for it.
pub fn build<R: Runtime>(
    builder: Builder<R>,
    config: Config,
    project_dir: Option<PathBuf>,
    exit: impl Fn(&AppHandle<R>, i32) + Send + 'static,
) -> Builder<R> {
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new(config))
        .invoke_handler(tauri::generate_handler![
            projects,
            open_project,
            close_project,
            rename_project,
            rpc,
            subscribe,
            daemon_proof
        ])
        .setup(move |app| {
            let state = app.state::<AppState>();
            match app.path().app_data_dir() {
                Ok(dir) => state.use_data_dir(dir),
                Err(err) => eprintln!(
                    "desktop: no data folder, so names and open Projects are not kept: {err}"
                ),
            }
            tauri::async_runtime::block_on(state.restore(app.handle()));
            if let Some(project_dir) = project_dir
                && let Err(err) =
                    tauri::async_runtime::block_on(state.open_project(app.handle(), &project_dir))
            {
                // An Err from setup makes Tauri panic (SIGABRT); a refused start is not a bug.
                eprintln!(
                    "{}",
                    serde_json::to_string(&err).expect("RpcError is plain data")
                );
                exit(app.handle(), 1);
            }
            Ok(())
        })
}

/// The Tauri context built from `tauri.conf.json` and `capabilities/`; tests build it on the mock
/// runtime to check what the webview is allowed to call. Defined once because embedding it twice
/// in one test binary is a duplicate-symbol linker warning.
pub fn context<R: Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

pub fn handle_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit) {
        app.state::<AppState>().close();
    }
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let project_dir = std::env::args_os()
        .nth(1)
        .map(std::path::absolute)
        .transpose()?;
    build(
        tauri::Builder::default(),
        config,
        project_dir,
        |app, code| app.exit(code),
    )
    .build(context())?
    .run(|app, event| handle_run_event(app, &event));
    Ok(())
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
) -> Result<Project, RpcError> {
    state.rename_project(&path, &name)
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
) -> Result<(), RpcError> {
    state.subscribe(&path, channel).await
}

#[tauri::command]
fn daemon_proof(state: State<'_, AppState>, path: String) -> Result<String, RpcError> {
    state.daemon_proof(&path)
}
