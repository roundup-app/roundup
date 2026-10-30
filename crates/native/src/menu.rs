//! AppKit attributed hints keep sequences separate from executable key equivalents.
use objc2::{
    MainThreadMarker, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
    sel,
};
use objc2_foundation::{NSRange, NSSize, NSString};
use tauri::{AppHandle, Runtime};

/// Refresh responder actions and decorate the freshly built Project submenu on the main thread.
/// Call after installation and every projection, including no Project. Indices include separators;
/// plain Project titles and key equivalents stay untouched.
pub fn project_menu_hints<R: Runtime>(
    app: &AppHandle<R>,
    hints: Vec<(Vec<usize>, String)>,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        let _main = MainThreadMarker::new().expect("Tauri's main thread");
        // SAFETY: on the main thread, as `decorate_project_menu` requires.
        unsafe { decorate_project_menu(hints) }
    })
}

/// Decorate the installed Project submenu of the application menu, when there is one.
unsafe fn decorate_project_menu(hints: Vec<(Vec<usize>, String)>) {
    let application = AnyClass::get(c"NSApplication").expect("AppKit is loaded");
    // SAFETY: documented AppKit/Foundation selectors run on the main thread. Objects
    // remain retained through installation; menus can be absent during teardown.
    unsafe {
        let application: Retained<AnyObject> = msg_send![application, sharedApplication];
        sync_responder_menu(&application);
        let menu: Option<Retained<AnyObject>> = msg_send![&*application, mainMenu];
        let Some(menu) = menu else { return };
        let project: Option<Retained<AnyObject>> =
            msg_send![&*menu, itemWithTitle: &*NSString::from_str("Project")];
        let Some(project) = project else { return };
        let submenu: Option<Retained<AnyObject>> = msg_send![&*project, submenu];
        let Some(submenu) = submenu else { return };
        decorate_project_tree(&submenu, &hints);
    }
}

/// AppKit owns validation and dispatch; Project commands keep muda's explicit availability.
unsafe fn sync_responder_menu(application: &AnyObject) {
    // SAFETY: called only with the shared NSApplication on the main thread. Menus and
    // their children are retained while inspected; no responder or window is cached.
    unsafe {
        let menu: Option<Retained<AnyObject>> = msg_send![application, mainMenu];
        let Some(menu) = menu else { return };
        let submenu = |title: &str| -> Option<Retained<AnyObject>> {
            let item: Option<Retained<AnyObject>> =
                msg_send![&*menu, itemWithTitle: &*NSString::from_str(title)];
            item.and_then(|item| msg_send![&*item, submenu])
        };
        if let Some(file) = submenu("File") {
            // Tauri's default File menu contains only standard Close Window on macOS.
            let _: () = msg_send![&*file, setAutoenablesItems: true];
            let _: () = msg_send![&*file, update];
        }
        let Some(edit) = submenu("Edit") else { return };
        let project_find = submenu("Project").is_some_and(|project| has_find_owner(&project));
        let index: isize = msg_send![&*edit, indexOfItemWithTag: 3787isize];
        if project_find && index >= 0 {
            let _: () = msg_send![&*edit, removeItemAtIndex: index];
        } else if !project_find && index < 0 {
            let item: Allocated<AnyObject> = msg_send![
                AnyClass::get(c"NSMenuItem").expect("AppKit is loaded"),
                alloc
            ];
            let item: Retained<AnyObject> = msg_send![item, initWithTitle: &*NSString::from_str("Find…"), action: sel!(performTextFinderAction:), keyEquivalent: &*NSString::from_str("f")];
            // NSTextFinderActionShowFindInterface = 1. Nil target follows the responder chain.
            let _: () = msg_send![&*item, setTag: 1isize];
            let _: () = msg_send![&*item, setTarget: std::ptr::null::<AnyObject>()];
            let _: () = msg_send![&*item, setKeyEquivalentModifierMask: 1usize << 20];
            let submenu: Retained<AnyObject> =
                msg_send![AnyClass::get(c"NSMenu").expect("AppKit is loaded"), new];
            let _: () = msg_send![&*submenu, setAutoenablesItems: true];
            let _: () = msg_send![&*submenu, addItem: &*item];
            let container: Retained<AnyObject> =
                msg_send![AnyClass::get(c"NSMenuItem").expect("AppKit is loaded"), new];
            let _: () = msg_send![&*container, setTitle: &*NSString::from_str("Find")];
            let _: () = msg_send![&*container, setTag: 3787isize];
            let _: () = msg_send![&*container, setSubmenu: &*submenu];
            let _: () = msg_send![&*edit, addItem: &*container];
            let _: () = msg_send![&*submenu, update];
        }
        // Edit stays manually enabled: Terminal Copy is handled by the webview's copy
        // event even when WebKit's native selection validator would disable it.
    }
}

