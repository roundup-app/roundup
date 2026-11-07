//! AppKit draws native rows; a non-interactive layer adds display-only hints.
#![deny(clippy::undocumented_unsafe_blocks)]
use objc2::{
    AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class,
    msg_send,
    rc::{Retained, Weak},
    runtime::ProtocolObject,
    sel,
};
use objc2_app_kit::{
    NSAccessibility, NSApplication, NSAttributedStringNSStringDrawing, NSAutoresizingMaskOptions,
    NSColor, NSEventModifierFlags, NSMenu, NSMenuItem, NSStringDrawing, NSView,
};
use objc2_foundation::{
    NSAttributedString, NSDictionary, NSMutableCopying, NSNotification, NSNotificationCenter,
    NSPoint, NSRange, NSRect, NSRunLoop, NSRunLoopCommonModes, NSSize, NSString, NSTimer,
};
use std::cell::{Cell, RefCell};
use std::ptr::NonNull;
use tauri::{AppHandle, Runtime};

/// Tag of the container item that holds the responder's Find entry in Edit.
const FIND_TAG: isize = 3787;

/// Refresh responder actions and decorate the freshly built Project submenu on the main thread.
/// Call after installation and every projection, including no Project. Indices include separators;
/// plain Project titles and key equivalents stay untouched.
pub fn project_menu_hints<R: Runtime>(
    app: &AppHandle<R>,
    hints: Vec<(Vec<usize>, String)>,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        let Some(main) = MainThreadMarker::new() else {
            log::warn!(target: "roundup::shell", "native menu hints skipped off the main thread");
            return;
        };
        decorate_project_menu(main, hints);
    })
}

/// Decorate the installed Project submenu of the application menu, when there is one.
fn decorate_project_menu(main: MainThreadMarker, hints: Vec<(Vec<usize>, String)>) {
    let application = NSApplication::sharedApplication(main);
    sync_responder_menu(&application);
    // Menus can be absent during teardown.
    let Some(menu) = application.mainMenu() else {
        return;
    };
    let Some(project) = menu.itemWithTitle(&NSString::from_str("Project")) else {
        return;
    };
    let Some(submenu) = project.submenu() else {
        return;
    };
    decorate_project_tree(main, &submenu, &hints);
}

/// AppKit owns validation and dispatch; Project commands keep muda's explicit availability.
fn sync_responder_menu(application: &NSApplication) {
    let main = application.mtm();
    let Some(menu) = application.mainMenu() else {
        return;
    };
    let submenu = |title: &str| {
        menu.itemWithTitle(&NSString::from_str(title))
            .and_then(|item| item.submenu())
    };
    if let Some(file) = submenu("File") {
        // Tauri's default File menu contains only standard Close Window on macOS.
        file.setAutoenablesItems(true);
        file.update();
    }
    let Some(edit) = submenu("Edit") else { return };
    let project_find = submenu("Project").is_some_and(|project| has_find_owner(&project));
    let index = edit.indexOfItemWithTag(FIND_TAG);
    if project_find && index >= 0 {
        edit.removeItemAtIndex(index);
    } else if !project_find && index < 0 {
        // SAFETY: `performTextFinderAction:` takes the sender, as a menu action does.
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(main),
                &NSString::from_str("Find…"),
                Some(sel!(performTextFinderAction:)),
                &NSString::from_str("f"),
            )
        };
        // NSTextFinderActionShowFindInterface = 1. Nil target follows the responder chain.
        item.setTag(1);
        // SAFETY: a nil target is the documented way to follow the responder chain.
        unsafe { item.setTarget(None) };
        item.setKeyEquivalentModifierMask(NSEventModifierFlags::Command);
        let submenu = NSMenu::new(main);
        submenu.setAutoenablesItems(true);
        submenu.addItem(&item);
        let container = NSMenuItem::new(main);
        container.setTitle(&NSString::from_str("Find"));
        container.setTag(FIND_TAG);
        container.setSubmenu(Some(&submenu));
        edit.addItem(&container);
        submenu.update();
    }
    // Edit stays manually enabled: Terminal Copy is handled by the webview's copy
    // event even when WebKit's native selection validator would disable it.
}

