//! AppKit item views keep sequence hints separate from executable key equivalents.
use objc2::{
    DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
};
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::cell::Cell;
use tauri::{AppHandle, Runtime};

/// Decorate the freshly built Project submenu on the main thread; indices include separators.
/// Plain titles and executable key equivalents stay on their original items.
pub fn project_menu_hints<R: Runtime>(
    app: &AppHandle<R>,
    hints: Vec<(usize, String)>,
) -> tauri::Result<()> {
    app.run_on_main_thread(move || {
        let _main = MainThreadMarker::new().expect("Tauri's main thread");
        // SAFETY: on the main thread, as `decorate_project_menu` requires.
        unsafe { decorate_project_menu(hints) }
    })
}

/// Decorate the installed Project submenu of the application menu, when there is one.
unsafe fn decorate_project_menu(hints: Vec<(usize, String)>) {
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
        decorate(&submenu, hints);
    }
}

// The right inset comes from NSMenuItemCell, never from the title's measured width.
fn hint_stop(menu_width: f64, right_inset: f64, hint_width: f64) -> f64 {
    menu_width - right_inset - hint_width
}

struct ItemViewState {
    cell: Retained<AnyObject>,
    column: Retained<AnyObject>,
    hint: Option<Retained<AnyObject>>,
    hover: Cell<bool>,
}

// Expansion audit: this main-thread NSView subclass owns its drawing cells and hint;
// it never retains its enclosing item (which owns the view), avoiding a retain cycle.
define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ItemViewState]
    struct ItemView;

    impl ItemView {
        #[unsafe(method(drawRect:))]
        fn draw(&self, _dirty: NSRect) {
            // SAFETY: AppKit invokes view methods on its main thread; all selectors
            // below are public NSView, NSMenuItemCell and attributed-string methods.
            unsafe {
                let bounds: NSRect = msg_send![self, bounds];
                let item: Retained<AnyObject> = msg_send![self, enclosingMenuItem];
                let enabled: bool = msg_send![&*item, isEnabled];
                let selected: bool = msg_send![&*item, isHighlighted];
                let state = self.ivars();
                let _: () = msg_send![&*state.cell, setMenuItem: &*item];
                let _: () = msg_send![&*state.cell, setHighlighted: enabled && (selected || state.hover.get())];
                let _: () = msg_send![&*state.cell, drawWithFrame: bounds, inView: self];
                // NSMenuItemCell strongly retains menuItem; keep no item → view → cell cycle.
                let _: () = msg_send![&*state.cell, setMenuItem: std::ptr::null::<AnyObject>()];
                if let Some(hint) = &state.hint {
                    let column: NSRect = msg_send![&*state.column, keyEquivalentRectForBounds: bounds];
                    let size: NSSize = msg_send![&**hint, size];
                    let inset = bounds.size.width - column.origin.x - column.size.width;
                    let point = NSPoint::new(
                        hint_stop(bounds.size.width, inset, size.width),
                        (bounds.size.height - size.height) / 2.0,
                    );
                    let _: () = msg_send![&**hint, drawAtPoint: point];
                }
            }
        }

        #[unsafe(method(updateTrackingAreas))]
        fn update_tracking(&self) {
            // SAFETY: the superclass owns tracking areas; replacing them prevents
            // stale rectangles after AppKit expands this view to the menu width.
            unsafe {
                let _: () = msg_send![super(self), updateTrackingAreas];
                let areas: Retained<AnyObject> = msg_send![self, trackingAreas];
                let count: usize = msg_send![&*areas, count];
                for index in 0..count {
                    let area: Retained<AnyObject> = msg_send![&*areas, objectAtIndex: index];
                    let _: () = msg_send![self, removeTrackingArea: &*area];
                }
                let class = AnyClass::get(c"NSTrackingArea").expect("AppKit is loaded");
                let area: Allocated<AnyObject> = msg_send![class, alloc];
                // MouseEnteredAndExited | ActiveAlways | InVisibleRect | EnabledDuringMouseDrag.
                let area: Retained<AnyObject> = msg_send![area, initWithRect: NSRect::ZERO, options: 1665usize, owner: self, userInfo: std::ptr::null::<AnyObject>()];
                let _: () = msg_send![self, addTrackingArea: &*area];
            }
        }

        #[unsafe(method(mouseEntered:))]
        fn entered(&self, _event: &AnyObject) { self.hover(true); }

        #[unsafe(method(mouseExited:))]
        fn exited(&self, _event: &AnyObject) { self.hover(false); }

        #[unsafe(method(acceptsFirstMouse:))]
        fn accepts_first_mouse(&self, _event: &AnyObject) -> bool { true }

        #[unsafe(method(mouseDown:))]
        fn pressed(&self, _event: &AnyObject) {}

        #[unsafe(method(mouseDragged:))]
        fn dragged(&self, event: &AnyObject) {
            // SAFETY: event and view coordinates are read on AppKit's main thread.
            unsafe {
                let location: NSPoint = msg_send![event, locationInWindow];
                let point: NSPoint = msg_send![self, convertPoint: location, fromView: std::ptr::null::<AnyObject>()];
                let inside: bool = msg_send![self, mouse: point, inRect: self.bounds()];
                self.hover(inside);
            }
        }

        #[unsafe(method(mouseUp:))]
        fn chosen(&self, event: &AnyObject) {
            // SAFETY: dispatch through the enclosing NSMenu preserves muda's
            // original target/action and menu-event delivery; a disabled row is inert.
            unsafe {
                let location: NSPoint = msg_send![event, locationInWindow];
                let point: NSPoint = msg_send![self, convertPoint: location, fromView: std::ptr::null::<AnyObject>()];
                let inside: bool = msg_send![self, mouse: point, inRect: self.bounds()];
                let item: Retained<AnyObject> = msg_send![self, enclosingMenuItem];
                let enabled: bool = msg_send![&*item, isEnabled];
                if enabled && inside {
                    let menu: Retained<AnyObject> = msg_send![&*item, menu];
                    let index: isize = msg_send![&*menu, indexOfItem: &*item];
                    let _: () = msg_send![&*menu, cancelTracking];
                    let _: () = msg_send![&*menu, performActionForItemAtIndex: index];
                }
            }
        }
    }
);