unsafe fn has_find_owner(menu: &AnyObject) -> bool {
    // SAFETY: callers retain a live NSMenu on the main thread; this reads only its projection.
    unsafe {
        let count: isize = msg_send![menu, numberOfItems];
        for index in 0..count {
            let item: Retained<AnyObject> = msg_send![menu, itemAtIndex: index];
            let enabled: bool = msg_send![&*item, isEnabled];
            if !enabled {
                continue;
            }
            let child: Option<Retained<AnyObject>> = msg_send![&*item, submenu];
            if let Some(child) = child {
                if has_find_owner(&child) {
                    return true;
                }
            } else {
                let key: Retained<NSString> = msg_send![&*item, keyEquivalent];
                let mask: usize = msg_send![&*item, keyEquivalentModifierMask];
                if key.to_string() == "f" && mask == 1usize << 20 {
                    return true;
                }
            }
        }
        false
    }
}

/// Each index path selects a leaf in the installed menu, including duplicate Agent names.
unsafe fn decorate_project_tree(submenu: &AnyObject, hints: &[(Vec<usize>, String)]) {
    // SAFETY: callers supply a live NSMenu on the process main thread; child menus are retained.
    unsafe {
        decorate(
            submenu,
            hints
                .iter()
                .filter(|(path, _)| path.len() == 1)
                .map(|(path, hint)| (path[0], hint.clone()))
                .collect(),
        );
        let count: isize = msg_send![submenu, numberOfItems];
        for index in 0..count {
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let child: Option<Retained<AnyObject>> = msg_send![&*item, submenu];
            if let Some(child) = child {
                let index = usize::try_from(index).expect("nonnegative menu index");
                let nested: Vec<_> = hints
                    .iter()
                    .filter(|(path, _)| path.len() > 1 && path[0] == index)
                    .map(|(path, hint)| (path[1..].to_vec(), hint.clone()))
                    .collect();
                decorate_project_tree(&child, &nested);
            }
        }
    }
}

/// Right edge of the hint column, from the title's left edge: where AppKit puts the widest
/// key equivalent (or the widest hint when no item has one), one `gap` after the longest title.
fn hint_stop(title_width: f64, key_equivalent_width: f64, hint_width: f64, gap: f64) -> f64 {
    title_width + gap + key_equivalent_width.max(hint_width)
}

/// Menu-font width of an item's key equivalent as AppKit draws it (modifier glyphs, then key).
unsafe fn key_equivalent_width(item: &AnyObject, fonts: &AnyObject) -> f64 {
    // SAFETY: `item` is a live NSMenuItem and `fonts` an attributes dictionary, on the main thread.
    unsafe {
        let key: Retained<NSString> = msg_send![item, keyEquivalent];
        if key.is_empty() {
            return 0.0;
        }
        let mask: usize = msg_send![item, keyEquivalentModifierMask];
        let glyphs: String = [
            (1usize << 18, "⌃"),
            (1 << 19, "⌥"),
            (1 << 17, "⇧"),
            (1 << 20, "⌘"),
        ]
        .iter()
        .filter(|(flag, _)| mask & flag != 0)
        .map(|(_, glyph)| *glyph)
        .collect();
        let shown = NSString::from_str(&format!("{glyphs}{}", key.to_string().to_uppercase()));
        let size: NSSize = msg_send![&*shown, sizeWithAttributes: fonts];
        size.width
    }
}

