//! AppKit badges provide a separate, system-aligned hint without claiming a key equivalent.
use objc2::{
    MainThreadMarker, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::NSString;
use tauri::{AppHandle, Runtime};

/// Decorate the freshly built Project submenu on the main thread; indices include separators.
pub fn project_menu_hints<R: Runtime>(
    app: &AppHandle<R>,
    hints: Vec<(usize, String)>,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        let _main = MainThreadMarker::new().expect("Tauri's main thread");
        let application = AnyClass::get(c"NSApplication").expect("AppKit is loaded");
        let Some(badge_class) = AnyClass::get(c"NSMenuItemBadge") else {
            log::warn!(target: "roundup::shell", "Project shortcut hints require macOS 14");
            return;
        };
        // SAFETY: these documented AppKit accessors run on the main thread. Retained values
        // keep each object alive; missing menus/items are allowed during application teardown.
        unsafe {
            let application: Retained<AnyObject> = msg_send![application, sharedApplication];
            let menu: Option<Retained<AnyObject>> = msg_send![&*application, mainMenu];
            let Some(menu) = menu else {
                return;
            };
            let project: Option<Retained<AnyObject>> =
                msg_send![&*menu, itemWithTitle: &*NSString::from_str("Project")];
            let Some(project) = project else {
                return;
            };
            let submenu: Option<Retained<AnyObject>> = msg_send![&*project, submenu];
            let Some(submenu) = submenu else {
                return;
            };
            let count: isize = msg_send![&*submenu, numberOfItems];
            for (index, hint) in hints {
                let Ok(index) = isize::try_from(index) else {
                    continue;
                };
                if index >= count {
                    continue;
                }
                let item: Retained<AnyObject> = msg_send![&*submenu, itemAtIndex: index];
                let badge: Allocated<AnyObject> = msg_send![badge_class, alloc];
                let badge: Retained<AnyObject> =
                    msg_send![badge, initWithString: &*NSString::from_str(&hint)];
                let _: () = msg_send![&*item, setBadge: &*badge];
            }
        }
    })
}
