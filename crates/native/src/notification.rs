//! The owner's answer to the system's banner permission, asked through UserNotifications.
use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::NSError;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings, UNUserNotificationCenter,
};
use std::ptr::NonNull;

/// Waits up to a minute for the owner's answer; `None` when none came, `Err` carries the refusal's cause.
pub fn banner_permission() -> Option<Result<(), String>> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let answer = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        // SAFETY: the system passes either null or a live NSError for the duration of the callback.
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

/// Whether the owner has denied roundup's notifications in System Settings; an unanswered read counts as not denied.
pub fn banner_denied() -> bool {
    let (sender, receiver) = std::sync::mpsc::channel();
    let read = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
        // SAFETY: the system passes a live settings object for the duration of the callback.
        let status = unsafe { settings.as_ref() }.authorizationStatus();
        let _ = sender.send(status == UNAuthorizationStatus::Denied);
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&read);
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap_or(false)
}
