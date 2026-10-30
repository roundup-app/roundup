//! AppKit draws native rows; a non-interactive layer adds display-only hints.
use objc2::{
    DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
    rc::{Allocated, Retained, Weak},
    runtime::{AnyClass, AnyObject},
    sel,
};
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRange, NSRect, NSRunLoopCommonModes, NSSize, NSString};
use std::cell::{Cell, RefCell};
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

// AppKit's gap between the menu's right edge and the key-equivalent column. A 20 pt
// guess ended 5 pt short of ⌘N in the owner's Mac observation 7. It is applied to
// the laid-out menu width of each final row, never to the longest title.
const KEY_INSET: f64 = 15.0;

fn hint_stop(menu_width: f64, right_inset: f64, hint_width: f64, origin: f64) -> f64 {
    origin + menu_width - right_inset - hint_width
}

struct HintState {
    item: Weak<AnyObject>,
    hint: Retained<AnyObject>,
    // AppKit repaints a row's highlight without invalidating this overlay and
    // offers no highlight signal (muda owns the menu delegate), so the overlay
    // polls while attached and repaints when its row's highlight flips.
    highlighted: Cell<bool>,
    timer: RefCell<Option<Retained<AnyObject>>>,
}

// NSMenuItem.view stays nil: AppKit owns titles, keys, selection and tracking.
// The accessory owns the drawing views; weak references release retired items.
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = HintState]
    struct HintView;

    impl HintView {
        // AppKit draws key equivalents vibrantly inside the menu's visual-effect
        // window; a plain subview paints the same colour darker and heavier.
        #[unsafe(method(allowsVibrancy))]
        fn allows_vibrancy(&self) -> bool {
            true
        }

        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }

        #[unsafe(method(drawRect:))]
        fn draw(&self, _dirty: NSRect) {
            // SAFETY: AppKit invokes drawing on its main thread; the weak item
            // is retained for this draw, and only the hint is painted.
            unsafe {
                let Some(item) = self.ivars().item.load() else { return; };
                let enabled: bool = msg_send![&*item, isEnabled];
                let menu: Option<Retained<AnyObject>> = msg_send![&*item, menu];
                let Some(menu) = menu else { return; };
                let attributes = hint_attributes(&menu, &hint_color(enabled, self.row_highlighted()));
                let hint: Retained<AnyObject> = msg_send![&*self.ivars().hint, mutableCopy];
                let length: usize = msg_send![&*hint, length];
                let _: () = msg_send![&*hint, setAttributes: &*attributes, range: NSRange::new(0, length)];
                let size: NSSize = msg_send![&*hint, size];
                let Some(window) = self.window() else { return; };
                let screen: NSRect = msg_send![&*item, accessibilityFrame];
                if screen.size.height <= 0.0 {
                    log::warn!(target: "roundup::shell", "native menu hint has no accessibility row frame");
                    return;
                }
                let local = window.convertRectFromScreen(screen);
                let row = self.convertRect_fromView(local, None);
                let bounds = self.bounds();
                let point = NSPoint::new(
                    hint_stop(bounds.size.width, KEY_INSET, size.width, bounds.origin.x),
                    row.origin.y + (row.size.height - size.height) / 2.0,
                );
                let _: () = msg_send![&*hint, drawAtPoint: point];
            }
        }
    }
);

impl HintView {
    fn row_highlighted(&self) -> bool {
        // SAFETY: main-thread AppKit reads; the weak item is retained for the call.
        unsafe {
            let Some(item) = self.ivars().item.load() else {
                return false;
            };
            let menu: Option<Retained<AnyObject>> = msg_send![&*item, menu];
            let Some(menu) = menu else {
                return false;
            };
            let row: Option<Retained<AnyObject>> = msg_send![&*menu, highlightedItem];
            row.is_some_and(|row| std::ptr::eq(&*row, &*item))
        }
    }