// Both installed menus and tracking popup menus use AppKit's attributed hint column.
unsafe fn decorate(submenu: &AnyObject, hints: Vec<(usize, String)>) {
    // SAFETY: callers supply a live NSMenu on the process main thread.
    unsafe {
        let count: isize = msg_send![submenu, numberOfItems];
        let font: Retained<AnyObject> = msg_send![submenu, font];
        let dictionary = AnyClass::get(c"NSDictionary").expect("Foundation is loaded");
        let font_key = NSString::from_str("NSFont");
        let fonts: Retained<AnyObject> =
            msg_send![dictionary, dictionaryWithObject: &*font, forKey: &*font_key];
        let mut title_width = 0.0f64;
        let mut key_width = 0.0f64;
        let mut hint_width = 0.0f64;
        for index in 0..count {
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let title: Retained<NSString> = msg_send![&*item, title];
            let size: NSSize = msg_send![&*title, sizeWithAttributes: &*fonts];
            title_width = title_width.max(size.width);
            key_width = key_width.max(key_equivalent_width(&item, &fonts));
        }
        for (_, hint) in &hints {
            let size: NSSize = msg_send![&*NSString::from_str(hint), sizeWithAttributes: &*fonts];
            hint_width = hint_width.max(size.width);
        }
        let em: f64 = msg_send![&*font, pointSize];
        let tabs = AnyClass::get(c"NSTextTab").expect("AppKit is loaded");
        let tab: Allocated<AnyObject> = msg_send![tabs, alloc];
        let options: Retained<AnyObject> = msg_send![dictionary, dictionary];
        // NSTextAlignmentRight = 1. Measure with the menu's font, including long titles.
        let tab: Retained<AnyObject> = msg_send![tab, initWithTextAlignment: 1isize, location: hint_stop(title_width, key_width, hint_width, em), options: &*options];
        let array = AnyClass::get(c"NSArray").expect("Foundation is loaded");
        let stops: Retained<AnyObject> = msg_send![array, arrayWithObject: &*tab];
        let styles = AnyClass::get(c"NSMutableParagraphStyle").expect("AppKit is loaded");
        let style: Retained<AnyObject> = msg_send![styles, new];
        let _: () = msg_send![&*style, setTabStops: &*stops];
        let style_key = NSString::from_str("NSParagraphStyle");
        let attributes: Retained<AnyObject> = msg_send![&*fonts, mutableCopy];
        let _: () = msg_send![&*attributes, setObject: &*style, forKey: &*style_key];
        let strings = AnyClass::get(c"NSMutableAttributedString").expect("Foundation is loaded");
        let colors = AnyClass::get(c"NSColor").expect("AppKit is loaded");
        let color_key = NSString::from_str("NSColor");
        for (index, hint) in hints {
            let Ok(index) = isize::try_from(index) else {
                continue;
            };
            if index >= count {
                continue;
            }
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let title: Retained<NSString> = msg_send![&*item, title];
            let display = NSString::from_str(&format!("{title}\t{hint}"));
            let attributed: Allocated<AnyObject> = msg_send![strings, alloc];
            let attributed: Retained<AnyObject> =
                msg_send![attributed, initWithString: &*display, attributes: &*attributes];
            let enabled: bool = msg_send![&*item, isEnabled];
            let color: Retained<AnyObject> = if enabled {
                msg_send![colors, secondaryLabelColor]
            } else {
                msg_send![colors, disabledControlTextColor]
            };
            // Foundation ranges count UTF-16 units, including non-ASCII menu titles.
            let range = NSRange::new(title.length() + 1, hint.encode_utf16().count());
            let _: () =
                msg_send![&*attributed, addAttribute: &*color_key, value: &*color, range: range];
            let _: () = msg_send![&*item, setAttributedTitle: &*attributed];
            // AppKit also assigns the attributed string to title; retain the action’s plain label.
            let _: () = msg_send![&*item, setTitle: &*title];
        }
    }
}

/// Decorate the items of a tracked popup submenu whose title has a hint.
unsafe fn decorate_by_title(submenu: &AnyObject, hints: &[(String, String)]) {
    // SAFETY: callers supply a live NSMenu on the process main thread.
    unsafe {
        let count: isize = msg_send![submenu, numberOfItems];
        let mut matching = Vec::new();
        for index in 0..count {
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let title: Retained<NSString> = msg_send![&*item, title];
            if let Some((_, hint)) = hints.iter().find(|(label, _)| *label == title.to_string()) {
                matching.push((
                    usize::try_from(index).expect("nonnegative menu index"),
                    hint.clone(),
                ));
            }
        }
        decorate(submenu, matching);
    }
}