fn has_find_owner(menu: &NSMenu) -> bool {
    (0..menu.numberOfItems())
        .filter_map(|index| menu.itemAtIndex(index))
        .filter(|item| item.isEnabled())
        .any(|item| match item.submenu() {
            Some(child) => has_find_owner(&child),
            None => {
                item.keyEquivalent().to_string() == "f"
                    && item.keyEquivalentModifierMask() == NSEventModifierFlags::Command
            }
        })
}

/// Each index path selects a leaf in the installed menu, including duplicate Agent names.
fn decorate_project_tree(main: MainThreadMarker, submenu: &NSMenu, hints: &[(Vec<usize>, String)]) {
    decorate(
        main,
        submenu,
        hints
            .iter()
            .filter_map(|(path, hint)| match path.as_slice() {
                [index] => Some((*index, hint.clone())),
                _ => None,
            })
            .collect(),
    );
    for index in 0..submenu.numberOfItems() {
        let Some(child) = submenu.itemAtIndex(index).and_then(|item| item.submenu()) else {
            continue;
        };
        let Ok(index) = usize::try_from(index) else {
            continue;
        };
        let nested: Vec<_> = hints
            .iter()
            .filter_map(|(path, hint)| match path.as_slice() {
                [first, rest @ ..] if *first == index && !rest.is_empty() => {
                    Some((rest.to_vec(), hint.clone()))
                }
                _ => None,
            })
            .collect();
        decorate_project_tree(main, &child, &nested);
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
    item: Weak<NSMenuItem>,
    hint: Retained<NSAttributedString>,
    // AppKit repaints a row's highlight without invalidating this overlay and
    // offers no highlight signal (muda owns the menu delegate), so the overlay
    // polls while attached and repaints when its row's highlight flips.
    highlighted: Cell<bool>,
    timer: RefCell<Option<Retained<NSTimer>>>,
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
            let Some(item) = self.ivars().item.load() else { return; };
            // SAFETY: AppKit invokes drawing on its main thread; `menu` is a plain getter.
            let Some(menu) = (unsafe { item.menu() }) else { return; };
            let Some(attributes) =
                hint_attributes(&menu, &hint_color(item.isEnabled(), self.row_highlighted()))
            else {
                return;
            };
            let hint = self.ivars().hint.mutableCopy();
            // SAFETY: the range is the whole string and the dictionary holds an NSFont and an NSColor.
            unsafe { hint.setAttributes_range(Some(&attributes), NSRange::new(0, hint.length())) };
            let size = hint.size();
            let Some(window) = self.window() else { return; };
            let screen = item.accessibilityFrame();
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
            hint.drawAtPoint(point);
        }
    }
);

impl HintView {
    fn row_highlighted(&self) -> bool {
        let Some(item) = self.ivars().item.load() else {
            return false;
        };
        // SAFETY: `menu` is a plain getter, read on the main thread.
        let Some(menu) = (unsafe { item.menu() }) else {
            return false;
        };
        menu.highlightedItem()
            .is_some_and(|row| std::ptr::eq(&*row, &*item))
    }

    fn watch_highlight(&self) {
        self.unwatch_highlight();
        let this = Weak::from_retained(&self.retain());
        let tick = block2::RcBlock::new(move |timer: NonNull<NSTimer>| {
            let Some(view) = this.load() else {
                // SAFETY: timers fire on the main run loop; `timer` is live for the call.
                unsafe { timer.as_ref() }.invalidate();
                return;
            };
            let now = view.row_highlighted();
            if view.ivars().highlighted.replace(now) != now {
                view.setNeedsDisplay(true);
            }
        });
        // SAFETY: the block runs on the main run loop, where it is added below.
        let timer =
            unsafe { NSTimer::timerWithTimeInterval_repeats_block(1.0 / 30.0, true, &tick) };
        // SAFETY: the common modes include the event-tracking mode that menu tracking runs in.
        unsafe { NSRunLoop::currentRunLoop().addTimer_forMode(&timer, NSRunLoopCommonModes) };
        *self.ivars().timer.borrow_mut() = Some(timer);
    }

