//! AppKit draws native rows; a non-interactive layer adds display-only hints.
use objc2::{
    DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
    rc::{Allocated, Retained, Weak},
    runtime::{AnyClass, AnyObject},
    sel,
};
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRange, NSRect, NSSize, NSString};
use std::cell::Cell;
use tauri::{AppHandle, Runtime};

/// Decorate the freshly built Project submenu on the main thread; indices include separators.
/// Plain titles, key equivalents and native item views stay untouched.
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

// This inset matched the native shortcut edge in the owner's full-width Mac
// observation. It is relative to each final row, never to the longest title.
const KEY_INSET: f64 = 20.0;

fn hint_stop(menu_width: f64, right_inset: f64, hint_width: f64, origin: f64) -> f64 {
    origin + menu_width - right_inset - hint_width
}

struct HintState {
    item: Weak<AnyObject>,
    hint: Retained<AnyObject>,
    tracking: Cell<bool>,
}

// NSMenuItem.view stays nil: AppKit owns titles, keys, selection and tracking.
// The item owns this drawing-only view through representedObject, and the weak
// back-reference prevents item → view → item from retaining a retired menu.
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = HintState]
    struct HintView;

    impl HintView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }

        #[unsafe(method(menuBegan:))]
        fn menu_began(&self, notification: &AnyObject) {
            // SAFETY: all menu ancestors remain retained during native tracking.
            unsafe {
                let Some(item) = self.ivars().item.load() else { return; };
                let tracked: Retained<AnyObject> = msg_send![notification, object];
                let mut menu: Option<Retained<AnyObject>> = msg_send![&*item, menu];
                while let Some(parent) = menu {
                    if std::ptr::eq(&*parent, &*tracked) {
                        self.ivars().tracking.set(true);
                        return;
                    }
                    menu = msg_send![&*parent, supermenu];
                }
            }
        }

        #[unsafe(method(menuEnded:))]
        fn menu_ended(&self, _notification: &AnyObject) {
            self.ivars().tracking.set(false);
            self.removeFromSuperview();
        }

        #[unsafe(method(windowUpdated:))]
        fn window_updated(&self, notification: &AnyObject) {
            // SAFETY: synchronous AppKit window notifications run on the main
            // thread. Accessibility supplies the live row and its owning window.
            unsafe {
                let Some(item) = self.ivars().item.load() else {
                    self.removeFromSuperview();
                    return;
                };
                if !self.ivars().tracking.get() { return; }
                let owner: Option<Retained<AnyObject>> = msg_send![&*item, accessibilityWindow];
                let window: Retained<AnyObject> = msg_send![notification, object];
                if let Some(owner) = owner {
                    if !std::ptr::eq(&*owner, &*window) { return; }
                } else {
                    // Menu accessibility elements may omit AXWindow. Match their
                    // screen rectangle only against a native popup-level window.
                    let level: isize = msg_send![&*window, level];
                    if level != objc2_app_kit::NSPopUpMenuWindowLevel { return; }
                    let row: NSRect = msg_send![&*item, accessibilityFrame];
                    let frame: NSRect = msg_send![&*window, frame];
                    if row.origin.x < frame.origin.x || row.origin.y < frame.origin.y
                        || row.origin.x + row.size.width > frame.origin.x + frame.size.width
                        || row.origin.y + row.size.height > frame.origin.y + frame.size.height {
                        return;
                    }
                }
                let visible: bool = msg_send![&*window, isVisible];
                if !visible { return; }
                let screen: NSRect = msg_send![&*item, accessibilityFrame];
                if screen.size.width <= 0.0 || screen.size.height <= 0.0 { return; }
                let content: Option<Retained<NSView>> = msg_send![&*window, contentView];
                let Some(content) = content else { return; };
                let local: NSRect = msg_send![&*window, convertRectFromScreen: screen];
                let frame = content.convertRect_fromView(local, None);
                if self.frame() != frame { self.setFrame(frame); }
                if self.superview().as_deref().map(std::ptr::from_ref) != Some(std::ptr::from_ref(&*content)) {
                    content.addSubview(self);
                }
                self.setNeedsDisplay(true);
            }
        }

        #[unsafe(method(drawRect:))]
        fn draw(&self, _dirty: NSRect) {
            // SAFETY: AppKit invokes drawing on its main thread; the weak item
            // is retained for this draw, and only the hint is painted.
            unsafe {
                let Some(item) = self.ivars().item.load() else { return; };
                let enabled: bool = msg_send![&*item, isEnabled];
                let menu: Retained<AnyObject> = msg_send![&*item, menu];
                let attributes = hint_attributes(&menu, enabled);
                let hint: Retained<AnyObject> = msg_send![&*self.ivars().hint, mutableCopy];
                let length: usize = msg_send![&*hint, length];
                let _: () = msg_send![&*hint, setAttributes: &*attributes, range: NSRange::new(0, length)];
                let size: NSSize = msg_send![&*hint, size];
                let bounds = self.bounds();
                let point = NSPoint::new(
                    hint_stop(bounds.size.width, KEY_INSET, size.width, bounds.origin.x),
                    bounds.origin.y + (bounds.size.height - size.height) / 2.0,
                );
                let _: () = msg_send![&*hint, drawAtPoint: point];
            }
        }
    }
);