impl ItemView {
    fn hover(&self, hover: bool) {
        self.ivars().hover.set(hover);
        self.setNeedsDisplay(true);
    }
}

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

// Every action row in a hinted menu uses the same native cell geometry, including
// real accelerators. Separators and submenus retain AppKit's standard views.
unsafe fn decorate(submenu: &AnyObject, hints: Vec<(usize, String)>) {
    if hints.is_empty() {
        return;
    }
    let main = MainThreadMarker::new().expect("Tauri's main thread");
    // SAFETY: callers supply an NSMenu on the main thread; NSMenuItem retains its
    // custom view. The sizing cell's display key is never installed as an accelerator.
    unsafe {
        let cells = AnyClass::get(c"NSMenuItemCell").expect("AppKit is loaded");
        let column: Allocated<AnyObject> = msg_send![cells, alloc];
        let column: Retained<AnyObject> = msg_send![column, initTextCell: &*NSString::from_str("")];
        let items = AnyClass::get(c"NSMenuItem").expect("AppKit is loaded");
        let exemplar: Retained<AnyObject> = msg_send![items, new];
        let _: () = msg_send![&*exemplar, setKeyEquivalent: &*NSString::from_str("n")];
        let _: () = msg_send![&*exemplar, setKeyEquivalentModifierMask: 1usize << 20];
        let _: () = msg_send![&*column, setMenuItem: &*exemplar];
        let font: Retained<AnyObject> = msg_send![submenu, font];
        let _: () = msg_send![&*column, setFont: &*font];
        let _: () = msg_send![&*column, calcSize];
        let count: isize = msg_send![submenu, numberOfItems];
        for index in 0..count {
            let item: Retained<AnyObject> = msg_send![submenu, itemAtIndex: index];
            let separator: bool = msg_send![&*item, isSeparatorItem];
            let children: bool = msg_send![&*item, hasSubmenu];
            if separator || children {
                continue;
            }
            let existing: Option<Retained<AnyObject>> = msg_send![&*item, view];
            if existing.is_some() {
                continue;
            }
            let title: Retained<NSString> = msg_send![&*item, title];
            let cell: Allocated<AnyObject> = msg_send![cells, alloc];
            let cell: Retained<AnyObject> = msg_send![cell, initTextCell: &*title];
            let _: () = msg_send![&*cell, setMenuItem: &*item];
            let _: () = msg_send![&*cell, setFont: &*font];
            let mut size: NSSize = msg_send![&*cell, cellSize];
            let _: () = msg_send![&*cell, setMenuItem: std::ptr::null::<AnyObject>()];
            let hint = hints
                .iter()
                .find(|(at, _)| isize::try_from(*at).ok() == Some(index));
            let hint = hint.map(|(_, hint)| {
                let enabled: bool = msg_send![&*item, isEnabled];
                let attributes = hint_attributes(submenu, enabled);
                let strings = AnyClass::get(c"NSAttributedString").expect("Foundation is loaded");
                let string: Allocated<AnyObject> = msg_send![strings, alloc];
                let string: Retained<AnyObject> = msg_send![string, initWithString: &*NSString::from_str(hint), attributes: &*attributes];
                let hint_size: NSSize = msg_send![&*string, size];
                let em: f64 = msg_send![&*font, pointSize];
                size.width += hint_size.width + em;
                string
            });
            let view = ItemView::alloc(main).set_ivars(ItemViewState {
                cell,
                column: column.clone(),
                hint,
                hover: Cell::new(false),
            });
            let view: Retained<ItemView> =
                msg_send![super(view), initWithFrame: NSRect::new(NSPoint::ZERO, size)];
            // NSViewWidthSizable: AppKit's final row width owns the right edge.
            let _: () = msg_send![&*view, setAutoresizingMask: 2usize];
            let _: () = msg_send![&*item, setView: &*view];
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
            let children: Option<Retained<AnyObject>> = msg_send![&*item, submenu];
            if let Some(children) = children {
                decorate_by_title(&children, hints);
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
                let view: Retained<ItemView> = msg_send![&*item, view];
                let attributed = view.ivars().hint.as_ref().expect("separate hint");
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
            }
        }
    }

    pub(crate) fn u4462_the_hint_stop_is_the_key_equivalent_edge() {
        // A 300 pt row, whose native key rectangle ends at 280 pt, places a
        // 30 pt hint at 250 pt. Growing the row moves the shared edge equally.
        assert_eq!(hint_stop(300.0, 20.0, 30.0), 250.0);
        assert_eq!(hint_stop(400.0, 20.0, 30.0), 350.0);
    }

    unsafe fn stops_and_titles(menu: &AnyObject) -> Vec<String> {
        // SAFETY: `menu` is a live NSMenu on the main thread.
        unsafe {
            let count: isize = msg_send![menu, numberOfItems];
            (0..count)
                .map(|index| {
                    let item: Retained<AnyObject> = msg_send![menu, itemAtIndex: index];
                    let view: Option<Retained<ItemView>> = msg_send![&*item, view];
                    view.and_then(|view| {
                        view.ivars().hint.as_ref().map(|hint| {
                            let string: Retained<NSString> = msg_send![&**hint, string];
                            string.to_string()
                        })
                    })
                    .unwrap_or_default()
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
            let nested = build();
            let parent: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*parent, setSubmenu: &*nested];
            let _: () = msg_send![&*popup, addItem: &*parent];
            decorate_by_title(&popup, &[("Open Project".into(), "⌘K P".into())]);
            assert_eq!(stops_and_titles(&nested)[1], "⌘K P");
            let _: () = msg_send![&*popup, removeItem: &*parent];

            let installed = build();
            let bar: Retained<AnyObject> = msg_send![class(c"NSMenu"), new];
            let project: Retained<AnyObject> = msg_send![class(c"NSMenuItem"), new];
            let _: () = msg_send![&*project, setTitle: &*NSString::from_str("Project")];
            let _: () = msg_send![&*project, setSubmenu: &*installed];
            let _: () = msg_send![&*bar, addItem: &*project];
            let _: () = msg_send![&*application, setMainMenu: &*bar];
            decorate_project_menu(vec![(1, "⌘K P".into())]);

            let (installed, popup) = (stops_and_titles(&installed), stops_and_titles(&popup));
            assert_eq!(installed[1], "⌘K P");
            assert_eq!(installed, popup, "both paths build the same column");
        }
    }
}