    fn unwatch_highlight(&self) {
        if let Some(timer) = self.ivars().timer.borrow_mut().take() {
            timer.invalidate();
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
fn hint_color(enabled: bool, highlighted: bool) -> Retained<NSColor> {
    match (enabled, highlighted) {
        (false, _) => NSColor::disabledControlTextColor(),
        (true, true) => NSColor::selectedMenuItemTextColor(),
        (true, false) => NSColor::tertiaryLabelColor(),
    }
}

/// The menu's font and the given colour; `None` when the menu has no font.
fn hint_attributes(
    menu: &NSMenu,
    color: &NSColor,
) -> Option<Retained<NSDictionary<NSString, objc2::runtime::AnyObject>>> {
    let font = menu.font()?;
    Some(NSDictionary::from_slices(
        &[
            &*NSString::from_str("NSFont"),
            &*NSString::from_str("NSColor"),
        ],
        &[&**font, &**color],
    ))
}

// The accessory is not an action row: its zero height preserves every native
// title, key equivalent, highlight and tracking target in the existing menu.
fn decorate(main: MainThreadMarker, submenu: &NSMenu, hints: Vec<(usize, String)>) {
    // Tauri knows only its own rows, so retire any accessory before applying its indices.
    for index in (0..submenu.numberOfItems()).rev() {
        let is_anchor = submenu
            .itemAtIndex(index)
            .and_then(|item| item.view())
            .is_some_and(|view| view.downcast_ref::<MenuAnchor>().is_some());
        if is_anchor {
            submenu.removeItemAtIndex(index);
        }
    }
    if hints.is_empty() {
        return;
    }
    let mut width = submenu.minimumWidth();
    let mut views = Vec::new();
    for (index, hint) in hints {
        let Some(item) = isize::try_from(index)
            .ok()
            .and_then(|index| submenu.itemAtIndex(index))
        else {
            continue;
        };
        let Some(attributes) = hint_attributes(submenu, &hint_color(item.isEnabled(), false))
        else {
            log::warn!(target: "roundup::shell", "native menu has no font for its hints");
            continue;
        };
        // SAFETY: `attributes` holds an NSFont and an NSColor under the keys AppKit reads.
        let attributed = unsafe {
            NSAttributedString::initWithString_attributes(
                NSAttributedString::alloc(),
                &NSString::from_str(&hint),
                Some(&attributes),
            )
        };
        // SAFETY: `attributes` holds the font and colour NSString drawing reads.
        let title_size = unsafe { item.title().sizeWithAttributes(Some(&attributes)) };
        width = width.max(title_size.width + attributed.size().width + 4.0 * KEY_INSET);
        let view = HintView::alloc(main).set_ivars(HintState {
            item: Weak::from_retained(&item),
            hint: attributed,
            highlighted: Cell::new(false),
            timer: RefCell::new(None),
        });
        // `msg_send!` stays: `define_class!` types are initialised through their super's init.
        // SAFETY: `initWithFrame:` on an allocated NSView subclass with its ivars set.
        let view: Retained<HintView> =
            unsafe { msg_send![super(view), initWithFrame: NSRect::ZERO] };
        view.setAccessibilityElement(false);
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        views.push(view);
    }
    if views.is_empty() {
        return;
    }
    let anchor = MenuAnchor::alloc(main).set_ivars(views);
    // `msg_send!` stays: `define_class!` types are initialised through their super's init.
    // SAFETY: `initWithFrame:` on an allocated NSView subclass with its ivars set.
    let anchor: Retained<MenuAnchor> = unsafe {
        msg_send![super(anchor), initWithFrame: NSRect::new(NSPoint::ZERO, NSSize::new(width, 0.0))]
    };
    anchor.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
    anchor.setAccessibilityElement(false);
    let accessory = NSMenuItem::new(main);
    accessory.setEnabled(false);
    accessory.setView(Some(&anchor));
    submenu.addItem(&accessory);
}

/// Decorate the items of a tracked popup submenu whose title has a hint.
fn decorate_by_title(main: MainThreadMarker, submenu: &NSMenu, hints: &[(String, String)]) {
    let mut matching = Vec::new();
    for index in 0..submenu.numberOfItems() {
        let Some(item) = submenu.itemAtIndex(index) else {
            continue;
        };
        if let Some(child) = item.submenu() {
            decorate_by_title(main, &child, hints);
        }
        let title = item.title().to_string();
        if let Some((_, hint)) = hints.iter().find(|(label, _)| *label == title)
            && let Ok(index) = usize::try_from(index)
        {
            matching.push((index, hint.clone()));
        }
    }
    decorate(main, submenu, matching);
}

/// Keep the observer scoped to the synchronous popup; AppKit supplies each menu as it tracks it.
pub fn context_menu<R: Runtime>(
    window: &tauri::Window<R>,
    menu: &tauri::menu::Menu<R>,
    position: tauri::LogicalPosition<f64>,
    hints: Vec<(String, String)>,
) -> tauri::Result<()> {
    let Some(main) = MainThreadMarker::new() else {
        return Err(tauri::Error::Io(std::io::Error::other(
            "a native context menu opens on the main thread",
        )));
    };
    let center = NSNotificationCenter::defaultCenter();
    let block = block2::RcBlock::new(move |notification: NonNull<NSNotification>| {
        // SAFETY: AppKit passes a live notification for the duration of the call.
        let notification = unsafe { notification.as_ref() };
        if let Some(submenu) = notification
            .object()
            .and_then(|object| object.downcast::<NSMenu>().ok())
        {
            decorate_by_title(main, &submenu, &hints);
        }
    });
    let name = NSString::from_str("NSMenuDidBeginTrackingNotification");
    // SAFETY: AppKit notifications are synchronous on this main thread. The observer and
    // its retained block live until popup_menu_at returns and are then removed together.
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(&name), None, None, &block)
    };
    let result = window.popup_menu_at(menu, position);
    // SAFETY: `observer` is the token returned above; the block is still retained.
    unsafe { center.removeObserver(ProtocolObject::as_ref(&*observer)) };
    result
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    use objc2::{DefinedClass, MainThreadOnly, define_class, runtime::AnyObject};
    use objc2_app_kit::{
        NSBackingStoreType, NSEvent, NSEventMask, NSEventType, NSFont, NSResponder, NSScrollView,
        NSTextView, NSWindow, NSWindowStyleMask,
    };
    use objc2_foundation::{NSDate, NSDefaultRunLoopMode, NSObjectProtocol, NSPoint, NSRect};
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

    fn titled_item(main: MainThreadMarker, title: &str) -> Retained<NSMenuItem> {
        let item = NSMenuItem::new(main);
        item.setTitle(&NSString::from_str(title));
        item
    }

    fn cmd_f(window_number: isize) -> Retained<NSEvent> {
        NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            NSEventType::KeyDown,
            NSPoint::new(0.0, 0.0),
            NSEventModifierFlags::Command,
            0.0,
            window_number,
            None,
            &NSString::from_str("f"),
            &NSString::from_str("f"),
            false,
            3,
        )
        .expect("a key event")
    }