unsafe fn hint_attributes(menu: &AnyObject, enabled: bool) -> Retained<AnyObject> {
    // SAFETY: caller supplies an NSMenu on the main thread.
    unsafe {
        let font: Retained<AnyObject> = msg_send![menu, font];
        let dictionary = AnyClass::get(c"NSMutableDictionary").expect("Foundation is loaded");
        let attributes: Retained<AnyObject> = msg_send![dictionary, new];
        let _: () =
            msg_send![&*attributes, setObject: &*font, forKey: &*NSString::from_str("NSFont")];
        let colors = AnyClass::get(c"NSColor").expect("AppKit is loaded");
        let color: Retained<AnyObject> = if enabled {
            msg_send![colors, secondaryLabelColor]
        } else {
            msg_send![colors, disabledControlTextColor]
        };
        let _: () =
            msg_send![&*attributes, setObject: &*color, forKey: &*NSString::from_str("NSColor")];
        attributes
    }
}

// Both installed and popup menus retain their native rows. Window updates occur
// after layout, including while tracking, so the overlay follows the live frame.
unsafe fn decorate(submenu: &AnyObject, hints: Vec<(usize, String)>) {
    let main = MainThreadMarker::new().expect("Tauri's main thread");
    // SAFETY: callers supply a live NSMenu on the process main thread. Selector
    // notification observers are zeroed by Foundation when their view deallocates.
    unsafe {
        let count: isize = msg_send![submenu, numberOfItems];
        let center = AnyClass::get(c"NSNotificationCenter").expect("Foundation is loaded");
        let center: Retained<AnyObject> = msg_send![center, defaultCenter];
        let mut width: f64 = msg_send![submenu, minimumWidth];
        for (index, hint) in hints {
            let Ok(index) = isize::try_from(index) else {
                continue;
            };
            if index >= count {
                continue;
            }
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let existing: Option<Retained<AnyObject>> = msg_send![&*item, representedObject];
            if existing.is_some() {
                continue;
            }
            let enabled: bool = msg_send![&*item, isEnabled];
            let attributes = hint_attributes(submenu, enabled);
            let strings = AnyClass::get(c"NSAttributedString").expect("Foundation is loaded");
            let attributed: Allocated<AnyObject> = msg_send![strings, alloc];
            let attributed: Retained<AnyObject> = msg_send![attributed, initWithString: &*NSString::from_str(&hint), attributes: &*attributes];
            let title: Retained<NSString> = msg_send![&*item, title];
            let title_size: NSSize = msg_send![&*title, sizeWithAttributes: &*attributes];
            let hint_size: NSSize = msg_send![&*attributed, size];
            // Reserve space without changing the native title or accelerator.
            width = width.max(title_size.width + hint_size.width + 4.0 * KEY_INSET);
            let view = HintView::alloc(main).set_ivars(HintState {
                item: Weak::from_retained(&item),
                hint: attributed,
                tracking: Cell::new(false),
            });
            let view: Retained<HintView> = msg_send![super(view), initWithFrame: NSRect::ZERO];
            let _: () = msg_send![&*view, setAccessibilityElement: false];
            let _: () = msg_send![&*item, setRepresentedObject: &*view];
            let _: () = msg_send![&*center, addObserver: &*view, selector: sel!(windowUpdated:), name: &*NSString::from_str("NSWindowDidUpdateNotification"), object: std::ptr::null::<AnyObject>()];
            let _: () = msg_send![&*center, addObserver: &*view, selector: sel!(menuEnded:), name: &*NSString::from_str("NSMenuDidEndTrackingNotification"), object: std::ptr::null::<AnyObject>()];
            let _: () = msg_send![&*center, addObserver: &*view, selector: sel!(menuBegan:), name: &*NSString::from_str("NSMenuDidBeginTrackingNotification"), object: std::ptr::null::<AnyObject>()];
        }
        let _: () = msg_send![submenu, setMinimumWidth: width];
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
        let indices: Vec<_> = matching.iter().map(|(index, _)| *index).collect();
        decorate(submenu, matching);
        for index in indices {
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: isize::try_from(index).expect("nonnegative menu index")];
            let view: Option<Retained<AnyObject>> = msg_send![&*item, representedObject];
            if let Some(view) = view
                .as_deref()
                .and_then(|view| view.downcast_ref::<HintView>())
            {
                view.ivars().tracking.set(true);
            }
        }
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
                let view: Retained<HintView> = msg_send![&*item, representedObject];
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
                    msg_send![colors, secondaryLabelColor]
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
    }

    unsafe fn shown_hints(menu: &AnyObject) -> Vec<String> {
        // SAFETY: `menu` is a live NSMenu on the main thread.
        unsafe {
            let count: isize = msg_send![menu, numberOfItems];
            (0..count)
                .map(|index| {
                    let item: Retained<AnyObject> = msg_send![menu, itemAtIndex: index];
                    let view: Option<Retained<HintView>> = msg_send![&*item, representedObject];
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
                let view: Retained<HintView> = msg_send![&*item, representedObject];
                let attributed = &view.ivars().hint;
                let shown: Retained<NSString> = msg_send![&**attributed, string];
                shown.to_string()
            };
            assert_eq!(plain(0), "1");
            assert_eq!(plain(1), "9");

            let (installed, popup) = (shown_hints(&installed), shown_hints(&popup));
            assert!(
                installed[1] == "⌘K P",
                "the hint is separate from the native title"
            );
            assert_eq!(installed[..2], popup, "both paths build the same column");
        }
    }
}
