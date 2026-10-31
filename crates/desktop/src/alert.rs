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
    /// `Err` carries the cause of a refusal; `None` is a request the owner has not answered yet.
    fn permission(&self) -> Option<Result<(), String>>;
    fn banner(&self, agent: &str, title: &str, body: &str) -> Result<(), String>;
    fn sound(&self);
}

pub struct Alerts {
    notifier: Box<dyn Notifier>,
    /// The answer of the permission request; a grant or refusal is kept, an unanswered request is asked again on the next alert.
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
                "invalid: a State alert needs an alert or a sound",
            ));
        }
        if request.sound {
            self.notifier.sound();
        }
        if !request.alert {
            return Ok(());
        }
        let mut cached = self
            .permission
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if cached.is_none() {
            *cached = self.notifier.permission();
        }
        let Some(permission) = cached.clone() else {
            return Ok(());
        };
        drop(cached);
        permission.map_err(|cause| {
            RpcError::new(code::FORBIDDEN, format!("State alerts refused: {cause}"))
        })?;
        self.notifier
            .banner(&request.agent, &request.title, &request.body)
            .map_err(RpcError::internal)
    }
}

/// The system banner. macOS sends it through `mac-notification-sys`, reads the permission from `UNUserNotificationCenter` and plays the sound with `NSSound`; the App ships on macOS only.
pub struct Plugin<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> Notifier for Plugin<R> {
    /// Asks macOS once (it prompts the owner the first time) and returns the refusal as the cause. A dev build has no bundle, so there is no center to ask.
    fn permission(&self) -> Option<Result<(), String>> {
        #[cfg(target_os = "macos")]
        if is_bundled() {
            return authorize();
        }
        Some(Ok(()))
    }

    #[cfg(target_os = "macos")]
    fn banner(&self, agent: &str, title: &str, body: &str) -> Result<(), String> {
        bundle(&self.0.config().identifier);
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
        {
            use objc2_app_kit::NSSound;
            use objc2_foundation::ns_string;
            match NSSound::soundNamed(ns_string!("Glass")) {
                Some(sound) => {
                    sound.play();
                }
                None => {
                    log::warn!(target: "roundup::shell", "play state alert sound: no Glass sound")
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn is_bundled() -> bool {
    std::env::current_exe().is_ok_and(|exe| exe.to_string_lossy().contains(".app/Contents/"))
}

/// The owner's answer to the system's banner permission, waited for up to a minute; `None` when none came.
#[cfg(target_os = "macos")]
fn authorize() -> Option<Result<(), String>> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

    let (sender, receiver) = std::sync::mpsc::channel();
    let answer = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        let cause = unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string());
        let _ = sender.send(if granted.as_bool() {
            Ok(())
        } else {
            Err(cause.unwrap_or_else(|| "macOS is blocking roundup's alerts; allow them in System Settings > Notifications".into()))
        });
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert, &answer);
    receiver
        .recv_timeout(std::time::Duration::from_secs(60))
        .ok()
}

/// Sends banners as roundup (its icon, its permission, its click target) when running from the `.app` bundle; a dev build has no bundle and keeps the default sender.
#[cfg(target_os = "macos")]
fn bundle(identifier: &str) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        if is_bundled()
            && let Err(error) = mac_notification_sys::set_application(identifier)
        {
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

#[tauri::command(async)]
pub fn state_alert(alerts: State<'_, Arc<Alerts>>, request: Request) -> Result<(), RpcError> {
    alerts.raise(&request)
}
