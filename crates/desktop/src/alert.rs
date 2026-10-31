//! `state_alert`: the macOS banner and sound the webview asks for when an Agent's Kind becomes a state the owner turned on
//! (`scenarios/ui-state-alerts.md` U5232e to U5232g). The App raises nothing of its own.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use rpc::{RpcError, code};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_notification::{NotificationExt, PermissionState};

/// The event the webview hears when the owner clicks a banner.
pub const CLICKED: &str = "state-alert-clicked";

#[derive(Debug, Deserialize)]
pub struct Request {
    agent: String,
    title: String,
    body: String,
    alert: bool,
    sound: bool,
}

/// What the system is asked to do; the plugin answers it in the App and a fake answers it in tests.
pub trait Notifier: Send + Sync {
    /// `Err` carries the cause of a refusal.
    fn permission(&self) -> Result<(), String>;
    fn banner(&self, agent: &str, title: &str, body: &str) -> Result<(), String>;
    fn sound(&self);
}

pub struct Alerts {
    notifier: Box<dyn Notifier>,
    /// The answer of the one permission request; a refusal is kept and returned, never asked again.
    permission: Mutex<Option<Result<(), String>>>,
}

impl Alerts {
    pub fn new(notifier: Box<dyn Notifier>) -> Self {
        Self {
            notifier,
            permission: Mutex::new(None),
        }
    }

    pub fn raise(&self, request: &Request) -> Result<(), RpcError> {
        if !request.alert && !request.sound {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "invalid: a state alert needs an alert or a sound",
            ));
        }
        if request.sound {
            self.notifier.sound();
        }
        if !request.alert {
            return Ok(());
        }
        let permission = self
            .permission
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get_or_insert_with(|| self.notifier.permission())
            .clone();
        permission.map_err(|cause| {
            RpcError::new(code::FORBIDDEN, format!("notifications refused: {cause}"))
        })?;
        self.notifier
            .banner(&request.agent, &request.title, &request.body)
            .map_err(RpcError::internal)
    }
}

/// The system banner, through `tauri-plugin-notification`; the sound is the system player's, since the plugin has no sound-only call.
pub struct Plugin<R: Runtime> {
    app: AppHandle<R>,
    /// Which Agent each shown banner names, by the id the plugin reports back on a click.
    shown: Arc<Mutex<HashMap<i32, String>>>,
    next: AtomicI32,
}

impl<R: Runtime> Plugin<R> {
    /// Listens for banner clicks; the plugin must already be installed on the App.
    pub fn new(app: AppHandle<R>) -> Result<Self, tauri_plugin_notification::Error> {
        let shown = Arc::new(Mutex::new(HashMap::<i32, String>::new()));
        let (handle, lookup) = (app.clone(), shown.clone());
        app.notification().on_action(move |performed| {
            let Some(notification) = performed.notification() else {
                return;
            };
            let agent = lookup
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(&notification.id())
                .cloned();
            if let Some(agent) = agent {
                clicked(&handle, &agent);
            }
        })?;
        Ok(Self {
            app,
            shown,
            next: AtomicI32::new(1),
        })
    }
}

impl<R: Runtime> Notifier for Plugin<R> {
    fn permission(&self) -> Result<(), String> {
        match self.app.notification().request_permission() {
            Ok(PermissionState::Granted) => Ok(()),
            Ok(state) => Err(format!("permission is {state}")),
            Err(error) => Err(error.to_string()),
        }
    }

    fn banner(&self, agent: &str, title: &str, body: &str) -> Result<(), String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.shown
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(id, agent.to_owned());
        self.app
            .notification()
            .builder()
            .id(id)
            .title(title)
            .body(body)
            .show()
            .map_err(|error| error.to_string())
    }

    fn sound(&self) {
        #[cfg(target_os = "macos")]
        if let Err(error) = std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .spawn()
        {
            log::warn!(target: "roundup::shell", "play state alert sound: {error}");
        }
    }
}

/// Reports a click on a banner: the window comes to the front and the webview hears whose banner it was.
pub fn clicked<R: Runtime>(app: &AppHandle<R>, agent: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(error) = app.emit(CLICKED, serde_json::json!({ "agent": agent })) {
        log::warn!(target: "roundup::shell", "report state alert click: {error}");
    }
}

#[tauri::command]
pub fn state_alert(alerts: State<'_, Arc<Alerts>>, request: Request) -> Result<(), RpcError> {
    alerts.raise(&request)
}
