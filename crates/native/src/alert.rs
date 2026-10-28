//! AppKit owns the default, destructive and Escape buttons of removal consent.
use objc2::{
    MainThreadMarker, msg_send,
    rc::Retained,
    runtime::Bool,
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::NSString;
use tauri::{AppHandle, Runtime};

/// Dispatch to AppKit's main thread; the callback runs after its single modal alert closes.
pub fn removal_alert<R: Runtime>(
    app: &AppHandle<R>,
    title: String,
    message: String,
    labels: [String; 3],
    answer: impl FnOnce(&'static str) + Send + 'static,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        let _main = MainThreadMarker::new().expect("Tauri's main thread");
        let class = AnyClass::get(c"NSAlert").expect("AppKit is loaded");
        // SAFETY: NSAlert and its retained buttons live entirely on AppKit's main thread;
        // runModal keeps them alive until the native response is delivered.
        unsafe {
            let alert: Retained<AnyObject> = msg_send![class, new];
            let _: () = msg_send![&*alert, setMessageText: &*NSString::from_str(&title)];
            let _: () = msg_send![&*alert, setInformativeText: &*NSString::from_str(&message)];
            let _: () = msg_send![&*alert, setAlertStyle: 1usize];
            for (index, label) in labels.iter().enumerate() {
                let button: Retained<AnyObject> =
                    msg_send![&*alert, addButtonWithTitle: &*NSString::from_str(label)];
                let key = match index {
                    0 => "\r",
                    2 => "\u{1b}",
                    _ => "",
                };
                let _: () = msg_send![&*button, setKeyEquivalent: &*NSString::from_str(key)];
                if index == 1 {
                    let _: () = msg_send![&*button, setHasDestructiveAction: Bool::YES];
                }
            }
            let response: isize = msg_send![&*alert, runModal];
            answer(match response {
                1000 => "this",
                1001 => "all",
                _ => "cancel",
            });
        }
    })
}