    fn watch_highlight(&self) {
        self.unwatch_highlight();
        // SAFETY: `self` is a live object; retaining it only to downgrade to a weak reference.
        let this = Weak::from_retained(
            &unsafe { Retained::retain(std::ptr::from_ref(self).cast_mut()) }
                .expect("self is non-null"),
        );
        let tick = block2::RcBlock::new(move |timer: std::ptr::NonNull<AnyObject>| {
            // SAFETY: timers fire on the main run loop; `timer` is live for the call.
            unsafe {
                let Some(view) = this.load() else {
                    let _: () = msg_send![timer.as_ptr(), invalidate];
                    return;
                };
                let now = view.row_highlighted();
                if view.ivars().highlighted.replace(now) != now {
                    view.setNeedsDisplay(true);
                }
            }
        });
        // SAFETY: Foundation timer and run-loop selectors on the main thread; the common
        // modes include the event-tracking mode that menu tracking runs in.
        unsafe {
            let timers = AnyClass::get(c"NSTimer").expect("Foundation is loaded");
            let timer: Retained<AnyObject> =
                msg_send![timers, timerWithTimeInterval: 1.0 / 30.0, repeats: true, block: &*tick];
            let run_loop = AnyClass::get(c"NSRunLoop").expect("Foundation is loaded");
            let run_loop: Retained<AnyObject> = msg_send![run_loop, currentRunLoop];
            let _: () = msg_send![&*run_loop, addTimer: &*timer, forMode: NSRunLoopCommonModes];
            *self.ivars().timer.borrow_mut() = Some(timer);
        }
    }

    fn unwatch_highlight(&self) {
        if let Some(timer) = self.ivars().timer.borrow_mut().take() {
            // SAFETY: invalidating a live NSTimer on its own thread.
            unsafe {
                let _: () = msg_send![&*timer, invalidate];
            }
        }
    }
}

// A zero-height accessory supplies the actual menu window through AppKit's
// documented item-view lifecycle. Action rows keep view == nil, and attachment
// requires no window-update notification during native tracking.
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Vec<Retained<HintView>>]
    struct MenuAnchor;

    impl MenuAnchor {
        #[unsafe(method(viewDidMoveToWindow))]
        fn moved(&self) {
            self.attach();
        }

        #[unsafe(method(resizeSubviewsWithOldSize:))]
        fn resized(&self, _old: NSSize) {
            self.attach();
        }

        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }
    }
);

impl MenuAnchor {
    fn attach(&self) {
        for hint in self.ivars() {
            hint.unwatch_highlight();
            hint.removeFromSuperview();
        }
        let Some(window) = self.window() else {
            return;
        };
        let Some(content) = window.contentView() else {
            return;
        };
        let row = self.convertRect_toView(self.bounds(), Some(&content));
        let bounds = content.bounds();
        for hint in self.ivars() {
            hint.setFrame(NSRect::new(
                NSPoint::new(row.origin.x, bounds.origin.y),
                NSSize::new(row.size.width, bounds.size.height),
            ));
            content.addSubview(hint);
            hint.setNeedsDisplay(true);
            hint.watch_highlight();
        }
    }
}

impl Drop for MenuAnchor {
    fn drop(&mut self) {
        for hint in self.ivars() {
            hint.removeFromSuperview();
        }
    }
}

// The NSColor AppKit's own key equivalents resolve to. The vibrant menu material
// brightens alpha-white label colours, so a rest hint uses the tertiary tone to
// land on the dim grey of ⌘N; a highlighted row flips to the selected-text colour.
unsafe fn hint_color(enabled: bool, highlighted: bool) -> Retained<AnyObject> {
    let colors = AnyClass::get(c"NSColor").expect("AppKit is loaded");
    // SAFETY: class-level NSColor accessors are valid on the main thread.
    unsafe {
        match (enabled, highlighted) {
            (false, _) => msg_send![colors, disabledControlTextColor],
            (true, true) => msg_send![colors, selectedMenuItemTextColor],
            (true, false) => msg_send![colors, tertiaryLabelColor],
        }
    }
}

unsafe fn hint_attributes(menu: &AnyObject, color: &AnyObject) -> Retained<AnyObject> {
    // SAFETY: caller supplies an NSMenu on the main thread.
    unsafe {
        let font: Retained<AnyObject> = msg_send![menu, font];
        let dictionary = AnyClass::get(c"NSMutableDictionary").expect("Foundation is loaded");
        let attributes: Retained<AnyObject> = msg_send![dictionary, new];
        let _: () =
            msg_send![&*attributes, setObject: &*font, forKey: &*NSString::from_str("NSFont")];
        let _: () =
            msg_send![&*attributes, setObject: color, forKey: &*NSString::from_str("NSColor")];
        attributes
    }
}

