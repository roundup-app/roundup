//! AppKit attributed hints keep sequences separate from executable key equivalents.
use objc2::{
    MainThreadMarker, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::{NSRange, NSSize, NSString};
use tauri::{AppHandle, Runtime};

/// Decorate the freshly built Project submenu on the main thread; indices include separators.
/// Plain titles and key equivalents stay untouched; attributed titles share a right-aligned hint stop.
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
        // A 300 pt menu with a 20 pt trailing inset puts a 30 pt hint at 250.
        assert_eq!(hint_stop(300.0, 20.0, 30.0, 0.0), 250.0);
        assert_eq!(hint_stop(400.0, 20.0, 30.0, 0.0), 350.0);
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