    pub(crate) fn u3787b_native_responder_find_and_close_follow_availability() {
        let main = MainThreadMarker::new().expect("main-thread harness");
        // Restore the prior menu and close only these probe windows.
        let app = NSApplication::sharedApplication(main);
        let prior = app.mainMenu();
        app.setActivationPolicy(objc2_app_kit::NSApplicationActivationPolicy::Regular);
        app.finishLaunching();
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        let menu = NSMenu::new(main);
        let mut submenus = Vec::new();
        for title in ["File", "Edit", "Project"] {
            let item = titled_item(main, title);
            let sub = NSMenu::new(main);
            sub.setAutoenablesItems(false);
            item.setSubmenu(Some(&sub));
            menu.addItem(&item);
            submenus.push(sub);
        }
        let close = titled_item(main, "Close Window");
        // SAFETY: `performClose:` is the standard window action.
        unsafe { close.setAction(Some(sel!(performClose:))) };
        close.setKeyEquivalent(&NSString::from_str("w"));
        submenus[0].addItem(&close);
        let copy = titled_item(main, "Copy");
        // SAFETY: `copy:` is the standard responder action.
        unsafe { copy.setAction(Some(sel!(copy:))) };
        copy.setEnabled(true);
        submenus[1].addItem(&copy);
        app.setMainMenu(Some(&menu));
        sync_responder_menu(&app);
        assert!(
            copy.isEnabled(),
            "Terminal Copy retains its existing event route"
        );
        let container = submenus[1].itemWithTag(FIND_TAG).expect("Find container");
        let find_menu = container.submenu().expect("Find submenu");
        let find = find_menu.itemAtIndex(0).expect("Find item");
        let windows = (0..2)
            .map(|_| {
                // SAFETY: a plain titled window created and used on the main thread.
                let window = unsafe {
                    NSWindow::initWithContentRect_styleMask_backing_defer(
                        NSWindow::alloc(main),
                        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(300.0, 200.0)),
                        NSWindowStyleMask::Titled | NSWindowStyleMask::Closable,
                        NSBackingStoreType::Buffered,
                        false,
                    )
                };
                // SAFETY: the test owns the window and keeps it retained.
                unsafe { window.setReleasedWhenClosed(false) };
                window
            })
            .collect::<Vec<_>>();
        let responders = (0..2)
            .map(|_| {
                let responder = FindResponder::alloc(main).set_ivars(FindState::default());
                // `msg_send!` stays: `define_class!` types are initialised through their super's init.
                // SAFETY: `init` on an allocated NSResponder subclass with its ivars set.
                let responder: Retained<FindResponder> =
                    unsafe { msg_send![super(responder), init] };
                responder
            })
            .collect::<Vec<_>>();
        for (index, window) in windows.iter().enumerate() {
            window.makeKeyAndOrderFront(None);
            // AppKit activation arrives through the event queue. Unlike the App,
            // this harness has no running event loop: dispatch until AppKit reports
            // this probe window as key before testing nil-target menu validation.
            let deadline = NSDate::dateWithTimeIntervalSinceNow(5.0);
            loop {
                if app
                    .keyWindow()
                    .is_some_and(|key| std::ptr::eq(&*key, &**window))
                {
                    break;
                }
                assert!(
                    deadline.timeIntervalSinceNow() > 0.0,
                    "AppKit did not make probe window {index} key"
                );
                // SAFETY: the default mode is a process-global constant.
                let mode = unsafe { NSDefaultRunLoopMode };
                let event = app.nextEventMatchingMask_untilDate_inMode_dequeue(
                    NSEventMask::Any,
                    Some(&deadline),
                    mode,
                    true,
                );
                if let Some(event) = event {
                    app.sendEvent(&event);
                }
            }
            // A bare NSResponder has no view hierarchy to link it to the window.
            // SAFETY: the window outlives the responder chain it joins.
            unsafe { responders[index].setNextResponder(Some(window)) };
            assert!(window.makeFirstResponder(Some(&responders[index])));
            for available in [false, true] {
                responders[index].ivars().available.set(available);
                find_menu.update();
                assert_eq!(
                    find.isEnabled(),
                    available,
                    "Find availability in probe window {index}"
                );
                menu.performKeyEquivalent(&cmd_f(window.windowNumber()));
                assert_eq!(
                    responders[index].ivars().calls.get(),
                    usize::from(available)
                );
                let focused = window.firstResponder().expect("a first responder");
                assert!(std::ptr::eq(
                    Retained::as_ptr(&focused),
                    Retained::as_ptr(&responders[index]).cast::<NSResponder>()
                ));
            }
        }
        let editor = NSTextView::new(main);
        // NSTextView only validates the modern finder action when its find bar
        // is enabled. A bare text view otherwise exercises an unavailable editor.
        editor.setUsesFindBar(true);
        editor.setString(&NSString::from_str("native editor"));
        let content = windows[1].contentView().expect("content view");
        let scroll = NSScrollView::new(main);
        scroll.setFrame(content.bounds());
        scroll.setDocumentView(Some(&editor));
        content.addSubview(&scroll);
        assert!(windows[1].makeFirstResponder(Some(&editor)));
        find_menu.update();
        // SAFETY: `targetForAction:` only walks the responder chain.
        let target =
            unsafe { app.targetForAction(sel!(performTextFinderAction:)) }.expect("a Find target");
        assert!(
            find.isEnabled(),
            "a find-enabled native editor validates Find"
        );
        assert!(
            std::ptr::eq(
                Retained::as_ptr(&target),
                Retained::as_ptr(&editor).cast::<AnyObject>()
            ),
            "Find targets the focused native editor"
        );
        assert!(windows[1].makeFirstResponder(Some(&responders[1])));
        // A projected registration owns the native accelerator; the responder entry
        // must be absent, so AppKit cannot fire both paths for one key equivalent.
        let terminal = titled_item(main, "Terminal Find");
        // SAFETY: the target is a retained responder that implements the action.
        unsafe {
            terminal.setAction(Some(sel!(performTextFinderAction:)));
            terminal.setTarget(Some(&responders[0]));
        }
        terminal.setKeyEquivalent(&NSString::from_str("f"));
        terminal.setKeyEquivalentModifierMask(NSEventModifierFlags::Command);
        submenus[2].addItem(&terminal);
        sync_responder_menu(&app);
        // AppKit can add native editing items after NSTextView becomes focused.
        // Only the responder Find entry must disappear when Project owns Cmd+F.
        assert_eq!(
            submenus[1].indexOfItemWithTag(FIND_TAG),
            -1,
            "Project Find suppresses the responder Find entry"
        );
        let event = cmd_f(0);
        assert!(menu.performKeyEquivalent(&event));
        assert_eq!(responders[0].ivars().calls.get(), 2);
        assert_eq!(responders[1].ivars().calls.get(), 1);
        terminal.setEnabled(false);
        sync_responder_menu(&app);
        menu.performKeyEquivalent(&event);
        assert_eq!(responders[0].ivars().calls.get(), 2);
        assert_eq!(responders[1].ivars().calls.get(), 2);
        submenus[2].removeItem(&terminal);
        sync_responder_menu(&app);
        let before = submenus[1].numberOfItems();
        sync_responder_menu(&app);
        assert_eq!(
            submenus[1].numberOfItems(),
            before,
            "projection is idempotent after removing an owner"
        );
        let container = submenus[1].itemWithTag(FIND_TAG).expect("Find container");
        let current_find_menu = container.submenu().expect("Find submenu");
        current_find_menu.update();
        current_find_menu.performActionForItemAtIndex(0);
        assert_eq!(responders[1].ivars().calls.get(), 3);
        submenus[0].update();
        assert!(close.isEnabled());
        submenus[0].performActionForItemAtIndex(0);
        assert!(
            !windows[1].isVisible() && windows[0].isVisible(),
            "Close targets the actual key window"
        );
        windows[0].close();
        submenus[0].update();
        current_find_menu.update();
        let current_find = current_find_menu.itemAtIndex(0).expect("Find item");
        assert!(!close.isEnabled() && !current_find.isEnabled());
        app.setMainMenu(prior.as_deref());
    }

    pub(crate) fn u4462_the_hint_uses_the_tertiary_tone_and_menu_font() {
        let main = MainThreadMarker::new().expect("native test harness runs on the main thread");
        let _ = NSApplication::sharedApplication(main);
        let menu = NSMenu::new(main);
        menu.setAutoenablesItems(false);
        let font = NSFont::menuFontOfSize(16.0);
        // SAFETY: a menu font is a valid font for the menu's text.
        unsafe { menu.setFont(Some(&font)) };
        for enabled in [true, false] {
            let item = titled_item(main, "项目 🦀");
            item.setEnabled(enabled);
            menu.addItem(&item);
        }
        decorate(main, &menu, vec![(0, "⌘K P".into()), (1, "⌘K W".into())]);
        for (index, enabled) in [(0isize, true), (1, false)] {
            let item = menu.itemAtIndex(index).expect("row");
            assert_eq!(item.title().to_string(), "项目 🦀");
            assert!(
                item.keyEquivalent().is_empty(),
                "a hint must never register an accelerator"
            );
            let view = hint_view(&item).expect("hint is retained by the menu accessory");
            assert!(
                view.allowsVibrancy(),
                "native key equivalents draw vibrantly"
            );
            let attributed = &view.ivars().hint;
            let font_key = NSString::from_str("NSFont");
            let color_key = NSString::from_str("NSColor");
            // SAFETY: index 0 is inside a non-empty hint; a null range pointer is allowed.
            let actual_font = unsafe {
                attributed.attribute_atIndex_effectiveRange(&font_key, 0, std::ptr::null_mut())
            }
            .expect("hint has the menu's font");
            assert!(
                actual_font
                    .downcast::<NSFont>()
                    .is_ok_and(|actual| actual == font)
            );
            // SAFETY: as above.
            let actual_color = unsafe {
                attributed.attribute_atIndex_effectiveRange(&color_key, 0, std::ptr::null_mut())
            }
            .expect("hint has an explicit semantic color");
            let expected_color = if enabled {
                NSColor::tertiaryLabelColor()
            } else {
                NSColor::disabledControlTextColor()
            };
            assert!(
                actual_color
                    .downcast::<NSColor>()
                    .is_ok_and(|actual| actual == expected_color)
            );
            assert!(
                item.view().is_none(),
                "AppKit must retain standard row drawing and tracking"
            );
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

    fn hint_view(item: &NSMenuItem) -> Option<Retained<HintView>> {
        // SAFETY: `menu` is a plain getter on a test menu retained on the main thread.
        let menu = unsafe { item.menu() }?;
        let last = menu.itemAtIndex(menu.numberOfItems() - 1)?;
        let anchor = last.view()?.downcast::<MenuAnchor>().ok()?;
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

    fn shown_hints(menu: &NSMenu) -> Vec<String> {
        (0..menu.numberOfItems() - 1)
            .filter_map(|index| menu.itemAtIndex(index))
            .map(|item| {
                hint_view(&item)
                    .map_or_else(String::new, |view| view.ivars().hint.string().to_string())
            })
            .collect()
    }

    pub(crate) fn u4462_installed_and_tracked_menus_use_one_decoration() {
        let main = MainThreadMarker::new().expect("native test harness runs on the main thread");
        let application = NSApplication::sharedApplication(main);
        let build = || {
            let menu = NSMenu::new(main);
            menu.setAutoenablesItems(false);
            for (title, key) in [("New Workstream", "n"), ("Open Project", "")] {
                let item = titled_item(main, title);
                item.setKeyEquivalent(&NSString::from_str(key));
                menu.addItem(&item);
            }
            menu
        };
        let popup = build();
        decorate_by_title(main, &popup, &[("Open Project".into(), "⌘K P".into())]);

        let installed = build();
        let bar = NSMenu::new(main);
        let project = titled_item(main, "Project");
        project.setSubmenu(Some(&installed));
        bar.addItem(&project);
        application.setMainMenu(Some(&bar));
        let child = NSMenu::new(main);
        for _ in 0..2 {
            child.addItem(&titled_item(main, "Assign to same name"));
        }
        let assignment = NSMenuItem::new(main);
        assignment.setSubmenu(Some(&child));
        installed.addItem(&assignment);
        decorate_project_menu(
            main,
            vec![
                (vec![1], "⌘K P".into()),
                (vec![2, 0], "1".into()),
                (vec![2, 1], "9".into()),
            ],
        );
        let plain = |index: isize| -> String {
            let item = child.itemAtIndex(index).expect("child row");
            let view = hint_view(&item).expect("hint is retained by the menu accessory");
            view.ivars().hint.string().to_string()
        };
        assert_eq!(plain(0), "1");
        assert_eq!(plain(1), "9");

        decorate_project_menu(main, vec![(vec![1], "⌘K P".into())]);
        let native = installed.itemAtIndex(0).expect("first row");
        assert_eq!(native.keyEquivalent().to_string(), "n");
        assert_eq!(native.title().to_string(), "New Workstream");
        assert!(native.view().is_none());
        assert_eq!(
            installed.numberOfItems(),
            4,
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
