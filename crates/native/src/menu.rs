//! AppKit attributed hints keep sequences separate from executable key equivalents.
use objc2::{
    MainThreadMarker, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::{NSSize, NSString};
use tauri::{AppHandle, Runtime};

/// Decorate the freshly built Project submenu on the main thread; indices include separators.
/// Plain titles and key equivalents stay untouched; attributed titles share a right-aligned hint stop.
pub fn project_menu_hints<R: Runtime>(
    app: &AppHandle<R>,
    hints: Vec<(usize, String)>,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        let _main = MainThreadMarker::new().expect("Tauri's main thread");
        let application = AnyClass::get(c"NSApplication").expect("AppKit is loaded");
        // SAFETY: documented AppKit/Foundation selectors run on the main thread. Objects
        // remain retained through installation; menus can be absent during teardown.
        unsafe {
            let application: Retained<AnyObject> = msg_send![application, sharedApplication];
            let menu: Option<Retained<AnyObject>> = msg_send![&*application, mainMenu];
            let Some(menu) = menu else { return };
            let project: Option<Retained<AnyObject>> =
                msg_send![&*menu, itemWithTitle: &*NSString::from_str("Project")];
            let Some(project) = project else { return };
            let submenu: Option<Retained<AnyObject>> = msg_send![&*project, submenu];
            let Some(submenu) = submenu else { return };
            let count: isize = msg_send![&*submenu, numberOfItems];
            let font_class = AnyClass::get(c"NSFont").expect("AppKit is loaded");
            let font: Retained<AnyObject> = msg_send![font_class, menuFontOfSize: 0.0f64];
            let dictionary = AnyClass::get(c"NSDictionary").expect("Foundation is loaded");
            let font_key = NSString::from_str("NSFont");
            let fonts: Retained<AnyObject> = msg_send![dictionary, dictionaryWithObject: &*font, forKey: &*font_key];
            let mut title_width = 0.0f64;
            let mut hint_width = 0.0f64;
            for index in 0..count {
                let item: Retained<AnyObject> = msg_send![&*submenu, itemAtIndex: index];
                let title: Retained<NSString> = msg_send![&*item, title];
                let size: NSSize = msg_send![&*title, sizeWithAttributes: &*fonts];
                title_width = title_width.max(size.width);
            }
            for (_, hint) in &hints {
                let size: NSSize = msg_send![&*NSString::from_str(hint), sizeWithAttributes: &*fonts];
                hint_width = hint_width.max(size.width);
            }
            let em: f64 = msg_send![&*font, pointSize];
            let tabs = AnyClass::get(c"NSTextTab").expect("AppKit is loaded");
            let tab: Allocated<AnyObject> = msg_send![tabs, alloc];
            let options: Retained<AnyObject> = msg_send![dictionary, dictionary];
            // NSTextAlignmentRight = 1. Measure with the system menu font, including long titles.
            let tab: Retained<AnyObject> = msg_send![tab, initWithTextAlignment: 1isize, location: title_width + hint_width + em * 2.0, options: &*options];
            let array = AnyClass::get(c"NSArray").expect("Foundation is loaded");
            let stops: Retained<AnyObject> = msg_send![array, arrayWithObject: &*tab];
            let styles = AnyClass::get(c"NSMutableParagraphStyle").expect("AppKit is loaded");
            let style: Retained<AnyObject> = msg_send![styles, new];
            let _: () = msg_send![&*style, setTabStops: &*stops];
            let style_key = NSString::from_str("NSParagraphStyle");
            let attributes: Retained<AnyObject> = msg_send![dictionary, dictionaryWithObject: &*style, forKey: &*style_key];
            let strings = AnyClass::get(c"NSAttributedString").expect("Foundation is loaded");
            for (index, hint) in hints {
                let Ok(index) = isize::try_from(index) else { continue };
                if index >= count { continue }
                let item: Retained<AnyObject> = msg_send![&*submenu, itemAtIndex: index];
                let title: Retained<NSString> = msg_send![&*item, title];
                let display = NSString::from_str(&format!("{title}\t{hint}"));
                let attributed: Allocated<AnyObject> = msg_send![strings, alloc];
                let attributed: Retained<AnyObject> = msg_send![attributed, initWithString: &*display, attributes: &*attributes];
                let _: () = msg_send![&*item, setAttributedTitle: &*attributed];
                // AppKit also assigns the attributed string to title; retain the action’s plain label.
                let _: () = msg_send![&*item, setTitle: &*title];
            }
        }
    })
}
