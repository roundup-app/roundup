//! The owner's answer to the system's banner permission, asked through UserNotifications.
use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_foundation::NSError;
use objc2_user_notifications::{UNAuthorizationOptions, UNUserNotificationCenter};

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
