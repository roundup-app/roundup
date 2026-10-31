//! The owner's answer to the system's banner permission, asked through UserNotifications.
use std::ptr::NonNull;
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::Duration;

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::NSError;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings, UNUserNotificationCenter,
};

static ANSWER: OnceLock<Mutex<Option<Result<(), String>>>> = OnceLock::new();

/// Never waits for the owner: the first call sends the request to macOS and returns `None`, and so does each call until the owner answers; then it returns the answer, where `Err` carries the refusal's cause.
pub fn banner_permission() -> Option<Result<(), String>> {
    static ASKED: std::sync::Once = std::sync::Once::new();
    ASKED.call_once(|| {
        let answer = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            // SAFETY: the system passes either null or a live NSError for the duration of the callback.
            let cause = unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string());
            let result = if granted.as_bool() {
                Ok(())
            } else {
                Err(cause.unwrap_or_else(|| "macOS is blocking roundup's alerts; allow them in System Settings > Notifications".into()))
            };
            *ANSWER
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(result);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert, &answer);
    });
    ANSWER
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

/// Whether the owner has denied roundup's notifications in macOS, read from the system's settings; a state the system does not answer within two seconds reads as not denied.
pub fn banner_denied() -> bool {
    let (tx, rx) = mpsc::channel();
    let handler = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        // SAFETY: the system passes a live settings object for the duration of the callback.
        let status = unsafe { settings.as_ref() }.authorizationStatus();
        let _ = tx.send(status == UNAuthorizationStatus::Denied);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&handler);
    rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false)
}
