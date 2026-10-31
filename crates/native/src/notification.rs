//! The owner's answer to the system's banner permission, asked through UserNotifications.
use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::NSError;
use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

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