// The accessory is not an action row: its zero height preserves every native
// title, key equivalent, highlight and tracking target in the existing menu.
unsafe fn decorate(submenu: &AnyObject, hints: Vec<(usize, String)>) {
    let main = MainThreadMarker::new().expect("Tauri's main thread");
    // SAFETY: callers supply a live NSMenu on the process main thread. Tauri
    // knows only its own rows, so retire any accessory before applying its indices.
    unsafe {
        let count: isize = msg_send![submenu, numberOfItems];
        for index in (0..count).rev() {
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let view: Option<Retained<AnyObject>> = msg_send![&*item, view];
            if view
                .as_deref()
                .is_some_and(|view| view.downcast_ref::<MenuAnchor>().is_some())
            {
                let _: () = msg_send![submenu, removeItemAtIndex: index];
            }
        }
        if hints.is_empty() {
            return;
        }
        let count: isize = msg_send![submenu, numberOfItems];
        let mut width: f64 = msg_send![submenu, minimumWidth];
        let mut views = Vec::new();
        for (index, hint) in hints {
            let Ok(index) = isize::try_from(index) else {
                continue;
            };
            if index >= count {
                continue;
            }
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let enabled: bool = msg_send![&*item, isEnabled];
            let attributes = hint_attributes(submenu, &hint_color(enabled, false));
            let strings = AnyClass::get(c"NSAttributedString").expect("Foundation is loaded");
            let attributed: Allocated<AnyObject> = msg_send![strings, alloc];
            let attributed: Retained<AnyObject> = msg_send![attributed, initWithString: &*NSString::from_str(&hint), attributes: &*attributes];
            let title: Retained<NSString> = msg_send![&*item, title];
            let title_size: NSSize = msg_send![&*title, sizeWithAttributes: &*attributes];
            let hint_size: NSSize = msg_send![&*attributed, size];
            width = width.max(title_size.width + hint_size.width + 4.0 * KEY_INSET);
            let view = HintView::alloc(main).set_ivars(HintState {
                item: Weak::from_retained(&item),
                hint: attributed,
                highlighted: Cell::new(false),
                timer: RefCell::new(None),
            });
            let view: Retained<HintView> = msg_send![super(view), initWithFrame: NSRect::ZERO];
            let _: () = msg_send![&*view, setAccessibilityElement: false];
            view.setAutoresizingMask(
                objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable
                    | objc2_app_kit::NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            views.push(view);
        }
        if views.is_empty() {
            return;
        }
        let anchor = MenuAnchor::alloc(main).set_ivars(views);
        let anchor: Retained<MenuAnchor> = msg_send![super(anchor), initWithFrame: NSRect::new(NSPoint::ZERO, NSSize::new(width, 0.0))];
        anchor.setAutoresizingMask(objc2_app_kit::NSAutoresizingMaskOptions::ViewWidthSizable);
        let _: () = msg_send![&*anchor, setAccessibilityElement: false];
        let items = AnyClass::get(c"NSMenuItem").expect("AppKit is loaded");
        let accessory: Retained<AnyObject> = msg_send![items, new];
        let _: () = msg_send![&*accessory, setEnabled: false];
        let _: () = msg_send![&*accessory, setView: &*anchor];
        let _: () = msg_send![submenu, addItem: &*accessory];
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
            let child: Option<Retained<AnyObject>> = msg_send![&*item, submenu];
            if let Some(child) = child {
                decorate_by_title(&child, hints);
            }
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
            // AppKit can add native editing items after NSTextView becomes focused.
            // Only the responder Find entry must disappear when Project owns Cmd+F.
            let index: isize = msg_send![&*submenus[1], indexOfItemWithTag: 3787isize];
            assert_eq!(
                index, -1,
                "Project Find suppresses the responder Find entry"
            );
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
            let before: isize = msg_send![&*submenus[1], numberOfItems];
            sync_responder_menu(&app);
            let count: isize = msg_send![&*submenus[1], numberOfItems];
            assert_eq!(
                count, before,
                "projection is idempotent after removing an owner"
            );
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

    pub(crate) fn u4462_the_hint_uses_the_tertiary_tone_and_menu_font() {
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
                let view = hint_view(&item).expect("hint is retained by the menu accessory");
                assert!(
                    view.allowsVibrancy(),
                    "native key equivalents draw vibrantly"
                );
                let attributed = &view.ivars().hint;
                let font_key = NSString::from_str("NSFont");
                let color_key = NSString::from_str("NSColor");
                let hint_index = 0usize;
                let actual_font: Option<Retained<AnyObject>> = msg_send![&**attributed, attribute: &*font_key, atIndex: hint_index, effectiveRange: std::ptr::null_mut::<objc2_foundation::NSRange>()];
                let actual_font = actual_font.expect("hint has the menu's font");
                let same_font: bool = msg_send![&*actual_font, isEqual: &*font];
                assert!(same_font);
                let actual_color: Option<Retained<AnyObject>> = msg_send![&**attributed, attribute: &*color_key, atIndex: hint_index, effectiveRange: std::ptr::null_mut::<objc2_foundation::NSRange>()];
                let actual_color = actual_color.expect("hint has an explicit semantic color");
                let expected_color: Retained<AnyObject> = if enabled {
                    msg_send![colors, tertiaryLabelColor]
                } else {
                    msg_send![colors, disabledControlTextColor]
                };
                let same_color: bool = msg_send![&*actual_color, isEqual: &*expected_color];
                assert!(same_color);
                let native_view: Option<Retained<AnyObject>> = msg_send![&*item, view];
                assert!(
                    native_view.is_none(),
                    "AppKit must retain standard row drawing and tracking"
                );
            }
        }
    }

    pub(crate) fn u4462_the_hint_stop_is_the_key_equivalent_edge() {
        // A full 300 pt row with a 20 pt trailing inset and a 40 pt hint.
        assert_eq!(hint_stop(300.0, 20.0, 40.0, 0.0), 240.0);
        assert_eq!(hint_stop(420.0, 20.0, 40.0, 10.0), 370.0);
        // The hint's right edge lands on the shared inset for any menu width.
        for width in [292.0, 420.0] {
            let (hint, origin) = (31.5, 3.0);
            let right = hint_stop(width, KEY_INSET, hint, origin) + hint;
            assert_eq!(right, origin + width - KEY_INSET);
        }
    }

    unsafe fn hint_view(item: &AnyObject) -> Option<Retained<HintView>> {
        // SAFETY: test menus and their accessory are retained on the main thread.
        unsafe {
            let menu: Retained<AnyObject> = msg_send![item, menu];
            let count: isize = msg_send![&*menu, numberOfItems];
            let last: Retained<AnyObject> = msg_send![&*menu, itemAtIndex: count - 1];
            let anchor: Retained<MenuAnchor> = msg_send![&*last, view];
            anchor
                .ivars()
                .iter()
                .find(|view| {
                    view.ivars()
                        .item
                        .load()
                        .is_some_and(|candidate| std::ptr::eq(&*candidate, item))
                })
                .cloned()
        }
    }

    unsafe fn shown_hints(menu: &AnyObject) -> Vec<String> {
        // SAFETY: `menu` is a live NSMenu on the main thread.
        unsafe {
            let count: isize = msg_send![menu, numberOfItems];
            (0..count - 1)
                .map(|index| {
                    let item: Retained<AnyObject> = msg_send![menu, itemAtIndex: index];
                    let view = hint_view(&item);
                    view.map_or_else(String::new, |view| {
                        let shown: Retained<NSString> = msg_send![&*view.ivars().hint, string];
                        shown.to_string()
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
                let view = hint_view(&item).expect("hint is retained by the menu accessory");
                let attributed = &view.ivars().hint;
                let shown: Retained<NSString> = msg_send![&**attributed, string];
                shown.to_string()
            };
            assert_eq!(plain(0), "1");
            assert_eq!(plain(1), "9");

            decorate_project_menu(vec![(vec![1], "⌘K P".into())]);
            let native: Retained<AnyObject> = msg_send![&*installed, itemAtIndex: 0isize];
            let key: Retained<NSString> = msg_send![&*native, keyEquivalent];
            assert_eq!(key.to_string(), "n");
            let title: Retained<NSString> = msg_send![&*native, title];
            assert_eq!(title.to_string(), "New Workstream");
            let native_view: Option<Retained<AnyObject>> = msg_send![&*native, view];
            assert!(native_view.is_none());
            let count: isize = msg_send![&*installed, numberOfItems];
            assert_eq!(
                count, 4,
                "reopening replaces the accessory instead of adding rows"
            );
            let (installed, popup) = (shown_hints(&installed), shown_hints(&popup));
            assert!(
                installed[1] == "⌘K P",
                "the hint is separate from the native title"
            );
            assert_eq!(installed[..2], popup, "both paths build the same column");
        }
    }
}