/// Keep the observer scoped to the synchronous popup; AppKit supplies each menu as it tracks it.
pub fn context_menu<R: Runtime>(
    window: &tauri::Window<R>,
    menu: &tauri::menu::Menu<R>,
    position: tauri::LogicalPosition<f64>,
    hints: Vec<(String, String)>,
) -> tauri::Result<()> {
    let _main = MainThreadMarker::new().expect("Tauri's main thread");
    // SAFETY: AppKit notifications are synchronous on this main thread. The observer and
    // its retained block live until popup_menu_at returns and are then removed together.
    unsafe {
        let center = AnyClass::get(c"NSNotificationCenter").expect("Foundation is loaded");
        let center: Retained<AnyObject> = msg_send![center, defaultCenter];
        let block = block2::RcBlock::new(move |notification: &AnyObject| {
            let submenu: Retained<AnyObject> = msg_send![notification, object];
            decorate_by_title(&submenu, &hints);
        });
        let name = NSString::from_str("NSMenuDidBeginTrackingNotification");
        let observer: Retained<AnyObject> = msg_send![&*center, addObserverForName: &*name, object: std::ptr::null::<AnyObject>(), queue: std::ptr::null::<AnyObject>(), usingBlock: &*block];
        let result = window.popup_menu_at(menu, position);
        let _: () = msg_send![&*center, removeObserver: &*observer];
        result
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    use objc2::{DefinedClass, MainThreadOnly, define_class};
    use objc2_app_kit::NSResponder;
    use objc2_foundation::{NSDefaultRunLoopMode, NSObjectProtocol, NSPoint, NSRect};
    use std::cell::Cell;

    #[derive(Default)]
    struct FindState {
        available: Cell<bool>,
        calls: Cell<usize>,
    }

    define_class!(
        #[unsafe(super(NSResponder))]
        #[thread_kind = MainThreadOnly]
        #[ivars = FindState]
        struct FindResponder;

        unsafe impl NSObjectProtocol for FindResponder {}
        impl FindResponder {
            #[unsafe(method(acceptsFirstResponder))]
            fn accepts(&self) -> bool { true }

            #[unsafe(method(performTextFinderAction:))]
            fn find(&self, _sender: &AnyObject) {
                self.ivars().calls.set(self.ivars().calls.get() + 1);
            }

            #[unsafe(method(validateMenuItem:))]
            fn validate(&self, _item: &AnyObject) -> bool {
                self.ivars().available.get()
            }
        }
    );

    pub(crate) fn u3787b_native_responder_find_and_close_follow_availability() {
        let main = MainThreadMarker::new().expect("main-thread harness");
        // SAFETY: actual AppKit menus, windows, responders and events stay retained on
        // the main thread. Restore the prior menu and close only these probe windows.
        unsafe {
            let class = |name: &std::ffi::CStr| AnyClass::get(name).expect("AppKit loaded");
            let app: Retained<AnyObject> = msg_send![class(c"NSApplication"), sharedApplication];
            let prior: Option<Retained<AnyObject>> = msg_send![&*app, mainMenu];
            let _: bool = msg_send![&*app, setActivationPolicy: 0isize];
            let _: () = msg_send![&*app, finishLaunching];
            let _: () = msg_send![&*app, activateIgnoringOtherApps: true];
            let menu: Retained<AnyObject> = msg_send![class(c"NSMenu"), new];
            let mut submenus = Vec::new();
            for title in ["File", "Edit", "Project"] {
                let item: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
                let sub: Retained<AnyObject> = msg_send![class(c"NSMenu"), new];
                let _: () = msg_send![&*item, setTitle: &*NSString::from_str(title)];
                let _: () = msg_send![&*sub, setAutoenablesItems: false];
                let _: () = msg_send![&*item, setSubmenu: &*sub];
                let _: () = msg_send![&*menu, addItem: &*item];
                submenus.push(sub);
            }
            let close: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*close, setTitle: &*NSString::from_str("Close Window")];
            let _: () = msg_send![&*close, setAction: sel!(performClose:)];
            let _: () = msg_send![&*close, setKeyEquivalent: &*NSString::from_str("w")];
            let _: () = msg_send![&*submenus[0], addItem: &*close];
            let copy: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*copy, setTitle: &*NSString::from_str("Copy")];
            let _: () = msg_send![&*copy, setAction: sel!(copy:)];
            let _: () = msg_send![&*copy, setEnabled: true];
            let _: () = msg_send![&*submenus[1], addItem: &*copy];
            let _: () = msg_send![&*app, setMainMenu: &*menu];
            sync_responder_menu(&app);
            let copy_enabled: bool = msg_send![&*copy, isEnabled];
            assert!(
                copy_enabled,
                "Terminal Copy retains its existing event route"
            );
            let container: Retained<AnyObject> = msg_send![&*submenus[1], itemWithTag: 3787isize];
            let find_menu: Retained<AnyObject> = msg_send![&*container, submenu];
            let find: Retained<AnyObject> = msg_send![&*find_menu, itemAtIndex: 0isize];
            let windows = (0..2).map(|_| {
                let window: Allocated<AnyObject> = msg_send![class(c"NSWindow"), alloc];
                let window: Retained<AnyObject> = msg_send![window,
                    initWithContentRect: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(300.0, 200.0)),
                    styleMask: 3usize, backing: 2usize, defer: false];
                let _: () = msg_send![&*window, setReleasedWhenClosed: false];
                window
            }).collect::<Vec<_>>();
            let responders = (0..2)
                .map(|_| {
                    let responder = FindResponder::alloc(main).set_ivars(FindState::default());
                    let responder: Retained<FindResponder> = msg_send![super(responder), init];
                    responder
                })
                .collect::<Vec<_>>();
            for (index, window) in windows.iter().enumerate() {
                let _: () =
                    msg_send![&**window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
                // AppKit activation arrives through the event queue. Unlike the App,
                // this harness has no running event loop: dispatch until AppKit reports
                // this probe window as key before testing nil-target menu validation.
                let deadline: Retained<AnyObject> =
                    msg_send![class(c"NSDate"), dateWithTimeIntervalSinceNow: 5.0f64];
                loop {
                    let key: Option<Retained<AnyObject>> = msg_send![&*app, keyWindow];
                    if key
                        .as_deref()
                        .is_some_and(|key| std::ptr::eq(key, &**window))
                    {
                        break;
                    }
                    let remaining: f64 = msg_send![&*deadline, timeIntervalSinceNow];
                    assert!(
                        remaining > 0.0,
                        "AppKit did not make probe window {index} key"
                    );
                    let event: Option<Retained<AnyObject>> = msg_send![&*app,
                        nextEventMatchingMask: usize::MAX, untilDate: &*deadline,
                        inMode: NSDefaultRunLoopMode, dequeue: true];
                    if let Some(event) = event {
                        let _: () = msg_send![&*app, sendEvent: &*event];
                    }
                }
                // A bare NSResponder has no view hierarchy to link it to the window.
                let _: () = msg_send![&*responders[index], setNextResponder: &**window];
                let accepted: bool = msg_send![&**window, makeFirstResponder: &*responders[index]];
                assert!(accepted);
                for available in [false, true] {
                    responders[index].ivars().available.set(available);
                    let _: () = msg_send![&*find_menu, update];
                    let enabled: bool = msg_send![&*find, isEnabled];
                    assert_eq!(
                        enabled, available,
                        "Find availability in probe window {index}"
                    );
                    let number: isize = msg_send![&**window, windowNumber];
                    let event: Retained<AnyObject> = msg_send![class(c"NSEvent"),
                        keyEventWithType: 10usize, location: NSPoint::new(0.0, 0.0),
                        modifierFlags: 1usize << 20, timestamp: 0.0f64, windowNumber: number,
                        context: std::ptr::null::<AnyObject>(), characters: &*NSString::from_str("f"),
                        charactersIgnoringModifiers: &*NSString::from_str("f"), isARepeat: false, keyCode: 3u16];
                    let _: bool = msg_send![&*menu, performKeyEquivalent: &*event];
                    assert_eq!(
                        responders[index].ivars().calls.get(),
                        usize::from(available)
                    );
                    let focused: Retained<AnyObject> = msg_send![&**window, firstResponder];
                    assert!(std::ptr::eq(
                        &*focused,
                        (&*responders[index]) as *const FindResponder as *const AnyObject
                    ));
                }
            }
            let editor: Retained<AnyObject> = msg_send![class(c"NSTextView"), new];
            // NSTextView only validates the modern finder action when its find bar
            // is enabled. A bare text view otherwise exercises an unavailable editor.
            let _: () = msg_send![&*editor, setUsesFindBar: true];
            let _: () = msg_send![&*editor, setString: &*NSString::from_str("native editor")];
            let content: Retained<AnyObject> = msg_send![&*windows[1], contentView];
            let scroll: Retained<AnyObject> = msg_send![class(c"NSScrollView"), new];
            let bounds: NSRect = msg_send![&*content, bounds];
            let _: () = msg_send![&*scroll, setFrame: bounds];
            let _: () = msg_send![&*scroll, setDocumentView: &*editor];
            let _: () = msg_send![&*content, addSubview: &*scroll];
            let accepted: bool = msg_send![&*windows[1], makeFirstResponder: &*editor];
            assert!(accepted);
            let _: () = msg_send![&*find_menu, update];
            let enabled: bool = msg_send![&*find, isEnabled];
            let target: Retained<AnyObject> =
                msg_send![&*app, targetForAction: sel!(performTextFinderAction:)];
            assert!(enabled, "a find-enabled native editor validates Find");
            assert!(
                std::ptr::eq(&*target, &*editor),
                "Find targets the focused native editor"
            );
            let accepted: bool = msg_send![&*windows[1], makeFirstResponder: &*responders[1]];
            assert!(accepted);
            // A projected registration owns the native accelerator; the responder entry
            // must be absent, so AppKit cannot fire both paths for one key equivalent.
            let terminal: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*terminal, setTitle: &*NSString::from_str("Terminal Find")];
            let _: () = msg_send![&*terminal, setAction: sel!(performTextFinderAction:)];
            let _: () = msg_send![&*terminal, setTarget: &*responders[0]];
            let _: () = msg_send![&*terminal, setKeyEquivalent: &*NSString::from_str("f")];
            let _: () = msg_send![&*terminal, setKeyEquivalentModifierMask: 1usize << 20];
            let _: () = msg_send![&*submenus[2], addItem: &*terminal];
            sync_responder_menu(&app);
            let count: isize = msg_send![&*submenus[1], numberOfItems];
            assert_eq!(count, 1);
            let event: Retained<AnyObject> = msg_send![class(c"NSEvent"),
                keyEventWithType: 10usize, location: NSPoint::new(0.0, 0.0),
                modifierFlags: 1usize << 20, timestamp: 0.0f64, windowNumber: 0isize,
                context: std::ptr::null::<AnyObject>(), characters: &*NSString::from_str("f"),
                charactersIgnoringModifiers: &*NSString::from_str("f"), isARepeat: false, keyCode: 3u16];
            let handled: bool = msg_send![&*menu, performKeyEquivalent: &*event];
            assert!(handled);
            assert_eq!(responders[0].ivars().calls.get(), 2);
            assert_eq!(responders[1].ivars().calls.get(), 1);
            let _: () = msg_send![&*terminal, setEnabled: false];
            sync_responder_menu(&app);
            let _: bool = msg_send![&*menu, performKeyEquivalent: &*event];
            assert_eq!(responders[0].ivars().calls.get(), 2);
            assert_eq!(responders[1].ivars().calls.get(), 2);
            let _: () = msg_send![&*submenus[2], removeItem: &*terminal];
            sync_responder_menu(&app);
            sync_responder_menu(&app);
            let count: isize = msg_send![&*submenus[1], numberOfItems];
            assert_eq!(count, 2, "projection is idempotent after removing an owner");
            let container: Retained<AnyObject> = msg_send![&*submenus[1], itemWithTag: 3787isize];
            let current_find_menu: Retained<AnyObject> = msg_send![&*container, submenu];
            let _: () = msg_send![&*current_find_menu, update];
            let _: () = msg_send![&*current_find_menu, performActionForItemAtIndex: 0isize];
            assert_eq!(responders[1].ivars().calls.get(), 3);
            let _: () = msg_send![&*submenus[0], update];
            let enabled: bool = msg_send![&*close, isEnabled];
            assert!(enabled);
            let _: () = msg_send![&*submenus[0], performActionForItemAtIndex: 0isize];
            let visible: bool = msg_send![&*windows[1], isVisible];
            let other_visible: bool = msg_send![&*windows[0], isVisible];
            assert!(
                !visible && other_visible,
                "Close targets the actual key window"
            );
            let _: () = msg_send![&*windows[0], close];
            let _: () = msg_send![&*submenus[0], update];
            let _: () = msg_send![&*current_find_menu, update];
            let close_enabled: bool = msg_send![&*close, isEnabled];
            let current_find: Retained<AnyObject> =
                msg_send![&*current_find_menu, itemAtIndex: 0isize];
            let find_enabled: bool = msg_send![&*current_find, isEnabled];
            assert!(!close_enabled && !find_enabled);
            let _: () = msg_send![&*app, setMainMenu: prior.as_deref()];
        }
    }

    pub(crate) fn u4462_the_hint_takes_the_key_equivalent_colour_and_font() {
        let _main = MainThreadMarker::new().expect("native test harness runs on the main thread");
        // SAFETY: AppKit objects stay retained on the main thread for the whole probe.
        unsafe {
            let application = AnyClass::get(c"NSApplication").expect("AppKit is loaded");
            let _: Retained<AnyObject> = msg_send![application, sharedApplication];
            let menus = AnyClass::get(c"NSMenu").expect("AppKit is loaded");
            let menu: Retained<AnyObject> = msg_send![menus, new];
            let _: () = msg_send![&*menu, setAutoenablesItems: false];
            let fonts = AnyClass::get(c"NSFont").expect("AppKit is loaded");
            let font: Retained<AnyObject> = msg_send![fonts, menuFontOfSize: 16.0f64];
            let _: () = msg_send![&*menu, setFont: &*font];
            let items = AnyClass::get(c"NSMenuItem").expect("AppKit is loaded");
            let colors = AnyClass::get(c"NSColor").expect("AppKit is loaded");
            for enabled in [true, false] {
                let item: Retained<AnyObject> = msg_send![items, new];
                let title = NSString::from_str("项目 🦀");
                let _: () = msg_send![&*item, setTitle: &*title];
                let _: () = msg_send![&*item, setEnabled: enabled];
                let _: () = msg_send![&*menu, addItem: &*item];
            }
            decorate(&menu, vec![(0, "⌘K P".into()), (1, "⌘K W".into())]);
            for (index, enabled) in [(0isize, true), (1, false)] {
                let item: Retained<AnyObject> = msg_send![&*menu, itemAtIndex: index];
                let title: Retained<NSString> = msg_send![&*item, title];
                assert_eq!(title.to_string(), "项目 🦀");
                let key: Retained<NSString> = msg_send![&*item, keyEquivalent];
                assert!(key.is_empty(), "a hint must never register an accelerator");
                let attributed: Retained<AnyObject> = msg_send![&*item, attributedTitle];
                let font_key = NSString::from_str("NSFont");
                let color_key = NSString::from_str("NSColor");
                let hint_index = title.length() + 1;
                let actual_font: Option<Retained<AnyObject>> = msg_send![&*attributed, attribute: &*font_key, atIndex: hint_index, effectiveRange: std::ptr::null_mut::<objc2_foundation::NSRange>()];
                let actual_font = actual_font.expect("hint has the menu's font");
                let same_font: bool = msg_send![&*actual_font, isEqual: &*font];
                assert!(same_font);
                let actual_color: Option<Retained<AnyObject>> = msg_send![&*attributed, attribute: &*color_key, atIndex: hint_index, effectiveRange: std::ptr::null_mut::<objc2_foundation::NSRange>()];
                let actual_color = actual_color.expect("hint has an explicit semantic color");
                let expected_color: Retained<AnyObject> = if enabled {
                    msg_send![colors, secondaryLabelColor]
                } else {
                    msg_send![colors, disabledControlTextColor]
                };
                let same_color: bool = msg_send![&*actual_color, isEqual: &*expected_color];
                assert!(same_color);
                let title_color: Option<Retained<AnyObject>> = msg_send![&*attributed, attribute: &*color_key, atIndex: 0usize, effectiveRange: std::ptr::null_mut::<objc2_foundation::NSRange>()];
                assert!(
                    title_color.is_none(),
                    "AppKit retains title highlighting and dimming"
                );
            }
        }
    }

    pub(crate) fn u4462_the_hint_stop_is_the_key_equivalent_edge() {
        // Hint narrower than the key column: it ends where `⇧⌘T` ends, one gap after the title.
        assert_eq!(hint_stop(100.0, 40.0, 30.0, 16.0), 156.0);
        // No key equivalent in the menu: the hint is the column.
        assert_eq!(hint_stop(100.0, 0.0, 30.0, 16.0), 146.0);
        // Hint wider than the key column: the hint widens the column.
        assert_eq!(hint_stop(100.0, 20.0, 30.0, 16.0), 146.0);
    }

    unsafe fn stops_and_titles(menu: &AnyObject) -> Vec<String> {
        // SAFETY: `menu` is a live NSMenu on the main thread.
        unsafe {
            let count: isize = msg_send![menu, numberOfItems];
            (0..count)
                .map(|index| {
                    let item: Retained<AnyObject> = msg_send![menu, itemAtIndex: index];
                    let attributed: Option<Retained<AnyObject>> =
                        msg_send![&*item, attributedTitle];
                    attributed.map_or_else(String::new, |attributed| {
                        let described: Retained<NSString> = msg_send![&*attributed, description];
                        described.to_string()
                    })
                })
                .collect()
        }
    }

    pub(crate) fn u4462_installed_and_tracked_menus_use_one_decoration() {
        let _main = MainThreadMarker::new().expect("native test harness runs on the main thread");
        // SAFETY: AppKit objects stay retained on the main thread for the whole probe.
        unsafe {
            let class = |name: &std::ffi::CStr| AnyClass::get(name).expect("AppKit is loaded");
            let application: Retained<AnyObject> =
                msg_send![class(c"NSApplication"), sharedApplication];
            let build = || -> Retained<AnyObject> {
                let menu: Retained<AnyObject> = msg_send![class(c"NSMenu"), new];
                let _: () = msg_send![&*menu, setAutoenablesItems: false];
                for (title, key) in [("New Workstream", "n"), ("Open Project", "")] {
                    let item: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
                    let _: () = msg_send![&*item, setTitle: &*NSString::from_str(title)];
                    let _: () = msg_send![&*item, setKeyEquivalent: &*NSString::from_str(key)];
                    let _: () = msg_send![&*menu, addItem: &*item];
                }
                menu
            };
            let popup = build();
            decorate_by_title(&popup, &[("Open Project".into(), "⌘K P".into())]);

            let installed = build();
            let bar: Retained<AnyObject> = msg_send![class(c"NSMenu"), new];
            let project: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*project, setTitle: &*NSString::from_str("Project")];
            let _: () = msg_send![&*project, setSubmenu: &*installed];
            let _: () = msg_send![&*bar, addItem: &*project];
            let _: () = msg_send![&*application, setMainMenu: &*bar];
            let child: Retained<AnyObject> = msg_send![class(c"NSMenu"), new];
            for _ in 0..2 {
                let item: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
                let _: () =
                    msg_send![&*item, setTitle: &*NSString::from_str("Assign to same name")];
                let _: () = msg_send![&*child, addItem: &*item];
            }
            let assignment: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*assignment, setSubmenu: &*child];
            let _: () = msg_send![&*installed, addItem: &*assignment];
            decorate_project_menu(vec![
                (vec![1], "⌘K P".into()),
                (vec![2, 0], "1".into()),
                (vec![2, 1], "9".into()),
            ]);
            let plain = |index: isize| -> String {
                let item: Retained<AnyObject> = msg_send![&*child, itemAtIndex: index];
                let attributed: Retained<AnyObject> = msg_send![&*item, attributedTitle];
                let shown: Retained<NSString> = msg_send![&*attributed, string];
                shown.to_string()
            };
            assert_eq!(plain(0), "Assign to same name\t1");
            assert_eq!(plain(1), "Assign to same name\t9");

            let (installed, popup) = (stops_and_titles(&installed), stops_and_titles(&popup));
            assert!(
                installed[1].contains('\t'),
                "the hint is in the attributed title"
            );
            assert_eq!(installed[..2], popup, "both paths build the same column");
        }
    }
}
