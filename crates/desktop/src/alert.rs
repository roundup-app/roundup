//! `state_alert`: the macOS banner and sound the webview asks for when an Agent's Kind becomes a state the owner turned on
//! (`scenarios/ui-state-alerts.md` U5232e to U5232g). The App raises nothing of its own.

use std::sync::{Arc, Mutex};

use rpc::{RpcError, code};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

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

/// The system banner. macOS sends it through `mac-notification-sys` and plays the sound with its system sound player; the App ships on macOS only.
pub struct Plugin<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> Notifier for Plugin<R> {
    /// `mac-notification-sys` has no call to ask or read the permission: macOS asks the owner when the first banner is sent, and a refusal then shows as that send's error, logged by the banner thread. So the pre-check always passes.
    fn permission(&self) -> Result<(), String> {
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn banner(&self, agent: &str, title: &str, body: &str) -> Result<(), String> {
        bundle();
        let handle = self.0.clone();
        let (agent, title, body) = (agent.to_owned(), title.to_owned(), body.to_owned());
        std::thread::Builder::new()
            .name("state-alert".into())
            .spawn(move || {
                let sent = mac_notification_sys::Notification::new()
                    .title(&title)
                    .message(&body)
                    .wait_for_click(true)
                    .send();
                match sent {
                    Ok(mac_notification_sys::NotificationResponse::Click) => {
                        clicked(&handle, &agent)
                    }
                    Ok(_) => {}
                    Err(error) => log::warn!(target: "roundup::shell", "show state alert: {error}"),
                }
            })
            .map(drop)
            .map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    fn banner(&self, _agent: &str, _title: &str, _body: &str) -> Result<(), String> {
        Err("banners need macOS".into())
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

/// Sends banners as roundup (its icon, its permission, its click target) when running from the `.app` bundle; a dev build has no bundle and keeps the default sender.
#[cfg(target_os = "macos")]
fn bundle() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let bundled = std::env::current_exe()
            .is_ok_and(|exe| exe.to_string_lossy().contains(".app/Contents/"));
        if bundled && let Err(error) = mac_notification_sys::set_application("dev.roundup.app") {
            log::warn!(target: "roundup::shell", "set banner application: {error}");
        }
    });
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
